using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SiteContentDto
    {
        public string? Type { get; set; }
        public JsonObject? Data { get; set; }
        /// <summary>The version the editor opened, so two people don't overwrite each other.</summary>
        public int? Version { get; set; }
        public bool AiDrafted { get; set; }
    }
    public class SiteNoteDto { public string? Note { get; set; } }
    public class SiteOrderDto { public List<Guid>? Ids { get; set; } }
    public class SitePublishDto { public List<SitePublishItemDto>? Items { get; set; } public string? Target { get; set; } }
    public class SitePublishItemDto { public Guid Id { get; set; } public string? Action { get; set; } }
    public class SiteSetupDto
    {
        public string? RepoOwner { get; set; }
        public string? RepoName { get; set; }
        public string? Branch { get; set; }
        public string? ContentDir { get; set; }
        public string? MediaDir { get; set; }
        public string? SiteUrl { get; set; }
        public string? AppId { get; set; }
        /// <summary>Left empty = keep the saved one.</summary>
        public string? PrivateKey { get; set; }
        public string? Token { get; set; }
        public bool ClearToken { get; set; }
        public List<string>? ReviewTypes { get; set; }
        public List<string>? Departments { get; set; }
        public bool? Ai { get; set; }
        public string? StagingBranch { get; set; }
        public string? ScanFiles { get; set; }
    }
    public class SiteAiDraftDto { public string? Topic { get; set; } public string? DepartmentId { get; set; } public string? Notes { get; set; } }
    public class SiteAiTextDto { public JsonObject? Data { get; set; } }

    /// <summary>
    /// The CRM's Website page: write and review the website's articles, questions and hospital details, and publish
    /// them. Four separate rights (Users &amp; roles): write, review, publish, developer. Nothing is ever deleted: taking
    /// something down archives it. A medical article is not published without a named reviewer.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Website, Pages.WebsiteReview, Pages.WebsitePublish, Pages.WebsiteDevelop)]
    [Route("api/v1/website")]
    public partial class WebsiteController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _app;
        private readonly IPermissionService _perms;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        private readonly SitePublisher _publisher;
        public WebsiteController(IMarketingDbContext db, IAppSettings app, IPermissionService perms, IFileStore files, INotifier notifier, SitePublisher publisher)
        { _db = db; _app = app; _perms = perms; _files = files; _notifier = notifier; _publisher = publisher; }

        private string Me => User.AgentIdOf();
        private async Task<string> MyNameAsync(CancellationToken ct) =>
            await _db.Agents.AsNoTracking().Where(a => a.AgentId == Me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? Me;
        private async Task<bool> CanAsync(string page) => User.IsAdmin() || await _perms.GetLevelAsync(User, page) >= Pages.Edit;
        private IActionResult No(string message) => BadRequest(new { message });
        private static string Last4(string? v) => string.IsNullOrEmpty(v) ? "" : v.Length <= 4 ? "••••" : "••••" + v[^4..];

        private static object Row(SiteContent c, JsonObject d) => new
        {
            id = c.Id, type = c.Type, key = c.Key, title = c.Title, status = c.Status, live = SiteRules.Live(c),
            // Live, and the working copy is no longer what is live.
            changed = SiteRules.Live(c) && c.Status != "published" && c.Status != "publishing",
            version = c.Version, sortOrder = c.SortOrder, aiDrafted = c.AiDrafted, archived = c.Archived, note = c.Note,
            department = c.Type == "article" ? SiteRules.Text(d["departmentId"]) : null, category = c.Type == "faq" ? SiteRules.Text(d["category"]) : null,
            submittedByName = c.SubmittedByName, submittedAt = c.SubmittedAt, reviewedByName = c.ReviewedByName, reviewedAt = c.ReviewedAt,
            publishedAt = c.PublishedAt, firstPublishedOn = c.FirstPublishedOn?.ToString("yyyy-MM-dd"), hasPicture = c.ImageKey != null,
            createdByName = c.CreatedByName, updatedByName = c.UpdatedByName, updatedAt = c.UpdatedAt,
            publishAt = c.PublishAt, unpublishAt = c.UnpublishAt, scheduledByName = c.ScheduledByName, stagedAt = c.StagedAt,
            date = c.Type == "camp" ? SiteRules.Text(d["date"]) : null, linked = c.Type == "doctor" ? SiteRules.Text(d["crmDoctorId"]).Length > 0 : c.Type == "camp" ? SiteRules.Text(d["campId"]).Length > 0 : (bool?)null,
        };

        private static object Job(SitePublish p, bool withLog = false) => new
        {
            id = p.Id, title = p.Title, status = p.Status, note = p.Note, prUrl = p.PrUrl, prNumber = p.PrNumber, branch = p.Branch,
            startedByName = p.StartedByName, startedAt = p.StartedAt, updatedAt = p.UpdatedAt, finishedAt = p.FinishedAt,
            running = SitePublisher.Active.Contains(p.Status), log = withLog ? p.Log : null, target = p.Target,
            files = withLog ? (JsonNode.Parse(p.Files) as JsonArray ?? new JsonArray()).Select(f => f?["path"]?.ToString()).ToList() : null,
        };

        private object Setup(SiteConfig c, bool full) => new
        {
            connected = c.Connected, imported = c.ImportedAt != null, siteUrl = c.SiteUrl, repo = c.Connected || full ? $"{c.RepoOwner}/{c.RepoName}".Trim('/') : null,
            reviewTypes = c.ReviewTypes, departments = c.Departments, ai = c.Ai, hasStaging = !string.IsNullOrWhiteSpace(c.StagingBranch),
            stagingBranch = full ? c.StagingBranch : null, scanFiles = full ? string.Join(", ", c.ScanFiles) : null, syncedAt = full ? c.SyncedAt : null,
            // The rest is for developers only; secrets are never sent back, only their last four characters.
            repoOwner = full ? c.RepoOwner : null, repoName = full ? c.RepoName : null, branch = full ? c.Branch : null,
            contentDir = full ? c.ContentDir : null, mediaDir = full ? c.MediaDir : null, appId = full ? c.AppId : null,
            privateKey = full ? Last4(c.PrivateKey?.Trim().Replace("-----END RSA PRIVATE KEY-----", "").Replace("-----END PRIVATE KEY-----", "").Trim()) : null,
            token = full ? Last4(c.Token) : null, connectedAt = full ? c.ConnectedAt : null, importedAt = full ? c.ImportedAt : null,
            keyUnreadable = full && (_app.Unreadable(SiteConfig.Prefix + "privateKey") || _app.Unreadable(SiteConfig.Prefix + "token")),
        };

        /// <summary>Everything the page lists: content, what is waiting, recent publishes, and what I may do.</summary>
        [HttpGet]
        public async Task<IActionResult> Get([FromServices] ChatAiService ai, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var develop = await CanAsync(Pages.WebsiteDevelop);
            var items = await _db.SiteContents.AsNoTracking().OrderByDescending(c => c.UpdatedAt).Take(2000).ToListAsync(ct);
            var jobs = await _db.SitePublishes.AsNoTracking().OrderByDescending(p => p.StartedAt).Take(20).ToListAsync(ct);
            return Ok(new
            {
                me = new { write = await CanAsync(Pages.Website), review = await CanAsync(Pages.WebsiteReview), publish = await CanAsync(Pages.WebsitePublish), develop },
                setup = Setup(cfg, develop),
                aiOn = cfg.Ai && ai.Configured,
                items = items.Select(c => Row(c, SiteRules.Parse(c.Data))),
                publishes = jobs.Select(p => Job(p)),
                faqCategories = SiteRules.FaqCategories,
                siteFields = SiteRules.SiteKeys.Select(k => new { key = k, label = SiteRules.SiteLabels[k] }),
                limits = new { title = SiteRules.TitleBest, excerptMin = SiteRules.ExcerptMin, excerptMax = SiteRules.ExcerptMax },
                types = SiteTypes.All.Select(t => SiteTypes.Describe(t, cfg)),
            });
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> One(Guid id, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var cfg = SiteConfig.Load(_app);
            var d = SiteRules.Parse(c.Data);
            var versions = await _db.SiteContentVersions.AsNoTracking().Where(v => v.ContentId == id).OrderByDescending(v => v.At).Take(100)
                .Select(v => new { id = v.Id, version = v.Version, action = v.Action, note = v.Note, byName = v.ByName, at = v.At, reviewedByName = v.ReviewedByName }).ToListAsync(ct);
            return Ok(new
            {
                item = Row(c, d), data = d, published = c.Published == null ? null : SiteRules.Parse(c.Published),
                problems = SiteRules.Problems(c.Type, d, cfg.Departments, c.ImageKey != null), warnings = SiteRules.Warnings(c.Type, d, c.ImageKey != null),
                needsReview = SiteRules.NeedsReview(c.Type, cfg), versions,
                address = AddressOf(c, d, cfg),
                kind = SiteTypes.Describe(SiteTypes.Of(c.Type), cfg),
            });
        }

        [HttpGet("{id:guid}/versions/{versionId:guid}")]
        public async Task<IActionResult> Version(Guid id, Guid versionId, CancellationToken ct)
        {
            var v = await _db.SiteContentVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId && x.ContentId == id, ct);
            return v == null ? NotFound() : Ok(new { id = v.Id, version = v.Version, action = v.Action, byName = v.ByName, at = v.At, data = SiteRules.Parse(v.Data) });
        }

        private void Log(SiteContent c, string action, string byName, string? note = null) =>
            _db.SiteContentVersions.Add(new SiteContentVersion { ContentId = c.Id, Version = c.Version, Action = action, Data = c.Data, Note = note, By = Me, ByName = byName });

        [HttpPost]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Create([FromBody] SiteContentDto dto, CancellationToken ct)
        {
            var type = (dto.Type ?? "").Trim().ToLowerInvariant();
            if (!SiteRules.Types.Contains(type) || !SiteTypes.Of(type).CanCreate) return No("Pick what to add.");
            var d = SiteRules.Clean(type, dto.Data ?? new JsonObject());
            var title = SiteRules.TitleOf(type, d);
            if (title.Length == 0 && type != "redirect") return No(type == "faq" ? "Write the question." : type == "notice" ? "Write the notice." : type == "testimonial" ? "Write the patient's words and name." : "Write the title.");
            // The id or address is made from the title unless one was typed; it must be free.
            var keyField = SiteTypes.Of(type).KeyField;
            var key = SiteRules.KeyOf(type, d);
            if (type == "redirect")
            {
                if (!SiteTypes.PathOk(key) || key == "/") return No("The old address must be a page address like /blogs/old-name.");
            }
            else
            {
                if (key.Length == 0) key = type switch
                {
                    "notice" => "notice-" + AttendanceService.TodayIst.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture),
                    "testimonial" => "story-" + SiteRules.Slug(SiteRules.Text(d["name"])),
                    "camp" => SiteRules.Slug(title + " " + SiteRules.Text(d["date"])),
                    _ => SiteRules.Slug(title),
                };
                key = key.Trim('-');
                if (!SiteRules.SlugOk(key)) return No("The web address needs lowercase English letters, numbers and hyphens. Type one.");
            }
            var taken = await _db.SiteContents.AsNoTracking().Where(c => c.Type == type).Select(c => c.Key).ToListAsync(ct);
            if (taken.Contains(key))
            {
                if (SiteRules.KeyOf(type, d).Length > 0) return No("Another one already uses that address. Pick a different one.");
                if (type == "redirect") return No("That old address already has a redirect. Open it and change where it goes.");
                var n = 2; while (taken.Contains($"{key}-{n}")) n++;
                key = $"{key}-{n}";
            }
            d[keyField] = key;
            var name = await MyNameAsync(ct);
            var c = new SiteContent
            {
                Type = type, Key = key, Title = title, Data = d.ToJsonString(), AiDrafted = dto.AiDrafted, CreatedBy = Me, CreatedByName = name, UpdatedByName = name,
                SortOrder = type is "faq" or "doctor" or "testimonial" or "notice" ? ((await _db.SiteContents.Where(x => x.Type == type).MaxAsync(x => (int?)x.SortOrder, ct)) ?? 0) + 10 : 0,
            };
            _db.SiteContents.Add(c);
            Log(c, "created", name, dto.AiDrafted ? "First draft written by AI" : null);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = c.Id });
        }

        [HttpPut("{id:guid}")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Save(Guid id, [FromBody] SiteContentDto dto, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            if (dto.Version != null && dto.Version != c.Version) return Conflict(new { message = $"{c.UpdatedByName} changed this while you were editing. Copy your text, reload, and add it again." });
            var d = SiteRules.Clean(c.Type, dto.Data ?? new JsonObject());
            // The id or address never changes here (an article's address is changed with "Change web address", which leaves a redirect).
            if (c.Type != "site") d[SiteTypes.Of(c.Type).KeyField] = c.Key;
            if (c.Type == "service") d["slug"] = SiteRules.Text(SiteRules.Parse(c.Data)["slug"]);
            // A picture already on the website keeps its address.
            if (c.Type == "article" && d["image"] is JsonObject img) img["src"] = SiteRules.Text((SiteRules.Parse(c.Data)["image"] as JsonObject)?["src"]);
            var text = d.ToJsonString();
            if (text == c.Data) return Ok(new { id = c.Id, version = c.Version, status = c.Status });
            var name = await MyNameAsync(ct);
            var wasChecked = c.Status is "review" or "approved";
            c.Data = text; c.Title = SiteRules.TitleOf(c.Type, d) is { Length: > 0 } t ? t : c.Title;
            c.Version++; c.Status = "draft"; c.UpdatedAt = DateTime.UtcNow; c.UpdatedByName = name;
            // An approval is for the exact text that was read: any change after it needs a new one.
            if (wasChecked) { c.ReviewedBy = null; c.ReviewedAt = null; if (!SiteRules.Live(c)) c.ReviewedByName = null; c.Note = "Changed after it was sent for review, so it needs sending again."; }
            c.StagedAt = null;
            Log(c, "saved", name);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = c.Id, version = c.Version, status = c.Status });
        }

        /// <summary>The writer says it is ready: it goes to the reviewer, or straight to "ready to publish" when its kind needs no review.</summary>
        [HttpPost("{id:guid}/submit")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Submit(Guid id, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var cfg = SiteConfig.Load(_app);
            if (SiteRules.CantSubmit(c, SiteRules.Problems(c.Type, SiteRules.Parse(c.Data), cfg.Departments, c.ImageKey != null)) is { } no) return No(no);
            var name = await MyNameAsync(ct);
            var review = SiteRules.NeedsReview(c.Type, cfg);
            c.Status = review ? "review" : "approved"; c.SubmittedBy = Me; c.SubmittedByName = name; c.SubmittedAt = DateTime.UtcNow; c.Note = null; c.UpdatedAt = DateTime.UtcNow;
            Log(c, "submitted", name);
            await _db.SaveChangesAsync(ct);
            if (review) _notifier.Notify(new NotifyJob { ToOffice = true, Except = Me, Kind = "website", Title = "Website: waiting for review", Body = $"{name} sent \"{c.Title}\" for review.", Link = "website:" + c.Id, RefId = c.Id.ToString() });
            return Ok(new { status = c.Status });
        }

        [HttpPost("{id:guid}/approve")]
        [PageAccess(Pages.WebsiteReview)]
        public async Task<IActionResult> Approve(Guid id, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantReview(c) is { } no) return No(no);
            var name = (await MyNameAsync(ct)).Trim();
            if (name.Length == 0 || name == Me) return No("Your account has no name. A reviewer's name is shown on the article, so add it in Users & roles first.");
            c.Status = "approved"; c.ReviewedBy = Me; c.ReviewedByName = name; c.ReviewedAt = DateTime.UtcNow; c.Note = null; c.UpdatedAt = DateTime.UtcNow;
            Log(c, "approved", name);
            await _db.SaveChangesAsync(ct);
            if (c.SubmittedBy != null) _notifier.Notify(new NotifyJob { To = new() { c.SubmittedBy }, Except = Me, Kind = "website", Title = "Website: approved", Body = $"{name} approved \"{c.Title}\". It can be published now.", Link = "website:" + c.Id, RefId = c.Id.ToString() });
            return Ok(new { status = c.Status });
        }

        [HttpPost("{id:guid}/send-back")]
        [PageAccess(Pages.WebsiteReview)]
        public async Task<IActionResult> SendBack(Guid id, [FromBody] SiteNoteDto dto, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            if (c.Status is not ("review" or "approved")) return No("This isn't waiting for review.");
            var note = Hoardings.Clean(dto.Note, 1000);
            if (string.IsNullOrWhiteSpace(note)) return No("Write what needs changing, so the writer knows.");
            var name = await MyNameAsync(ct);
            c.Status = "draft"; c.Note = $"{name}: {note}"; c.ReviewedBy = null; c.ReviewedAt = null; if (!SiteRules.Live(c)) c.ReviewedByName = null; c.UpdatedAt = DateTime.UtcNow;
            Log(c, "sent_back", name, note);
            await _db.SaveChangesAsync(ct);
            if (c.SubmittedBy != null) _notifier.Notify(new NotifyJob { To = new() { c.SubmittedBy }, Except = Me, Kind = "website", Title = "Website: changes asked for", Body = $"\"{c.Title}\": {note}", Link = "website:" + c.Id, RefId = c.Id.ToString() });
            return Ok(new { status = c.Status });
        }

        /// <summary>Puts back an older version as the working copy (a new version; the history stays).</summary>
        [HttpPost("{id:guid}/restore/{versionId:guid}")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Restore(Guid id, Guid versionId, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            var v = await _db.SiteContentVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId && x.ContentId == id, ct);
            if (c == null || v == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            var name = await MyNameAsync(ct);
            var d = SiteRules.Clean(c.Type, SiteRules.Parse(v.Data));
            c.Data = d.ToJsonString(); c.Title = SiteRules.TitleOf(c.Type, d) is { Length: > 0 } t ? t : c.Title;
            c.Version++; c.Status = "draft"; c.ReviewedBy = null; c.ReviewedAt = null; c.UpdatedAt = DateTime.UtcNow; c.UpdatedByName = name; c.Note = null;
            Log(c, "saved", name, $"Put back version {v.Version}");
            await _db.SaveChangesAsync(ct);
            return Ok(new { version = c.Version });
        }

        /// <summary>Archives it (never deletes). Something on the website has to be taken down first.</summary>
        [HttpPost("{id:guid}/archive")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Archive(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (!undo && SiteRules.CantArchive(c) is { } no) return No(no);
            c.Archived = !undo; c.UpdatedAt = DateTime.UtcNow;
            if (!undo && c.Status is "review" or "approved") c.Status = "draft";
            await _db.SaveChangesAsync(ct);
            return Ok(new { archived = c.Archived });
        }

        /// <summary>The order questions appear in on the website. Takes effect the next time a question is published.</summary>
        [HttpPost("faq-order")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Order([FromBody] SiteOrderDto dto, CancellationToken ct)
        {
            var ids = dto.Ids ?? new();
            var faqs = await _db.SiteContents.Where(c => c.Type == "faq").ToListAsync(ct);
            for (var i = 0; i < ids.Count; i++) if (faqs.FirstOrDefault(f => f.Id == ids[i]) is { } f) f.SortOrder = (i + 1) * 10;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("{id:guid}/picture")]
        [PageAccess(Pages.Website)]
        [RequestSizeLimit(3_000_000)]
        public async Task<IActionResult> AddPicture(Guid id, IFormFile? file, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id && x.Type == "article", ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            if (file == null || file.Length == 0) return No("Pick a picture.");
            if (!SiteRules.ImageTypes.TryGetValue(file.ContentType ?? "", out var ext)) return No("The picture must be a JPG, PNG or WebP.");
            if (file.Length > SiteRules.MaxImageBytes) return No("The picture can be up to 2 MB. Big pictures make the page slow, so make it smaller first.");
            await using var stream = file.OpenReadStream();
            // The old picture stays in storage; nothing is deleted.
            c.ImageKey = await _files.SaveAsync("website", $"{c.Key}-{Guid.NewGuid():N}.{ext}", stream, file.ContentType!, ct);
            c.ImageMime = file.ContentType;
            var name = await MyNameAsync(ct);
            var wasChecked = c.Status is "review" or "approved";
            c.Version++; c.Status = "draft"; c.UpdatedAt = DateTime.UtcNow; c.UpdatedByName = name;
            if (wasChecked) { c.ReviewedBy = null; c.ReviewedAt = null; c.Note = "The picture changed after it was sent for review, so it needs sending again."; }
            Log(c, "saved", name, "New picture");
            await _db.SaveChangesAsync(ct);
            return Ok(new { version = c.Version });
        }

        [HttpGet("{id:guid}/picture")]
        public async Task<IActionResult> Picture(Guid id, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c?.ImageKey == null) return NotFound();
            var f = await _files.OpenAsync(c.ImageKey, ct);
            if (f == null) return NotFound(new { message = "The picture is no longer in storage." });
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.Headers["Cache-Control"] = "private, no-cache";
            return File(f.Value.Content, c.ImageMime ?? f.Value.ContentType);
        }

        // ── Publishing ──────────────────────────────────────────────────────────

        [HttpPost("publish")]
        [PageAccess(Pages.WebsitePublish)]
        public async Task<IActionResult> Publish([FromBody] SitePublishDto dto, CancellationToken ct)
        {
            var asks = (dto.Items ?? new()).Select(i => new SitePublisher.Ask(i.Id, i.Action == "unpublish" ? "unpublish" : "publish")).ToList();
            var asksAll = asks.Select(a => a with { Action = (dto.Items ?? new()).FirstOrDefault(i => i.Id == a.Id)?.Action == "media" ? "media" : a.Action }).ToList();
            var (problem, job) = await _publisher.StartAsync(asksAll, Me, await MyNameAsync(ct), ct, dto.Target == "staging" ? "staging" : "live");
            return problem != null ? No(problem) : Ok(Job(job!));
        }

        [HttpGet("publishes/{id:guid}")]
        public async Task<IActionResult> PublishOne(Guid id, CancellationToken ct)
        {
            var p = await _db.SitePublishes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            return p == null ? NotFound() : Ok(Job(p, withLog: await CanAsync(Pages.WebsiteDevelop)));
        }

        // ── Developer ───────────────────────────────────────────────────────────

        /// <summary>The exact files the website has from the CRM right now (what is live), as they would be written.</summary>
        [HttpGet("files")]
        [PageAccess(Pages.WebsiteDevelop, Level = Pages.Edit)]
        public async Task<IActionResult> Files(CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var live = await _db.SiteContents.AsNoTracking().Where(c => c.Published != null).ToListAsync(ct);
            return Ok(new
            {
                files = SiteTypes.All.Select(t => new
                {
                    path = cfg.FilePath(t.File),
                    text = SitePublisher.FileFor(t.Key, live.Where(c => c.Type == t.Key).Select(c => (c, SiteRules.Parse(c.Published)))),
                }),
            });
        }

        [HttpPut("setup")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> SaveSetup([FromBody] SiteSetupDto dto, CancellationToken ct)
        {
            var old = SiteConfig.Load(_app);
            string? Name(string? v, string what, ref string? err)
            {
                v = (v ?? "").Trim().Trim('/');
                if (v.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(v, @"^[A-Za-z0-9._\-/]{1,100}$")) err ??= $"{what} has characters GitHub doesn't allow.";
                return v.Length == 0 ? null : v;
            }
            string? err = null;
            // People paste the whole address; take the owner and name out of it.
            var owner = (dto.RepoOwner ?? "").Trim(); var repo = (dto.RepoName ?? "").Trim();
            var m = System.Text.RegularExpressions.Regex.Match(owner + "/" + repo, @"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$");
            if (m.Success) { owner = m.Groups[1].Value; repo = m.Groups[2].Value; }
            else if (repo.Length == 0 && owner.Contains('/')) { var parts = owner.Split('/', 2); owner = parts[0]; repo = parts[1]; }
            var values = new Dictionary<string, string?>
            {
                ["repoOwner"] = Name(owner, "The owner", ref err), ["repoName"] = Name(repo, "The repository name", ref err),
                ["branch"] = Name(dto.Branch, "The branch", ref err) ?? "main", ["contentDir"] = Name(dto.ContentDir, "The content folder", ref err) ?? "content",
                ["mediaDir"] = Name(dto.MediaDir, "The pictures folder", ref err) ?? "public/media/blogs",
                ["siteUrl"] = (dto.SiteUrl ?? "").Trim().TrimEnd('/') is { Length: > 0 } u ? u : null,
                ["appId"] = (dto.AppId ?? "").Trim() is { Length: > 0 } a ? a : null,
                ["reviewTypes"] = string.Join(",", (dto.ReviewTypes ?? old.ReviewTypes).Select(t => t.Trim().ToLowerInvariant()).Where(SiteRules.Types.Contains).Distinct()),
                ["departments"] = string.Join(",", (dto.Departments ?? old.Departments).Select(t => SiteRules.Slug(t)).Where(SiteRules.SlugOk).Distinct()),
                ["ai"] = (dto.Ai ?? old.Ai) ? "on" : null,
                ["stagingBranch"] = Name(dto.StagingBranch, "The staging branch", ref err),
                ["scanFiles"] = dto.ScanFiles == null ? string.Join(",", old.ScanFiles) : string.Join(",", dto.ScanFiles.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Take(10)),
            };
            if (err != null) return No(err);
            if (values["siteUrl"] != null && !values["siteUrl"]!.StartsWith("https://")) return No("The website address must start with https://.");
            if (values["appId"] != null && !values["appId"]!.All(char.IsLetterOrDigit)) return No("The app id is the number (or client id) on the GitHub App's page.");
            if (values["stagingBranch"] != null && values["stagingBranch"] == values["branch"]) return No("The staging branch must be a different branch from the live one.");
            if (string.IsNullOrEmpty(values["departments"])) return No("Keep at least one department.");
            if (!string.IsNullOrWhiteSpace(dto.PrivateKey))
            {
                var pem = dto.PrivateKey.Trim();
                if (!pem.Contains("PRIVATE KEY")) return No("That isn't a private key. Paste the whole .pem file GitHub gave you, from -----BEGIN to -----END.");
                values["privateKey"] = pem;
            }
            if (!string.IsNullOrWhiteSpace(dto.Token)) values["token"] = dto.Token.Trim();
            else if (dto.ClearToken) values["token"] = null;
            values["connectedAt"] = old.ConnectedAt ?? DateTime.UtcNow.ToString("o");
            // A different repository is a different website: its content has to be brought in again before publishing.
            if (old.ImportedAt != null && (!string.Equals(old.RepoOwner, values["repoOwner"], StringComparison.OrdinalIgnoreCase) || !string.Equals(old.RepoName, values["repoName"], StringComparison.OrdinalIgnoreCase)))
                values["importedAt"] = null;
            await _app.SetAsync(values.ToDictionary(kv => SiteConfig.Prefix + kv.Key, kv => kv.Value), SiteConfig.SecretKeys.ToList(), Me, ct);
            return Ok(Setup(SiteConfig.Load(_app), true));
        }

        /// <summary>Tries the connection and says in plain words what works and what doesn't. Changes nothing.</summary>
        [HttpPost("setup/test")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> Test([FromServices] GitHubClient gh, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var checks = new List<object>();
            var allOk = true;
            void Add(string what, bool ok, string detail) { allOk &= ok; checks.Add(new { what, ok, detail }); }
            if (!cfg.Connected) return Ok(new { ok = false, checks = new[] { new { what = "Connection", ok = false, detail = "Fill in the repository and the GitHub key first, and save." } } });
            try
            {
                var repo = await gh.GetAsync(cfg, "", ct);
                Add("Reach the repository", true, $"{repo?["full_name"]} ({(repo?["private"]?.GetValue<bool>() == true ? "private" : "public")})");
                var canPush = repo?["permissions"]?["push"]?.GetValue<bool>();
                if (canPush == false) Add("Write to the repository", false, "The key can read but not write. The app needs Contents and Pull requests set to \"Read and write\".");
                var branch = await gh.GetAsync(cfg, $"/git/ref/heads/{cfg.Branch}", ct, missingOk: true);
                Add($"Find the branch \"{cfg.Branch}\"", branch != null, branch != null ? "Found." : "That branch isn't in the repository.");
                foreach (var name in new[] { "site.json", "faqs.json", "blog.json" })
                {
                    var text = branch == null ? null : await gh.FileAsync(cfg, cfg.FilePath(name), cfg.Branch, ct);
                    Add($"Find {cfg.FilePath(name)}", text != null, text != null ? "Found." : "Not there yet. The website's content files have to be merged into this branch first.");
                }
            }
            catch (GitHubException ex) { Add("Reach the repository", false, ex.Message); }
            return Ok(new { ok = allOk, checks });
        }

        /// <summary>Brings in what is on the website now. Only adds what the CRM doesn't have.</summary>
        [HttpPost("import")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> Import([FromServices] IHttpClientFactory http, CancellationToken ct)
        {
            if (!SiteConfig.Load(_app).Connected) return No("Connect the website first.");
            try
            {
                var counts = await _publisher.ImportAsync(Me, await MyNameAsync(ct), ct, http);
                return Ok(new { counts = SiteTypes.All.Select(t => new { type = t.Key, label = t.Plural, count = counts.GetValueOrDefault(t.Key), found = counts.ContainsKey(t.Key) }) });
            }
            catch (GitHubException ex) { return No(ex.Message); }
        }

        // ── Writing help (AI) ───────────────────────────────────────────────────

        private static string Flat(JsonObject d)
        {
            var sb = new StringBuilder();
            sb.Append("Title: ").Append(SiteRules.Text(d["title"])).Append("\nSummary: ").Append(SiteRules.Text(d["excerpt"])).Append('\n');
            foreach (var s in (d["sections"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            {
                sb.Append("\n## ").Append(SiteRules.Text(s["heading"])).Append('\n');
                foreach (var p in s["paragraphs"] as JsonArray ?? new JsonArray()) sb.Append(SiteRules.Text(p)).Append('\n');
                foreach (var p in s["points"] as JsonArray ?? new JsonArray()) sb.Append("- ").Append(SiteRules.Text(p)).Append('\n');
            }
            return sb.ToString();
        }

        /// <summary>A first draft for a person to edit. It is not saved: the writer reads it, changes it and saves it themselves.</summary>
        [HttpPost("ai/draft")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> AiDraft([FromBody] SiteAiDraftDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var topic = Hoardings.Clean(dto.Topic, 200);
            if (string.IsNullOrWhiteSpace(topic) || topic.Length < 4) return No("Write what the article is about.");
            var cfg = SiteConfig.Load(_app);
            var dept = (dto.DepartmentId ?? "").Trim().ToLowerInvariant();
            if (!cfg.Departments.Contains(dept)) return No("Pick the department.");
            try
            {
                var json = await ai.ArticleDraftAsync(Me, topic, dept.Replace('-', ' '), Hoardings.Clean(dto.Notes, 1000), ct);
                json["departmentId"] = dept;
                // References are never taken from the AI: a person adds real ones.
                json.Remove("references"); json.Remove("image"); json.Remove("slug");
                return Ok(new { data = SiteRules.Clean("article", json) });
            }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
        }

        [HttpPost("ai/suggest")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> AiSuggest([FromBody] SiteAiTextDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var d = SiteRules.Clean("article", dto.Data ?? new JsonObject());
            if ((d["sections"] as JsonArray)?.Count is null or 0) return No("Write some of the article first.");
            try { var (titles, excerpts) = await ai.ArticleSuggestAsync(Me, Flat(d), ct); return Ok(new { titles, excerpts }); }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
        }

        /// <summary>Sentences a doctor should check or that need a source. For writers and reviewers.</summary>
        [HttpPost("ai/claims")]
        [PageAccess(Pages.Website, Pages.WebsiteReview)]
        public async Task<IActionResult> AiClaims([FromBody] SiteAiTextDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var d = SiteRules.Clean("article", dto.Data ?? new JsonObject());
            if ((d["sections"] as JsonArray)?.Count is null or 0) return No("Write some of the article first.");
            try { return Ok(new { claims = (await ai.ArticleClaimsAsync(Me, Flat(d), ct)).Select(c => new { text = c.Text, why = c.Why }) }); }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
        }
    }
}
