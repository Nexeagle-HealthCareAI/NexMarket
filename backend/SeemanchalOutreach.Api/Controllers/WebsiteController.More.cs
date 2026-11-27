using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SiteRenameDto { public string? Slug { get; set; } }
    public class SiteScheduleDto { public DateTime? PublishAt { get; set; } public DateTime? UnpublishAt { get; set; } }
    public class SiteMediaDto { public string? Alt { get; set; } }
    public class SiteCheckDto { public JsonObject? Data { get; set; } }

    /// <summary>A preview kept in memory for 30 minutes: the content as the website would get it, and the pictures it needs.</summary>
    public record SitePreview(string Type, string Title, string Json, string? PictureKey, string? PictureMime, Dictionary<Guid, (string Key, string Mime)> Media);

    public partial class WebsiteController
    {
        private static string? AddressOf(SiteContent c, JsonObject d, SiteConfig cfg) => cfg.SiteUrl == null ? null : c.Type switch
        {
            "article" => $"{cfg.SiteUrl}{SitePublisher.BlogPath(c.Key)}",
            "service" => SiteRules.Text(d["slug"]) is { Length: > 0 } slug ? $"{cfg.SiteUrl}/services/{slug}" : null,
            "camp" => $"{cfg.SiteUrl}/health-camps#{c.Key}",
            "faq" => $"{cfg.SiteUrl}/faqs",
            "doctor" => $"{cfg.SiteUrl}/doctors",
            "redirect" => cfg.SiteUrl + c.Key,
            "location" => $"{cfg.SiteUrl}/areas/{c.Key}",
            _ => cfg.SiteUrl,
        };

        // ── Article address ────────────────────────────────────────────────────

        /// <summary>Changes an article's web address. When it is live, publishing it leaves a redirect from the old address.</summary>
        [HttpPost("{id:guid}/rename")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> Rename(Guid id, [FromBody] SiteRenameDto dto, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id && x.Type == "article", ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            var slug = SiteRules.Slug(dto.Slug);
            if (!SiteRules.SlugOk(slug)) return No("Write the new address in lowercase English letters, numbers and hyphens.");
            if (slug == c.Key) return No("That is already its address.");
            if (await _db.SiteContents.AnyAsync(x => x.Type == "article" && x.Key == slug, ct)) return No("Another article already uses that address.");
            var name = await MyNameAsync(ct);
            var d = SiteRules.Parse(c.Data); d["slug"] = slug;
            var old = c.Key;
            c.Key = slug; c.Data = d.ToJsonString(); c.Version++; c.UpdatedAt = DateTime.UtcNow; c.UpdatedByName = name;
            if (c.Status is "published" or "unpublished") c.Status = "draft";
            Log(c, "saved", name, $"Address changed from /blogs/{old}");
            await _db.SaveChangesAsync(ct);
            return Ok(new { key = c.Key, version = c.Version, redirect = SiteRules.Live(c) });
        }

        // ── Schedule ───────────────────────────────────────────────────────────

        [HttpPost("{id:guid}/schedule")]
        [PageAccess(Pages.WebsitePublish)]
        public async Task<IActionResult> Schedule(Guid id, [FromBody] SiteScheduleDto dto, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var now = DateTime.UtcNow;
            var on = dto.PublishAt?.ToUniversalTime(); var off = dto.UnpublishAt?.ToUniversalTime();
            if (on != null && on < now.AddMinutes(-1)) return No("The time to go live has already passed.");
            if (off != null && off < now.AddMinutes(-1)) return No("The time to come off has already passed.");
            if (on != null && off != null && off <= on) return No("It has to go live before it comes off.");
            if (off != null && SiteRules.CantUnpublish(new SiteContent { Type = c.Type, Status = "published", Published = "{}" }) is { } cant) return No(cant);
            if (on != null && SiteRules.NeedsReview(c.Type, SiteConfig.Load(_app)) && c.Status is not ("approved" or "review")) return No("Send it for review first; it goes live at that time only if it is approved by then.");
            c.PublishAt = on; c.UnpublishAt = off; c.ScheduledBy = Me; c.ScheduledByName = await MyNameAsync(ct); c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { publishAt = c.PublishAt, unpublishAt = c.UnpublishAt });
        }

        // ── Roll back ──────────────────────────────────────────────────────────

        /// <summary>Puts a version that was live before back on the website, with the reviewer who approved it then.</summary>
        [HttpPost("{id:guid}/rollback/{versionId:guid}")]
        [PageAccess(Pages.WebsitePublish)]
        public async Task<IActionResult> Rollback(Guid id, Guid versionId, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
            var v = await _db.SiteContentVersions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == versionId && x.ContentId == id, ct);
            if (c == null || v == null) return NotFound(new { message = "That isn't here any more." });
            if (SiteRules.CantEdit(c) is { } no) return No(no);
            if (v.Action is not ("published" or "imported" or "changed_on_github")) return No("Only a version that was on the website can be put back directly. Put this one back as a draft instead.");
            var cfg = SiteConfig.Load(_app);
            if (SiteRules.NeedsReview(c.Type, cfg) && string.IsNullOrWhiteSpace(v.ReviewedByName) && v.Action == "published") return No("That version has no reviewer recorded. Put it back as a draft and send it for review.");
            var name = await MyNameAsync(ct);
            var d = SiteRules.Clean(c.Type, SiteRules.Parse(v.Data));
            if (c.Type != "site") d[SiteTypes.Of(c.Type).KeyField] = c.Key;
            c.Data = d.ToJsonString(); c.Title = SiteRules.TitleOf(c.Type, d) is { Length: > 0 } t ? t : c.Title; c.Version++;
            c.Status = "approved"; c.ReviewedByName = v.ReviewedByName ?? c.ReviewedByName; c.ReviewedBy = null; c.ReviewedAt = v.At; c.UpdatedAt = DateTime.UtcNow; c.UpdatedByName = name; c.Note = null;
            Log(c, "saved", name, $"Rolled back to version {v.Version}");
            await _db.SaveChangesAsync(ct);
            var (problem, job) = await _publisher.StartAsync(new[] { new SitePublisher.Ask(c.Id, "publish") }, Me, name, ct);
            return problem != null ? No(problem) : Ok(Job(job!));
        }

        // ── Preview ────────────────────────────────────────────────────────────

        /// <summary>A link that shows the working copy in the website's real design, for 30 minutes.</summary>
        [HttpPost("{id:guid}/preview")]
        public async Task<IActionResult> Preview(Guid id, [FromServices] IMemoryCache cache, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var cfg = SiteConfig.Load(_app);
            if (cfg.SiteUrl == null) return No("Add the website address in Setup first.");
            if (c.Type == "redirect") return No("A redirect has no page of its own to preview.");
            // Hospital details: the website's /preview page puts them in its header, footer and contact page.
            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var org = OrgScope.Current?.Key ?? "";
            var api = (Request.Host.Host is "localhost" or "127.0.0.1" ? Request.Scheme : "https") + "://" + Request.Host;
            string Url(string tail) => $"{api}/api/v1/website-preview/{token}/{tail}?org={Uri.EscapeDataString(org)}";
            var copy = SiteRules.LiveCopy(c, AttendanceService.TodayIst, c.ImageKey != null ? Url("picture") : null);
            if (c.Type == "service") copy["id"] = c.Key;
            var json = copy.ToJsonString();
            var media = new Dictionary<Guid, (string, string)>();
            foreach (var m in await _db.SiteMedia.AsNoTracking().Where(m => !m.Archived).ToListAsync(ct))
                if (json.Contains(m.Path, StringComparison.Ordinal) && !m.OnSite) { media[m.Id] = (m.Key, m.Mime); json = json.Replace("\"" + m.Path + "\"", "\"" + Url("media/" + m.Id) + "\""); }
            cache.Set("site-preview:" + token, new SitePreview(c.Type, c.Title, json, c.ImageKey, c.ImageMime, media), TimeSpan.FromMinutes(30));
            return Ok(new { url = $"{cfg.SiteUrl}/preview#t={token}&o={Uri.EscapeDataString(org)}", minutes = 30 });
        }

        // ── Checks before publishing ───────────────────────────────────────────

        /// <summary>Links and pictures that don't work, and how the page shows in Google and when shared on WhatsApp.</summary>
        [HttpPost("{id:guid}/check")]
        public async Task<IActionResult> Check(Guid id, [FromBody] SiteCheckDto dto, [FromServices] IHttpClientFactory http, CancellationToken ct)
        {
            var c = await _db.SiteContents.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var cfg = SiteConfig.Load(_app);
            var d = SiteRules.Clean(c.Type, dto.Data ?? SiteRules.Parse(c.Data));
            var (links, paths) = LinkChecker.Find(d);
            var media = await _db.SiteMedia.AsNoTracking().Where(m => !m.Archived).ToListAsync(ct);
            var client = http.CreateClient("linkcheck");
            using var gate = new SemaphoreSlim(6);
            async Task<LinkChecker.Result> Run(string url) { await gate.WaitAsync(ct); try { return await LinkChecker.CheckAsync(client, url, ct); } finally { gate.Release(); } }
            var linkResults = await Task.WhenAll(links.Select(Run));
            var pathResults = await Task.WhenAll(paths.Select(async p =>
            {
                var m = media.FirstOrDefault(x => x.Path == p);
                if (m != null) return new LinkChecker.Result(p, true, m.OnSite ? "In the media library, on the website." : "In the media library; it is added to the website when this is published.");
                if (cfg.SiteUrl == null) return new LinkChecker.Result(p, true, "Not checked: add the website address in Setup.");
                var r = await Run(cfg.SiteUrl + p);
                return r with { Url = p, Note = r.Ok ? "On the website." : "Not on the website: " + r.Note };
            }));
            var siteName = cfg.SiteUrl == null ? "" : new Uri(cfg.SiteUrl).Host.Replace("www.", "");
            object? card = c.Type switch
            {
                "article" => new
                {
                    title = SiteRules.Text(d["title"]), description = SiteRules.Text(d["excerpt"]), url = AddressOf(c, d, cfg), site = siteName,
                    image = c.ImageKey != null ? "picture" : SiteRules.Text((d["image"] as JsonObject)?["src"]) is { Length: > 0 } img ? cfg.SiteUrl + img : cfg.SiteUrl + "/og-image.png",
                },
                "service" => new
                {
                    title = SiteRules.Text(d["seoTitle"]) is { Length: > 0 } st ? st : SiteRules.Text(d["title"]),
                    description = SiteRules.Text(d["seoDescription"]) is { Length: > 0 } sd ? sd : SiteRules.Text(d["description"]),
                    url = AddressOf(c, d, cfg), site = siteName, image = cfg.SiteUrl + "/og-image.png",
                },
                _ => null,
            };
            return Ok(new
            {
                links = linkResults.Select(r => new { url = r.Url, ok = r.Ok, note = r.Note }),
                paths = pathResults.Select(r => new { url = r.Url, ok = r.Ok, note = r.Note }),
                card, titleBest = SiteRules.TitleBest, descriptionBest = SiteRules.ExcerptMax,
                redirectNote = c.Type == "article" && c.Published != null && SiteRules.Text(SiteRules.Parse(c.Published)["slug"]) is { Length: > 0 } was && was != c.Key
                    ? $"The address changed from /blogs/{was}. Publishing leaves a redirect from the old address, so old links keep working." : null,
            });
        }

        // ── Missing information, sync ──────────────────────────────────────────

        [HttpGet("gaps")]
        public async Task<IActionResult> Gaps(CancellationToken ct)
        {
            try
            {
                var gaps = await _publisher.GapsAsync(ct);
                return Ok(new { items = gaps.Select(g => new { where = g.Where, what = g.What, itemId = g.ItemId, file = g.File, line = g.Line }) });
            }
            catch (GitHubException ex) { return No(ex.Message); }
        }

        /// <summary>Looks for changes made directly on GitHub now, instead of waiting for the next 10-minute check.</summary>
        [HttpPost("sync")]
        [PageAccess(Pages.WebsiteDevelop)]
        public async Task<IActionResult> Sync(CancellationToken ct)
        {
            if (await _db.SitePublishes.AnyAsync(p => SitePublisher.Active.Contains(p.Status), ct)) return No("A publish is running. Try again when it has finished.");
            try { return Ok(new { changed = await _publisher.SyncAsync("now", ct) }); }
            catch (GitHubException ex) { return No(ex.Message); }
        }

        // ── Media library ──────────────────────────────────────────────────────

        private static object MediaRow(SiteMedia m, IEnumerable<SiteContent> items) => new
        {
            id = m.Id, name = m.Name, path = m.Path, mime = m.Mime, width = m.Width, height = m.Height, bytes = m.Bytes, alt = m.Alt, onSite = m.OnSite,
            version = m.Version, archived = m.Archived, updatedByName = m.UpdatedByName, updatedAt = m.UpdatedAt,
            usedBy = items.Where(c => (c.Data + c.Published).Contains(m.Path, StringComparison.Ordinal))
                .Select(c => new { id = c.Id, title = c.Title, type = c.Type, live = c.Published != null && c.Published.Contains(m.Path, StringComparison.Ordinal) }).ToList(),
        };

        [HttpGet("media")]
        public async Task<IActionResult> Media(CancellationToken ct)
        {
            var media = await _db.SiteMedia.AsNoTracking().OrderByDescending(m => m.UpdatedAt).Take(1000).ToListAsync(ct);
            var items = await _db.SiteContents.AsNoTracking().Where(c => !c.Archived || c.Published != null).ToListAsync(ct);
            return Ok(new { items = media.Select(m => MediaRow(m, items)), folder = "/media/library/" });
        }

        private static async Task<string?> ReadPictureAsync(IFormFile? file, Func<System.IO.Stream, string, Task> save)
        {
            if (file == null || file.Length == 0) return "Pick a picture.";
            if (!SiteRules.ImageTypes.ContainsKey(file.ContentType ?? "")) return "The picture must be a JPG, PNG or WebP.";
            if (file.Length > SiteRules.MaxImageBytes) return "The picture can be up to 2 MB. Big pictures make pages slow.";
            await using var s = file.OpenReadStream();
            await save(s, file.ContentType!);
            return null;
        }

        /// <summary>Adds a picture. The page makes it smaller and turns it into WebP before sending, where the browser can.</summary>
        [HttpPost("media")]
        [PageAccess(Pages.Website)]
        [RequestSizeLimit(3_000_000)]
        public async Task<IActionResult> AddMedia(IFormFile? file, [FromForm] string? name, [FromForm] string? alt, [FromForm] int width, [FromForm] int height, CancellationToken ct)
        {
            var slug = SiteRules.Slug(name);
            if (!SiteRules.SlugOk(slug)) return No("Give the picture a short name in English letters, like kasba-camp-2026. It becomes part of its web address.");
            if (string.IsNullOrWhiteSpace(alt)) return No("Describe the picture in a few words (for people who can't see it, and for Google).");
            var taken = await _db.SiteMedia.Select(m => m.Name).ToListAsync(ct);
            var n = 2; var unique = slug; while (taken.Contains(unique)) unique = $"{slug}-{n++}";
            var who = await MyNameAsync(ct);
            var m = new SiteMedia { Name = unique, Alt = Hoardings.Clean(alt, 200) ?? "", Width = Math.Clamp(width, 0, 10000), Height = Math.Clamp(height, 0, 10000), CreatedByName = who, UpdatedByName = who };
            var err = await ReadPictureAsync(file, async (s, mime) =>
            {
                m.Mime = mime; m.Bytes = file!.Length;
                m.Key = await _files.SaveAsync("website-media", $"{unique}-{Guid.NewGuid():N}.{SiteRules.ImageTypes[mime]}", s, mime, ct);
                m.Path = $"/media/library/{unique}.{SiteRules.ImageTypes[mime]}";
            });
            if (err != null) return No(err);
            _db.SiteMedia.Add(m);
            await _db.SaveChangesAsync(ct);
            return Ok(MediaRow(m, Array.Empty<SiteContent>()));
        }

        /// <summary>Replaces a picture's file, keeping its address, so every page using it shows the new one once it is published.</summary>
        [HttpPost("media/{id:guid}/file")]
        [PageAccess(Pages.Website)]
        [RequestSizeLimit(3_000_000)]
        public async Task<IActionResult> ReplaceMedia(Guid id, IFormFile? file, [FromForm] int width, [FromForm] int height, CancellationToken ct)
        {
            var m = await _db.SiteMedia.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound(new { message = "That picture isn't here any more." });
            var ext = m.Path[(m.Path.LastIndexOf('.') + 1)..];
            if (file != null && SiteRules.ImageTypes.GetValueOrDefault(file.ContentType ?? "") != ext) return No($"The new picture must be the same kind as the old one ({ext.ToUpperInvariant()}), so its address stays the same.");
            var err = await ReadPictureAsync(file, async (s, mime) =>
            {
                // The old file stays in storage; nothing is deleted.
                m.Key = await _files.SaveAsync("website-media", $"{m.Name}-{Guid.NewGuid():N}.{ext}", s, mime, ct);
                m.Bytes = file!.Length; m.Width = Math.Clamp(width, 0, 10000); m.Height = Math.Clamp(height, 0, 10000);
            });
            if (err != null) return No(err);
            m.OnSite = false; m.Version++; m.UpdatedAt = DateTime.UtcNow; m.UpdatedByName = await MyNameAsync(ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { version = m.Version });
        }

        [HttpPut("media/{id:guid}")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> SaveMedia(Guid id, [FromBody] SiteMediaDto dto, CancellationToken ct)
        {
            var m = await _db.SiteMedia.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound(new { message = "That picture isn't here any more." });
            if (string.IsNullOrWhiteSpace(dto.Alt)) return No("Describe the picture in a few words.");
            m.Alt = Hoardings.Clean(dto.Alt, 200) ?? m.Alt; m.UpdatedAt = DateTime.UtcNow; m.UpdatedByName = await MyNameAsync(ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("media/{id:guid}/archive")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> ArchiveMedia(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var m = await _db.SiteMedia.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound(new { message = "That picture isn't here any more." });
            if (!undo && await _db.SiteContents.AnyAsync(c => !c.Archived && (c.Data.Contains(m.Path) || (c.Published != null && c.Published.Contains(m.Path))), ct))
                return No("Something still uses this picture. Change it there first.");
            m.Archived = !undo; m.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { archived = m.Archived });
        }

        [HttpGet("media/{id:guid}/file")]
        public async Task<IActionResult> MediaFile(Guid id, CancellationToken ct)
        {
            var m = await _db.SiteMedia.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var f = await _files.OpenAsync(m.Key, ct);
            if (f == null) return NotFound(new { message = "The picture is no longer in storage." });
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.Headers["Cache-Control"] = "private, max-age=600";
            return File(f.Value.Content, m.Mime);
        }

        // ── From the CRM's own records ─────────────────────────────────────────

        [HttpGet("crm")]
        public async Task<IActionResult> CrmRecords(CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var depts = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Name, ct);
            var items = await _db.SiteContents.AsNoTracking().Where(c => c.Type == "doctor" || c.Type == "camp").ToListAsync(ct);
            string? Linked(string type, string field, string id) => items.FirstOrDefault(c => c.Type == type && SiteRules.Text(SiteRules.Parse(c.Data)[field]) == id)?.Id.ToString();
            var doctors = (await _db.Doctors.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Name).ToListAsync(ct)).Select(d => new
            {
                id = d.Id, name = d.Name, department = d.DepartmentId != null ? depts.GetValueOrDefault(d.DepartmentId.Value) : null, qualification = d.Qualification,
                opd = string.Join(": ", new[] { d.OpdDays, d.OpdTimings }.Where(x => !string.IsNullOrWhiteSpace(x))), itemId = Linked("doctor", "crmDoctorId", d.Id.ToString()),
            });
            var camps = (await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= today && c.Status != "cancelled").OrderBy(c => c.Date).Take(100).ToListAsync(ct)).Select(c => new
            {
                id = c.Id, title = c.Title, date = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime, place = c.Venue ?? c.Block, status = c.Status,
                itemId = Linked("camp", "campId", c.Id.ToString()),
            });
            return Ok(new { doctors, camps });
        }

        private async Task<JsonObject?> FromCrmAsync(string type, Guid crmId, CancellationToken ct)
        {
            if (type == "doctor")
            {
                var d = await _db.Doctors.AsNoTracking().FirstOrDefaultAsync(x => x.Id == crmId, ct);
                if (d == null) return null;
                var dept = d.DepartmentId == null ? null : await _db.Departments.AsNoTracking().Where(x => x.Id == d.DepartmentId).Select(x => x.Name).FirstOrDefaultAsync(ct);
                var o = new JsonObject { ["name"] = d.Name, ["crmDoctorId"] = d.Id.ToString() };
                if (dept != null) { o["department"] = dept; o["specialty"] = dept; }
                if (!string.IsNullOrWhiteSpace(d.Qualification)) o["qualifications"] = d.Qualification;
                var opd = string.Join(": ", new[] { d.OpdDays, d.OpdTimings }.Where(x => !string.IsNullOrWhiteSpace(x)));
                if (opd.Length > 0) o["consultationTimings"] = opd;
                return o;
            }
            var c = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == crmId, ct);
            if (c == null) return null;
            string[] Split(string? s) => (s ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            return new JsonObject
            {
                ["title"] = c.Title, ["date"] = c.Date.ToString("yyyy-MM-dd"), ["startTime"] = c.StartTime, ["endTime"] = c.EndTime,
                ["place"] = c.Venue ?? c.Block ?? c.District ?? "", ["address"] = string.Join(", ", new[] { c.Block, c.District }.Where(x => !string.IsNullOrWhiteSpace(x))),
                ["services"] = new JsonArray(Split(c.Departments).Select(x => (JsonNode)JsonValue.Create(x)!).ToArray()),
                ["doctors"] = new JsonArray(Split(c.Doctors).Select(x => (JsonNode)JsonValue.Create(x)!).ToArray()),
                ["free"] = true, ["campId"] = c.Id.ToString(), ["description"] = c.Notes is { Length: > 0 } n && n.Length < 400 ? n : "",
            };
        }

        /// <summary>A new website doctor or camp, filled in from the CRM's record of it (Departments &amp; doctors, Health camps).</summary>
        [HttpPost("from-crm/{type}/{crmId:guid}")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> FromCrm(string type, Guid crmId, CancellationToken ct)
        {
            if (type is not ("doctor" or "camp")) return No("Pick a doctor or a camp.");
            var d = await FromCrmAsync(type, crmId, ct);
            if (d == null) return NotFound(new { message = "That record isn't in the CRM any more." });
            return await Create(new SiteContentDto { Type = type, Data = d }, ct);
        }

        /// <summary>Copies the CRM record's current details (name, department, qualifications, timings; or the camp's day and place) into the draft.</summary>
        [HttpPost("{id:guid}/refresh-from-crm")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> RefreshFromCrm(Guid id, CancellationToken ct)
        {
            var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id && (x.Type == "doctor" || x.Type == "camp"), ct);
            if (c == null) return NotFound(new { message = "That isn't here any more." });
            var data = SiteRules.Parse(c.Data);
            var link = SiteRules.Text(data[c.Type == "doctor" ? "crmDoctorId" : "campId"]);
            if (!Guid.TryParse(link, out var crmId)) return No("This isn't linked to a CRM record.");
            var fresh = await FromCrmAsync(c.Type, crmId, ct);
            if (fresh == null) return No("The CRM record isn't there any more.");
            foreach (var (k, v) in fresh) if (v is not JsonValue sv || !sv.TryGetValue<string>(out var str) || str.Length > 0) data[k] = v?.DeepClone();
            return await Save(id, new SiteContentDto { Data = data, Version = c.Version }, ct);
        }

        // ── Order of doctors, stories and notices (like questions) ─────────────

        [HttpPost("order")]
        [PageAccess(Pages.Website)]
        public async Task<IActionResult> OrderAny([FromBody] SiteOrderDto dto, [FromQuery] string type, CancellationToken ct)
        {
            if (type is not ("faq" or "doctor" or "testimonial" or "notice")) return No("This kind has no order.");
            var ids = dto.Ids ?? new();
            var rows = await _db.SiteContents.Where(c => c.Type == type).ToListAsync(ct);
            for (var i = 0; i < ids.Count; i++) if (rows.FirstOrDefault(f => f.Id == ids[i]) is { } f) f.SortOrder = (i + 1) * 10;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }

    /// <summary>
    /// What the website's /preview page reads: a draft for 30 minutes, by its unguessable key. No sign-in, nothing saved,
    /// and any site may read it (the key is the only way in).
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/website-preview")]
    public class WebsitePreviewController : ControllerBase
    {
        private readonly IMemoryCache _cache;
        private readonly IFileStore _files;
        public WebsitePreviewController(IMemoryCache cache, IFileStore files) { _cache = cache; _files = files; }

        private SitePreview? Find(string token)
        {
            Response.Headers["Access-Control-Allow-Origin"] = "*";
            Response.Headers["Cache-Control"] = "no-store";
            Response.Headers["X-Robots-Tag"] = "noindex";
            return token.Length is >= 20 and <= 80 && _cache.TryGetValue("site-preview:" + token, out SitePreview? p) ? p : null;
        }

        [HttpGet("{token}")]
        public IActionResult Get(string token)
        {
            var p = Find(token);
            if (p == null) return NotFound(new { message = "This preview has expired." });
            return Content($"{{\"type\":{System.Text.Json.JsonSerializer.Serialize(p.Type)},\"title\":{System.Text.Json.JsonSerializer.Serialize(p.Title)},\"data\":{p.Json}}}", "application/json");
        }

        [HttpGet("{token}/picture")]
        public async Task<IActionResult> Picture(string token, CancellationToken ct)
        {
            var p = Find(token);
            if (p?.PictureKey == null) return NotFound();
            var f = await _files.OpenAsync(p.PictureKey, ct);
            return f == null ? NotFound() : File(f.Value.Content, p.PictureMime ?? f.Value.ContentType);
        }

        [HttpGet("{token}/media/{id:guid}")]
        public async Task<IActionResult> Media(string token, Guid id, CancellationToken ct)
        {
            var p = Find(token);
            if (p == null || !p.Media.TryGetValue(id, out var m)) return NotFound();
            var f = await _files.OpenAsync(m.Key, ct);
            return f == null ? NotFound() : File(f.Value.Content, m.Mime);
        }
    }
}
