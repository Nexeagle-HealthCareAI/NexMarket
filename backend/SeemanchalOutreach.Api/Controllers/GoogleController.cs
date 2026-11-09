using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class GoogleReplyDto { public string? Text { get; set; } }

    /// <summary>
    /// The Google page: what the hospital's Google listing, website, YouTube channel and Google Ads did, day by day, read
    /// straight from Google by NexMarket (see GoogleSyncService), set against the leads and arrivals that came from Google.
    /// </summary>
    [ApiController]
    [Route("api/v1/google")]
    [Authorize]
    [PageAccess(Pages.Social)]
    public class GoogleController : ControllerBase
    {
        /// <summary>Lead sources that mean "found us on Google".</summary>
        public static readonly string[] GoogleLeadSources = { "google_listing", "google_ads", "web" };

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly GoogleSyncService _sync;

        public GoogleController(IMarketingDbContext db, IAppSettings settings, GoogleSyncService sync) { _db = db; _settings = settings; _sync = sync; }

        private sealed record Range(DateOnly From, DateOnly To, DateOnly PrevFrom, DateOnly PrevTo);
        private sealed record Pt(DateOnly Date, string Source, string Metric, decimal Value);

        private async Task<Range> RangeAsync(string? from, string? to, CancellationToken ct)
        {
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            var t = DateOnly.TryParse(to, CultureInfo.InvariantCulture, out var td) ? td : today;
            DateOnly f;
            if (DateOnly.TryParse(from, CultureInfo.InvariantCulture, out var fd)) f = fd;
            else f = await _db.ChannelMetrics.Where(m => m.Dimension == "").OrderBy(m => m.Date).Select(m => (DateOnly?)m.Date).FirstOrDefaultAsync(ct) ?? t.AddDays(-29);
            if (f > t) (f, t) = (t, f);
            var len = t.DayNumber - f.DayNumber + 1;
            return new Range(f, t, f.AddDays(-len), f.AddDays(-1));
        }

        private object Status()
        {
            var c = GoogleConfig.Load(_settings);
            object? last = null;
            if (c.SyncResult != null) try { last = JsonSerializer.Deserialize<JsonElement>(c.SyncResult); } catch (JsonException) { /* old value */ }
            return new
            {
                connected = c.Connected,
                sources = new { gbp = c.GbpLocation != null, gsc = c.GscSite != null, ga4 = c.Ga4Property != null, youtube = c.YtChannel != null, ads = c.AdsCustomer != null },
                names = new { gbp = c.GbpName, gsc = c.GscSite, ga4 = c.Ga4Name, youtube = c.YtName, ads = c.AdsName },
                currency = c.AdsCurrency ?? "INR",
                syncedAt = c.SyncedAt,
                lastSync = last,
                isAdmin = User.IsInRole("Admin") || User.IsInRole("admin"),
            };
        }

        [HttpGet("overview")]
        public async Task<IActionResult> Overview([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var r = await RangeAsync(from, to, ct);
            var rows = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Dimension == "" && m.Date >= r.PrevFrom && m.Date <= r.To)
                .Select(m => new Pt(m.Date, m.Source, m.Metric, m.Value)).ToListAsync(ct);
            var cur = rows.Where(x => x.Date >= r.From).ToList();
            var prev = rows.Where(x => x.Date < r.From).ToList();
            static decimal Sum(IEnumerable<Pt> xs, string src, string metric) => xs.Where(x => x.Source == src && x.Metric == metric).Sum(x => x.Value);
            bool Has(string src) => cur.Any(x => x.Source == src);

            object M(string key, string label, string src, string metric, string format = "n") => new
            {
                key, label, format,
                value = Sum(cur, src, metric),
                prev = prev.Any(x => x.Source == src) ? Sum(prev, src, metric) : (decimal?)null,
            };
            static decimal? Pos(IEnumerable<Pt> xs)
            {
                var impr = Sum(xs, "gsc", "impressions");
                return impr == 0 ? null : Math.Round(Sum(xs, "gsc", "position_x_impr") / impr, 1);
            }
            decimal? Latest(string metric) => rows.Where(x => x.Source == "gbp" && x.Metric == metric && x.Date <= r.To).OrderByDescending(x => x.Date).Select(x => (decimal?)x.Value).FirstOrDefault();

            var cards = new List<object>();
            if (Has("gbp"))
                cards.Add(new
                {
                    source = "gbp", label = "Google listing (Search & Maps)",
                    metrics = new[]
                    {
                        M("calls", "Calls", "gbp", "calls"), M("directions", "Direction requests", "gbp", "directions"),
                        M("website_clicks", "Website clicks", "gbp", "website_clicks"),
                        new { key = "views", label = "Times shown", format = "n", value = Sum(cur, "gbp", "views_search") + Sum(cur, "gbp", "views_maps"),
                              prev = prev.Any(x => x.Source == "gbp") ? Sum(prev, "gbp", "views_search") + Sum(prev, "gbp", "views_maps") : (decimal?)null } as object,
                    },
                    note = "Google shows these 2–5 days late.",
                });
            if (Has("gsc"))
                cards.Add(new
                {
                    source = "gsc", label = "Google Search → website",
                    metrics = new[]
                    {
                        M("clicks", "Clicks to website", "gsc", "clicks"), M("impressions", "Times shown", "gsc", "impressions"),
                        new { key = "position", label = "Average position", format = "pos", value = Pos(cur), prev = prev.Any(x => x.Source == "gsc") ? Pos(prev) : null } as object,
                    },
                    note = "Search Console shows these 2–3 days late.",
                });
            if (Has("ga4"))
                cards.Add(new
                {
                    source = "ga4", label = "Website visits",
                    metrics = new[] { M("sessions", "Visits", "ga4", "sessions"), M("users", "Visitors", "ga4", "users"), M("key_events", "Key events (forms, calls)", "ga4", "key_events") },
                    note = (string?)null,
                });
            if (Has("youtube"))
                cards.Add(new
                {
                    source = "youtube", label = "YouTube",
                    metrics = new[]
                    {
                        M("views", "Views", "youtube", "views"), M("watch_minutes", "Minutes watched", "youtube", "watch_minutes"),
                        new { key = "subs", label = "New subscribers", format = "n", value = Sum(cur, "youtube", "subscribers_gained") - Sum(cur, "youtube", "subscribers_lost"),
                              prev = prev.Any(x => x.Source == "youtube") ? Sum(prev, "youtube", "subscribers_gained") - Sum(prev, "youtube", "subscribers_lost") : (decimal?)null } as object,
                    },
                    note = "YouTube shows these 2–3 days late.",
                });
            if (Has("google_ads"))
                cards.Add(new
                {
                    source = "google_ads", label = "Google Ads",
                    metrics = new[]
                    {
                        M("cost", "Spend", "google_ads", "cost", "money"), M("clicks", "Clicks", "google_ads", "clicks"),
                        M("phone_calls", "Calls from ads", "google_ads", "phone_calls"), M("conversions", "Conversions", "google_ads", "conversions"),
                    },
                    note = (string?)null,
                });

            // One row per day for the chart.
            var days = new List<object>();
            for (var d = r.From; d <= r.To && days.Count < 800; d = d.AddDays(1))
            {
                var day = cur.Where(x => x.Date == d).ToList();
                decimal? V(string src, params string[] metrics) => day.Any(x => x.Source == src) ? day.Where(x => x.Source == src && metrics.Contains(x.Metric)).Sum(x => x.Value) : null;
                days.Add(new
                {
                    date = d.ToString("yyyy-MM-dd"),
                    calls = V("gbp", "calls"), directions = V("gbp", "directions"), listingWebsite = V("gbp", "website_clicks"),
                    searchClicks = V("gsc", "clicks"), visits = V("ga4", "sessions"), ytViews = V("youtube", "views"), adCost = V("google_ads", "cost"),
                });
            }

            // Leads that came from Google, and how many reached the hospital.
            var fromUtc = IstClock.StartOfIstDayUtc(r.From);
            var toUtc = IstClock.StartOfIstDayUtc(r.To.AddDays(1));
            var leads = await _db.Leads.AsNoTracking()
                .Where(l => GoogleLeadSources.Contains(l.Source) && l.CreatedAt >= fromUtc && l.CreatedAt < toUtc)
                .GroupBy(l => l.Source)
                .Select(g => new { source = g.Key, leads = g.Count(), arrived = g.Count(x => x.Status == "arrived" || x.Status == "admitted") })
                .ToListAsync(ct);

            // Reviews.
            var reviews = await _db.GoogleReviews.AsNoTracking().Select(x => new { x.Stars, x.PostedAt, x.ReplyText }).ToListAsync(ct);
            var inRange = reviews.Where(x => x.PostedAt >= fromUtc && x.PostedAt < toUtc).ToList();

            return Ok(new
            {
                range = new { from = r.From, to = r.To, prevFrom = r.PrevFrom, prevTo = r.PrevTo },
                status = Status(),
                cards,
                days,
                crm = GoogleLeadSources.Select(s => new
                {
                    source = s, label = LeadInbox.SourceLabel(s),
                    leads = leads.FirstOrDefault(x => x.source == s)?.leads ?? 0,
                    arrived = leads.FirstOrDefault(x => x.source == s)?.arrived ?? 0,
                }),
                reviews = new
                {
                    rating = Latest("rating") ?? (reviews.Any(x => x.Stars > 0) ? Math.Round((decimal)reviews.Where(x => x.Stars > 0).Average(x => x.Stars), 1) : (decimal?)null),
                    total = (int?)Latest("review_count") ?? reviews.Count,
                    newInRange = inRange.Count,
                    newAverage = inRange.Count(x => x.Stars > 0) > 0 ? Math.Round((decimal)inRange.Where(x => x.Stars > 0).Average(x => x.Stars), 1) : (decimal?)null,
                    unanswered = reviews.Count(x => x.ReplyText == null),
                    lowUnanswered = reviews.Count(x => x.ReplyText == null && x.Stars is > 0 and <= 3),
                },
            });
        }

        /// <summary>What people searched: Google Search terms that led to the website (Search Console), and the terms that showed the listing (Business Profile, monthly).</summary>
        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? q, CancellationToken ct)
        {
            var r = await RangeAsync(from, to, ct);
            var gsc = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "gsc" && m.Dimension.StartsWith("query:") && m.Date >= r.From && m.Date <= r.To)
                .GroupBy(m => new { m.Dimension, m.Metric }).Select(g => new { g.Key.Dimension, g.Key.Metric, Value = g.Sum(x => x.Value) })
                .ToListAsync(ct);
            var needle = (q ?? "").Trim().ToLowerInvariant();
            var queries = gsc.GroupBy(x => x.Dimension)
                .Select(g =>
                {
                    decimal V(string m) => g.Where(x => x.Metric == m).Sum(x => x.Value);
                    var impr = V("impressions");
                    var clicks = V("clicks");
                    return new
                    {
                        term = g.Key[6..], clicks, impressions = impr,
                        ctr = impr > 0 ? Math.Round(clicks / impr * 100, 1) : 0,
                        position = impr > 0 ? Math.Round(V("position_x_impr") / impr, 1) : (decimal?)null,
                    };
                })
                .Where(x => needle.Length == 0 || x.term.Contains(needle))
                .OrderByDescending(x => x.clicks).ThenByDescending(x => x.impressions).Take(200).ToList();

            // Business Profile terms are monthly: take every month the range touches.
            var m0 = new DateOnly(r.From.Year, r.From.Month, 1);
            var listing = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "gbp" && m.Metric == "keyword_views" && m.Date >= m0 && m.Date <= r.To)
                .Select(m => new { m.Dimension, m.Value, m.Label, m.Date }).ToListAsync(ct);
            var months = listing.Select(x => x.Date).Distinct().OrderBy(d => d).ToList();
            var keywords = listing.GroupBy(x => x.Dimension)
                .Select(g => new { term = g.Key[8..], views = g.Sum(x => x.Value), under = g.All(x => x.Label == "under") })
                .Where(x => needle.Length == 0 || x.term.Contains(needle))
                .OrderByDescending(x => x.under ? 0 : 1).ThenByDescending(x => x.views).Take(200).ToList();

            return Ok(new
            {
                range = new { from = r.From, to = r.To },
                status = Status(),
                queries,
                listing = new { months = months.Select(d => d.ToString("yyyy-MM")), keywords },
            });
        }

        /// <summary>Website visits by channel and by campaign (UTM tags), and Google Ads campaigns, each with the CRM leads and arrivals they brought.</summary>
        [HttpGet("website")]
        public async Task<IActionResult> Website([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var r = await RangeAsync(from, to, ct);
            var ga = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "ga4" && m.Dimension != "" && m.Date >= r.From && m.Date <= r.To)
                .GroupBy(m => new { m.Dimension, m.Metric }).Select(g => new { g.Key.Dimension, g.Key.Metric, Value = g.Sum(x => x.Value), Label = g.Max(x => x.Label) })
                .ToListAsync(ct);
            var ads = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "google_ads" && m.Dimension.StartsWith("campaign:") && m.Date >= r.From && m.Date <= r.To)
                .GroupBy(m => new { m.Dimension, m.Metric }).Select(g => new { g.Key.Dimension, g.Key.Metric, Value = g.Sum(x => x.Value), Label = g.Max(x => x.Label) })
                .ToListAsync(ct);

            var fromUtc = IstClock.StartOfIstDayUtc(r.From);
            var toUtc = IstClock.StartOfIstDayUtc(r.To.AddDays(1));
            var leads = await _db.Leads.AsNoTracking()
                .Where(l => GoogleLeadSources.Contains(l.Source) && l.SourceRef != null && l.CreatedAt >= fromUtc && l.CreatedAt < toUtc)
                .Select(l => new { l.Source, Ref = l.SourceRef!.ToLower(), l.Status }).ToListAsync(ct);
            (int Leads, int Arrived) Crm(params string[] keys)
            {
                var k = keys.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim().ToLowerInvariant()).ToHashSet();
                var ls = leads.Where(l => k.Contains(l.Ref)).ToList();
                return (ls.Count, ls.Count(x => x.Status is "arrived" or "admitted"));
            }

            var channels = ga.Where(x => x.Dimension.StartsWith("channel:")).GroupBy(x => x.Dimension)
                .Select(g => new
                {
                    channel = g.Key[8..],
                    visits = g.Where(x => x.Metric == "sessions").Sum(x => x.Value),
                    visitors = g.Where(x => x.Metric == "users").Sum(x => x.Value),
                    keyEvents = g.Where(x => x.Metric == "key_events").Sum(x => x.Value),
                }).OrderByDescending(x => x.visits).ToList();

            var campaigns = ga.Where(x => x.Dimension.StartsWith("campaign:")).GroupBy(x => x.Dimension)
                .Select(g =>
                {
                    var name = g.Key[9..].Split('|')[0];
                    var (l, a) = Crm(name);
                    return new
                    {
                        campaign = name, label = g.Max(x => x.Label) ?? name,
                        visits = g.Where(x => x.Metric == "sessions").Sum(x => x.Value),
                        keyEvents = g.Where(x => x.Metric == "key_events").Sum(x => x.Value),
                        leads = l, arrived = a,
                    };
                }).OrderByDescending(x => x.visits).Take(100).ToList();

            var adRows = ads.GroupBy(x => x.Dimension)
                .Select(g =>
                {
                    decimal V(string m) => g.Where(x => x.Metric == m).Sum(x => x.Value);
                    var id = g.Key[9..];
                    var name = g.Max(x => x.Label) ?? id;
                    var (l, a) = Crm(id, name);
                    var cost = V("cost");
                    return new
                    {
                        id, name, cost, impressions = V("impressions"), clicks = V("clicks"), calls = V("phone_calls"), conversions = V("conversions"),
                        leads = l, arrived = a,
                        costPerLead = l > 0 ? Math.Round(cost / l) : (decimal?)null,
                        costPerArrival = a > 0 ? Math.Round(cost / a) : (decimal?)null,
                    };
                }).OrderByDescending(x => x.cost).ToList();

            return Ok(new { range = new { from = r.From, to = r.To }, status = Status(), channels, campaigns, ads = adRows });
        }

        [HttpGet("reviews")]
        public async Task<IActionResult> Reviews([FromQuery] string? show, CancellationToken ct)
        {
            var q = _db.GoogleReviews.AsNoTracking();
            q = show switch
            {
                "unanswered" => q.Where(x => x.ReplyText == null),
                "low" => q.Where(x => x.Stars > 0 && x.Stars <= 3),
                _ => q,
            };
            var items = await q.OrderByDescending(x => x.PostedAt).Take(300)
                .Select(x => new { id = x.Id, reviewer = x.ReviewerName, stars = x.Stars, comment = x.Comment, postedAt = x.PostedAt, reply = x.ReplyText, repliedAt = x.RepliedAt, repliedBy = x.RepliedBy })
                .ToListAsync(ct);
            var all = await _db.GoogleReviews.AsNoTracking().Select(x => new { x.Stars, x.ReplyText }).ToListAsync(ct);
            return Ok(new
            {
                status = Status(),
                counts = new
                {
                    all = all.Count, unanswered = all.Count(x => x.ReplyText == null), low = all.Count(x => x.Stars is > 0 and <= 3),
                    stars = Enumerable.Range(1, 5).Reverse().Select(s => new { stars = s, count = all.Count(x => x.Stars == s) }),
                },
                items,
            });
        }

        /// <summary>Replies to a review on Google from the CRM. Never about a patient's treatment: the desk is reminded in the screen.</summary>
        [HttpPost("reviews/{id:guid}/reply")]
        public async Task<IActionResult> Reply(Guid id, [FromBody] GoogleReplyDto dto, CancellationToken ct)
        {
            var text = (dto.Text ?? "").Trim();
            if (text.Length < 2) return BadRequest(new { message = "Write the reply first." });
            if (text.Length > 4000) return BadRequest(new { message = "Google allows replies up to 4,000 characters." });
            var review = await _db.GoogleReviews.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (review == null) return NotFound(new { message = "That review isn't here any more." });
            var err = await _sync.ReplyAsync(review, text, User.AgentIdOf(), ct);
            if (err != null) return BadRequest(new { message = err });
            return Ok(new { id = review.Id, reply = review.ReplyText, repliedAt = review.RepliedAt, repliedBy = review.RepliedBy });
        }

        /// <summary>Fetches from Google now.</summary>
        [HttpPost("sync")]
        public async Task<IActionResult> Sync(CancellationToken ct)
        {
            var c = GoogleConfig.Load(_settings);
            if (!c.Connected) return BadRequest(new { message = "Google isn't connected yet. An admin can connect it in Google → Setup." });
            if (!c.AnySource) return BadRequest(new { message = "Pick at least one Google account to follow in Google → Setup." });
            var res = await _sync.SyncAsync(User.AgentIdOf(), ct);
            return Ok(res);
        }

        [HttpGet("export.csv")]
        public async Task<IActionResult> Export([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var r = await RangeAsync(from, to, ct);
            var rows = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Date >= r.From && m.Date <= r.To && !m.Dimension.StartsWith("query:") && !m.Dimension.StartsWith("keyword:") && m.Metric != "position_x_impr")
                .OrderBy(m => m.Date).ThenBy(m => m.Source).ThenBy(m => m.Dimension).ThenBy(m => m.Metric)
                .Select(m => new { m.Date, m.Source, m.Dimension, m.Label, m.Metric, m.Value }).ToListAsync(ct);
            var sb = new StringBuilder("Date,Source,Breakdown,Name,Metric,Value\n");
            static string Csv(string? s)
            {
                s ??= "";
                if (s.Length > 0 && "=+-@".Contains(s[0])) s = "'" + s;
                return s.Contains(',') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
            }
            foreach (var x in rows)
                sb.Append(x.Date.ToString("yyyy-MM-dd")).Append(',').Append(Csv(GoogleSyncService.SourceLabels.GetValueOrDefault(x.Source, x.Source))).Append(',')
                  .Append(Csv(x.Dimension == "" ? "Total" : x.Dimension)).Append(',').Append(Csv(x.Label)).Append(',').Append(Csv(x.Metric)).Append(',')
                  .Append(x.Value.ToString("0.##", CultureInfo.InvariantCulture)).Append('\n');
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"google-{r.From:yyyy-MM-dd}-to-{r.To:yyyy-MM-dd}.csv");
        }
    }
}
