using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WorkFolderDto
    {
        public string? Name { get; set; }
        /// <summary>Guid.Empty = the top level.</summary>
        public Guid? ParentId { get; set; }
        public string? Color { get; set; }
        /// <summary>team | restricted (new folders only).</summary>
        public string? Access { get; set; }
    }

    public class WorkDocMoveDto
    {
        public List<Guid>? Docs { get; set; }
        public List<Guid>? Folders { get; set; }
        /// <summary>The folder to move into; null or Guid.Empty = the top level.</summary>
        public Guid? To { get; set; }
    }

    public class WorkSharePerson
    {
        public string AgentId { get; set; } = string.Empty;
        /// <summary>view | comment | edit</summary>
        public string Role { get; set; } = "view";
    }

    public class WorkAccessDto
    {
        /// <summary>team | restricted; leave out to keep it.</summary>
        public string? Access { get; set; }
        /// <summary>Everyone it is shared with after this change (people left out lose their access).</summary>
        public List<WorkSharePerson>? People { get; set; }
        /// <summary>A short note for the people newly added.</summary>
        public string? Message { get; set; }
    }

    public class WorkDocCommentDto
    {
        public string? Text { get; set; }
        public Guid? ParentId { get; set; }
        public string? Quote { get; set; }
        public int QuoteNth { get; set; }
        public List<string>? Mentions { get; set; }
    }

    /// <summary>Folders, moving, sharing and private access, stars, copies and comments for Team board documents.</summary>
    public partial class WorkDocsController
    {
        private static readonly string[] FolderColors = { "", "blue", "green", "orange", "red", "purple", "teal", "grey" };
        private const int MaxComment = 4000;

        /// <summary>Why something can't go into this folder (null = it can).</summary>
        private async Task<string?> FolderProblemAsync(Guid? folderId, CancellationToken ct)
        {
            if (folderId is not Guid g) return null;
            var ctx = await CtxAsync(ct);
            if (!ctx.Folders.TryGetValue(g, out var f) || f.DeletedAt != null || ctx.Folder(g) < DocAccess.View) return "That folder isn't here any more.";
            if (ctx.Folder(g) < DocAccess.Edit) return $"You can't add to “{f.Name}”. Ask its owner for edit access.";
            return null;
        }

        private object FolderRow(WorkDocFolder f, DocAccess.Context ctx, Dictionary<Guid, int> people, Dictionary<Guid, int> counts) => new
        {
            id = f.Id, name = f.Name, parentId = f.ParentId, color = f.Color, access = f.Access, owner = f.CreatedBy,
            role = DocAccess.NameOf(ctx.Folder(f.Id)), inTree = ctx.InTree(f.ParentId), shared = f.CreatedBy != Me && ctx.SharedFolder(f.Id),
            people = people.GetValueOrDefault(f.Id), items = counts.GetValueOrDefault(f.Id),
            createdAt = f.CreatedAt, updatedAt = f.UpdatedAt, deleted = f.DeletedAt != null, deletedAt = f.DeletedAt, deletedBy = f.DeletedBy,
        };

        /// <summary>
        /// Every folder this person can see (the page builds the tree from it), or with <c>bin</c> the folders in the Bin
        /// that they could change.
        /// </summary>
        [HttpGet("folders")]
        public async Task<IActionResult> Folders([FromQuery] bool bin, CancellationToken ct)
        {
            var ctx = await CtxAsync(ct);
            var list = ctx.Folders.Values.Where(f => bin ? f.DeletedAt != null && f.DeletedWith == null && ctx.Folder(f.Id) >= DocAccess.Edit
                    : f.DeletedAt == null && ctx.Folder(f.Id) >= DocAccess.View)
                .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList();
            var ids = list.Select(f => f.Id).ToList();
            var people = (await _db.WorkDocShares.AsNoTracking().Where(s => s.FolderId != null && ids.Contains(s.FolderId.Value)).GroupBy(s => s.FolderId!.Value)
                .Select(g => new { g.Key, n = g.Count() }).ToListAsync(ct)).ToDictionary(x => x.Key, x => x.n);
            var docs = await _db.WorkDocs.AsNoTracking().Where(d => d.DeletedAt == null && !d.Archived && d.FolderId != null && ids.Contains(d.FolderId.Value))
                .Select(d => new { d.Id, d.CreatedBy, d.Access, d.FolderId }).ToListAsync(ct);
            var counts = docs.Where(d => ctx.Doc(d.Id, d.CreatedBy, d.Access, d.FolderId) >= DocAccess.View).GroupBy(d => d.FolderId!.Value).ToDictionary(g => g.Key, g => g.Count());
            foreach (var f in list.Where(f => f.ParentId != null)) counts[f.ParentId!.Value] = counts.GetValueOrDefault(f.ParentId!.Value) + (bin ? 0 : 1);
            return Ok(list.Select(f => FolderRow(f, ctx, people, counts)));
        }

        private static string? CleanName(string? name)
        {
            var n = string.Join(' ', (name ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
            return n.Length == 0 ? null : n.Length > 80 ? n[..80] : n;
        }

        [HttpPost("folders")]
        public async Task<IActionResult> NewFolder([FromBody] WorkFolderDto dto, CancellationToken ct)
        {
            var name = CleanName(dto.Name);
            if (name == null) return BadRequest(new { message = "Give the folder a name." });
            var parent = dto.ParentId is Guid p && p != Guid.Empty ? p : (Guid?)null;
            if (await FolderProblemAsync(parent, ct) is string problem) return BadRequest(new { message = problem });
            var ctx = await CtxAsync(ct);
            if (ctx.Folders.Values.Any(f => f.DeletedAt == null && f.ParentId == parent && string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase) && ctx.Folder(f.Id) >= DocAccess.View))
                return BadRequest(new { message = $"There is already a folder called “{name}” here." });
            var f = new WorkDocFolder
            {
                Name = name, ParentId = parent, Color = FolderColors.Contains(dto.Color) ? dto.Color : null,
                Access = dto.Access == "restricted" ? "restricted" : "team", CreatedBy = Me,
            };
            _db.WorkDocFolders.Add(f);
            await _db.SaveChangesAsync(ct);
            ctx.Folders[f.Id] = f;
            return Ok(FolderRow(f, new DocAccess.Context(Me, ctx.Folders.Values, Array.Empty<WorkDocShare>()), new(), new()));
        }

        /// <summary>Rename a folder or change its colour (moving is <see cref="Move"/>).</summary>
        [HttpPut("folders/{id:guid}")]
        public async Task<IActionResult> EditFolder(Guid id, [FromBody] WorkFolderDto dto, CancellationToken ct)
        {
            var ctx = await CtxAsync(ct);
            var f = await _db.WorkDocFolders.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
            if (f == null || ctx.Folder(id) < DocAccess.View) return NotFound(new { message = "That folder isn't here any more." });
            if (ctx.Folder(id) < DocAccess.Edit) return StatusCode(403, new { message = "You can't change this folder. Ask its owner for edit access." });
            if (dto.Name != null)
            {
                var name = CleanName(dto.Name);
                if (name == null) return BadRequest(new { message = "Give the folder a name." });
                f.Name = name;
            }
            if (dto.Color != null) f.Color = FolderColors.Contains(dto.Color) && dto.Color.Length > 0 ? dto.Color : null;
            f.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(FolderRow(f, ctx, new(), new()));
        }

        /// <summary>
        /// A folder to the Bin, with what is in it (they come back together). Anything inside that this person can't see
        /// (someone's private document) is not deleted with it: it moves up to the folder above instead.
        /// </summary>
        [HttpPost("folders/{id:guid}/delete")]
        public async Task<IActionResult> DeleteFolder(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var ctx = await CtxAsync(ct);
            var f = await _db.WorkDocFolders.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (f == null || ctx.Folder(id) < DocAccess.View) return NotFound(new { message = "That folder isn't here any more." });
            if (ctx.Folder(id) < DocAccess.Edit) return StatusCode(403, new { message = "You can't delete this folder. Ask its owner." });
            var now = DateTime.UtcNow;
            if (undo)
            {
                if (f.DeletedAt == null) return Ok(new { restored = 0 });
                var folders = await _db.WorkDocFolders.Where(x => x.Id == id || x.DeletedWith == id).ToListAsync(ct);
                foreach (var x in folders) { x.DeletedAt = null; x.DeletedBy = null; x.DeletedWith = null; }
                var docs = await _db.WorkDocs.Where(d => d.DeletedWith == id).ToListAsync(ct);
                foreach (var d in docs) { d.DeletedAt = null; d.DeletedBy = null; d.DeletedWith = null; }
                // Its own folder went to the Bin meanwhile: it comes back at the top level.
                var movedOut = f.ParentId is Guid pid && (!ctx.Folders.TryGetValue(pid, out var parent) || parent.DeletedAt != null);
                if (movedOut) f.ParentId = null;
                await _db.SaveChangesAsync(ct);
                return Ok(new { restored = docs.Count + folders.Count - 1, movedToTop = movedOut });
            }
            if (f.DeletedAt != null) return Ok(new { deleted = 0 });
            // Everything below this folder.
            var below = new List<WorkDocFolder>();
            var frontier = new List<Guid> { id };
            var all = await _db.WorkDocFolders.Where(x => x.DeletedAt == null).ToListAsync(ct);
            for (var i = 0; i < 30 && frontier.Count > 0; i++)
            {
                var next = all.Where(x => x.ParentId != null && frontier.Contains(x.ParentId.Value) && x.Id != id).ToList();
                below.AddRange(next);
                frontier = next.Select(x => x.Id).ToList();
            }
            var inside = below.Select(x => x.Id).Append(id).ToList();
            var items = await _db.WorkDocs.Where(d => d.DeletedAt == null && d.FolderId != null && inside.Contains(d.FolderId.Value)).ToListAsync(ct);
            var kept = 0;
            foreach (var d in items)
            {
                if (ctx.Doc(d) < DocAccess.Edit) { d.FolderId = f.ParentId; kept++; continue; }   // not theirs to delete
                d.DeletedAt = now; d.DeletedBy = Me; d.DeletedWith = id; d.Pinned = false;
            }
            foreach (var x in below)
            {
                if (ctx.Folder(x.Id) < DocAccess.Edit) { x.ParentId = f.ParentId; kept++; continue; }
                x.DeletedAt = now; x.DeletedBy = Me; x.DeletedWith = id;
            }
            f.DeletedAt = now; f.DeletedBy = Me;
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = "A folder changed", RefId = f.Id.ToString() });
            return Ok(new { deleted = items.Count - kept + 1, keptOut = kept });
        }

        /// <summary>
        /// Moves documents and folders into a folder (drag and drop, or "Move to"). Needs edit rights on each item and on
        /// the folder it goes into; a folder can't go inside itself. Items that can't move are named in the answer.
        /// </summary>
        [HttpPost("move")]
        public async Task<IActionResult> Move([FromBody] WorkDocMoveDto dto, CancellationToken ct)
        {
            var to = dto.To is Guid t && t != Guid.Empty ? t : (Guid?)null;
            if (await FolderProblemAsync(to, ct) is string problem) return BadRequest(new { message = problem });
            var ctx = await CtxAsync(ct);
            var docIds = (dto.Docs ?? new()).Distinct().Take(200).ToList();
            var folderIds = (dto.Folders ?? new()).Distinct().Take(200).ToList();
            var skipped = new List<string>();
            var docs = await _db.WorkDocs.Where(d => docIds.Contains(d.Id) && d.DeletedAt == null).ToListAsync(ct);
            foreach (var d in docs)
            {
                var r = ctx.Doc(d);
                if (r < DocAccess.View) continue;
                if (r < DocAccess.Edit) { skipped.Add(d.Title); continue; }
                d.FolderId = to;
            }
            var folders = await _db.WorkDocFolders.Where(f => folderIds.Contains(f.Id) && f.DeletedAt == null).ToListAsync(ct);
            foreach (var f in folders)
            {
                var r = ctx.Folder(f.Id);
                if (r < DocAccess.View) continue;
                if (r < DocAccess.Edit || ctx.IsInside(to, f.Id)) { skipped.Add(f.Name); continue; }
                f.ParentId = to; f.UpdatedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = "Documents moved", RefId = to?.ToString() });
            return Ok(new { moved = docs.Count + folders.Count - skipped.Count, skipped });
        }

        // ─── Sharing and private access ─────────────────────────────────────────────

        private async Task<object> AccessViewAsync(Guid? docId, Guid? folderId, string owner, string access, int role, CancellationToken ct)
        {
            var shares = await _db.WorkDocShares.AsNoTracking().Where(s => docId != null ? s.DocId == docId : s.FolderId == folderId).OrderBy(s => s.SharedAt).ToListAsync(ct);
            var ctx = await CtxAsync(ct);
            Guid? parent = docId != null ? (await _db.WorkDocs.AsNoTracking().Where(d => d.Id == docId).Select(d => d.FolderId).FirstOrDefaultAsync(ct))
                : ctx.Folders.TryGetValue(folderId!.Value, out var f) ? f.ParentId : null;
            var path = ctx.PathTo(parent);
            var closedAbove = path.LastOrDefault(p => p.Access == "restricted");
            return new
            {
                access, owner, role = DocAccess.NameOf(role),
                canShare = DocAccess.CanShare(role, access), canChangeAccess = DocAccess.CanChangeAccess(role),
                people = shares.Select(s => new { agentId = s.AgentId, role = s.Role, sharedBy = s.SharedBy, sharedAt = s.SharedAt }),
                // The folder above that already limits who can see it (team items inside a restricted folder).
                limitedBy = closedAbove == null ? null : new { id = closedAbove.Id, name = closedAbove.Name },
            };
        }

        [HttpGet("{id:guid}/access")]
        public async Task<IActionResult> DocAccessOf(Guid id, CancellationToken ct)
        {
            if (await FindAsync(id, false, ct) is not var (d, role)) return Gone();
            return Ok(await AccessViewAsync(d.Id, null, d.CreatedBy, d.Access, role, ct));
        }

        [HttpGet("folders/{id:guid}/access")]
        public async Task<IActionResult> FolderAccessOf(Guid id, CancellationToken ct)
        {
            var ctx = await CtxAsync(ct);
            if (!ctx.Folders.TryGetValue(id, out var f) || f.DeletedAt != null || ctx.Folder(id) < DocAccess.View) return NotFound(new { message = "That folder isn't here any more." });
            return Ok(await AccessViewAsync(null, id, f.CreatedBy, f.Access, ctx.Folder(id), ct));
        }

        [HttpPut("{id:guid}/access")]
        public async Task<IActionResult> SetDocAccess(Guid id, [FromBody] WorkAccessDto dto, CancellationToken ct)
        {
            if (await FindAsync(id, true, ct) is not var (d, role)) return Gone();
            var err = await ApplyAccessAsync(dto, role, d.Access, a => d.Access = a, d.Id, null, d.CreatedBy, d.Title, $"doc:{d.Id}", ct);
            if (err != null) return err;
            await _db.SaveChangesAsync(ct);
            await LiveAsync(d, "Sharing changed");
            return Ok(await AccessViewAsync(d.Id, null, d.CreatedBy, d.Access, role, ct));
        }

        [HttpPut("folders/{id:guid}/access")]
        public async Task<IActionResult> SetFolderAccess(Guid id, [FromBody] WorkAccessDto dto, CancellationToken ct)
        {
            var ctx = await CtxAsync(ct);
            var f = await _db.WorkDocFolders.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
            var role = ctx.Folder(id);
            if (f == null || role < DocAccess.View) return NotFound(new { message = "That folder isn't here any more." });
            var err = await ApplyAccessAsync(dto, role, f.Access, a => f.Access = a, null, f.Id, f.CreatedBy, f.Name, $"docs-folder:{f.Id}", ct);
            if (err != null) return err;
            await _db.SaveChangesAsync(ct);
            return Ok(await AccessViewAsync(null, f.Id, f.CreatedBy, f.Access, role, ct));
        }

        /// <summary>Checks and applies a sharing change (not saved yet); tells newly added people. Returns an error answer, or null.</summary>
        private async Task<IActionResult?> ApplyAccessAsync(WorkAccessDto dto, int role, string access, Action<string> setAccess,
            Guid? docId, Guid? folderId, string owner, string title, string link, CancellationToken ct)
        {
            if (dto.Access != null && dto.Access != access)
            {
                if (dto.Access != "team" && dto.Access != "restricted") return BadRequest(new { message = "Choose who can open it: the team, or only the people added." });
                if (!DocAccess.CanChangeAccess(role)) return StatusCode(403, new { message = "Only its owner can make it private or open it to the team." });
                setAccess(dto.Access);
                access = dto.Access;
            }
            if (dto.People == null) return null;
            if (!DocAccess.CanShare(role, access)) return StatusCode(403, new { message = access == "restricted" ? "Only its owner can choose who sees a private item." : "You can read this but not share it. Ask its owner." });
            var wanted = dto.People.Where(p => !string.IsNullOrWhiteSpace(p.AgentId) && p.AgentId != owner).GroupBy(p => p.AgentId).Select(g => g.Last()).Take(100).ToList();
            if (wanted.Any(p => !DocAccess.Roles.Contains(p.Role))) return BadRequest(new { message = "Each person can view, comment or edit." });
            var ids = wanted.Select(p => p.AgentId).ToList();
            var known = await _db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId) && a.IsActive && a.Role != "field_rep").Select(a => a.AgentId).ToListAsync(ct);
            var unknown = ids.Except(known).ToList();
            if (unknown.Count > 0) return BadRequest(new { message = "Some of those people can't use the Team board. Choose people from the office team." });
            var current = await _db.WorkDocShares.Where(s => docId != null ? s.DocId == docId : s.FolderId == folderId).ToListAsync(ct);
            // Someone who isn't the owner can add people and raise roles, but not remove others' access or lower it.
            if (role != DocAccess.Owner && current.Any(c => !wanted.Any(w => w.AgentId == c.AgentId && DocAccess.RoleOf(w.Role) >= DocAccess.RoleOf(c.Role))))
                return StatusCode(403, new { message = "Only its owner can remove people or lower what they can do." });
            if (role != DocAccess.Owner && wanted.Any(w => DocAccess.RoleOf(w.Role) > role)) return StatusCode(403, new { message = "You can't give someone more access than you have." });
            foreach (var c in current.Where(c => !ids.Contains(c.AgentId))) _db.WorkDocShares.Remove(c);
            var added = new List<string>();
            foreach (var w in wanted)
            {
                var c = current.FirstOrDefault(x => x.AgentId == w.AgentId);
                if (c == null) { _db.WorkDocShares.Add(new WorkDocShare { DocId = docId, FolderId = folderId, AgentId = w.AgentId, Role = w.Role, SharedBy = Me }); added.Add(w.AgentId); }
                else if (c.Role != w.Role) c.Role = w.Role;
            }
            if (added.Count > 0)
            {
                var me = await _db.Agents.AsNoTracking().Where(a => a.AgentId == Me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? "Someone";
                var note = CleanText(dto.Message, 300);
                _notifier.Notify(new NotifyJob
                {
                    To = added, Kind = "work", Title = $"{me} shared {(folderId != null ? "a folder" : "a document")} with you",
                    Body = note != null ? $"{title}: {note}" : title, Link = link, RefId = (docId ?? folderId)?.ToString(), Except = Me,
                });
            }
            return null;
        }

        private static string? CleanText(string? s, int max)
        {
            var t = (s ?? "").Trim();
            return t.Length == 0 ? null : t.Length > max ? t[..max] : t;
        }

        // ─── Stars and copies ───────────────────────────────────────────────────────

        [HttpPost("{id:guid}/star")]
        public async Task<IActionResult> Star(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            if (await FindAsync(id, false, ct) is not var (d, role)) return Gone();
            var mine = await _db.WorkDocStars.FirstOrDefaultAsync(s => s.AgentId == Me && s.DocId == id, ct);
            if (undo && mine != null) _db.WorkDocStars.Remove(mine);
            else if (!undo && mine == null) _db.WorkDocStars.Add(new WorkDocStar { AgentId = Me, DocId = id });
            await _db.SaveChangesAsync(ct);
            return Ok(await OneAsync(d, role, ct));
        }

        /// <summary>A copy of a written document (not of an uploaded file), owned by this person, in the same folder if they can add there.</summary>
        [HttpPost("{id:guid}/copy")]
        public async Task<IActionResult> Copy(Guid id, CancellationToken ct)
        {
            if (await FindAsync(id, false, ct) is not var (d, _)) return Gone();
            if (d.Kind == FileKind) return BadRequest(new { message = "Uploaded files can't be copied here. Download it and upload it again." });
            var folder = await FolderProblemAsync(d.FolderId, ct) == null ? d.FolderId : null;
            var copy = new WorkDoc
            {
                Title = (d.Title.Length > 190 ? d.Title[..190] : d.Title) + " (copy)", Kind = d.Kind, ContentJson = d.ContentJson, PlainText = d.PlainText,
                Project = d.Project, FolderId = folder, Access = d.Access, CreatedBy = Me, UpdatedBy = Me,
            };
            _db.WorkDocs.Add(copy);
            await _db.SaveChangesAsync(ct);
            await LiveAsync(copy, "New plan");
            return Ok(await OneAsync(copy, DocAccess.Owner, ct));
        }

        // ─── Comments ───────────────────────────────────────────────────────────────

        private static object CommentRow(WorkDocComment c) => new
        {
            id = c.Id, parentId = c.ParentId, quote = c.Quote, quoteNth = c.QuoteNth,
            text = c.DeletedAt != null ? "" : c.Text, removed = c.DeletedAt != null,
            mentions = c.DeletedAt != null ? new List<string>() : JsonSerializer.Deserialize<List<string>>(c.MentionsJson) ?? new(),
            agentId = c.AgentId, createdAt = c.CreatedAt, editedAt = c.EditedAt, resolved = c.Resolved, resolvedBy = c.ResolvedBy, resolvedAt = c.ResolvedAt,
        };

        /// <summary>Every comment on a document, oldest first (the page groups replies under the first comment).</summary>
        [HttpGet("{id:guid}/comments")]
        public async Task<IActionResult> Comments(Guid id, CancellationToken ct)
        {
            if (await FindAsync(id, false, ct) is not var (_, role)) return Gone();
            var list = await _db.WorkDocComments.AsNoTracking().Where(c => c.DocId == id).OrderBy(c => c.CreatedAt).Take(2000).ToListAsync(ct);
            return Ok(new { role = DocAccess.NameOf(role), comments = list.Select(CommentRow) });
        }

        [HttpPost("{id:guid}/comments")]
        public async Task<IActionResult> AddComment(Guid id, [FromBody] WorkDocCommentDto dto, CancellationToken ct)
        {
            if (await FindAsync(id, false, ct) is not var (d, role)) return Gone();
            if (role < DocAccess.Comment) return StatusCode(403, new { message = "You can read this document but not comment on it. Ask its owner." });
            if (d.DeletedAt != null) return BadRequest(new { message = "This is in the Bin. Put it back to comment on it." });
            var text = CleanText(dto.Text, MaxComment);
            if (text == null) return BadRequest(new { message = "Write a comment." });
            WorkDocComment? root = null;
            if (dto.ParentId is Guid pid)
            {
                root = await _db.WorkDocComments.FirstOrDefaultAsync(c => c.Id == pid && c.DocId == id, ct);
                if (root == null) return BadRequest(new { message = "That comment isn't here any more." });
                if (root.ParentId != null) root = await _db.WorkDocComments.FirstOrDefaultAsync(c => c.Id == root.ParentId, ct) ?? root;
            }
            // Mentions: only people who can open the document (others would get a link they can't use).
            var people = (await _db.Agents.AsNoTracking().Where(a => a.IsActive && a.Role != "field_rep").Select(a => a.AgentId).ToListAsync(ct)).ToHashSet();
            var mentions = DocAccess.Mentions(dto.Mentions, people, Me);
            var cannot = new List<string>();
            foreach (var m in mentions)
            {
                var their = new DocAccess.Context(m, (await CtxAsync(ct)).Folders.Values, await _db.WorkDocShares.AsNoTracking().Where(s => s.AgentId == m).ToListAsync(ct));
                if (their.Doc(d) < DocAccess.View) cannot.Add(m);
            }
            if (cannot.Count > 0)
            {
                var names = await _db.Agents.AsNoTracking().Where(a => cannot.Contains(a.AgentId)).Select(a => a.Name).ToListAsync(ct);
                return BadRequest(new { message = $"{string.Join(", ", names)} can't open this document. Share it with them first.", cannotOpen = cannot });
            }
            var c = new WorkDocComment
            {
                DocId = id, ParentId = root?.Id, Text = text, AgentId = Me, MentionsJson = JsonSerializer.Serialize(mentions),
                Quote = root == null ? CleanText(dto.Quote, 500) : null, QuoteNth = root == null ? Math.Max(0, dto.QuoteNth) : 0,
            };
            if (root != null && root.Resolved) { root.Resolved = false; root.ResolvedBy = null; root.ResolvedAt = null; }   // a reply reopens it
            _db.WorkDocComments.Add(c);
            await _db.SaveChangesAsync(ct);

            // Who hears about it: the people mentioned, the document's owner, and everyone already in this thread.
            var to = new HashSet<string>(mentions) { d.CreatedBy };
            if (root != null)
                foreach (var a in await _db.WorkDocComments.AsNoTracking().Where(x => x.Id == root.Id || x.ParentId == root.Id).Select(x => x.AgentId).ToListAsync(ct)) to.Add(a);
            to.Remove(Me);
            if (to.Count > 0)
            {
                var me = await _db.Agents.AsNoTracking().Where(a => a.AgentId == Me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? "Someone";
                var clip = text.Length > 140 ? text[..140] + "…" : text;
                foreach (var group in to.GroupBy(a => mentions.Contains(a)))
                    _notifier.Notify(new NotifyJob
                    {
                        To = group.ToList(), Kind = "work", Except = Me,
                        Title = group.Key ? $"{me} mentioned you in “{d.Title}”" : root != null ? $"{me} replied on “{d.Title}”" : $"{me} commented on “{d.Title}”",
                        Body = clip, Link = $"doc:{d.Id}:{root?.Id ?? c.Id}", RefId = d.Id.ToString(),
                    });
            }
            await LiveAsync(d, "New comment");
            return Ok(CommentRow(c));
        }

        private async Task<(WorkDocComment C, WorkDoc D, int Role)?> CommentAsync(Guid cid, CancellationToken ct)
        {
            var c = await _db.WorkDocComments.FirstOrDefaultAsync(x => x.Id == cid, ct);
            if (c == null || await FindAsync(c.DocId, false, ct) is not var (d, role)) return null;
            return (c, d, role);
        }

        /// <summary>The writer changes their own words.</summary>
        [HttpPut("comments/{cid:guid}")]
        public async Task<IActionResult> EditComment(Guid cid, [FromBody] WorkDocCommentDto dto, CancellationToken ct)
        {
            if (await CommentAsync(cid, ct) is not var (c, _, _)) return NotFound(new { message = "That comment isn't here any more." });
            if (c.AgentId != Me) return StatusCode(403, new { message = "Only the person who wrote a comment can change it." });
            if (c.DeletedAt != null) return BadRequest(new { message = "That comment was removed." });
            var text = CleanText(dto.Text, MaxComment);
            if (text == null) return BadRequest(new { message = "Write a comment." });
            c.Text = text; c.EditedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(CommentRow(c));
        }

        /// <summary>Marks a thread done (anyone who can comment), or opens it again.</summary>
        [HttpPost("comments/{cid:guid}/resolve")]
        public async Task<IActionResult> Resolve(Guid cid, [FromQuery] bool undo, CancellationToken ct)
        {
            if (await CommentAsync(cid, ct) is not var (c, d, role)) return NotFound(new { message = "That comment isn't here any more." });
            if (role < DocAccess.Comment) return StatusCode(403, new { message = "You can read this document but not comment on it." });
            if (c.ParentId != null) c = await _db.WorkDocComments.FirstOrDefaultAsync(x => x.Id == c.ParentId, ct) ?? c;
            c.Resolved = !undo; c.ResolvedBy = undo ? null : Me; c.ResolvedAt = undo ? null : DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            await LiveAsync(d, undo ? "Comment opened again" : "Comment resolved");
            return Ok(CommentRow(c));
        }

        /// <summary>The writer takes a comment back. It shows as "comment removed"; replies stay.</summary>
        [HttpPost("comments/{cid:guid}/delete")]
        public async Task<IActionResult> RemoveComment(Guid cid, CancellationToken ct)
        {
            if (await CommentAsync(cid, ct) is not var (c, _, _)) return NotFound(new { message = "That comment isn't here any more." });
            if (c.AgentId != Me) return StatusCode(403, new { message = "Only the person who wrote a comment can remove it." });
            c.DeletedAt ??= DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(CommentRow(c));
        }
    }
}
