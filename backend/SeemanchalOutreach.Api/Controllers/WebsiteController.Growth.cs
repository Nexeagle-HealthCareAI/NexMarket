using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SiteTranslateDto { public string? Language { get; set; } }
    public class SiteHookDto { public string? Url { get; set; } }
    public class SiteKeyDto { public string? Name { get; set; } }
    public class SiteChainDto { public string? HeadOffice { get; set; } public string? Branches { get; set; } }

    public partial class WebsiteController
    {
        /// <summary>The path of an item's page on the website, for matching search figures; null for things without a page.</summary>
        public static string? PathOf(SiteContent c, JsonObject d) => c.Type switch
        {
            "article" => SitePublisher.BlogPath(c.Key),
            "service" => SiteRules.Text(d["slug"]) is { Length: > 0 } s ? "/services/" + s : null,
            "location" => "/areas/" + c.Key,
            "faq" => "/faqs", "doctor" => "/doctors", "camp" => "/health-camps", "site" => "/",
            _ => null,
        };

        // ── Search and results (phase 3) ───────────────────────────────────────

        /// <summary>Every page with its Google figures, visits and what visitors did; and what to fix first.</summary>
        [HttpGet("insights")]
        public async Task<IActionResult> Insights([FromServices] SiteInsights insights, CancellationToken ct)
        {
            var (pages, err) = await insights.PagesAsync(ct);
            var queries = err == null ? await insights.QueryPagesAsync(ct) : new();
            var views = await insights.ViewsAsync(ct);
            var leads = await insights.LeadsAsync(ct);
            var items = await _db.SiteContents.AsNoTracking().Where(c => !c.Archived && c.Published != null).ToListAsync(ct);
            var byPath = items.Select(c => (c, Path: PathOf(c, SiteRules.Parse(c.Data)))).Where(x => x.Path != null).GroupBy(x => x.Path!).ToDictionary(g => g.Key, g => g.First().c);
            var paths = pages.Select(p => p.Path).Concat(views.Keys).Concat(leads.Keys).Distinct();
            var p = SiteInsights.Period(AttendanceService.TodayIst);
            var g = insights.Google;
            return Ok(new
            {
                period = new { from = p.From.ToString("yyyy-MM-dd"), to = p.To.ToString("yyyy-MM-dd") },
                searchConsole = new { connected = g.Connected && g.GscSite != null, error = err }, analytics = g.Connected && g.Ga4Property != null,
                rows = paths.Select(path =>
                {
                    var s = pages.FirstOrDefault(x => x.Path == path);
                    views.TryGetValue(path, out var v); leads.TryGetValue(path, out var l);
                    byPath.TryGetValue(path, out var item);
                    return new
                    {
                        path, itemId = item?.Id, title = item?.Title, type = item?.Type,
                        clicks = s?.Clicks ?? 0, prevClicks = s?.PrevClicks ?? 0, impressions = s?.Impressions ?? 0, position = s?.Position ?? 0,
                        views = v.Views, enquiries = l?.Enquiries ?? 0, admitted = l?.Admitted ?? 0, calls = l?.Calls ?? 0, whatsapp = l?.WhatsApp ?? 0, bookings = l?.Bookings ?? 0,
                    };
                }).OrderByDescending(r => r.clicks + r.views / 10 + r.enquiries * 5).Take(300),
                fixes = SiteFixes.Find(pages, queries).Select(f => new { kind = f.Kind, path = f.Path, title = f.Title, detail = f.Detail, paths = f.Paths, query = f.Query, itemId = byPath.TryGetValue(f.Path, out var it) ? it.Id : (Guid?)null }),
            });
        }

        /// <summary>One page's figures, its searches (questions marked), and other pages worth linking to.</summary>
        [HttpGet("{id:guid}/insights")]
        public async Task<IActionResult> ItemInsights(Guid id, [FromServices] SiteInsights insights, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var d = SiteRules.Parse(c.Data);
            var path = PathOf(c, d);
            object? figures = null; List<QueryStat> queries = new(); string? error = null;
            if (path != null)
            {
                var (pages, err) = await insights.PagesAsync(ct);
                error = err;
                var s = pages.FirstOrDefault(x => x.Path == path);
                (await insights.LeadsAsync(ct)).TryGetValue(path, out var l);
                (await insights.ViewsAsync(ct)).TryGetValue(path, out var v);
                figures = new { clicks = s?.Clicks ?? 0, prevClicks = s?.PrevClicks ?? 0, impressions = s?.Impressions ?? 0, position = s?.Position ?? 0, views = v.Views, enquiries = l?.Enquiries ?? 0, admitted = l?.Admitted ?? 0, calls = l?.Calls ?? 0, whatsapp = l?.WhatsApp ?? 0, bookings = l?.Bookings ?? 0 };
                if (err == null) (queries, error) = await insights.QueriesAsync(path, ct);
            }
            var others = (await _db.SiteContents.AsNoTracking().Where(x => x.Published != null && !x.Archived && (x.Type == "article" || x.Type == "service" || x.Type == "location")).ToListAsync(ct))
                .Select(x => { var pd = SiteRules.Parse(x.Published); return (x.Title, Path: PathOf(x, SiteRules.Parse(x.Data)) ?? "", Text: SiteRelated.TextOf(pd)); }).Where(x => x.Path.Length > 0);
            var related = c.Type is "article" or "service" or "location" ? SiteRelated.Suggest(SiteRelated.TextOf(d), others, path) : new();
            return Ok(new
            {
                path, figures, error,
                queries = queries.Take(25).Select(q => new { query = q.Query, clicks = q.Clicks, impressions = q.Impressions, position = q.Position, question = SiteFixes.IsQuestion(q.Query) }),
                related = related.Select(r => new { title = r.Title, path = r.Path, score = r.Score }),
            });
        }

        [HttpPost("{id:guid}/ai/questions")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> AiQuestions(Guid id, [FromServices] ChatAiService ai, [FromServices] SiteInsights insights, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var path = PathOf(c, SiteRules.Parse(c.Data));
            var searched = path == null ? new List<string>() : (await insights.QueriesAsync(path, ct)).Queries.Select(q => q.Query).ToList();
            try { return Ok(new { questions = await ai.ArticleQuestionsAsync(Me, c.Title, searched, ct) }); }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
        }

        /// <summary>A Hindi or Bengali copy of an article as a new AI draft, linked to the original, for a person to check and a reviewer to approve.</summary>
        [HttpPost("{id:guid}/ai/translate")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> AiTranslate(Guid id, [FromBody] SiteTranslateDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Type == "article", ct);
            if (c == null) return NotFound(new { message = "That article isn't here any more." });
            var lang = dto.Language is "hi" or "bn" ? dto.Language : null;
            if (lang == null) return No("Pick Hindi or Bengali.");
            var d = SiteRules.Clean("article", SiteRules.Parse(c.Data));
            if (SiteRules.Text(d["language"]) is "hi" or "bn") return No("This is already a translation. Translate the English article.");
            var key = $"{c.Key}-{lang}";
            if (await _db.SiteContents.AnyAsync(x => x.Type == "article" && x.Key == key, ct)) return No("That translation already exists. Open it from Content.");
            var forAi = new JsonObject { ["title"] = d["title"]?.DeepClone(), ["excerpt"] = d["excerpt"]?.DeepClone(), ["sections"] = d["sections"]?.DeepClone() };
            JsonObject t;
            try { t = await ai.ArticleTranslateAsync(Me, forAi.ToJsonString(), lang, ct); }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
            var copy = (JsonObject)d.DeepClone();
            copy["title"] = t["title"]?.DeepClone(); copy["excerpt"] = t["excerpt"]?.DeepClone(); copy["sections"] = t["sections"]?.DeepClone();
            copy["language"] = lang; copy["translationOf"] = c.Key; copy["slug"] = key;
            return await Create(new SiteContentDto { Type = "article", Data = copy, AiDrafted = true }, ct);
        }

        // ── Re-review ──────────────────────────────────────────────────────────

        [HttpGet("rereview")]
        public async Task<IActionResult> ReReview(CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app); var today = AttendanceService.TodayIst;
            var due = (await _db.SiteContents.AsNoTracking().Where(c => c.Published != null && c.Status == "published" && !c.Archived).ToListAsync(ct))
                .Where(c => SiteRules.DueForReview(c, cfg, today)).OrderBy(c => c.ReviewedOn).ToList();
            return Ok(new { months = cfg.ReReviewMonths, items = due.Select(c => new { id = c.Id, title = c.Title, type = c.Type, reviewedOn = c.ReviewedOn?.ToString("yyyy-MM-dd"), reviewedByName = c.ReviewedByName }) });
        }

        // ── Guided setup (phase 4) ─────────────────────────────────────────────

        [HttpGet("steps")]
        public async Task<IActionResult> Steps(CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var approved = await _db.SiteContentVersions.AnyAsync(v => v.Action == "approved", ct);
            var live = await _db.SitePublishes.AnyAsync(p => p.Status == "live", ct);
            var steps = new[]
            {
                new { key = "repo", label = "Connect the website's repository", done = cfg.Connected, detail = cfg.Connected ? cfg.Repo : "Create the GitHub App and fill in step 2 below. No website yet? Make a starter website first (below)." },
                new { key = "import", label = "Bring in what is on the website", done = cfg.ImportedAt != null, detail = cfg.ImportedAt != null ? "Done." : "Step 3 below, after the connection test passes." },
                new { key = "people", label = "Give people their rights", done = approved, detail = approved ? "A reviewer has approved something." : "Users & roles: Website (write), Website: review (a doctor), Website: publish, Website: developer." },
                new { key = "publish", label = "Publish something", done = live, detail = live ? "Done." : "Start small: change one question and publish it." },
                new { key = "search", label = "Connect Google Search Console (optional)", done = GoogleConfig.Load(_app) is { Connected: true, GscSite: not null }, detail = "On the CRM's Google page. It fills the Search & results tab." },
            };
            return Ok(new { steps });
        }

        // ── Chains ─────────────────────────────────────────────────────────────

        [HttpPut("chain")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> SaveChain([FromBody] SiteChainDto dto, [FromServices] OrgDirectory orgs, CancellationToken ct)
        {
            var me = OrgScope.Current?.Key ?? orgs.Default.Key;
            var head = (dto.HeadOffice ?? "").Trim().ToLowerInvariant();
            var branches = (dto.Branches ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(b => b.ToLowerInvariant()).Distinct().ToList();
            var known = orgs.All().Select(o => o.Key.ToLowerInvariant()).ToHashSet();
            if (head.Length > 0 && (!known.Contains(head) || head == me.ToLowerInvariant())) return No("That head office isn't another organisation on this platform.");
            if (branches.FirstOrDefault(b => !known.Contains(b) || b == me.ToLowerInvariant()) is { } bad) return No($"\"{bad}\" isn't another organisation on this platform.");
            await _app.SetAsync(new Dictionary<string, string?> { [SiteConfig.Prefix + "headOffice"] = head.Length > 0 ? head : null, [SiteConfig.Prefix + "branches"] = branches.Count > 0 ? string.Join(",", branches) : null }, SiteConfig.SecretKeys.ToList(), Me, ct);
            return Ok(new { headOffice = head, branches });
        }

        /// <summary>Head office: offer an item to the branches, or stop offering it (branches keep what they adopted).</summary>
        [HttpPost("{id:guid}/share")]
        [PageAccess(Pages.WebsitePublish)]
        public async Task<IActionResult> Share(Guid id, [FromQuery] bool off, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            if (c.Type is "site" or "redirect") return No("This can't be shared.");
            c.Shared = !off; await _db.SaveChangesAsync(ct);
            return Ok(new { shared = c.Shared });
        }

        /// <summary>Branch: what the head office shares, and which of it this branch has adopted.</summary>
        [HttpGet("chain")]
        public async Task<IActionResult> Chain([FromServices] OrgDirectory orgs, [FromServices] IServiceScopeFactory scopes, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var mine = await _db.SiteContents.AsNoTracking().Where(c => c.ChainId != null).Select(c => new { c.Id, c.ChainId, c.ChainVersion }).ToListAsync(ct);
            var known = orgs.All().Select(o => new { key = o.Key, name = o.Name });
            if (string.IsNullOrWhiteSpace(cfg.HeadOffice)) return Ok(new { headOffice = (string?)null, branches = cfg.Branches, orgs = known, items = Array.Empty<object>() });
            var (head, problem) = SiteChain.OpenHead(orgs, scopes, cfg);
            if (head == null) return Ok(new { headOffice = cfg.HeadOffice, branches = cfg.Branches, orgs = known, problem, items = Array.Empty<object>() });
            List<SiteContent> shared;
            using (head) shared = await head.Db.SiteContents.AsNoTracking().Where(c => c.Shared && c.Published != null && !c.Archived).OrderBy(c => c.Type).ThenBy(c => c.Title).ToListAsync(ct);
            return Ok(new
            {
                headOffice = cfg.HeadOffice, headName = head.Org.Name, branches = cfg.Branches, orgs = known,
                items = shared.Select(s =>
                {
                    var had = mine.FirstOrDefault(m => m.ChainId == s.Id);
                    return new { id = s.Id, type = s.Type, title = s.Title, version = s.Version, adoptedId = had?.Id, adoptedVersion = had?.ChainVersion, newer = had != null && had.ChainVersion < s.Version };
                }),
            });
        }

        private async Task<(SiteContent? Item, string? Org, string? Problem)> HeadItemAsync(OrgDirectory orgs, IServiceScopeFactory scopes, Guid headId, CancellationToken ct)
        {
            var (head, problem) = SiteChain.OpenHead(orgs, scopes, SiteConfig.Load(_app));
            if (head == null) return (null, null, problem);
            using (head)
            {
                var item = await head.Db.SiteContents.AsNoTracking().FirstOrDefaultAsync(c => c.Id == headId && c.Shared && c.Published != null, ct);
                return (item, head.Org.Key, item == null ? "The head office no longer shares that." : null);
            }
        }

        /// <summary>Branch: a local copy of a shared item, as a draft here (this branch's own review and publish rules apply).</summary>
        [HttpPost("chain/adopt/{headId:guid}")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Adopt(Guid headId, [FromServices] OrgDirectory orgs, [FromServices] IServiceScopeFactory scopes, CancellationToken ct)
        {
            if (await _db.SiteContents.AnyAsync(c => c.ChainId == headId, ct)) return No("This branch already has it. Open it from Content.");
            var (item, org, problem) = await HeadItemAsync(orgs, scopes, headId, ct);
            if (item == null) return No(problem!);
            var data = SiteRules.Parse(item.Data);
            var res = await Create(new SiteContentDto { Type = item.Type, Data = data }, ct);
            if (res is OkObjectResult ok && ok.Value?.GetType().GetProperty("id")?.GetValue(ok.Value) is Guid newId)
            {
                var c = (await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == newId, ct))!;
                c.ChainOrg = org; c.ChainId = item.Id; c.ChainVersion = item.Version; c.ChainBase = c.Data;
                await _db.SaveChangesAsync(ct);
            }
            return res;
        }

        /// <summary>Branch: takes the head office's newer version. Fields changed here are kept; every other field follows the head office.</summary>
        [HttpPost("{id:guid}/chain-update")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> ChainUpdate(Guid id, [FromServices] OrgDirectory orgs, [FromServices] IServiceScopeFactory scopes, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id && x.ChainId != null, ct);
            if (c == null) return NotFound(new { message = "That isn't from the head office." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            var (item, _, problem) = await HeadItemAsync(orgs, scopes, c.ChainId!.Value, ct);
            if (item == null) return No(problem!);
            if (item.Version <= (c.ChainVersion ?? 0)) return No("This already has the head office's latest version.");
            var theirs = SiteRules.Clean(c.Type, SiteRules.Parse(item.Data));
            if (c.Type != "site") theirs[SiteTypes.Of(c.Type).KeyField] = c.Key;
            var (merged, kept) = SiteChain.Merge(SiteRules.Parse(c.ChainBase), SiteRules.Parse(c.Data), theirs);
            var res = await Save(id, new SiteContentDto { Data = merged, Version = c.Version }, ct);
            c = (await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct))!;
            c.ChainVersion = item.Version; c.ChainBase = theirs.ToJsonString();
            await _db.SaveChangesAsync(ct);
            return res is OkObjectResult ? Ok(new { kept, version = c.Version }) : res;
        }

        // ── Webhooks ───────────────────────────────────────────────────────────

        [HttpGet("hooks")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> Hooks(CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var log = await _db.SiteWebhookDeliveries.AsNoTracking().OrderByDescending(d => d.CreatedAt).Take(40)
                .Select(d => new { id = d.Id, hook = d.Hook, url = d.Url, @event = d.Event, status = d.Status, tries = d.Tries, lastError = d.LastError, lastStatus = d.LastStatus, createdAt = d.CreatedAt, sentAt = d.SentAt }).ToListAsync(ct);
            return Ok(new { hooks = cfg.Hooks.Select(h => new { n = h.N, url = h.Url, secret = Last4(h.Secret) }), log });
        }

        /// <summary>Adds an address to tell about publishes. Its signing secret is shown once, now.</summary>
        [HttpPost("hooks")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> AddHook([FromBody] SiteHookDto dto, CancellationToken ct)
        {
            var url = (dto.Url ?? "").Trim();
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != "https") return No("The address must start with https://.");
            var cfg = SiteConfig.Load(_app);
            var free = new[] { 1, 2, 3 }.FirstOrDefault(n => cfg.Hooks.All(h => h.N != n));
            if (free == 0) return No("Up to three webhooks. Remove one first.");
            var secret = SiteHooks.NewSecret();
            await _app.SetAsync(new Dictionary<string, string?> { [$"{SiteConfig.Prefix}hook{free}Url"] = url, [$"{SiteConfig.Prefix}hook{free}Secret"] = secret }, SiteConfig.SecretKeys.ToList(), Me, ct);
            return Ok(new { n = free, url, secret });
        }

        [HttpPost("hooks/{n:int}/remove")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> RemoveHook(int n, CancellationToken ct)
        {
            if (n is < 1 or > 3) return No("No such webhook.");
            await _app.SetAsync(new Dictionary<string, string?> { [$"{SiteConfig.Prefix}hook{n}Url"] = null, [$"{SiteConfig.Prefix}hook{n}Secret"] = null }, SiteConfig.SecretKeys.ToList(), Me, ct);
            return Ok(new { ok = true });
        }

        [HttpPost("hooks/{n:int}/test")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> TestHook(int n, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var h = cfg.Hooks.FirstOrDefault(x => x.N == n);
            if (h.Url == null) return No("No such webhook.");
            _db.SiteWebhookDeliveries.Add(new SiteWebhookDelivery { Hook = n, Url = h.Url, Event = "ping", Payload = SiteHooks.Payload("ping", cfg, Array.Empty<(string, string, string, string?)>(), DateTime.UtcNow) });
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ── Read API keys ──────────────────────────────────────────────────────

        [HttpGet("keys")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> Keys(CancellationToken ct) =>
            Ok(new { items = await _db.SiteApiKeys.AsNoTracking().OrderByDescending(k => k.CreatedAt).Select(k => new { id = k.Id, name = k.Name, last4 = "••••" + k.Last4, createdByName = k.CreatedByName, createdAt = k.CreatedAt, lastUsedAt = k.LastUsedAt, revokedAt = k.RevokedAt }).ToListAsync(ct) });

        /// <summary>A new key to read the live content. It is shown once, now; only its hash is kept.</summary>
        [HttpPost("keys")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> AddKey([FromBody] SiteKeyDto dto, CancellationToken ct)
        {
            var name = Hoardings.Clean(dto.Name, 80);
            if (string.IsNullOrWhiteSpace(name)) return No("Name the key after what will use it, e.g. \"Hospital app\".");
            var key = SiteKeys.NewKey();
            _db.SiteApiKeys.Add(new SiteApiKey { Name = name, Hash = SiteKeys.Hash(key), Last4 = key[^4..], CreatedByName = await MyNameAsync(ct) });
            await _db.SaveChangesAsync(ct);
            return Ok(new { key, org = OrgScope.Current?.Key ?? "" });
        }

        [HttpPost("keys/{id:guid}/revoke")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> RevokeKey(Guid id, CancellationToken ct)
        {
            var k = await _db.SiteApiKeys.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (k == null) return NotFound();
            k.RevokedAt ??= DateTime.UtcNow; await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ── Starter website ────────────────────────────────────────────────────

        [HttpGet("starter.zip")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> StarterZip([FromServices] SiteStarter starter, [FromServices] OrgDirectory orgs, CancellationToken ct)
        {
            var org = OrgScope.Current ?? orgs.Default;
            var files = await starter.FilesAsync(org.Name, SiteConfig.Load(_app), ct);
            var folder = SiteRules.Slug(org.Name) is { Length: > 0 } s ? s + "-website" : "website";
            return File(SiteStarter.Zip(files, folder), "application/zip", folder + ".zip");
        }

        /// <summary>Opens a pull request with the starter website in the connected repository, if it has no website yet. It is not merged by itself.</summary>
        [HttpPost("starter/pr")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> StarterPr([FromServices] SiteStarter starter, [FromServices] GitHubClient gh, [FromServices] OrgDirectory orgs, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            if (!cfg.Connected) return No("Connect the (empty) repository first in step 2.");
            try
            {
                if (await gh.FileAsync(cfg, cfg.FilePath("site.json"), cfg.Branch, ct) != null || await gh.FileAsync(cfg, "package.json", cfg.Branch, ct) != null)
                    return No("This repository already has a website. A starter website is only for an empty repository.");
                var files = await starter.FilesAsync((OrgScope.Current ?? orgs.Default).Name, cfg, ct);
                var baseSha = (await gh.GetAsync(cfg, $"/git/ref/heads/{cfg.Branch}", ct, missingOk: true))?["object"]?["sha"]?.ToString();
                if (baseSha == null) return No($"The repository has no \"{cfg.Branch}\" branch yet. On GitHub, add a README to the empty repository first (it creates the branch), then try again.");
                var baseTree = (await gh.GetAsync(cfg, $"/git/commits/{baseSha}", ct))?["tree"]?["sha"]?.ToString();
                var entries = new JsonArray();
                foreach (var (path, bytes) in files)
                {
                    var blob = await gh.SendAsync(cfg, HttpMethod.Post, "/git/blobs", new JsonObject { ["content"] = Convert.ToBase64String(bytes), ["encoding"] = "base64" }, ct);
                    entries.Add(new JsonObject { ["path"] = path, ["mode"] = "100644", ["type"] = "blob", ["sha"] = blob?["sha"]?.ToString() });
                }
                var tree = (await gh.SendAsync(cfg, HttpMethod.Post, "/git/trees", new JsonObject { ["base_tree"] = baseTree, ["tree"] = entries }, ct))?["sha"]?.ToString();
                var commit = (await gh.SendAsync(cfg, HttpMethod.Post, "/git/commits", new JsonObject { ["message"] = "Starter website from the CRM", ["tree"] = tree, ["parents"] = new JsonArray(baseSha) }, ct))?["sha"]?.ToString();
                var branch = $"crm/starter-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
                await gh.SendAsync(cfg, HttpMethod.Post, "/git/refs", new JsonObject { ["ref"] = "refs/heads/" + branch, ["sha"] = commit }, ct);
                var pr = await gh.SendAsync(cfg, HttpMethod.Post, "/pulls", new JsonObject
                {
                    ["title"] = "Starter website", ["head"] = branch, ["base"] = cfg.Branch,
                    ["body"] = "A starter website made by the CRM from the organisation's records. Build it with `node build.mjs`; see README.md for publishing. Review it, then merge.",
                }, ct);
                return Ok(new { url = pr?["html_url"]?.ToString(), files = files.Count });
            }
            catch (GitHubException ex) { return No(ex.Message); }
        }
    }

    /// <summary>
    /// For other systems and for the website itself: read the live content with an API key, and count clicks per page.
    /// Organisation by ?org=&lt;name&gt;. Nothing here returns anything that isn't already public on the website.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/public")]
    public class PublicWebsiteController : ControllerBase
    {
        private static readonly string[] Kinds = { "call", "whatsapp", "booking", "enquiry" };
        private readonly IMarketingDbContext _db;
        public PublicWebsiteController(IMarketingDbContext db) { _db = db; }

        private async Task<bool> KeyOkAsync(CancellationToken ct)
        {
            var raw = Request.Headers["X-Api-Key"].ToString();
            if (string.IsNullOrEmpty(raw) && Request.Headers.Authorization.ToString() is var a && a.StartsWith("Bearer ", StringComparison.Ordinal)) raw = a[7..];
            if (raw.Length < 20 || raw.Length > 100) return false;
            var hash = SiteKeys.Hash(raw);
            var k = await _db.SiteApiKeys.FirstOrDefaultAsync(x => x.Hash == hash && x.RevokedAt == null, ct);
            if (k == null) return false;
            if (k.LastUsedAt == null || k.LastUsedAt < DateTime.UtcNow.AddMinutes(-10)) { k.LastUsedAt = DateTime.UtcNow; await _db.SaveChangesAsync(ct); }
            return true;
        }

        private static object Item(SiteContent c) => new
        {
            type = c.Type, key = c.Key, title = c.Title, publishedAt = c.PublishedAt, reviewedOn = c.ReviewedOn?.ToString("yyyy-MM-dd"),
            content = JsonNode.Parse(c.Published ?? "{}"),
        };

        /// <summary>Everything live on the website, or one kind (?type=article).</summary>
        [HttpGet("website/content")]
        [EnableRateLimiting("webform")]
        public async Task<IActionResult> Content([FromQuery] string? type, CancellationToken ct)
        {
            if (!await KeyOkAsync(ct)) return Unauthorized(new { message = "A valid API key is needed (header X-Api-Key)." });
            var q = _db.SiteContents.AsNoTracking().Where(c => c.Published != null && !c.Archived);
            if (!string.IsNullOrWhiteSpace(type)) q = q.Where(c => c.Type == type);
            var rows = await q.OrderBy(c => c.Type).ThenBy(c => c.SortOrder).ThenBy(c => c.Key).Take(2000).ToListAsync(ct);
            return Ok(new { items = rows.Select(Item) });
        }

        [HttpGet("website/content/{type}/{key}")]
        [EnableRateLimiting("webform")]
        public async Task<IActionResult> One(string type, string key, CancellationToken ct)
        {
            if (!await KeyOkAsync(ct)) return Unauthorized(new { message = "A valid API key is needed (header X-Api-Key)." });
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Type == type && x.Key == key && x.Published != null, ct);
            return c == null ? NotFound() : Ok(Item(c));
        }

        /// <summary>
        /// The website counts a click on a call, WhatsApp, booking or enquiry button: only the kind and the page path, per day.
        /// No names, numbers, addresses or cookies. Sent with navigator.sendBeacon as text/plain.
        /// </summary>
        [HttpPost("web-event")]
        [EnableRateLimiting("webform")]
        public async Task<IActionResult> Event(CancellationToken ct)
        {
            Response.Headers["Access-Control-Allow-Origin"] = "*";
            string body;
            using (var r = new System.IO.StreamReader(Request.Body, Encoding.UTF8)) body = await r.ReadToEndAsync(ct);
            if (body.Length > 500) return BadRequest();
            JsonObject? o;
            try { o = JsonNode.Parse(body) as JsonObject; } catch (System.Text.Json.JsonException) { return BadRequest(); }
            var kind = o?["kind"]?.ToString() ?? "";
            var page = SiteInsights.PathOf(o?["page"]?.ToString() ?? "");
            if (!Kinds.Contains(kind) || page.Length > 200 || !System.Text.RegularExpressions.Regex.IsMatch(page, @"^/[\p{L}\p{N}\-/_.]*$")) return BadRequest();
            var day = AttendanceService.TodayIst;
            var row = await _db.SiteEvents.FirstOrDefaultAsync(e => e.Day == day && e.Path == page && e.Kind == kind, ct);
            if (row == null) _db.SiteEvents.Add(new SiteEvent { Day = day, Path = page, Kind = kind, Count = 1 });
            else row.Count++;
            try { await _db.SaveChangesAsync(ct); } catch (DbUpdateException) { /* two clicks at once on a new row: one is enough */ }
            return NoContent();
        }
    }
}
