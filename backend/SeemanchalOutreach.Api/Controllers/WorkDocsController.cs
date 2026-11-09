using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
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
    /// Nothing is lost: every save keeps the version before it, and documents are archived, never deleted.
    /// </summary>
    [ApiController]
    [Route("api/v1/work/docs")]
    [Authorize]
    public class WorkDocsController : ControllerBase
    {
        private static readonly string[] Kinds = { "plan", "doc", "notes" };
        private const int MaxContent = 2_000_000;  // characters of editor JSON (about 300 pages of text)
        private const int MaxText = 400_000;

        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;
        public WorkDocsController(IMarketingDbContext db, ILiveEvents live) { _db = db; _live = live; }

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
        public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] string? kind, [FromQuery] bool archived, [FromQuery] Guid? card, CancellationToken ct)
        {
            var query = _db.WorkDocs.AsNoTracking().Where(d => d.Archived == archived);
            if (!string.IsNullOrWhiteSpace(kind) && Kinds.Contains(kind)) query = query.Where(d => d.Kind == kind);
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
