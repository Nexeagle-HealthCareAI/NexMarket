using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WorkSprintDto
    {
        public string? Name { get; set; }
        public string? Goal { get; set; }
        /// <summary>yyyy-MM-dd, or "" to clear.</summary>
        public string? StartDate { get; set; }
        public string? EndDate { get; set; }
    }

    public class WorkSprintCloseDto
    {
        /// <summary>Where unfinished issues go: another open sprint, or null for the backlog.</summary>
        public Guid? MoveTo { get; set; }
    }

    public class WorkPlanDto
    {
        public List<Guid>? Ids { get; set; }
        /// <summary>The sprint; Guid.Empty or null = the backlog.</summary>
        public Guid? SprintId { get; set; }
        /// <summary>The issues they now sit between in the list (either may be null).</summary>
        public Guid? After { get; set; }
        public Guid? Before { get; set; }
    }

    public class WorkLinkDto
    {
        /// <summary>The other issue, by id or by its number (#12).</summary>
        public Guid? ToId { get; set; }
        public int? ToNumber { get; set; }
        /// <summary>blocks | blocked_by | relates | duplicates | duplicated_by | clones | cloned_by</summary>
        public string? Kind { get; set; }
    }

    public class WorkLogDto
    {
        /// <summary>"2h 30m", "1d", "45m"…</summary>
        public string? Time { get; set; }
        /// <summary>yyyy-MM-dd; today if left out.</summary>
        public string? Day { get; set; }
        public string? Note { get; set; }
    }

    public class WorkDocLinkDto { public Guid DocId { get; set; } }

    /// <summary>Sprints, the backlog order, issue links, linked documents, the work log, watching and the burndown.</summary>
    public partial class WorkBoardController
    {
        private static object SprintView(WorkSprint s) => new
        {
            id = s.Id, name = s.Name, goal = s.Goal, startDate = s.StartDate, endDate = s.EndDate, status = s.Status,
            committedPoints = s.CommittedPoints, completedPoints = s.CompletedPoints, completedIssues = s.CompletedIssues,
            startedAt = s.StartedAt, closedAt = s.ClosedAt, createdBy = s.CreatedBy,
        };

        private static string? Clip(string? s, int n) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length > n ? s.Trim()[..n] : s.Trim();

        // ─── The path above an issue, its links and its documents ──────────────────

        /// <summary>The issues above this one, from the top (epic › feature › story).</summary>
        private async Task<List<object>> PathAsync(WorkCard c, CancellationToken ct)
        {
            var path = new List<object>();
            var pid = c.ParentId;
            for (var i = 0; pid != null && i < 5; i++)
            {
                var p = await _db.WorkCards.AsNoTracking().Where(x => x.Id == pid).Select(x => new { x.Id, x.Number, x.Title, x.Type, x.ParentId }).FirstOrDefaultAsync(ct);
                if (p == null) break;
                path.Insert(0, new { id = p.Id, number = p.Number, title = p.Title, type = p.Type });
                pid = p.ParentId;
            }
            return path;
        }

        private async Task<List<object>> LinksAsync(Guid id, CancellationToken ct)
        {
            var links = await _db.WorkCardLinks.AsNoTracking().Where(l => l.FromId == id || l.ToId == id).ToListAsync(ct);
            var others = links.Select(l => l.FromId == id ? l.ToId : l.FromId).Distinct().ToList();
            var cards = await _db.WorkCards.AsNoTracking().Where(x => others.Contains(x.Id))
                .Select(x => new { x.Id, x.Number, x.Title, x.Type, x.Status, x.Priority, x.AssigneesJson, x.Archived }).ToDictionaryAsync(x => x.Id, ct);
            return links.Where(l => cards.ContainsKey(l.FromId == id ? l.ToId : l.FromId)).Select(l =>
            {
                var outward = l.FromId == id;
                var o = cards[outward ? l.ToId : l.FromId];
                var names = WorkIssues.LinkKinds.TryGetValue(l.Kind, out var k) ? k : (Out: "relates to", In: "relates to");
                return (object)new
                {
                    id = l.Id, kind = l.Kind, label = outward ? names.Out : names.In,
                    issue = new { id = o.Id, number = o.Number, title = o.Title, type = o.Type, status = o.Status, priority = o.Priority, assignees = Strings(o.AssigneesJson), archived = o.Archived },
                };
            }).ToList();
        }

        /// <summary>Documents linked to an issue (written for it, or linked to it later) that this person may open.</summary>
        private async Task<List<object>> LinkedDocsAsync(Guid id, CancellationToken ct)
        {
            var access = await WorkDocsController.AccessAsync(_db, User.AgentIdOf(), ct);
            var linked = await _db.WorkCardDocs.AsNoTracking().Where(x => x.CardId == id).Select(x => x.DocId).ToListAsync(ct);
            return (await _db.WorkDocs.AsNoTracking().Where(x => (x.CardId == id || linked.Contains(x.Id)) && !x.Archived && x.DeletedAt == null).OrderByDescending(x => x.UpdatedAt)
                .Select(x => new { x.Id, x.Title, x.Kind, x.UpdatedAt, x.UpdatedBy, x.CreatedBy, x.Access, x.FolderId, x.CardId, x.FileName }).ToListAsync(ct))
                .Where(x => access.Doc(x.Id, x.CreatedBy, x.Access, x.FolderId) >= DocAccess.View)
                .Select(x => (object)new { id = x.Id, title = x.Title, kind = x.Kind, updatedAt = x.UpdatedAt, updatedBy = x.UpdatedBy, access = x.Access, fileName = x.FileName, planFor = x.CardId == id }).ToList();
        }

        private async Task<WorkCard?> CardAsync(Guid id, CancellationToken ct) => await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == id, ct);
        private IActionResult NoCard() => NotFound(new { message = "That issue isn't here any more." });

        /// <summary>Finds issues by number (#12 or 12) or words in the title: for linking and choosing a parent.</summary>
        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string? q, [FromQuery] string? types, CancellationToken ct)
        {
            var query = _db.WorkCards.AsNoTracking().Where(c => !c.Archived);
            var wanted = (types ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Where(t => WorkIssues.Types.Contains(t)).ToList();
            if (wanted.Count > 0) query = query.Where(c => wanted.Contains(c.Type));
            var t = (q ?? "").Trim().TrimStart('#');
            if (int.TryParse(t, out var n)) query = query.Where(c => c.Number == n);
            else if (t.Length > 0) { var s = t.ToLower(); query = query.Where(c => c.Title.ToLower().Contains(s)); }
            var list = await query.OrderBy(c => c.Status == "done").ThenByDescending(c => c.UpdatedAt).Take(20)
                .Select(c => new { id = c.Id, number = c.Number, title = c.Title, type = c.Type, status = c.Status }).ToListAsync(ct);
            return Ok(list);
        }

        // ─── Links between issues ───────────────────────────────────────────────────

        [HttpPost("cards/{id:guid}/links")]
        public async Task<IActionResult> AddLink(Guid id, [FromBody] WorkLinkDto d, CancellationToken ct)
        {
            var c = await CardAsync(id, ct);
            if (c == null) return NoCard();
            var other = d.ToId != null ? await CardAsync(d.ToId.Value, ct) : d.ToNumber != null ? await _db.WorkCards.FirstOrDefaultAsync(x => x.Number == d.ToNumber, ct) : null;
            if (other == null) return BadRequest(new { message = "Choose the issue to link to." });
            if (other.Id == c.Id) return BadRequest(new { message = "An issue can't be linked to itself." });
            // "is blocked by" is the same link the other way round.
            var kind = (d.Kind ?? "relates").Replace("_by", "");
            if (!WorkIssues.LinkKinds.ContainsKey(kind)) return BadRequest(new { message = "Choose how they are linked." });
            var reverse = (d.Kind ?? "").EndsWith("_by");
            var (from, to) = reverse ? (other, c) : (c, other);
            if (await _db.WorkCardLinks.AnyAsync(l => (l.FromId == from.Id && l.ToId == to.Id || kind == "relates" && l.FromId == to.Id && l.ToId == from.Id) && l.Kind == kind, ct))
                return BadRequest(new { message = "Those two are already linked that way." });
            _db.WorkCardLinks.Add(new WorkCardLink { FromId = from.Id, ToId = to.Id, Kind = kind, CreatedBy = User.AgentIdOf() });
            var names = WorkIssues.LinkKinds[kind];
            Note(from.Id, $"linked: {names.Out} #{to.Number} {to.Title}");
            Note(to.Id, $"linked: {names.In} #{from.Number} {from.Title}");
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"Issues linked: #{from.Number} and #{to.Number}", RefId = c.Id.ToString() });
            return Ok(await LinksAsync(id, ct));
        }

        /// <summary>Removes a link (both issues keep a line in their history saying so).</summary>
        [HttpPost("links/{linkId:guid}/remove")]
        public async Task<IActionResult> RemoveLink(Guid linkId, [FromQuery] Guid from, CancellationToken ct)
        {
            var l = await _db.WorkCardLinks.FirstOrDefaultAsync(x => x.Id == linkId, ct);
            if (l == null) return Ok(await LinksAsync(from, ct));
            var a = await _db.WorkCards.AsNoTracking().Where(x => x.Id == l.FromId).Select(x => x.Number).FirstOrDefaultAsync(ct);
            var b = await _db.WorkCards.AsNoTracking().Where(x => x.Id == l.ToId).Select(x => x.Number).FirstOrDefaultAsync(ct);
            Note(l.FromId, $"removed the link with #{b}");
            Note(l.ToId, $"removed the link with #{a}");
            _db.WorkCardLinks.Remove(l);
            await _db.SaveChangesAsync(ct);
            return Ok(await LinksAsync(from, ct));
        }

        // ─── Documents on an issue ──────────────────────────────────────────────────

        [HttpPost("cards/{id:guid}/docs")]
        public async Task<IActionResult> LinkDoc(Guid id, [FromBody] WorkDocLinkDto d, CancellationToken ct)
        {
            var c = await CardAsync(id, ct);
            if (c == null) return NoCard();
            var doc = await _db.WorkDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == d.DocId && x.DeletedAt == null, ct);
            var access = await WorkDocsController.AccessAsync(_db, User.AgentIdOf(), ct);
            if (doc == null || access.Doc(doc) < DocAccess.View) return BadRequest(new { message = "That document isn't here any more, or it is private." });
            if (doc.CardId != id && !await _db.WorkCardDocs.AnyAsync(x => x.CardId == id && x.DocId == doc.Id, ct))
            {
                _db.WorkCardDocs.Add(new WorkCardDoc { CardId = id, DocId = doc.Id, CreatedBy = User.AgentIdOf() });
                // A private document's title stays out of the issue's history (others can read the history).
                Note(id, doc.Access == "restricted" ? "linked a private document" : $"linked the document \"{doc.Title}\"");
                c.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
            return Ok(await LinkedDocsAsync(id, ct));
        }

        [HttpPost("cards/{id:guid}/docs/{docId:guid}/remove")]
        public async Task<IActionResult> UnlinkDoc(Guid id, Guid docId, CancellationToken ct)
        {
            var c = await CardAsync(id, ct);
            if (c == null) return NoCard();
            var links = await _db.WorkCardDocs.Where(x => x.CardId == id && x.DocId == docId).ToListAsync(ct);
            _db.WorkCardDocs.RemoveRange(links);
            var doc = await _db.WorkDocs.FirstOrDefaultAsync(x => x.Id == docId && x.CardId == id, ct);
            if (doc != null)
            {
                var access = await WorkDocsController.AccessAsync(_db, User.AgentIdOf(), ct);
                if (access.Doc(doc) < DocAccess.Edit) return StatusCode(403, new { message = "You can't change that document. Ask its owner." });
                doc.CardId = null;
            }
            if (links.Count > 0 || doc != null) Note(id, "removed a linked document");
            await _db.SaveChangesAsync(ct);
            return Ok(await LinkedDocsAsync(id, ct));
        }

        /// <summary>The issues a document is linked to (shown on the document).</summary>
        [HttpGet("docs-links/{docId:guid}")]
        public async Task<IActionResult> DocCards(Guid docId, CancellationToken ct)
        {
            var access = await WorkDocsController.AccessAsync(_db, User.AgentIdOf(), ct);
            var doc = await _db.WorkDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == docId, ct);
            if (doc == null || access.Doc(doc) < DocAccess.View) return NotFound(new { message = "That document isn't here any more, or it is private." });
            var ids = await _db.WorkCardDocs.AsNoTracking().Where(x => x.DocId == docId).Select(x => x.CardId).ToListAsync(ct);
            if (doc.CardId != null) ids.Add(doc.CardId.Value);
            var list = await _db.WorkCards.AsNoTracking().Where(c => ids.Contains(c.Id))
                .Select(c => new { id = c.Id, number = c.Number, title = c.Title, type = c.Type, status = c.Status, archived = c.Archived }).ToListAsync(ct);
            return Ok(list.OrderBy(x => x.number));
        }

        // ─── Work log and watching ──────────────────────────────────────────────────

        [HttpPost("cards/{id:guid}/worklog")]
        public async Task<IActionResult> LogWork(Guid id, [FromBody] WorkLogDto d, CancellationToken ct)
        {
            var c = await CardAsync(id, ct);
            if (c == null) return NoCard();
            if (WorkIssues.Minutes(d.Time) is not int mins) return BadRequest(new { message = "Write the time like 2h 30m, 1d or 45m." });
            var day = DateOnly.TryParse(d.Day, out var x) ? x : Today;
            if (day > Today) return BadRequest(new { message = "Time can't be logged for a day still to come." });
            var w = new WorkLog { CardId = id, AgentId = User.AgentIdOf(), Minutes = mins, Day = day, Note = Clip(d.Note, 500) };
            _db.WorkLogs.Add(w);
            c.SpentMinutes += mins;
            c.UpdatedAt = DateTime.UtcNow;
            Note(id, $"logged {WorkIssues.Duration(mins)}{(day != Today ? $" on {day:d MMM}" : "")}");
            await _db.SaveChangesAsync(ct);
            return Ok(new { entry = new { id = w.Id, agentId = w.AgentId, minutes = w.Minutes, day = w.Day, note = w.Note, at = w.CreatedAt }, spentMinutes = c.SpentMinutes });
        }

        /// <summary>The person who logged it takes back a work log entry (the history keeps a line saying so).</summary>
        [HttpPost("worklog/{logId:guid}/remove")]
        public async Task<IActionResult> RemoveLog(Guid logId, CancellationToken ct)
        {
            var w = await _db.WorkLogs.FirstOrDefaultAsync(x => x.Id == logId, ct);
            if (w == null) return NotFound(new { message = "That entry isn't here any more." });
            if (w.AgentId != User.AgentIdOf() && !User.IsAdmin()) return StatusCode(403, new { message = "Only the person who logged the time (or an admin) can take it back." });
            var c = await CardAsync(w.CardId, ct);
            if (c != null) { c.SpentMinutes = Math.Max(0, c.SpentMinutes - w.Minutes); Note(c.Id, $"took back {WorkIssues.Duration(w.Minutes)} of logged time"); }
            _db.WorkLogs.Remove(w);
            await _db.SaveChangesAsync(ct);
            return Ok(new { spentMinutes = c?.SpentMinutes ?? 0 });
        }

        [HttpPost("cards/{id:guid}/watch")]
        public async Task<IActionResult> Watch(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var c = await CardAsync(id, ct);
            if (c == null) return NoCard();
            var list = Strings(c.WatchersJson);
            var me = User.AgentIdOf();
            if (undo) list.Remove(me); else if (!list.Contains(me)) list.Add(me);
            c.WatchersJson = JsonSerializer.Serialize(list.Take(50));
            await _db.SaveChangesAsync(ct);
            return Ok(new { watchers = list });
        }

        // ─── Sprints and the backlog ────────────────────────────────────────────────

        /// <summary>Every sprint (open ones first, then the last closed ones) with what is in each, for the backlog page.</summary>
        [HttpGet("sprints")]
        public async Task<IActionResult> Sprints(CancellationToken ct)
        {
            var open = await _db.WorkSprints.AsNoTracking().Where(s => s.Status != "closed").ToListAsync(ct);
            var closed = await _db.WorkSprints.AsNoTracking().Where(s => s.Status == "closed").OrderByDescending(s => s.ClosedAt).Take(12).ToListAsync(ct);
            return Ok(new
            {
                open = open.OrderBy(s => s.Status == "active" ? 0 : 1).ThenBy(s => s.StartDate).ThenBy(s => s.CreatedAt).Select(SprintView),
                closed = closed.Select(SprintView),
            });
        }

        private async Task<string?> SprintProblemAsync(WorkSprint s, WorkSprintDto d)
        {
            await Task.CompletedTask;
            if (d.Name != null) { var n = Clip(d.Name, 80); if (n == null) return "Give the sprint a name."; s.Name = n; }
            if (d.Goal != null) s.Goal = Clip(d.Goal, 500);
            if (d.StartDate != null) s.StartDate = d.StartDate == "" ? null : DateOnly.TryParse(d.StartDate, out var a) ? a : s.StartDate;
            if (d.EndDate != null) s.EndDate = d.EndDate == "" ? null : DateOnly.TryParse(d.EndDate, out var b) ? b : s.EndDate;
            if (s.StartDate != null && s.EndDate != null && s.EndDate < s.StartDate) return "The sprint ends before it starts.";
            return null;
        }

        [HttpPost("sprints")]
        public async Task<IActionResult> NewSprint([FromBody] WorkSprintDto d, CancellationToken ct)
        {
            var count = await _db.WorkSprints.CountAsync(ct);
            var s = new WorkSprint { Name = $"Sprint {count + 1}", CreatedBy = User.AgentIdOf() };
            // A new sprint starts the day after the last one ends, two weeks long, unless dates are given.
            var last = await _db.WorkSprints.AsNoTracking().Where(x => x.EndDate != null).OrderByDescending(x => x.EndDate).Select(x => x.EndDate).FirstOrDefaultAsync(ct);
            s.StartDate = last != null && last >= Today ? last.Value.AddDays(1) : Today;
            s.EndDate = s.StartDate.Value.AddDays(13);
            if (await SprintProblemAsync(s, d) is string p) return BadRequest(new { message = p });
            _db.WorkSprints.Add(s);
            await _db.SaveChangesAsync(ct);
            return Ok(SprintView(s));
        }

        [HttpPut("sprints/{id:guid}")]
        public async Task<IActionResult> EditSprint(Guid id, [FromBody] WorkSprintDto d, CancellationToken ct)
        {
            var s = await _db.WorkSprints.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That sprint isn't here any more." });
            if (s.Status == "closed") return BadRequest(new { message = "That sprint is finished." });
            if (await SprintProblemAsync(s, d) is string p) return BadRequest(new { message = p });
            await _db.SaveChangesAsync(ct);
            return Ok(SprintView(s));
        }

        /// <summary>Starts a sprint: only one runs at a time; what is in it now is what the team commits to.</summary>
        [HttpPost("sprints/{id:guid}/start")]
        public async Task<IActionResult> StartSprint(Guid id, CancellationToken ct)
        {
            var s = await _db.WorkSprints.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That sprint isn't here any more." });
            if (s.Status != "planned") return BadRequest(new { message = "That sprint has already started." });
            var running = await _db.WorkSprints.AsNoTracking().Where(x => x.Status == "active").Select(x => x.Name).FirstOrDefaultAsync(ct);
            if (running != null) return BadRequest(new { message = $"{running} is still running. Complete it first." });
            var inSprint = await _db.WorkCards.AsNoTracking().Where(c => c.SprintId == id && !c.Archived).Select(c => new { c.StoryPoints, c.AssigneesJson }).ToListAsync(ct);
            var issues = inSprint.Select(c => c.StoryPoints).ToList();
            if (issues.Count == 0) return BadRequest(new { message = "Put some issues in the sprint first: drag them in from the backlog." });
            s.Status = "active"; s.StartedAt = DateTime.UtcNow;
            s.StartDate ??= Today;
            if (s.StartDate > Today) s.StartDate = Today;
            s.EndDate ??= s.StartDate.Value.AddDays(13);
            s.CommittedPoints = issues.Sum(p => p ?? 0);
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"{s.Name} started", RefId = s.Id.ToString() });
            // Everyone with work in it hears it started, and how much of it is theirs.
            var who = await MyNameAsync(ct);
            foreach (var g in inSprint.SelectMany(c => Strings(c.AssigneesJson)).GroupBy(a => a))
                _notifier.Notify(new NotifyJob
                {
                    To = new() { g.Key }, Except = User.AgentIdOf(), Kind = "work", Link = "work-board", RefId = s.Id.ToString(),
                    Title = $"{who} started {s.Name}",
                    Body = $"{g.Count()} issue{(g.Count() == 1 ? "" : "s")} in it are yours{(s.EndDate is DateOnly end ? $" · ends {end:d MMM}" : "")}{(string.IsNullOrWhiteSpace(s.Goal) ? "" : $" · Goal: {s.Goal}")}",
                });
            return Ok(SprintView(s));
        }

        /// <summary>Completes a sprint: done issues stay in it; unfinished ones move to another sprint or back to the backlog.</summary>
        [HttpPost("sprints/{id:guid}/complete")]
        public async Task<IActionResult> CompleteSprint(Guid id, [FromBody] WorkSprintCloseDto d, CancellationToken ct)
        {
            var s = await _db.WorkSprints.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That sprint isn't here any more." });
            if (s.Status != "active") return BadRequest(new { message = "Only the running sprint can be completed." });
            if (d.MoveTo != null && (d.MoveTo == id || !await _db.WorkSprints.AnyAsync(x => x.Id == d.MoveTo && x.Status == "planned", ct)))
                return BadRequest(new { message = "Choose a sprint that hasn't started, or the backlog." });
            var issues = await _db.WorkCards.Where(c => c.SprintId == id && !c.Archived).ToListAsync(ct);
            var done = issues.Where(c => c.Status == "done").ToList();
            var left = issues.Where(c => c.Status != "done").ToList();
            foreach (var c in left) { c.SprintId = d.MoveTo; c.UpdatedAt = DateTime.UtcNow; Note(c.Id, d.MoveTo == null ? $"not finished in {s.Name}: back to the backlog" : $"not finished in {s.Name}: moved to the next sprint"); }
            s.Status = "closed"; s.ClosedAt = DateTime.UtcNow;
            s.CompletedIssues = done.Count; s.CompletedPoints = done.Sum(c => c.StoryPoints ?? 0);
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"{s.Name} completed", RefId = s.Id.ToString() });
            var closer = await MyNameAsync(ct);
            var people = issues.SelectMany(c => Strings(c.AssigneesJson)).Distinct().ToList();
            if (people.Count > 0)
                _notifier.Notify(new NotifyJob
                {
                    To = people, Except = User.AgentIdOf(), Kind = "work", Link = "work-board", RefId = s.Id.ToString(),
                    Title = $"{closer} completed {s.Name}",
                    Body = $"{done.Count} done{(left.Count > 0 ? $", {left.Count} moved {(d.MoveTo == null ? "back to the backlog" : "to the next sprint")}" : "")}",
                });
            return Ok(new { sprint = SprintView(s), done = done.Count, moved = left.Count });
        }

        /// <summary>
        /// Backlog drag and drop: puts issues in a sprint (or the backlog) and, when given, between two issues in that list.
        /// </summary>
        [HttpPost("plan")]
        public async Task<IActionResult> Plan([FromBody] WorkPlanDto d, CancellationToken ct)
        {
            var ids = (d.Ids ?? new()).Distinct().Take(200).ToList();
            if (ids.Count == 0) return BadRequest(new { message = "Choose the issues to move." });
            var sid = d.SprintId == Guid.Empty ? null : d.SprintId;
            WorkSprint? sprint = null;
            if (sid != null)
            {
                sprint = await _db.WorkSprints.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sid, ct);
                if (sprint == null || sprint.Status == "closed") return BadRequest(new { message = "That sprint isn't open any more." });
            }
            var cards = await _db.WorkCards.Where(c => ids.Contains(c.Id)).ToListAsync(ct);
            if (sid != null && cards.Any(c => c.Type == "epic")) return BadRequest(new { message = "Epics stay out of sprints: put their stories and tasks in the sprint instead." });
            var a = d.After == null ? null : await _db.WorkCards.AsNoTracking().Where(x => x.Id == d.After).Select(x => (double?)x.Rank).FirstOrDefaultAsync(ct);
            var b = d.Before == null ? null : await _db.WorkCards.AsNoTracking().Where(x => x.Id == d.Before).Select(x => (double?)x.Rank).FirstOrDefaultAsync(ct);
            double start, step;
            if (a != null && b != null) { step = (b.Value - a.Value) / (cards.Count + 1); start = a.Value + step; }
            else if (a != null) { start = a.Value + 1000; step = 1000; }
            else if (b != null) { step = 1000; start = b.Value - 1000 * cards.Count; }
            else { start = (await _db.WorkCards.MaxAsync(x => (double?)x.Rank, ct) ?? 0) + 1000; step = 1000; }
            var i = 0;
            foreach (var c in ids.Select(id => cards.FirstOrDefault(x => x.Id == id)).Where(x => x != null)!)
            {
                var moved = c!.SprintId != sid;
                if (moved) Note(c.Id, sprint == null ? "moved it to the backlog" : $"moved it to the sprint {sprint.Name}");
                c.SprintId = sid;
                if (d.After != null || d.Before != null || moved) c.Rank = start + step * i;
                i++;
                c.UpdatedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = "Backlog changed", RefId = sid?.ToString() });
            return Ok(new { moved = cards.Count });
        }

        /// <summary>The sprint's burndown (story points left each day against the ideal line), and its issues by status.</summary>
        [HttpGet("sprints/{id:guid}/report")]
        public async Task<IActionResult> SprintReport(Guid id, CancellationToken ct)
        {
            var s = await _db.WorkSprints.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That sprint isn't here any more." });
            var issues = await _db.WorkCards.AsNoTracking().Where(c => c.SprintId == id && !c.Archived)
                .Select(c => new { c.Status, c.StoryPoints, c.DoneAt, c.Type }).ToListAsync(ct);
            var start = s.StartDate ?? Today;
            var end = s.EndDate ?? start.AddDays(13);
            var today = s.Status == "closed" && s.ClosedAt != null ? DateOnly.FromDateTime(s.ClosedAt.Value.AddHours(5.5)) : Today;
            var burn = WorkIssues.Burndown(start, end, today, issues.Select(i => new WorkIssues.BurnIssue(i.StoryPoints ?? 0,
                i.Status == "done" && i.DoneAt != null ? DateOnly.FromDateTime(i.DoneAt.Value.AddHours(5.5)) : null)).ToList());
            var closed = await _db.WorkSprints.AsNoTracking().Where(x => x.Status == "closed").OrderByDescending(x => x.ClosedAt).Take(8)
                .Select(x => new { name = x.Name, committed = x.CommittedPoints ?? 0, completed = x.CompletedPoints ?? 0 }).ToListAsync(ct);
            return Ok(new
            {
                sprint = SprintView(s),
                burndown = burn.Select(b => new { day = b.Day, remaining = b.Remaining, ideal = b.Ideal }),
                byStatus = Statuses.Select(st => new { status = st, issues = issues.Count(i => i.Status == st), points = issues.Where(i => i.Status == st).Sum(i => i.StoryPoints ?? 0) }),
                byType = issues.GroupBy(i => i.Type).Select(g => new { type = g.Key, issues = g.Count() }),
                noPoints = issues.Count(i => i.StoryPoints == null && i.Type != "subtask"),
                velocity = closed.AsEnumerable().Reverse(),
            });
        }
    }
}
