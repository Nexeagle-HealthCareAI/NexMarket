using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WorkDocDto
    {
        public string? Title { get; set; }
        public string? Kind { get; set; }
        /// <summary>The editor's document (Tiptap / ProseMirror JSON).</summary>
        public JsonElement? Content { get; set; }
        /// <summary>The same document as plain text, for search and previews.</summary>
        public string? Text { get; set; }
        /// <summary>"" to clear.</summary>
        public string? Project { get; set; }
        /// <summary>The card it plans; Guid.Empty to unlink.</summary>
        public Guid? CardId { get; set; }
        /// <summary>The version the editor started from; a newer one on the server means someone else saved meanwhile.</summary>
        public int? Version { get; set; }
    }

    /// <summary>
    /// Plans and documents on the Team board, written in a rich-text editor. Everyone in the CRM can read and write them.
    /// Every save keeps the version before it. A deleted document goes to the Bin and can be put back; only
    /// "Delete for ever" (its writer or an admin) removes it. Uploaded files (PDF, Word, pictures…) sit beside the plans.
    /// </summary>
    [ApiController]
    [Route("api/v1/work/docs")]
    [Authorize]
    public class WorkDocsController : ControllerBase
    {
        private static readonly string[] Kinds = { "plan", "doc", "notes" };
        public const string FileKind = "file";
        public const long MaxFileBytes = 25 * 1024 * 1024;
        /// <summary>What can be uploaded. Nothing a browser would run (no HTML, SVG or scripts).</summary>
        public static readonly Dictionary<string, string> Uploads = new(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = "application/pdf",
            [".doc"] = "application/msword", [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xls"] = "application/vnd.ms-excel", [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".ppt"] = "application/vnd.ms-powerpoint", [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            [".csv"] = "text/csv", [".txt"] = "text/plain",
            [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".webp"] = "image/webp", [".gif"] = "image/gif",
        };

        /// <summary>The file's first bytes must match what its name says (a renamed program is not a PDF).</summary>
        public static bool LooksLike(string ext, byte[] head)
        {
            bool Starts(params byte[] sig) => head.Length >= sig.Length && sig.Select((b, i) => head[i] == b).All(x => x);
            switch (ext.ToLowerInvariant())
            {
                case ".pdf": return Starts(0x25, 0x50, 0x44, 0x46);                                   // %PDF
                case ".docx": case ".xlsx": case ".pptx": return Starts(0x50, 0x4B, 0x03, 0x04);     // zip
                case ".doc": case ".xls": case ".ppt": return Starts(0xD0, 0xCF, 0x11, 0xE0);        // old Office
                case ".png": return Starts(0x89, 0x50, 0x4E, 0x47);
                case ".jpg": case ".jpeg": return Starts(0xFF, 0xD8, 0xFF);
                case ".gif": return Starts(0x47, 0x49, 0x46, 0x38);
                case ".webp": return Starts(0x52, 0x49, 0x46, 0x46) && head.Length >= 12 && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50;
                case ".txt": case ".csv": return !head.Contains((byte)0);                            // text has no zero bytes
                default: return false;
            }
        }

        /// <summary>Who may delete a document for ever: an admin, or the person who wrote or uploaded it.</summary>
        public static bool CanErase(bool admin, string me, string createdBy) => admin || (me.Length > 0 && me == createdBy);
        private const int MaxContent = 2_000_000;  // characters of editor JSON (about 300 pages of text)
        private const int MaxText = 400_000;

        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;
        private readonly IFileStore _files;
        public WorkDocsController(IMarketingDbContext db, ILiveEvents live, IFileStore files) { _db = db; _live = live; _files = files; }

        private string Me => User.AgentIdOf();

        private static string Preview(string text) { var t = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)); return t.Length > 180 ? t[..180] + "…" : t; }
        private static int Words(string text) => text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;

        /// <summary>The editor's JSON, checked: an object whose type is "doc", within the size limit.</summary>
        private static string? ContentOf(JsonElement? content, out string? error)
        {
            error = null;
            if (content is not JsonElement el || el.ValueKind == JsonValueKind.Undefined || el.ValueKind == JsonValueKind.Null) return null;
            if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty("type", out var t) || t.GetString() != "doc") { error = "That isn't a document from the editor."; return null; }
            var raw = el.GetRawText();
            if (raw.Length > MaxContent) { error = "This document is too long. Split it into two."; return null; }
            return raw;
        }

        private object Row(WorkDoc d, Dictionary<Guid, (int Number, string Title)> cards) => new
        {
            id = d.Id, title = d.Title, kind = d.Kind, project = d.Project, cardId = d.CardId,
            card = d.CardId != null && cards.TryGetValue(d.CardId.Value, out var c) ? new { number = c.Number, title = c.Title } : null,
            pinned = d.Pinned, archived = d.Archived, createdBy = d.CreatedBy, createdAt = d.CreatedAt, updatedBy = d.UpdatedBy, updatedAt = d.UpdatedAt,
            preview = Preview(d.PlainText), words = Words(d.PlainText), version = d.Version,
            deleted = d.DeletedAt != null, deletedAt = d.DeletedAt, deletedBy = d.DeletedBy,
            file = d.FileKey == null ? null : new { name = d.FileName ?? "file", mime = d.FileMime ?? "application/octet-stream", size = d.FileSize ?? 0 },
            canErase = CanErase(User.IsAdmin(), Me, d.CreatedBy),
        };

        private async Task<Dictionary<Guid, (int, string)>> CardsAsync(IEnumerable<Guid?> ids, CancellationToken ct)
        {
            var list = ids.Where(x => x != null).Select(x => x!.Value).Distinct().ToList();
            if (list.Count == 0) return new();
            return (await _db.WorkCards.AsNoTracking().Where(c => list.Contains(c.Id)).Select(c => new { c.Id, c.Number, c.Title }).ToListAsync(ct))
                .ToDictionary(c => c.Id, c => (c.Number, c.Title));
        }

        /// <summary>All plans and documents (pinned first, then the latest), with search across titles and text.</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] string? kind, [FromQuery] bool archived, [FromQuery] bool bin, [FromQuery] Guid? card, CancellationToken ct)
        {
            // The Bin shows deleted ones (archived or not); every other list leaves them out.
            var query = bin ? _db.WorkDocs.AsNoTracking().Where(d => d.DeletedAt != null)
                : _db.WorkDocs.AsNoTracking().Where(d => d.DeletedAt == null && d.Archived == archived);
            if (!string.IsNullOrWhiteSpace(kind) && (Kinds.Contains(kind) || kind == FileKind)) query = query.Where(d => d.Kind == kind);
            if (card != null) query = query.Where(d => d.CardId == card);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                query = query.Where(d => d.Title.ToLower().Contains(s) || d.PlainText.ToLower().Contains(s) || (d.Project != null && d.Project.ToLower().Contains(s)));
            }
            var docs = await query.OrderByDescending(d => d.Pinned).ThenByDescending(d => d.UpdatedAt).Take(500).ToListAsync(ct);
            var cards = await CardsAsync(docs.Select(d => d.CardId), ct);
            return Ok(docs.Select(d => Row(d, cards)));
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var d = await _db.WorkDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound(new { message = "That document isn't here any more." });
            var cards = await CardsAsync(new[] { d.CardId }, ct);
            using var content = JsonDocument.Parse(string.IsNullOrWhiteSpace(d.ContentJson) ? "{}" : d.ContentJson);
            return Ok(new { doc = Row(d, cards), content = content.RootElement.Clone() });
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] WorkDocDto dto, CancellationToken ct)
        {
            var title = (dto.Title ?? "").Trim();
            if (title.Length == 0) title = "Untitled plan";
            var content = ContentOf(dto.Content, out var err);
            if (err != null) return BadRequest(new { message = err });
            if (dto.CardId is Guid cid && cid != Guid.Empty && !await _db.WorkCards.AnyAsync(c => c.Id == cid, ct)) return BadRequest(new { message = "That card isn't on the board any more." });
            var d = new WorkDoc
            {
                Title = title.Length > 200 ? title[..200] : title,
                Kind = Kinds.Contains(dto.Kind) ? dto.Kind! : "plan",
                ContentJson = content ?? "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
                PlainText = Clip(dto.Text, MaxText) ?? "",
                Project = Clip(dto.Project, 80),
                CardId = dto.CardId is Guid g && g != Guid.Empty ? g : null,
                CreatedBy = Me, UpdatedBy = Me,
            };
            _db.WorkDocs.Add(d);
            if (d.CardId != null) _db.WorkNotes.Add(new WorkNote { CardId = d.CardId.Value, Kind = "activity", AgentId = Me, Text = $"wrote a plan: \"{d.Title}\"" });
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"New plan: {d.Title}", RefId = d.Id.ToString() });
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        private static string? Clip(string? s, int n) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length > n ? s.Trim()[..n] : s.Trim();

        /// <summary>
        /// Saves the document. If someone else saved it after this editor opened it, nothing is overwritten: the answer is
        /// 409 with who saved it, and the editor asks what to do. The version before every save is kept.
        /// </summary>
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Save(Guid id, [FromBody] WorkDocDto dto, [FromQuery] bool force, CancellationToken ct)
        {
            var d = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound(new { message = "That document isn't here any more." });
            if (d.DeletedAt != null) return BadRequest(new { message = "This is in the Bin. Put it back before changing it." });
            if (d.Kind == FileKind) { dto.Content = null; dto.Kind = null; }   // an uploaded file: only its title, project and card can change
            if (!force && dto.Version != null && dto.Version != d.Version)
                return Conflict(new { message = "Someone else saved this document while you were editing it.", version = d.Version, updatedBy = d.UpdatedBy, updatedAt = d.UpdatedAt });
            var content = ContentOf(dto.Content, out var err);
            if (err != null) return BadRequest(new { message = err });
            var title = Clip(dto.Title, 200);
            var changed = content != null && content != d.ContentJson || title != null && title != d.Title;
            if (changed)
            {
                // Keep what was there before (nothing written is ever lost).
                _db.WorkDocRevisions.Add(new WorkDocRevision { DocId = d.Id, Version = d.Version, Title = d.Title, ContentJson = d.ContentJson, SavedBy = d.UpdatedBy, SavedAt = d.UpdatedAt });
            }
            if (title != null) d.Title = title;
            if (content != null) { d.ContentJson = content; d.PlainText = Clip(dto.Text, MaxText) ?? ""; }
            if (dto.Kind != null && Kinds.Contains(dto.Kind)) d.Kind = dto.Kind;
            if (dto.Project != null) d.Project = Clip(dto.Project, 80);
            if (dto.CardId != null)
            {
                if (dto.CardId == Guid.Empty) d.CardId = null;
                else if (await _db.WorkCards.AnyAsync(c => c.Id == dto.CardId, ct)) d.CardId = dto.CardId;
                else return BadRequest(new { message = "That card isn't on the board any more." });
            }
            d.Version++;
            d.UpdatedBy = Me;
            d.UpdatedAt = DateTime.UtcNow;
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict(new { message = "Someone else saved this document at the same moment. Open it again to see their version." });
            }
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"Plan saved: {d.Title}", RefId = d.Id.ToString() });
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        [HttpPost("{id:guid}/pin")]
        public async Task<IActionResult> Pin(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var d = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound();
            d.Pinned = !undo;
            await _db.SaveChangesAsync(ct);
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        [HttpPost("{id:guid}/archive")]
        public async Task<IActionResult> Archive(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var d = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound();
            d.Archived = !undo;
            if (!undo) d.Pinned = false;
            await _db.SaveChangesAsync(ct);
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        /// <summary>To the Bin (or back out of it with undo). Nothing is removed.</summary>
        [HttpPost("{id:guid}/delete")]
        public async Task<IActionResult> Delete(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var d = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound(new { message = "That document isn't here any more." });
            if (undo) { d.DeletedAt = null; d.DeletedBy = null; }
            else if (d.DeletedAt == null) { d.DeletedAt = DateTime.UtcNow; d.DeletedBy = Me; d.Pinned = false; }
            await _db.SaveChangesAsync(ct);
            if (d.CardId != null)
            {
                _db.WorkNotes.Add(new WorkNote { CardId = d.CardId.Value, Kind = "activity", AgentId = Me, Text = undo ? $"put \"{d.Title}\" back from the Bin" : $"moved \"{d.Title}\" to the Bin" });
                await _db.SaveChangesAsync(ct);
            }
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        /// <summary>
        /// Delete for ever: the document, its earlier versions and its uploaded file. Only from the Bin, and only by an
        /// admin or the person who wrote it. This cannot be undone.
        /// </summary>
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Erase(Guid id, CancellationToken ct)
        {
            var d = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound(new { message = "That document isn't here any more." });
            if (d.DeletedAt == null) return BadRequest(new { message = "Move it to the Bin first." });
            if (!CanErase(User.IsAdmin(), Me, d.CreatedBy)) return StatusCode(403, new { message = "Only an admin or the person who wrote it can delete it for ever." });
            var key = d.FileKey;
            var title = d.Title;
            var cardId = d.CardId;
            _db.WorkDocRevisions.RemoveRange(await _db.WorkDocRevisions.Where(r => r.DocId == id).ToListAsync(ct));
            _db.WorkDocs.Remove(d);
            if (cardId != null) _db.WorkNotes.Add(new WorkNote { CardId = cardId.Value, Kind = "activity", AgentId = Me, Text = $"deleted \"{title}\" for ever" });
            await _db.SaveChangesAsync(ct);
            // The row is gone first: if the stored file cannot be removed now, nothing points to it any more.
            var fileGone = key == null || await _files.DeleteAsync(key, ct);
            return Ok(new { deleted = true, fileGone });
        }

        /// <summary>Uploads a document (PDF, Word, Excel, PowerPoint, text or a picture) to sit beside the plans.</summary>
        [HttpPost("upload")]
        [RequestSizeLimit(MaxFileBytes + 1_000_000)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxFileBytes + 1_000_000)]
        public async Task<IActionResult> Upload([FromForm] IFormFile file, [FromForm] string? title, [FromForm] Guid? cardId, CancellationToken ct)
        {
            if (file == null || file.Length == 0) return BadRequest(new { message = "Choose a file." });
            if (file.Length > MaxFileBytes) return BadRequest(new { message = "Files can be up to 25 MB." });
            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!Uploads.TryGetValue(ext, out var mime))
                return BadRequest(new { message = "Upload a PDF, Word, Excel, PowerPoint, text or CSV file, or a picture." });
            if (cardId is Guid cid && cid != Guid.Empty && !await _db.WorkCards.AnyAsync(c => c.Id == cid, ct)) return BadRequest(new { message = "That card isn't on the board any more." });

            await using var s = file.OpenReadStream();
            var head = new byte[Math.Min(512, (int)Math.Min(file.Length, 512))];
            var read = 0;
            while (read < head.Length) { var n = await s.ReadAsync(head.AsMemory(read), ct); if (n == 0) break; read += n; }
            if (!LooksLike(ext, head[..read])) return BadRequest(new { message = "This file isn't what its name says. Save it again in its own program and upload that." });
            s.Position = 0;

            var name = Path.GetFileName(file.FileName ?? $"file{ext}");
            if (name.Length > 150) name = name[^150..];
            var key = await _files.SaveAsync("work-docs", name, s, mime, ct);
            var t = Clip(title, 200) ?? Path.GetFileNameWithoutExtension(name);
            var d = new WorkDoc
            {
                Title = string.IsNullOrWhiteSpace(t) ? "Uploaded file" : t, Kind = FileKind,
                ContentJson = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}", PlainText = name,
                CardId = cardId is Guid g && g != Guid.Empty ? g : null,
                FileKey = key, FileName = name, FileMime = mime, FileSize = file.Length,
                CreatedBy = Me, UpdatedBy = Me,
            };
            _db.WorkDocs.Add(d);
            if (d.CardId != null) _db.WorkNotes.Add(new WorkNote { CardId = d.CardId.Value, Kind = "activity", AgentId = Me, Text = $"uploaded a file: \"{d.Title}\"" });
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"File uploaded: {d.Title}", RefId = d.Id.ToString() });
            return Ok(Row(d, await CardsAsync(new[] { d.CardId }, ct)));
        }

        /// <summary>The uploaded file itself. Pictures and PDFs can open in the page; everything else is sent as a download.</summary>
        [HttpGet("{id:guid}/file")]
        public async Task<IActionResult> FileOf(Guid id, [FromQuery] bool download, CancellationToken ct)
        {
            var d = await _db.WorkDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d?.FileKey == null) return NotFound(new { message = "That file isn't here any more." });
            var f = await _files.OpenAsync(d.FileKey, ct);
            if (f == null) return NotFound(new { message = "The file is no longer in storage." });
            var mime = d.FileMime ?? "application/octet-stream";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.Headers["Cache-Control"] = "private, no-store";
            var inline = !download && (mime.StartsWith("image/") || mime == "application/pdf" || mime.StartsWith("text/"));
            Response.Headers["Content-Disposition"] = $"{(inline ? "inline" : "attachment")}; filename*=UTF-8''{Uri.EscapeDataString(d.FileName ?? "file")}";
            return File(f.Value.Content, mime == "text/csv" ? "text/plain; charset=utf-8" : mime);
        }

        /// <summary>Earlier versions, newest first.</summary>
        [HttpGet("{id:guid}/history")]
        public async Task<IActionResult> History(Guid id, CancellationToken ct)
        {
            var list = await _db.WorkDocRevisions.AsNoTracking().Where(r => r.DocId == id).OrderByDescending(r => r.Version).Take(100)
                .Select(r => new { id = r.Id, version = r.Version, title = r.Title, savedBy = r.SavedBy, savedAt = r.SavedAt }).ToListAsync(ct);
            return Ok(list);
        }

        [HttpGet("{id:guid}/history/{revId:guid}")]
        public async Task<IActionResult> Revision(Guid id, Guid revId, CancellationToken ct)
        {
            var r = await _db.WorkDocRevisions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == revId && x.DocId == id, ct);
            if (r == null) return NotFound();
            using var content = JsonDocument.Parse(string.IsNullOrWhiteSpace(r.ContentJson) ? "{}" : r.ContentJson);
            return Ok(new { id = r.Id, version = r.Version, title = r.Title, savedBy = r.SavedBy, savedAt = r.SavedAt, content = content.RootElement.Clone() });
        }
    }
}
