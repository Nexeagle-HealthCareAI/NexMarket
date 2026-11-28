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
    public class KwTopicDto
    {
        public string? Name { get; set; }
        public string? Department { get; set; }
        public string? Intent { get; set; }
        public string? Status { get; set; }
        public string? OwnerId { get; set; }
        public string? MatchTerms { get; set; }
        public string? Note { get; set; }
    }

    public class KwKeywordDto
    {
        public Guid? TopicId { get; set; }
        public bool? ClearTopic { get; set; }
        public bool? Hidden { get; set; }
    }

    public class KwSeedDto
    {
        public string? Text { get; set; }
        public Guid? TopicId { get; set; }
    }

    public class KwActionDto
    {
        public Guid? TopicId { get; set; }
        public string? Kind { get; set; }
        public string? Title { get; set; }
        public string? Stage { get; set; }
        public string? OwnerId { get; set; }
        public DateOnly? DueOn { get; set; }
        public string? LinkCode { get; set; }
        public string? Url { get; set; }
        public string? Brief { get; set; }
        public int? Spend { get; set; }
    }

    public class KwRunDto { public bool Planner { get; set; } }
    public class KwSettingsDto { public string? Brand { get; set; } }

    /// <summary>
    /// Network → Keywords: what people around the hospital search for, which topics the hospital is missing, where, and
    /// what was done about each, followed through to enquiries, patients who came and admissions. See KeywordService.
    /// </summary>
    [ApiController]
    [Route("api/v1/keywords")]
    [Authorize]
    [PageAccess(Pages.Social, Pages.Analytics)]
    public class KeywordsController : ControllerBase
    {
        public static readonly string[] Kinds = { "page", "post", "ad", "camp", "broadcast" };
        public static readonly string[] Stages = { "idea", "brief", "writing", "review", "live", "done" };
        public static readonly string[] Intents = { "visit", "compare", "learn", "brand" };
        public static readonly string[] TopicStatuses = { "new", "planned", "active", "dismissed" };
        private static readonly string[] Came = { "arrived", "admitted" };

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly KeywordService _kw;

        public KeywordsController(IMarketingDbContext db, IAppSettings settings, KeywordService kw) { _db = db; _settings = settings; _kw = kw; }

        /// <summary>Searches a month for a keyword: Keyword Planner's figure, else an estimate from what Google showed us.</summary>
        public static int DemandOf(int? volume, int impressions, int gbpViews) => volume ?? Math.Max(impressions / 3, gbpViews / 3);

        // ─── Outcomes ────────────────────────────────────────────────────────────────────────────────────────────

        private sealed record LeadRow(Guid Id, string Text, string? SourceRef, string? LandingPage, string Status, string? PartnerClientId, DateTime CreatedAt);
        public sealed record Outcome(int Enquiries, int Came, int Admitted);

        private async Task<List<LeadRow>> LeadsAsync(int days, CancellationToken ct)
        {
            var since = DateTime.UtcNow.AddDays(-days);
            var rows = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= since)
                .Select(l => new { l.Id, l.Note, l.LastMessage, l.SourceRef, l.LandingPage, l.Status, l.PartnerClientId, l.CreatedAt }).ToListAsync(ct);
            return rows.Select(l => new LeadRow(l.Id, KeywordService.Normalize((l.Note ?? "") + " " + (l.LastMessage ?? "")), l.SourceRef, l.LandingPage, l.Status, l.PartnerClientId, l.CreatedAt)).ToList();
        }

        /// <summary>
        /// Leads a topic brought: their message names one of its words, or they came through one of its actions (a tracked
        /// link code, or the page the action made).
        /// </summary>
        public static Outcome OutcomeOf(string[] terms, IEnumerable<(string? Code, string? Url)> actions, IEnumerable<(string Text, string? SourceRef, string? LandingPage, string Status)> leads)
        {
            var codes = actions.Select(a => a.Code).Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c!.ToUpperInvariant()).ToHashSet();
            var paths = actions.Select(a => PathOf(a.Url)).Where(p => p != null && p.Length > 1).Select(p => p!).ToList();
            int n = 0, came = 0, adm = 0;
            foreach (var l in leads)
            {
                var hit = (l.SourceRef != null && codes.Contains(l.SourceRef.ToUpperInvariant()))
                    || (l.LandingPage != null && paths.Any(p => l.LandingPage.Contains(p, StringComparison.OrdinalIgnoreCase)))
                    || terms.Any(t => KeywordService.Contains(l.Text, t));
                if (!hit) continue;
                n++;
                if (Came.Contains(l.Status)) came++;
                if (l.Status == "admitted") adm++;
            }
            return new Outcome(n, came, adm);
        }

        private static string? PathOf(string? url)
        {
            if (string.IsNullOrWhiteSpace(url)) return null;
            return Attribution.PathOf(url);
        }

        /// <summary>The next step a topic needs, from where the hospital stands on it.</summary>
        public static (string Kind, string Text) Suggest(KwTopic t, int month)
        {
            var peaks = (t.PeakMonths ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(p => int.TryParse(p, out var m) ? m : 0).ToArray();
            var soon = peaks.Any(p => p == month % 12 + 1 || p == (month + 1) % 12 + 1);
            if (soon) return ("camp", "Searches peak soon: plan a camp and a WhatsApp broadcast now");
            if (t.BestPosition == null) return t.Intent == "learn"
                ? ("page", "No page of yours shows: write a page that answers it in Hindi")
                : ("page", "Not found on Google: add a page and the service on Business Profile");
            if (t.BestPosition > 10) return ("page", "On page 2: improve the page with cost, timings and the doctor, in Hindi");
            if (t.Intent is "visit" or "compare") return ("ad", "On page 1 but not at the top: a small ad group can win the rest");
            return ("post", "Doing well: keep it fresh with a Business Profile post");
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
        }

        /// <summary>Office staff who can own a topic or an action.</summary>
        [HttpGet("people")]
        public async Task<IActionResult> People(CancellationToken ct)
        {
            var rows = await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Name, a.Role }).ToListAsync(ct);
            return Ok(rows.Where(a => RoleChecks.IsDashboardRole(a.Role)).OrderBy(a => a.Name).Select(a => new { id = a.AgentId, name = a.Name }));
        }

        // ─── Status and run ──────────────────────────────────────────────────────────────────────────────────────

        [HttpGet("status")]
        public async Task<IActionResult> Status(CancellationToken ct)
        {
            await _kw.EnsureTopicsAsync(ct);
            var cfg = GoogleConfig.Load(_settings);
            var counts = await _db.KwKeywords.GroupBy(_ => 1).Select(g => new { N = g.Count(), Topic = g.Count(k => k.TopicId != null), Vol = g.Count(k => k.Volume != null) }).FirstOrDefaultAsync(ct);
            var bySource = (await _db.KwKeywords.AsNoTracking().Select(k => k.Sources).ToListAsync(ct))
                .SelectMany(KeywordService.SourcesOf).GroupBy(s => s).ToDictionary(g => g.Key, g => g.Count());
            Dictionary<string, string>? geo = null;
            try { if (_settings.Get(KeywordService.GeoKey) is { Length: > 0 } j) geo = JsonSerializer.Deserialize<Dictionary<string, string>>(j); } catch (JsonException) { }
            return Ok(new
            {
                google = new { connected = cfg.Connected, gsc = cfg.GscSite != null, gbp = cfg.GbpLocation != null, ads = cfg.AdsCustomer != null, developerToken = !string.IsNullOrWhiteSpace(cfg.AdsDeveloperToken) },
                runAt = _settings.Get(KeywordService.RunAtKey),
                plannerAt = _settings.Get(KeywordService.PlannerAtKey),
                plannerResult = _settings.Get(KeywordService.PlannerResultKey),
                brand = _settings.Get(KeywordService.BrandKey) ?? "",
                keywords = counts?.N ?? 0, grouped = counts?.Topic ?? 0, withVolume = counts?.Vol ?? 0,
                sources = bySource,
                places = geo?.Keys.OrderBy(k => k).ToArray() ?? Array.Empty<string>(),
            });
        }

        [HttpPost("run")]
        public async Task<IActionResult> Run([FromBody] KwRunDto dto, CancellationToken ct)
        {
            var r = await _kw.RunAsync(dto.Planner, User.AgentIdOf(), ct);
            return Ok(new { ok = r.Ok, keywords = r.Keywords, topics = r.Topics, planner = r.Planner, error = r.Error });
        }

        [HttpPut("settings")]
        public async Task<IActionResult> Settings([FromBody] KwSettingsDto dto, CancellationToken ct)
        {
            var brand = string.Join('\n', KeywordService.TermsOf(dto.Brand ?? "").Take(20));
            await _settings.SetAsync(new Dictionary<string, string?> { [KeywordService.BrandKey] = brand }, Array.Empty<string>(), User.AgentIdOf(), ct);
            return Ok(new { brand });
        }

        // ─── Opportunities ───────────────────────────────────────────────────────────────────────────────────────

        [HttpGet("opportunities")]
        public async Task<IActionResult> Opportunities([FromQuery] string? department, [FromQuery] string? district, [FromQuery] string? lang,
            [FromQuery] string? intent, [FromQuery] bool all = false, CancellationToken ct = default)
        {
            await _kw.EnsureTopicsAsync(ct);
            var topics = await _db.KwTopics.AsNoTracking().Where(t => all || t.Status != "dismissed").ToListAsync(ct);
            var kws = await _db.KwKeywords.AsNoTracking().Where(k => k.TopicId != null && !k.Hidden)
                .Select(k => new { k.Id, k.TopicId, k.Text, k.Lang, k.Intent, k.District, k.Volume, k.Impressions, k.GbpViews, k.Position, k.VolumeJson }).ToListAsync(ct);
            var area = string.IsNullOrWhiteSpace(district) ? new Dictionary<Guid, int>()
                : await _db.KwAreaVolumes.AsNoTracking().Where(a => a.District == district).ToDictionaryAsync(a => a.KeywordId, a => a.Volume, ct);
            var actions = await _db.KwActions.AsNoTracking().Select(a => new { a.TopicId, a.LinkCode, a.Url, a.Stage }).ToListAsync(ct);
            var leads = await LeadsAsync(90, ct);
            var leadTuples = leads.Select(l => (l.Text, l.SourceRef, l.LandingPage, l.Status)).ToList();
            var month = IstClock.NowIst.Month;

            var rows = new List<(int Score, int Demand, object Row)>();
            long totalDemand = 0, foundDemand = 0;
            int pCame = 0, pAdm = 0;
            foreach (var t in topics)
            {
                if (!string.IsNullOrWhiteSpace(department) && !string.Equals(t.Department, department, StringComparison.OrdinalIgnoreCase)) continue;
                if (!string.IsNullOrWhiteSpace(intent) && t.Intent != intent) continue;
                var mine = kws.Where(k => k.TopicId == t.Id && (string.IsNullOrWhiteSpace(lang) || k.Lang == lang)).ToList();
                int dem(Guid id, int? vol, int impr, int gbp, string? d) => string.IsNullOrWhiteSpace(district)
                    ? DemandOf(vol, impr, gbp)
                    : area.TryGetValue(id, out var av) ? av : (d == district ? DemandOf(vol, impr, gbp) : 0);
                var demand = mine.Sum(k => dem(k.Id, k.Volume, k.Impressions, k.GbpViews, k.District));
                var filtered = !string.IsNullOrWhiteSpace(lang) || !string.IsNullOrWhiteSpace(district);
                if (filtered && demand == 0) continue;
                totalDemand += demand;
                foundDemand += mine.Where(k => k.Position is <= 10).Sum(k => dem(k.Id, k.Volume, k.Impressions, k.GbpViews, k.District));
                var example = mine.OrderByDescending(k => dem(k.Id, k.Volume, k.Impressions, k.GbpViews, k.District)).FirstOrDefault()?.Text;
                var myActions = actions.Where(a => a.TopicId == t.Id).ToList();
                var o = OutcomeOf(KeywordService.TermsOf(t.MatchTerms), myActions.Select(a => (a.LinkCode, a.Url)), leadTuples);
                pCame += o.Came; pAdm += o.Admitted;
                var (kind, text) = Suggest(t, month);
                rows.Add((t.Score, demand, new
                {
                    id = t.Id, name = t.Name, department = t.Department, intent = t.Intent, status = t.Status, score = t.Score,
                    demand, gapPct = t.GapPct, valuePct = t.ValuePct, bestPosition = t.BestPosition, peakMonths = t.PeakMonths,
                    keywords = mine.Count, langs = mine.Select(k => k.Lang).Distinct().ToArray(), example,
                    trend = Trend(mine.Select(k => k.VolumeJson)),
                    enquiries = o.Enquiries, came = o.Came, admitted = o.Admitted,
                    actions = myActions.Count, liveActions = myActions.Count(a => a.Stage is "live" or "done"),
                    suggestKind = kind, suggest = text,
                }));
            }
            var ordered = rows.OrderByDescending(r => r.Score).ThenByDescending(r => r.Demand).Select(r => r.Row).ToList();
            var depts = topics.Select(t => t.Department).Where(d => !string.IsNullOrWhiteSpace(d)).Distinct().OrderBy(d => d).ToArray();
            var districts = (await _kw.PlacesAsync(ct)).Values.Distinct().OrderBy(d => d).ToArray();

            // The next topic whose searches peak in the coming 2 months.
            string? nextPeak = null; int? peakIn = null;
            foreach (var t in topics.Where(t => t.PeakMonths != null && t.Status != "dismissed").OrderByDescending(t => t.Demand))
            {
                var ms = t.PeakMonths!.Split(',').Select(int.Parse).ToArray();
                for (int ahead = 1; ahead <= 2; ahead++)
                    if (ms.Contains((month - 1 + ahead) % 12 + 1) && !ms.Contains(month)) { nextPeak = t.Name; peakIn = ahead; break; }
                if (nextPeak != null) break;
            }
            return Ok(new
            {
                topics = ordered,
                kpis = new
                {
                    demand = totalDemand, topics = ordered.Count,
                    foundPct = totalDemand > 0 ? (int)Math.Round(100.0 * foundDemand / totalDemand) : (int?)null,
                    came = pCame, admitted = pAdm, nextPeak, peakInMonths = peakIn,
                },
                departments = depts, districts,
            });
        }

        /// <summary>Last 3 months against the same months a year earlier, as a percentage change; null without enough data.</summary>
        public static int? Trend(IEnumerable<string?> volumeJsons)
        {
            var months = volumeJsons.SelectMany(j => KeywordService.MonthsOf(j)).GroupBy(m => m.Month).ToDictionary(g => g.Key, g => g.Sum(x => x.Searches));
            if (months.Count < 12) return null;
            var keys = months.Keys.OrderBy(k => k).ToList();
            var last = keys.TakeLast(3).ToList();
            var before = last.Select(k => $"{int.Parse(k[..4]) - 1:D4}{k[4..]}").ToList();
            if (before.Any(b => !months.ContainsKey(b))) return null;
            long a = last.Sum(k => months[k]), b0 = before.Sum(k => months[k]);
            return b0 <= 0 ? null : (int)Math.Round(100.0 * (a - b0) / b0);
        }

        // ─── One topic ───────────────────────────────────────────────────────────────────────────────────────────

        [HttpGet("topics/{id:guid}")]
        public async Task<IActionResult> Topic(Guid id, CancellationToken ct)
        {
            var t = await _db.KwTopics.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return NotFound();
            var kws = await _db.KwKeywords.AsNoTracking().Where(k => k.TopicId == id && !k.Hidden).ToListAsync(ct);
            var ids = kws.Select(k => k.Id).ToList();
            var areas = await _db.KwAreaVolumes.AsNoTracking().Where(a => ids.Contains(a.KeywordId)).GroupBy(a => a.District)
                .Select(g => new { district = g.Key, searches = g.Sum(x => x.Volume) }).OrderByDescending(x => x.searches).ToListAsync(ct);
            var actions = await _db.KwActions.AsNoTracking().Where(a => a.TopicId == id).OrderByDescending(a => a.UpdatedAt).ToListAsync(ct);
            var leads = await LeadsAsync(90, ct);
            var tuples = leads.Select(l => (l.Text, l.SourceRef, l.LandingPage, l.Status)).ToList();
            var terms = KeywordService.TermsOf(t.MatchTerms);
            var outcome = OutcomeOf(terms, actions.Select(a => (a.LinkCode, a.Url)), tuples);
            var names = await NamesAsync(actions.Select(a => a.OwnerId).Append(t.OwnerId), ct);

            // Searches by month across the topic's keywords: the last 12 months Keyword Planner has.
            var monthly = kws.SelectMany(k => KeywordService.MonthsOf(k.VolumeJson)).GroupBy(m => m.Month)
                .Select(g => new { month = g.Key, searches = g.Sum(x => x.Searches) }).OrderBy(x => x.month).TakeLast(12).ToList();
            var bids = kws.Where(k => k.BidLowMicros != null).ToList();
            return Ok(new
            {
                topic = new
                {
                    t.Id, t.Name, t.Department, t.Intent, t.Status, t.OwnerId, ownerName = t.OwnerId != null ? names.GetValueOrDefault(t.OwnerId) : null,
                    t.MatchTerms, t.Note, t.Score, t.Demand, t.ValuePct, t.GapPct, t.BestPosition, t.PeakMonths, t.IsCustom, t.ScoredAt,
                },
                suggest = Suggest(t, IstClock.NowIst.Month) is var s ? new { kind = s.Kind, text = s.Text } : null,
                outcome = new { enquiries = outcome.Enquiries, came = outcome.Came, admitted = outcome.Admitted },
                bid = bids.Count == 0 ? null : new { low = Math.Round(bids.Min(k => k.BidLowMicros!.Value) / 1_000_000m), high = Math.Round(bids.Max(k => k.BidHighMicros ?? k.BidLowMicros!.Value) / 1_000_000m) },
                monthly, areas,
                keywords = kws.Select(k => new
                {
                    k.Id, k.Text, k.Lang, k.Intent, k.District, demand = DemandOf(k.Volume, k.Impressions, k.GbpViews), estimated = k.Volume == null,
                    k.Position, k.Impressions, k.Clicks, k.GbpViews, k.AdClicks, adCost = Math.Round(k.AdCostMicros / 1_000_000m), k.ChatCount,
                    sources = KeywordService.SourcesOf(k.Sources), manual = KeywordService.SourcesOf(k.Sources).Contains("manual"),
                }).OrderByDescending(k => k.demand).ThenByDescending(k => k.Impressions).Take(300),
                actions = actions.Select(a => ActionRow(a, names, tuples)),
            });
        }

        private static object ActionRow(KwAction a, Dictionary<string, string> names, List<(string Text, string? SourceRef, string? LandingPage, string Status)> leads)
        {
            var hasTrack = !string.IsNullOrWhiteSpace(a.LinkCode) || !string.IsNullOrWhiteSpace(a.Url);
            var o = hasTrack ? OutcomeOf(Array.Empty<string>(), new[] { (a.LinkCode, a.Url) }, leads) : null;
            return new
            {
                a.Id, a.TopicId, a.Kind, a.Title, a.Stage, a.OwnerId, ownerName = a.OwnerId != null ? names.GetValueOrDefault(a.OwnerId) : null,
                a.DueOn, a.LinkCode, a.Url, a.Brief, a.Spend, a.CreatedAt, a.UpdatedAt, a.LiveAt,
                enquiries = o?.Enquiries, came = o?.Came, admitted = o?.Admitted,
                costPerPatient = o != null && o.Came > 0 && a.Spend is > 0 ? (int?)Math.Round((double)a.Spend.Value / o.Came) : null,
            };
        }

        [HttpPost("topics")]
        public async Task<IActionResult> CreateTopic([FromBody] KwTopicDto dto, CancellationToken ct)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length < 3 || name.Length > 80) return BadRequest(new { message = "Give the topic a name of 3 to 80 characters." });
            if (await _db.KwTopics.AnyAsync(t => t.Name.ToLower() == name.ToLower(), ct)) return BadRequest(new { message = "A topic with this name exists." });
            var terms = KeywordService.TermsOf(dto.MatchTerms ?? name);
            if (terms.Length == 0) return BadRequest(new { message = "Add at least one word that belongs to this topic." });
            var t = new KwTopic
            {
                Name = name, Department = Clean(dto.Department, 60), Intent = Intents.Contains(dto.Intent) ? dto.Intent! : "visit",
                MatchTerms = string.Join('\n', terms), IsCustom = true, Note = Clean(dto.Note, 1000),
            };
            _db.KwTopics.Add(t);
            await _db.SaveChangesAsync(ct);
            await RegroupAsync(ct);
            return Ok(new { t.Id });
        }

        [HttpPut("topics/{id:guid}")]
        public async Task<IActionResult> UpdateTopic(Guid id, [FromBody] KwTopicDto dto, CancellationToken ct)
        {
            var t = await _db.KwTopics.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return NotFound();
            var regroup = false;
            if (dto.Name != null)
            {
                var name = dto.Name.Trim();
                if (name.Length < 3 || name.Length > 80) return BadRequest(new { message = "Give the topic a name of 3 to 80 characters." });
                if (await _db.KwTopics.AnyAsync(x => x.Id != id && x.Name.ToLower() == name.ToLower(), ct)) return BadRequest(new { message = "A topic with this name exists." });
                t.Name = name;
            }
            if (dto.Department != null) t.Department = Clean(dto.Department, 60);
            if (dto.Intent != null) { if (!Intents.Contains(dto.Intent)) return BadRequest(new { message = "Unknown intent." }); t.Intent = dto.Intent; }
            if (dto.Status != null) { if (!TopicStatuses.Contains(dto.Status)) return BadRequest(new { message = "Unknown status." }); regroup |= (t.Status == "dismissed") != (dto.Status == "dismissed"); t.Status = dto.Status; }
            if (dto.OwnerId != null) t.OwnerId = dto.OwnerId.Length == 0 ? null : dto.OwnerId;
            if (dto.Note != null) t.Note = Clean(dto.Note, 1000);
            if (dto.MatchTerms != null)
            {
                var terms = KeywordService.TermsOf(dto.MatchTerms);
                if (terms.Length == 0) return BadRequest(new { message = "Keep at least one word for this topic." });
                t.MatchTerms = string.Join('\n', terms);
                regroup = true;
            }
            t.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            if (regroup) await RegroupAsync(ct);
            return Ok(new { t.Id });
        }

        /// <summary>Puts every keyword (except ones a person placed) back in its topic, then rescores.</summary>
        private async Task RegroupAsync(CancellationToken ct)
        {
            var topics = await _db.KwTopics.Where(t => t.Status != "dismissed").ToListAsync(ct);
            var terms = topics.Select(t => (t.Id, KeywordService.TermsOf(t.MatchTerms))).ToList();
            foreach (var k in await _db.KwKeywords.ToListAsync(ct))
                if (!KeywordService.SourcesOf(k.Sources).Contains("manual")) k.TopicId = KeywordService.TopicFor(k.Text, terms);
            await _db.SaveChangesAsync(ct);
            await _kw.ScoreAsync(topics, ct);
        }

        private static string? Clean(string? s, int max)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = s.Trim();
            return s.Length > max ? s[..max] : s;
        }

        // ─── Keywords ────────────────────────────────────────────────────────────────────────────────────────────

        [HttpGet("list")]
        public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] Guid? topic, [FromQuery] string? lang, [FromQuery] bool unassigned = false,
            [FromQuery] bool hidden = false, [FromQuery] int page = 1, CancellationToken ct = default)
        {
            var x = _db.KwKeywords.AsNoTracking().Where(k => k.Hidden == hidden);
            if (!string.IsNullOrWhiteSpace(q)) { var n = KeywordService.Normalize(q); x = x.Where(k => k.Text.Contains(n)); }
            if (topic != null) x = x.Where(k => k.TopicId == topic);
            if (unassigned) x = x.Where(k => k.TopicId == null);
            if (!string.IsNullOrWhiteSpace(lang)) x = x.Where(k => k.Lang == lang);
            var total = await x.CountAsync(ct);
            page = Math.Max(1, page);
            var rows = await x.OrderByDescending(k => k.Volume ?? 0).ThenByDescending(k => k.Impressions).ThenByDescending(k => k.GbpViews).ThenBy(k => k.Text)
                .Skip((page - 1) * 50).Take(50).ToListAsync(ct);
            var topicNames = await _db.KwTopics.AsNoTracking().ToDictionaryAsync(t => t.Id, t => t.Name, ct);
            return Ok(new
            {
                total, page, pageSize = 50,
                items = rows.Select(k => new
                {
                    k.Id, k.Text, k.Lang, k.Intent, k.District, k.TopicId, topic = k.TopicId != null ? topicNames.GetValueOrDefault(k.TopicId.Value) : null,
                    demand = DemandOf(k.Volume, k.Impressions, k.GbpViews), estimated = k.Volume == null, k.Position, k.Impressions, k.GbpViews, k.AdClicks, k.ChatCount,
                    sources = KeywordService.SourcesOf(k.Sources), k.Hidden,
                }),
                topics = topicNames.Select(kv => new { id = kv.Key, name = kv.Value }).OrderBy(t => t.name),
            });
        }

        [HttpPut("list/{id:guid}")]
        public async Task<IActionResult> UpdateKeyword(Guid id, [FromBody] KwKeywordDto dto, CancellationToken ct)
        {
            var k = await _db.KwKeywords.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (k == null) return NotFound();
            if (dto.TopicId != null)
            {
                if (!await _db.KwTopics.AnyAsync(t => t.Id == dto.TopicId, ct)) return BadRequest(new { message = "That topic doesn't exist." });
                k.TopicId = dto.TopicId;
                k.Sources = KeywordService.AddSource(k.Sources, "manual");
            }
            else if (dto.ClearTopic == true)
            {
                k.Sources = string.Join(',', KeywordService.SourcesOf(k.Sources).Where(s => s != "manual"));
                var topics = await _db.KwTopics.AsNoTracking().Where(t => t.Status != "dismissed").Select(t => new { t.Id, t.MatchTerms }).ToListAsync(ct);
                k.TopicId = KeywordService.TopicFor(k.Text, topics.Select(t => (t.Id, KeywordService.TermsOf(t.MatchTerms))));
            }
            if (dto.Hidden != null) k.Hidden = dto.Hidden.Value;
            k.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await _kw.ScoreAsync(await _db.KwTopics.Where(t => t.Status != "dismissed").ToListAsync(ct), ct);
            return Ok(new { k.Id, k.TopicId, k.Hidden });
        }

        /// <summary>Seed words a person adds ("pathri ka operation"), one per line. Keyword Planner adds their volume on the next refresh.</summary>
        [HttpPost("list")]
        public async Task<IActionResult> AddSeeds([FromBody] KwSeedDto dto, CancellationToken ct)
        {
            var lines = (dto.Text ?? "").Split('\n').Select(KeywordService.Normalize).Where(l => l.Length >= 3 && l.Length <= 80).Distinct().Take(200).ToList();
            if (lines.Count == 0) return BadRequest(new { message = "Write one keyword per line (3 to 80 characters)." });
            if (dto.TopicId != null && !await _db.KwTopics.AnyAsync(t => t.Id == dto.TopicId, ct)) return BadRequest(new { message = "That topic doesn't exist." });
            var have = await _db.KwKeywords.Where(k => lines.Contains(k.Text)).ToDictionaryAsync(k => k.Text, ct);
            var topics = await _db.KwTopics.AsNoTracking().Where(t => t.Status != "dismissed").Select(t => new { t.Id, t.MatchTerms }).ToListAsync(ct);
            var terms = topics.Select(t => (t.Id, KeywordService.TermsOf(t.MatchTerms))).ToList();
            var places = await _kw.PlacesAsync(ct);
            var brand = _kw.BrandTerms();
            int added = 0;
            foreach (var l in lines)
            {
                if (!have.TryGetValue(l, out var k))
                {
                    k = new KwKeyword { Text = l, Lang = KeywordService.LangOf(l), Intent = KeywordService.IntentOf(l, brand, places), District = KeywordService.DistrictOf(l, places) };
                    _db.KwKeywords.Add(k);
                    added++;
                }
                k.IsSeed = true;
                k.Sources = KeywordService.AddSource(k.Sources, "seed");
                if (dto.TopicId != null) { k.TopicId = dto.TopicId; k.Sources = KeywordService.AddSource(k.Sources, "manual"); }
                else if (!KeywordService.SourcesOf(k.Sources).Contains("manual")) k.TopicId = KeywordService.TopicFor(l, terms);
                k.UpdatedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { added, total = lines.Count });
        }

        // ─── Areas ───────────────────────────────────────────────────────────────────────────────────────────────

        [HttpGet("areas")]
        public async Task<IActionResult> Areas(CancellationToken ct)
        {
            var places = await _kw.PlacesAsync(ct);
            var districts = places.Values.Distinct().ToList();
            var topics = await _db.KwTopics.AsNoTracking().Where(t => t.Status != "dismissed").ToListAsync(ct);
            var topicDept = topics.ToDictionary(t => t.Id, t => t.Department ?? "General");
            var kws = await _db.KwKeywords.AsNoTracking().Where(k => k.TopicId != null && !k.Hidden)
                .Select(k => new { k.Id, k.TopicId, k.District, k.Volume, k.Impressions, k.GbpViews }).ToListAsync(ct);
            var kwById = kws.ToDictionary(k => k.Id);
            var areaRows = await _db.KwAreaVolumes.AsNoTracking().ToListAsync(ct);
            var fromPlanner = areaRows.Count > 0;

            // district → department → searches; Keyword Planner per district when there, else keywords that name the district.
            var grid = new Dictionary<(string D, string Dept), int>();
            var byTopicDistrict = new Dictionary<(Guid T, string D), int>();
            void Add(string d, Guid topic, int v)
            {
                var dept = topicDept.GetValueOrDefault(topic, "General");
                grid[(d, dept)] = grid.GetValueOrDefault((d, dept)) + v;
                byTopicDistrict[(topic, d)] = byTopicDistrict.GetValueOrDefault((topic, d)) + v;
            }
            if (fromPlanner)
            {
                foreach (var a in areaRows)
                    if (kwById.TryGetValue(a.KeywordId, out var k) && k.TopicId is Guid tid) Add(a.District, tid, a.Volume);
            }
            else
            {
                foreach (var k in kws.Where(k => k.District != null))
                    Add(k.District!, k.TopicId!.Value, DemandOf(k.Volume, k.Impressions, k.GbpViews));
            }
            var allDistricts = districts.Union(grid.Keys.Select(g => g.D)).Distinct().ToList();
            var depts = grid.Keys.Select(g => g.Dept).Distinct().OrderByDescending(d => grid.Where(g => g.Key.Dept == d).Sum(g => g.Value)).Take(8).ToList();

            // Enquiries per district over 90 days: from the partner who sent them, a camp they came from, or the place named in their message.
            var leads = await LeadsAsync(90, ct);
            var partnerIds = leads.Select(l => l.PartnerClientId).Where(p => p != null).Distinct().ToList();
            var partnerDistrict = await (from c in _db.Contacts.AsNoTracking()
                                         where partnerIds.Contains(c.ClientId) && c.PanchayatId != null
                                         join p in _db.Panchayats.AsNoTracking() on c.PanchayatId equals p.PanchayatId
                                         select new { c.ClientId, p.District }).ToListAsync(ct);
            var pd = partnerDistrict.GroupBy(x => x.ClientId).ToDictionary(g => g.Key, g => g.First().District);
            var leadIds = leads.Select(l => l.Id).ToList();
            var campDistrict = await (from cp in _db.CampPatients.AsNoTracking()
                                      where cp.LeadId != null && leadIds.Contains(cp.LeadId.Value) && cp.PanchayatId != null
                                      join p in _db.Panchayats.AsNoTracking() on cp.PanchayatId equals p.PanchayatId
                                      select new { LeadId = cp.LeadId!.Value, p.District }).ToListAsync(ct);
            var cd = campDistrict.GroupBy(x => x.LeadId).ToDictionary(g => g.Key, g => g.First().District);
            var enquiries = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var came = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in leads)
            {
                var d = (l.PartnerClientId != null ? pd.GetValueOrDefault(l.PartnerClientId) : null) ?? cd.GetValueOrDefault(l.Id) ?? KeywordService.DistrictOf(l.Text, places);
                if (d == null) continue;
                var key = allDistricts.FirstOrDefault(x => string.Equals(x, d, StringComparison.OrdinalIgnoreCase)) ?? d;
                enquiries[key] = enquiries.GetValueOrDefault(key) + 1;
                if (Came.Contains(l.Status)) came[key] = came.GetValueOrDefault(key) + 1;
            }

            var rows = allDistricts.Select(d =>
            {
                var searches = grid.Where(g => g.Key.D == d).Sum(g => g.Value);
                var enq = enquiries.GetValueOrDefault(d);
                var topTopics = byTopicDistrict.Where(x => x.Key.D == d).OrderByDescending(x => x.Value).Take(3)
                    .Select(x => new { id = x.Key.T, name = topics.First(t => t.Id == x.Key.T).Name, searches = x.Value }).ToList();
                return new
                {
                    district = d, searches, enquiries = enq, came = came.GetValueOrDefault(d),
                    per100 = searches > 0 ? Math.Round(100.0 * enq / searches, 1) : (double?)null,
                    cells = depts.Select(dep => grid.GetValueOrDefault((d, dep))).ToArray(),
                    topTopics,
                };
            }).Where(r => r.searches > 0 || r.enquiries > 0).OrderByDescending(r => r.searches).ToList();
            return Ok(new { departments = depts, rows, fromPlanner });
        }

        // ─── Content plan (actions) ──────────────────────────────────────────────────────────────────────────────

        [HttpGet("plan")]
        public async Task<IActionResult> Plan(CancellationToken ct)
        {
            var actions = await _db.KwActions.AsNoTracking().OrderBy(a => a.DueOn ?? DateOnly.MaxValue).ThenByDescending(a => a.UpdatedAt).Take(500).ToListAsync(ct);
            var topicIds = actions.Select(a => a.TopicId).Distinct().ToList();
            var topics = await _db.KwTopics.AsNoTracking().Where(t => topicIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => new { t.Name, t.Score, t.Demand }, ct);
            var names = await NamesAsync(actions.Select(a => a.OwnerId), ct);
            var leads = (await LeadsAsync(365, ct)).Select(l => (l.Text, l.SourceRef, l.LandingPage, l.Status)).ToList();
            return Ok(new
            {
                stages = Stages,
                items = actions.Select(a => new
                {
                    action = ActionRow(a, names, leads),
                    topic = topics.TryGetValue(a.TopicId, out var t) ? new { id = a.TopicId, t.Name, t.Score, t.Demand } : null,
                }),
            });
        }

        [HttpPost("actions")]
        public async Task<IActionResult> CreateAction([FromBody] KwActionDto dto, CancellationToken ct)
        {
            if (dto.TopicId == null || !await _db.KwTopics.AnyAsync(t => t.Id == dto.TopicId, ct)) return BadRequest(new { message = "Pick a topic." });
            var a = new KwAction { TopicId = dto.TopicId.Value, CreatedBy = User.AgentIdOf() };
            var err = Apply(a, dto, true);
            if (err != null) return BadRequest(new { message = err });
            _db.KwActions.Add(a);
            var topic = await _db.KwTopics.FirstAsync(t => t.Id == a.TopicId, ct);
            if (topic.Status == "new") topic.Status = "planned";
            await _db.SaveChangesAsync(ct);
            return Ok(new { a.Id });
        }

        [HttpPut("actions/{id:guid}")]
        public async Task<IActionResult> UpdateAction(Guid id, [FromBody] KwActionDto dto, CancellationToken ct)
        {
            var a = await _db.KwActions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (a == null) return NotFound();
            var err = Apply(a, dto, false);
            if (err != null) return BadRequest(new { message = err });
            if (a.Stage is "live" or "done")
            {
                var topic = await _db.KwTopics.FirstAsync(t => t.Id == a.TopicId, ct);
                if (topic.Status is "new" or "planned") topic.Status = "active";
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { a.Id });
        }

        [HttpDelete("actions/{id:guid}")]
        public async Task<IActionResult> DeleteAction(Guid id, CancellationToken ct)
        {
            var a = await _db.KwActions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (a == null) return NotFound();
            _db.KwActions.Remove(a);
            await _db.SaveChangesAsync(ct);
            return NoContent();
        }

        /// <summary>Checks and copies an action's fields; returns what's wrong, or null.</summary>
        public static string? Apply(KwAction a, KwActionDto dto, bool create)
        {
            if (dto.Kind != null || create) { var k = dto.Kind ?? "page"; if (!Kinds.Contains(k)) return "Pick page, post, ad, camp or broadcast."; a.Kind = k; }
            if (dto.Title != null || create)
            {
                var t = (dto.Title ?? "").Trim();
                if (t.Length < 3 || t.Length > 140) return "Give it a title of 3 to 140 characters.";
                a.Title = t;
            }
            if (dto.Stage != null || create)
            {
                var s = dto.Stage ?? "idea";
                if (!Stages.Contains(s)) return "Unknown stage.";
                if (s is "live" or "done" && a.LiveAt == null) a.LiveAt = DateTime.UtcNow;
                a.Stage = s;
            }
            if (dto.OwnerId != null) a.OwnerId = dto.OwnerId.Length == 0 ? null : dto.OwnerId;
            if (dto.DueOn != null) a.DueOn = dto.DueOn;
            if (dto.LinkCode != null)
            {
                var c = dto.LinkCode.Trim().ToUpperInvariant();
                if (c.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(c, @"^[A-Z0-9][A-Z0-9\-]{2,15}$")) return "A tracked link code is 3 to 16 letters, digits or dashes.";
                a.LinkCode = c.Length == 0 ? null : c;
            }
            if (dto.Url != null)
            {
                var u = dto.Url.Trim();
                if (u.Length > 0 && !(u.StartsWith("/") || Uri.TryCreate(u, UriKind.Absolute, out var abs) && abs.Scheme is "https" or "http")) return "The link should start with https:// or /.";
                a.Url = u.Length == 0 ? null : u[..Math.Min(u.Length, 500)];
            }
            if (dto.Brief != null) a.Brief = dto.Brief.Length == 0 ? null : dto.Brief[..Math.Min(dto.Brief.Length, 8000)];
            if (dto.Spend != null) { if (dto.Spend < 0 || dto.Spend > 10_000_000) return "Spend should be in rupees."; a.Spend = dto.Spend == 0 ? null : dto.Spend; }
            a.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        /// <summary>
        /// A writing brief for a page on the topic: the words to use (in the languages people search in), the questions
        /// people ask, and what the page must say. Saved as a new "page" action at the brief stage.
        /// </summary>
        [HttpPost("topics/{id:guid}/brief")]
        public async Task<IActionResult> Brief(Guid id, CancellationToken ct)
        {
            var t = await _db.KwTopics.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return NotFound();
            var kws = await _db.KwKeywords.AsNoTracking().Where(k => k.TopicId == id && !k.Hidden).ToListAsync(ct);
            var text = MakeBrief(t, kws.Select(k => (k.Text, k.Lang, k.Intent, DemandOf(k.Volume, k.Impressions, k.GbpViews), k.Position, k.ChatCount)).ToList());
            var a = new KwAction { TopicId = id, Kind = "page", Title = "Page: " + t.Name, Stage = "brief", Brief = text, CreatedBy = User.AgentIdOf() };
            _db.KwActions.Add(a);
            if (t.Status == "new") t.Status = "planned";
            await _db.SaveChangesAsync(ct);
            return Ok(new { a.Id, brief = text });
        }

        public static string MakeBrief(KwTopic t, List<(string Text, string Lang, string Intent, int Demand, double? Position, int Chats)> kws)
        {
            var sb = new StringBuilder();
            var top = kws.OrderByDescending(k => k.Demand).ThenByDescending(k => k.Chats).ToList();
            var langs = top.Where(k => k.Demand > 0).GroupBy(k => k.Lang).OrderByDescending(g => g.Sum(x => x.Demand)).Select(g => g.Key).ToList();
            string LangName(string l) => l switch { "hi" => "Hindi", "hinglish" => "Hinglish", "bn" => "Bangla", _ => "English" };
            sb.AppendLine($"Topic: {t.Name}" + (t.Department != null ? $" ({t.Department})" : ""));
            sb.AppendLine($"About {t.Demand.ToString("N0", CultureInfo.GetCultureInfo("en-IN"))} searches a month." + (t.BestPosition is double p ? $" Best Google position today: {p:0.#}." : " The hospital doesn't show on Google for it yet."));
            if (langs.Count > 0) sb.AppendLine("Write in: " + string.Join(", ", langs.Take(2).Select(LangName)) + (langs.Count > 1 ? " (main language first)" : "") + ".");
            sb.AppendLine();
            sb.AppendLine("Main words to use (title, first paragraph, a heading):");
            foreach (var k in top.Take(5)) sb.AppendLine($"- {k.Text}");
            var questions = top.Where(k => k.Intent == "learn" || k.Text.Contains("kya") || k.Text.Contains("kaise") || k.Text.Contains("क्या") || k.Text.Contains("कैसे")).Take(5).ToList();
            if (questions.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("Questions people ask (answer each in a short section):");
                foreach (var k in questions) sb.AppendLine($"- {k.Text}");
            }
            var chats = top.Where(k => k.Chats > 0).OrderByDescending(k => k.Chats).Take(5).ToList();
            if (chats.Count > 0)
            {
                sb.AppendLine();
                sb.AppendLine("How patients put it on WhatsApp:");
                foreach (var k in chats) sb.AppendLine($"- {k.Text} ({k.Chats} messages)");
            }
            sb.AppendLine();
            sb.AppendLine("The page must say:");
            if (t.Intent is "visit" or "compare") sb.AppendLine("- Which doctor treats it, OPD days and timings, and how to book (WhatsApp button and phone).");
            if (t.Intent == "compare" || top.Any(k => k.Text.Contains("cost") || k.Text.Contains("kharcha") || k.Text.Contains("खर्च") || k.Text.Contains("price")))
                sb.AppendLine("- A cost range and what it includes, and any scheme accepted (Ayushman Bharat, if the hospital takes it).");
            sb.AppendLine("- Symptoms that mean seeing a doctor soon, and when it is an emergency.");
            sb.AppendLine("- Where the hospital is and how to reach it from nearby districts.");
            sb.AppendLine();
            sb.AppendLine("Before publishing: a doctor reviews the medical content (Manage website → review).");
            return sb.ToString().TrimEnd();
        }
    }
}
