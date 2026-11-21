using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    public record PageStat(string Path, double Clicks, double Impressions, double Position, double PrevClicks, double PrevImpressions, double PrevPosition);
    public record QueryStat(string Query, string Path, double Clicks, double Impressions, double Position);
    public record PageLeads(int Enquiries, int Admitted, int Calls, int WhatsApp, int Bookings, int Forms);
    public record SiteFix(string Kind, string Path, string Title, string Detail, double Score, List<string>? Paths = null, string? Query = null);

    /// <summary>
    /// How each website page does: Google searches (Search Console, already connected on the CRM's Google page), visits
    /// (Google Analytics, when connected), and what visitors did next (enquiries and admissions from the Leads inbox, and
    /// counts of call, WhatsApp and booking clicks). Figures are for the last 28 days with complete data, against the 28 before.
    /// </summary>
    public class SiteInsights
    {
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _app;
        private readonly GoogleApi _api;
        private readonly IMemoryCache _cache;
        public SiteInsights(IMarketingDbContext db, IAppSettings app, GoogleApi api, IMemoryCache cache) { _db = db; _app = app; _api = api; _cache = cache; }

        public static (DateOnly From, DateOnly To, DateOnly PrevFrom, DateOnly PrevTo) Period(DateOnly today)
        {
            var to = today.AddDays(-3); var from = to.AddDays(-27);
            return (from, to, from.AddDays(-28), from.AddDays(-1));
        }

        private static string D(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        /// <summary>A page address as a path: "https://site.in/blogs/x/?a=1" → "/blogs/x".</summary>
        public static string PathOf(string url)
        {
            var p = Uri.TryCreate(url, UriKind.Absolute, out var u) ? u.AbsolutePath : url.Split('?', '#')[0];
            p = Uri.UnescapeDataString(p);
            if (p.Length > 1) p = p.TrimEnd('/');
            return p.Length == 0 ? "/" : p.ToLowerInvariant();
        }

        public GoogleConfig Google => GoogleConfig.Load(_app);

        private async Task<(List<JsonElement> Rows, string? Error)> GscAsync(GoogleConfig cfg, DateOnly from, DateOnly to, string[] dims, int limit, CancellationToken ct, object? filter = null)
        {
            var url = $"https://www.googleapis.com/webmasters/v3/sites/{Uri.EscapeDataString(cfg.GscSite!)}/searchAnalytics/query";
            object body = filter == null
                ? new { startDate = D(from), endDate = D(to), dimensions = dims, rowLimit = limit, dataState = "final" }
                : new { startDate = D(from), endDate = D(to), dimensions = dims, rowLimit = limit, dataState = "final", dimensionFilterGroups = new[] { new { filters = new[] { filter } } } };
            var r = await _api.PostAsync(cfg, url, body, ct);
            if (!r.Ok || r.Doc == null) return (new(), r.Error ?? "Search Console didn't answer.");
            using (r.Doc)
                return (r.Doc.RootElement.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Array ? rows.EnumerateArray().Select(x => x.Clone()).ToList() : new(), null);
        }

        private static double N(JsonElement r, string name) => (double)GoogleApi.Num(r, name);
        private static string Key(JsonElement row, int i) => row.TryGetProperty("keys", out var k) && k.GetArrayLength() > i ? k[i].GetString() ?? "" : "";

        /// <summary>Every page's Search Console figures, this period and the one before. Kept for 6 hours.</summary>
        public async Task<(List<PageStat> Pages, string? Error)> PagesAsync(CancellationToken ct)
        {
            var cfg = Google;
            if (!cfg.Connected || cfg.GscSite == null) return (new(), "Search Console isn't connected. Connect it on the CRM's Google page.");
            return await _cache.GetOrCreateAsync("site-insights:pages", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var p = Period(AttendanceService.TodayIst);
                var (now, err) = await GscAsync(cfg, p.From, p.To, new[] { "page" }, 5000, ct);
                if (err != null) { e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2); return (new List<PageStat>(), err); }
                var (before, _) = await GscAsync(cfg, p.PrevFrom, p.PrevTo, new[] { "page" }, 5000, ct);
                var prev = before.GroupBy(r => PathOf(Key(r, 0))).ToDictionary(g => g.Key, g => (C: g.Sum(r => N(r, "clicks")), I: g.Sum(r => N(r, "impressions")), P: Avg(g)));
                var list = now.GroupBy(r => PathOf(Key(r, 0))).Select(g =>
                {
                    prev.TryGetValue(g.Key, out var pv);
                    return new PageStat(g.Key, g.Sum(r => N(r, "clicks")), g.Sum(r => N(r, "impressions")), Avg(g), pv.C, pv.I, pv.P);
                }).ToList();
                foreach (var (path, pv) in prev.Where(x => list.All(l => l.Path != x.Key))) list.Add(new PageStat(path, 0, 0, 0, pv.C, pv.I, pv.P));
                return (list, (string?)null);
            });
        }

        private static double Avg(IEnumerable<JsonElement> rows)
        {
            double impr = 0, w = 0;
            foreach (var r in rows) { var i = N(r, "impressions"); impr += i; w += N(r, "position") * i; }
            return impr > 0 ? Math.Round(w / impr, 1) : 0;
        }

        /// <summary>Which searches reach which pages (for "competing pages"). Kept for 6 hours.</summary>
        public async Task<List<QueryStat>> QueryPagesAsync(CancellationToken ct)
        {
            var cfg = Google;
            if (!cfg.Connected || cfg.GscSite == null) return new();
            return await _cache.GetOrCreateAsync("site-insights:query-pages", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var p = Period(AttendanceService.TodayIst);
                var (rows, _) = await GscAsync(cfg, p.From, p.To, new[] { "query", "page" }, 25000, ct);
                return rows.Select(r => new QueryStat(Key(r, 0).Trim().ToLowerInvariant(), PathOf(Key(r, 1)), N(r, "clicks"), N(r, "impressions"), Math.Round(N(r, "position"), 1))).ToList();
            }) ?? new();
        }

        /// <summary>The searches that reach one page.</summary>
        public async Task<(List<QueryStat> Queries, string? Error)> QueriesAsync(string path, CancellationToken ct)
        {
            var cfg = Google;
            if (!cfg.Connected || cfg.GscSite == null) return (new(), "Search Console isn't connected. Connect it on the CRM's Google page.");
            var site = (cfg.GscSite.StartsWith("sc-domain:") ? "https://" + cfg.GscSite["sc-domain:".Length..] : cfg.GscSite).TrimEnd('/');
            var p = Period(AttendanceService.TodayIst);
            var (rows, err) = await GscAsync(cfg, p.From, p.To, new[] { "query" }, 200, ct, new { dimension = "page", @operator = "contains", expression = path == "/" ? site + "/" : path });
            return (rows.Select(r => new QueryStat(Key(r, 0).Trim().ToLowerInvariant(), path, N(r, "clicks"), N(r, "impressions"), Math.Round(N(r, "position"), 1)))
                .OrderByDescending(q => q.Impressions).ToList(), err);
        }

        /// <summary>Page views and visits per page from Google Analytics, when it is connected. Kept for 6 hours.</summary>
        public async Task<Dictionary<string, (double Views, double Sessions)>> ViewsAsync(CancellationToken ct)
        {
            var cfg = Google;
            if (!cfg.Connected || cfg.Ga4Property == null) return new();
            return await _cache.GetOrCreateAsync("site-insights:views", async e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6);
                var p = Period(AttendanceService.TodayIst);
                var r = await _api.PostAsync(cfg, $"https://analyticsdata.googleapis.com/v1beta/{cfg.Ga4Property}:runReport", new
                {
                    dateRanges = new[] { new { startDate = D(p.From), endDate = D(p.To) } },
                    dimensions = new[] { new { name = "pagePath" } },
                    metrics = new[] { new { name = "screenPageViews" }, new { name = "sessions" } },
                    limit = 10000,
                }, ct);
                var map = new Dictionary<string, (double, double)>();
                if (!r.Ok || r.Doc == null) { e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2); return map; }
                using (r.Doc)
                    if (r.Doc.RootElement.TryGetProperty("rows", out var rows))
                        foreach (var row in rows.EnumerateArray())
                        {
                            var path = PathOf(row.GetProperty("dimensionValues")[0].GetProperty("value").GetString() ?? "/");
                            var m = row.GetProperty("metricValues");
                            double V(int i) => double.TryParse(m[i].GetProperty("value").GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var v) ? v : 0;
                            map[path] = map.TryGetValue(path, out var had) ? (had.Item1 + V(0), had.Item2 + V(1)) : (V(0), V(1));
                        }
                return map;
            }) ?? new();
        }

        /// <summary>Enquiries and admissions from each page (Leads inbox), and clicks counted on the website, over the period.</summary>
        public async Task<Dictionary<string, PageLeads>> LeadsAsync(CancellationToken ct)
        {
            var p = Period(AttendanceService.TodayIst);
            var since = p.From.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var leads = await _db.Leads.AsNoTracking().Where(l => l.LandingPage != null && l.CreatedAt >= since).Select(l => new { l.LandingPage, l.Status }).ToListAsync(ct);
            var events = await _db.SiteEvents.AsNoTracking().Where(e => e.Day >= p.From).ToListAsync(ct);
            var paths = leads.Select(l => l.LandingPage!).Concat(events.Select(e => e.Path)).Distinct();
            return paths.ToDictionary(path => path, path =>
            {
                int K(string kind) => events.Where(e => e.Path == path && e.Kind == kind).Sum(e => e.Count);
                var mine = leads.Where(l => l.LandingPage == path).ToList();
                return new PageLeads(mine.Count, mine.Count(l => l.Status == "admitted"), K("call"), K("whatsapp"), K("booking"), K("enquiry"));
            });
        }
    }

    /// <summary>What to work on first, from Search Console figures. No database or network, so it can be tested.</summary>
    public static class SiteFixes
    {
        public static List<SiteFix> Find(IEnumerable<PageStat> pages, IEnumerable<QueryStat> queries)
        {
            var fixes = new List<SiteFix>();
            var qs = queries.ToList();
            foreach (var p in pages)
            {
                if (p.PrevClicks >= 10 && p.Clicks <= p.PrevClicks * 0.7)
                {
                    var drop = (int)Math.Round((1 - p.Clicks / p.PrevClicks) * 100);
                    fixes.Add(new SiteFix("losing", p.Path, "Losing visitors from Google",
                        $"{p.PrevClicks:0} visits from Google in the 28 days before, {p.Clicks:0} in the last 28 (down {drop}%). Check that its title and summary still match what people search, and that the facts are current.", p.PrevClicks - p.Clicks));
                }
                if (p.Position >= 8 && p.Position <= 20 && p.Impressions >= 50)
                {
                    var top = qs.Where(q => q.Path == p.Path && q.Position >= 8 && q.Position <= 20).OrderByDescending(q => q.Impressions).FirstOrDefault();
                    fixes.Add(new SiteFix("almost", p.Path, "Almost on Google's first page",
                        $"Shown {p.Impressions:0} times, on average at place {p.Position:0.#}. Places 1–10 get most of the visits."
                        + (top != null ? $" Its main search is “{top.Query}” (place {top.Position:0.#}): answer it clearly near the top and in the title." : " Answering the main question clearly near the top, and linking to it from related pages, often helps."),
                        p.Impressions / Math.Max(1, p.Position - 7), Query: top?.Query));
                }
            }
            foreach (var g in qs.GroupBy(q => q.Query))
            {
                var total = g.Sum(q => q.Impressions);
                var rivals = g.Where(q => q.Impressions >= total * 0.1).OrderByDescending(q => q.Impressions).ToList();
                if (rivals.Count < 2 || total < 30) continue;
                fixes.Add(new SiteFix("competing", rivals[0].Path, "Pages competing for the same search",
                    $"For “{g.Key}” ({total:0} searches), Google shows {string.Join(" and ", rivals.Take(3).Select(r => r.Path))}. When two pages answer the same question, Google often ranks neither well: make one the main page for it and link the others to it.",
                    total / 2, rivals.Select(r => r.Path).ToList(), g.Key));
            }
            return fixes.OrderByDescending(f => f.Score).Take(50).ToList();
        }

        private static readonly Regex QuestionRx = new(@"^(how|what|why|when|where|which|who|can|is|are|does|do|should|will|kya|kaise|kab|kyu|kyon|kitna|kaun)\b|\?$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        public static bool IsQuestion(string query) => QuestionRx.IsMatch(query.Trim());
    }

    /// <summary>Checks on how an article reads, for patients. Advice only; nothing here blocks publishing.</summary>
    public static class SiteWriting
    {
        private static readonly Regex Sentence = new(@"[^.!?।]+[.!?।]+|[^.!?।]+$", RegexOptions.Compiled);
        private static readonly Regex Word = new(@"[A-Za-zऀ-ॿঀ-৿']+", RegexOptions.Compiled);

        public static int Syllables(string word)
        {
            var w = word.ToLowerInvariant().Trim('\'');
            if (w.Length <= 3) return 1;
            w = Regex.Replace(w, "(?:[^laeiouy]es|ed|[^laeiouy]e)$", "");
            w = Regex.Replace(w, "^y", "");
            return Math.Max(1, Regex.Matches(w, "[aeiouy]{1,2}").Count);
        }

        /// <summary>Flesch reading ease of English text: 60–70 is plain English; under 50 is hard for most patients.</summary>
        public static double ReadingEase(string text)
        {
            var sentences = Sentence.Matches(text).Count(m => Word.IsMatch(m.Value));
            var words = Word.Matches(text).Select(m => m.Value).ToList();
            if (sentences == 0 || words.Count < 30) return 100;
            var syl = words.Sum(Syllables);
            return Math.Round(206.835 - 1.015 * ((double)words.Count / sentences) - 84.6 * ((double)syl / words.Count), 0);
        }

        public static List<string> Check(JsonObject d)
        {
            var w = new List<string>();
            var sections = (d["sections"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
            var headings = sections.Select(s => SiteRules.Text(s["heading"])).Where(h => h.Length > 0).ToList();
            foreach (var dup in headings.GroupBy(h => h.ToLowerInvariant()).Where(g => g.Count() > 1)) w.Add($"Two sections have the same heading (\"{dup.First()}\"). Each heading should say what is different in its section.");
            foreach (var h in headings.Where(h => h.Length > 70)) w.Add($"The heading \"{h[..40]}…\" is long. A short heading is easier to scan.");
            if (SiteRules.Text(d["title"]).Length > 0 && headings.Any(h => string.Equals(h, SiteRules.Text(d["title"]), StringComparison.OrdinalIgnoreCase))) w.Add("A section heading repeats the title. Use the heading to say what the section adds.");
            var all = new List<string>();
            for (var i = 0; i < sections.Count; i++)
                foreach (var p in (sections[i]["paragraphs"] as JsonArray ?? new JsonArray()).Select(SiteRules.Text))
                {
                    all.Add(p);
                    var n = Word.Matches(p).Count;
                    if (n > 120) w.Add($"A paragraph in section {i + 1} has {n} words. Paragraphs under about 80 words are easier to read on a phone.");
                }
            var text = string.Join(" ", all);
            var lang = SiteRules.Text(d["language"]);
            if (lang is "" or "en")
            {
                var sentences = Sentence.Matches(text).Select(m => m.Value).Where(s => Word.IsMatch(s)).ToList();
                var longOnes = sentences.Count(s => Word.Matches(s).Count > 30);
                if (longOnes > 0) w.Add($"{longOnes} sentence{(longOnes == 1 ? " is" : "s are")} over 30 words. Splitting them helps patients follow.");
                var ease = ReadingEase(text);
                if (ease < 50) w.Add($"This reads as hard (reading ease {ease:0}; 60 or more is plain English). Shorter sentences and everyday words help.");
            }
            return w;
        }
    }

    /// <summary>Other pages worth linking to from this one, by the words they share.</summary>
    public static class SiteRelated
    {
        private static readonly HashSet<string> Stop = new(("about after again also always among another because been before being between both cannot could does doing during each even every from have having here into just more most much must never only other over same should some such than that their them then there these they this those through under until very what when where which while will with within without would your yours your doctor doctors hospital patient patients purnia bihar treatment care").Split(' '));
        public static Dictionary<string, int> Terms(string text) =>
            Regex.Matches(text.ToLowerInvariant(), @"[a-z]{4,}").Select(m => m.Value).Where(t => !Stop.Contains(t))
                .GroupBy(t => t.EndsWith('s') && t.Length > 5 ? t[..^1] : t).ToDictionary(g => g.Key, g => g.Count());

        public static double Score(Dictionary<string, int> a, Dictionary<string, int> b)
        {
            var ta = a.OrderByDescending(x => x.Value).Take(40).Select(x => x.Key).ToHashSet();
            var tb = b.OrderByDescending(x => x.Value).Take(40).Select(x => x.Key).ToHashSet();
            if (ta.Count == 0 || tb.Count == 0) return 0;
            return Math.Round((double)ta.Intersect(tb).Count() / ta.Union(tb).Count(), 3);
        }

        public static string TextOf(JsonNode? n) => n switch
        {
            JsonObject o => string.Join(" ", o.Where(kv => kv.Key is not ("image" or "references" or "slug" or "id" or "related")).Select(kv => TextOf(kv.Value))),
            JsonArray a => string.Join(" ", a.Select(TextOf)),
            JsonValue v when v.TryGetValue<string>(out var s) => s,
            _ => "",
        };

        public static List<(string Title, string Path, double Score)> Suggest(string text, IEnumerable<(string Title, string Path, string Text)> others, string? self)
        {
            var mine = Terms(text);
            return others.Where(o => o.Path != self).Select(o => (o.Title, o.Path, Score: Score(mine, Terms(o.Text)))).Where(x => x.Score >= 0.08)
                .OrderByDescending(x => x.Score).Take(5).ToList();
        }
    }
}
