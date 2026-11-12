using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WorkCheckItem { public string Id { get; set; } = ""; public string Text { get; set; } = ""; public bool Done { get; set; } }

    public class WorkCardDto
    {
        public string? Title { get; set; }
        public string? Description { get; set; }
        public string? Status { get; set; }
        public string? Priority { get; set; }
        /// <summary>yyyy-MM-dd, or "" to clear.</summary>
        public string? DueDate { get; set; }
        public List<string>? Assignees { get; set; }
        public List<string>? Labels { get; set; }
        /// <summary>"" to clear.</summary>
        public string? Project { get; set; }
        public List<WorkCheckItem>? Checklist { get; set; }
        public string? Link { get; set; }
        public string? Repeat { get; set; }
        /// <summary>Creating a sub-task: the card it belongs under.</summary>
        public Guid? ParentId { get; set; }
    }

    public class WorkMoveDto
    {
        public string? Status { get; set; }
        /// <summary>The cards it now sits between (either may be null at a column's end).</summary>
        public Guid? After { get; set; }
        public Guid? Before { get; set; }
    }

    public class WorkCommentDto { public string? Text { get; set; } }

    /// <summary>
    /// The team board: the office team plans, does and finishes its work here. Cards move Ideas → To do → Doing → Check → Done,
    /// carry people, a due date, labels, a checklist and comments, and can repeat (a daily job comes back by itself once done).
    /// Nothing is deleted: finished or unwanted cards are archived and can be brought back.
    /// </summary>
    [ApiController]
    [Route("api/v1/work")]
    [Authorize]
    [PageAccess(Pages.Work)]
    public class WorkBoardController : ControllerBase
    {
        public static readonly string[] Statuses = { "idea", "todo", "doing", "review", "done" };
        private static readonly string[] Priorities = { "urgent", "high", "normal", "low" };
        private static readonly string[] Repeats = { "none", "daily", "weekdays", "weekly", "monthly" };
        private static readonly Dictionary<string, string> StatusLabel = new() { ["idea"] = "Ideas", ["todo"] = "To do", ["doing"] = "Doing", ["review"] = "Check", ["done"] = "Done" };
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        private readonly IMarketingDbContext _db;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        public WorkBoardController(IMarketingDbContext db, INotifier notifier, ILiveEvents live) { _db = db; _notifier = notifier; _live = live; }

        private static List<string> Strings(string? j) { try { return JsonSerializer.Deserialize<List<string>>(j ?? "[]", Json) ?? new(); } catch (JsonException) { return new(); } }
        private static List<WorkCheckItem> Checks(string? j) { try { return JsonSerializer.Deserialize<List<WorkCheckItem>>(j ?? "[]", Json) ?? new(); } catch (JsonException) { return new(); } }
        private static DateOnly Today => DateOnly.FromDateTime(IstClock.NowIst);

        /// <summary>Sub-task counts per parent, and the number and title of each parent, for the cards being shown.</summary>
        private record Family(Dictionary<Guid, (int Total, int Done)> Subs, Dictionary<Guid, (int Number, string Title)> Parents);

        private async Task<Family> FamilyAsync(IEnumerable<WorkCard> cards, CancellationToken ct)
        {
            var list = cards.ToList();
            var ids = list.Select(c => c.Id).ToList();
            var subs = (await _db.WorkCards.AsNoTracking().Where(x => x.ParentId != null && ids.Contains(x.ParentId.Value) && !x.Archived)
                    .Select(x => new { x.ParentId, x.Status }).ToListAsync(ct))
                .GroupBy(x => x.ParentId!.Value).ToDictionary(g => g.Key, g => (g.Count(), g.Count(x => x.Status == "done")));
            var pids = list.Where(c => c.ParentId != null).Select(c => c.ParentId!.Value).Distinct().ToList();
            var parents = pids.Count == 0 ? new Dictionary<Guid, (int, string)>()
                : (await _db.WorkCards.AsNoTracking().Where(x => pids.Contains(x.Id)).Select(x => new { x.Id, x.Number, x.Title }).ToListAsync(ct))
                    .ToDictionary(x => x.Id, x => (x.Number, x.Title));
            return new Family(subs, parents);
        }

        private static object View(WorkCard c, Family? f = null)
        {
            var checks = Checks(c.ChecklistJson);
            var sub = f != null && f.Subs.TryGetValue(c.Id, out var s) ? s : (0, 0);
            var parent = c.ParentId != null && f != null && f.Parents.TryGetValue(c.ParentId.Value, out var pp) ? new { id = c.ParentId.Value, number = pp.Number, title = pp.Title } : null;
            return new
            {
                id = c.Id, number = c.Number, title = c.Title, description = c.Description, status = c.Status, order = c.Order, priority = c.Priority,
                dueDate = c.DueDate, assignees = Strings(c.AssigneesJson), labels = Strings(c.LabelsJson), project = c.Project,
                checklist = checks, checkDone = checks.Count(x => x.Done), checkTotal = checks.Count, link = c.Link, repeat = c.Repeat,
                comments = c.CommentCount, archived = c.Archived, createdBy = c.CreatedBy, createdAt = c.CreatedAt, updatedAt = c.UpdatedAt,
                startedAt = c.StartedAt, doneAt = c.DoneAt, doneBy = c.DoneBy,
                overdue = c.DueDate != null && c.Status != "done" && c.DueDate < Today,
                parentId = c.ParentId, parent, subTotal = sub.Item1, subDone = sub.Item2,
            };
        }

        /// <summary>Everything the board page shows: cards (done ones from the last 30 days unless asked for more), people, labels, projects and the numbers on top.</summary>
        [HttpGet]
        public async Task<IActionResult> Board([FromQuery] bool archived, CancellationToken ct)
        {
            var since = DateTime.UtcNow.AddDays(-30);
            var q = _db.WorkCards.AsNoTracking().Where(c => c.Archived == archived);
            if (!archived) q = q.Where(c => c.Status != "done" || c.DoneAt > since);
            var cards = await q.OrderBy(c => c.Order).Take(2000).ToListAsync(ct);
            var family = await FamilyAsync(cards, ct);
            var people = await _db.Agents.AsNoTracking().Where(a => a.IsActive && a.Role != "field_rep").OrderBy(a => a.Name)
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, photo = a.PhotoUrl }).ToListAsync(ct);
            // Field agents can be given office cards too, but they are listed after the office team.
            var agents = await _db.Agents.AsNoTracking().Where(a => a.IsActive && a.Role == "field_rep").OrderBy(a => a.Name)
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, photo = a.PhotoUrl }).ToListAsync(ct);
            var all = await _db.WorkCards.AsNoTracking().Where(c => !c.Archived).Select(c => new { c.LabelsJson, c.Project, c.Status, c.DueDate, c.DoneAt, c.AssigneesJson }).ToListAsync(ct);
            var weekStart = IstClock.TodayStartUtc.AddDays(-(((int)IstClock.NowIst.DayOfWeek + 6) % 7));
            var today = Today;
            var open = all.Where(c => c.Status != "done").ToList();
            return Ok(new
            {
                me = User.AgentIdOf(),
                isAdmin = User.IsInRole("Admin") || User.IsInRole("admin"),
                columns = Statuses.Select(s => new { key = s, label = StatusLabel[s] }),
                cards = cards.Select(c => View(c, family)),
                people = people.Concat(agents),
                labels = all.SelectMany(c => Strings(c.LabelsJson)).GroupBy(x => x, StringComparer.OrdinalIgnoreCase).OrderByDescending(g => g.Count()).Select(g => g.First()).Take(40),
                projects = all.Where(c => !string.IsNullOrWhiteSpace(c.Project)).GroupBy(c => c.Project!)
                    .Select(g => new { name = g.Key, open = g.Count(x => x.Status != "done"), done = g.Count(x => x.Status == "done") }).OrderByDescending(x => x.open),
                stats = new
                {
                    open = open.Count,
                    doing = open.Count(c => c.Status == "doing"),
                    overdue = open.Count(c => c.DueDate != null && c.DueDate < today),
                    dueToday = open.Count(c => c.DueDate == today),
                    doneThisWeek = all.Count(c => c.Status == "done" && c.DoneAt >= weekStart),
                    load = open.SelectMany(c => Strings(c.AssigneesJson).Select(a => (a, c))).GroupBy(x => x.a)
                        .Select(g => new { agentId = g.Key, open = g.Count(), overdue = g.Count(x => x.c.DueDate != null && x.c.DueDate < today), doing = g.Count(x => x.c.Status == "doing") }),
                },
            });
        }

        private string? Apply(WorkCard c, WorkCardDto d, List<string> changes, out List<string> newlyAssigned)
        {
            newlyAssigned = new();
            static string? Clip(string? s, int n) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length > n ? s.Trim()[..n] : s.Trim();
            if (d.Title != null)
            {
                var t = Clip(d.Title, 200);
                if (t == null) return "Write what needs doing.";
                if (t != c.Title && c.Title != "") changes.Add($"renamed it to \"{t}\"");
                c.Title = t;
            }
            if (d.Description != null) c.Description = Clip(d.Description, 8000);
            if (d.Priority != null && Priorities.Contains(d.Priority) && d.Priority != c.Priority) { if (c.Title != "") changes.Add($"set priority to {d.Priority}"); c.Priority = d.Priority; }
            if (d.DueDate != null)
            {
                DateOnly? due = d.DueDate == "" ? null : DateOnly.TryParse(d.DueDate, out var x) ? x : c.DueDate;
                if (due != c.DueDate && c.Title != "") changes.Add(due == null ? "removed the due date" : $"set due date {due:d MMM}");
                c.DueDate = due;
            }
            if (d.Assignees != null)
            {
                var before = Strings(c.AssigneesJson);
                var after = d.Assignees.Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).Distinct().Take(12).ToList();
                newlyAssigned = after.Except(before).ToList();
                if (!before.SequenceEqual(after) && c.Title != "") changes.Add("changed who is on it");
                c.AssigneesJson = JsonSerializer.Serialize(after);
            }
            if (d.Labels != null)
                c.LabelsJson = JsonSerializer.Serialize(d.Labels.Select(l => (l ?? "").Trim().TrimStart('#').ToLowerInvariant()).Where(l => l.Length > 0 && l.Length <= 30).Distinct().Take(10));
            if (d.Project != null) c.Project = Clip(d.Project, 80);
            if (d.Checklist != null)
                c.ChecklistJson = JsonSerializer.Serialize(d.Checklist.Where(x => !string.IsNullOrWhiteSpace(x.Text)).Take(60)
                    .Select(x => new WorkCheckItem { Id = string.IsNullOrWhiteSpace(x.Id) ? Guid.NewGuid().ToString("N")[..8] : x.Id[..Math.Min(20, x.Id.Length)], Text = x.Text.Trim()[..Math.Min(300, x.Text.Trim().Length)], Done = x.Done }), Json);
            if (d.Link != null)
            {
                var l = Clip(d.Link, 500);
                if (l != null && !(l.StartsWith("https://") || l.StartsWith("http://") || l.StartsWith("/admin/"))) l = "https://" + l;
                c.Link = l;
            }
            if (d.Repeat != null && Repeats.Contains(d.Repeat)) c.Repeat = d.Repeat;
            return null;
        }

        private void Note(Guid card, string text, string kind = "activity") =>
            _db.WorkNotes.Add(new WorkNote { CardId = card, Kind = kind, AgentId = User.AgentIdOf(), Text = text });

        private void Tell(WorkCard c, IEnumerable<string> to, string title)
        {
            var list = to.Where(a => a != User.AgentIdOf()).Distinct().ToList();
            if (list.Count == 0) return;
            _notifier.Notify(new NotifyJob { To = list, Kind = "work", Title = title, Body = $"#{c.Number} {c.Title}", Link = $"work:{c.Id}", RefId = c.Id.ToString() });
        }

        private async Task<double> EndOrderAsync(string status, CancellationToken ct) =>
            (await _db.WorkCards.Where(x => x.Status == status && !x.Archived).MaxAsync(x => (double?)x.Order, ct) ?? 0) + 1000;

        [HttpPost("cards")]
        public async Task<IActionResult> Create([FromBody] WorkCardDto d, CancellationToken ct)
        {
            var c = new WorkCard { CreatedBy = User.AgentIdOf(), Status = Statuses.Contains(d.Status) ? d.Status! : "todo" };
            if (string.IsNullOrWhiteSpace(d.Title)) return BadRequest(new { message = "Write what needs doing." });
            var err = Apply(c, d, new(), out var assigned);
            if (err != null) return BadRequest(new { message = err });
            WorkCard? parent = null;
            if (d.ParentId != null)
            {
                parent = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == d.ParentId, ct);
                if (parent == null || parent.Archived) return BadRequest(new { message = "That card isn't on the board any more." });
                if (parent.ParentId != null) return BadRequest(new { message = "Sub-tasks can't have their own sub-tasks. Add it to the main card instead." });
                c.ParentId = parent.Id;
                c.Project ??= parent.Project;
                if (d.Labels == null) c.LabelsJson = parent.LabelsJson;
            }
            c.Number = (await _db.WorkCards.MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1;
            c.Order = await EndOrderAsync(c.Status, ct);
            if (c.Status == "doing") c.StartedAt = DateTime.UtcNow;
            if (c.Status == "done") { c.DoneAt = DateTime.UtcNow; c.DoneBy = c.CreatedBy; }
            _db.WorkCards.Add(c);
            Note(c.Id, parent == null ? "created the card" : $"created it as a sub-task of #{parent.Number}");
            if (parent != null) { Note(parent.Id, $"added sub-task #{c.Number} {c.Title}"); parent.UpdatedAt = DateTime.UtcNow; }
            await _db.SaveChangesAsync(ct);
            Tell(c, assigned, "New work for you");
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"New card: {c.Title}", RefId = c.Id.ToString() });
            return Ok(View(c, await FamilyAsync(new[] { c }, ct)));
        }

        [HttpGet("cards/{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var c = await _db.WorkCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here any more." });
            var notes = await _db.WorkNotes.AsNoTracking().Where(n => n.CardId == id).OrderBy(n => n.CreatedAt).Take(500)
                .Select(n => new { id = n.Id, kind = n.Kind, agentId = n.AgentId, text = n.Text, at = n.CreatedAt }).ToListAsync(ct);
            var subs = await _db.WorkCards.AsNoTracking().Where(x => x.ParentId == id && !x.Archived).ToListAsync(ct);
            var family = await FamilyAsync(subs.Append(c), ct);
            var docs = await _db.WorkDocs.AsNoTracking().Where(x => x.CardId == id && !x.Archived && x.DeletedAt == null).OrderByDescending(x => x.UpdatedAt)
                .Select(x => new { id = x.Id, title = x.Title, kind = x.Kind, updatedAt = x.UpdatedAt, updatedBy = x.UpdatedBy }).ToListAsync(ct);
            return Ok(new
            {
                card = View(c, family),
                notes,
                subtasks = subs.OrderBy(x => x.Status == "done").ThenBy(x => x.CreatedAt).Select(x => View(x, family)),
                docs,
            });
        }

        [HttpPut("cards/{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] WorkCardDto d, CancellationToken ct)
        {
            var c = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here any more." });
            var changes = new List<string>();
            var err = Apply(c, d, changes, out var assigned);
            if (err != null) return BadRequest(new { message = err });
            if (d.Status != null && Statuses.Contains(d.Status) && d.Status != c.Status) await MoveAsync(c, d.Status, null, null, changes, ct);
            c.UpdatedAt = DateTime.UtcNow;
            foreach (var ch in changes) Note(c.Id, ch);
            await _db.SaveChangesAsync(ct);
            Tell(c, assigned, "You were added to a card");
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"Card changed: {c.Title}", RefId = c.Id.ToString() });
            return Ok(View(c, await FamilyAsync(new[] { c }, ct)));
        }

        /// <summary>Drag and drop: the new column and the cards it now sits between.</summary>
        [HttpPost("cards/{id:guid}/move")]
        public async Task<IActionResult> Move(Guid id, [FromBody] WorkMoveDto d, CancellationToken ct)
        {
            var c = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here any more." });
            var status = Statuses.Contains(d.Status) ? d.Status! : c.Status;
            var changes = new List<string>();
            var next = await MoveAsync(c, status, d.After, d.Before, changes, ct);
            c.UpdatedAt = DateTime.UtcNow;
            foreach (var ch in changes) Note(c.Id, ch);
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"Card moved: {c.Title}", RefId = c.Id.ToString() });
            var fam = await FamilyAsync(next == null ? new[] { c } : new[] { c, next }, ct);
            return Ok(new { card = View(c, fam), repeated = next == null ? null : View(next, fam) });
        }

        /// <summary>Puts the card in a column (between two cards, or at the end); finishing a repeating card makes the next one.</summary>
        private async Task<WorkCard?> MoveAsync(WorkCard c, string status, Guid? after, Guid? before, List<string> changes, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var a = after == null ? null : await _db.WorkCards.AsNoTracking().Where(x => x.Id == after).Select(x => (double?)x.Order).FirstOrDefaultAsync(ct);
            var b = before == null ? null : await _db.WorkCards.AsNoTracking().Where(x => x.Id == before).Select(x => (double?)x.Order).FirstOrDefaultAsync(ct);
            c.Order = a != null && b != null ? (a.Value + b.Value) / 2 : a != null ? a.Value + 1000 : b != null ? b.Value - 1000 : await EndOrderAsync(status, ct);
            WorkCard? next = null;
            if (status != c.Status)
            {
                changes.Add($"moved it to {StatusLabel[status]}");
                if (status == "doing") c.StartedAt ??= DateTime.UtcNow;
                if (status == "done")
                {
                    c.DoneAt = DateTime.UtcNow; c.DoneBy = me;
                    if (c.ParentId != null) Note(c.ParentId.Value, $"finished sub-task #{c.Number} {c.Title}");
                    Tell(c, Strings(c.AssigneesJson).Append(c.CreatedBy), "Card done");
                    if (c.Repeat != "none") next = await RepeatAsync(c, ct);
                }
                else { c.DoneAt = null; c.DoneBy = null; }
                c.Status = status;
            }
            return next;
        }

        private async Task<WorkCard> RepeatAsync(WorkCard c, CancellationToken ct)
        {
            var from = c.DueDate is DateOnly d && d >= Today ? d : Today;
            DateOnly due = c.Repeat switch
            {
                "daily" => from.AddDays(1),
                "weekdays" => from.DayOfWeek == DayOfWeek.Friday ? from.AddDays(3) : from.DayOfWeek == DayOfWeek.Saturday ? from.AddDays(2) : from.AddDays(1),
                "weekly" => from.AddDays(7),
                _ => from.AddMonths(1),
            };
            var next = new WorkCard
            {
                Number = (await _db.WorkCards.MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1,
                Title = c.Title, Description = c.Description, Status = "todo", Priority = c.Priority, DueDate = due, AssigneesJson = c.AssigneesJson,
                LabelsJson = c.LabelsJson, Project = c.Project, Link = c.Link, Repeat = c.Repeat, RepeatOf = c.RepeatOf ?? c.Id, CreatedBy = c.CreatedBy,
                ChecklistJson = JsonSerializer.Serialize(Checks(c.ChecklistJson).Select(x => new WorkCheckItem { Id = x.Id, Text = x.Text, Done = false }), Json),
                Order = await EndOrderAsync("todo", ct),
            };
            _db.WorkCards.Add(next);
            _db.WorkNotes.Add(new WorkNote { CardId = next.Id, Kind = "activity", AgentId = "system", Text = $"made again from #{c.Number} (repeats {c.Repeat})" });
            // Its sub-tasks come back too, not done yet.
            var subs = await _db.WorkCards.AsNoTracking().Where(x => x.ParentId == c.Id && !x.Archived).OrderBy(x => x.CreatedAt).ToListAsync(ct);
            var n = next.Number;
            foreach (var s in subs)
            {
                _db.WorkCards.Add(new WorkCard
                {
                    Number = ++n, Title = s.Title, Description = s.Description, Status = "todo", Priority = s.Priority, AssigneesJson = s.AssigneesJson,
                    LabelsJson = s.LabelsJson, Project = s.Project, ParentId = next.Id, CreatedBy = s.CreatedBy, Order = next.Order + n,
                    ChecklistJson = JsonSerializer.Serialize(Checks(s.ChecklistJson).Select(x => new WorkCheckItem { Id = x.Id, Text = x.Text, Done = false }), Json),
                });
            }
            return next;
        }

        [HttpPost("cards/{id:guid}/archive")]
        public async Task<IActionResult> Archive(Guid id, [FromQuery] bool undo, CancellationToken ct)
        {
            var c = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here any more." });
            c.Archived = !undo;
            if (undo) c.Order = await EndOrderAsync(c.Status, ct);
            c.UpdatedAt = DateTime.UtcNow;
            Note(c.Id, undo ? "brought it back from the archive" : "archived it");
            // A card's sub-tasks go to the archive with it, and come back with it.
            var subs = await _db.WorkCards.Where(x => x.ParentId == c.Id && x.Archived == undo).ToListAsync(ct);
            foreach (var s in subs) { s.Archived = !undo; s.UpdatedAt = DateTime.UtcNow; }
            if (undo && c.ParentId != null && await _db.WorkCards.AnyAsync(x => x.Id == c.ParentId && x.Archived, ct))
                c.ParentId = null; // its parent is still archived: it comes back as a card of its own
            await _db.SaveChangesAsync(ct);
            return Ok(View(c, await FamilyAsync(new[] { c }, ct)));
        }

        /// <summary>Archives every card that has been in Done for more than a week (they stay searchable in the archive).</summary>
        [HttpPost("archive-done")]
        public async Task<IActionResult> ArchiveDone(CancellationToken ct)
        {
            var before = DateTime.UtcNow.AddDays(-7);
            var cards = await _db.WorkCards.Where(c => !c.Archived && c.Status == "done" && c.DoneAt < before).ToListAsync(ct);
            foreach (var c in cards) { c.Archived = true; c.UpdatedAt = DateTime.UtcNow; }
            await _db.SaveChangesAsync(ct);
            return Ok(new { archived = cards.Count });
        }

        [HttpPost("cards/{id:guid}/comments")]
        public async Task<IActionResult> Comment(Guid id, [FromBody] WorkCommentDto d, CancellationToken ct)
        {
            var text = (d.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Write the comment first." });
            if (text.Length > 4000) text = text[..4000];
            var c = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here any more." });
            var n = new WorkNote { CardId = id, Kind = "comment", AgentId = User.AgentIdOf(), Text = text };
            _db.WorkNotes.Add(n);
            c.CommentCount++;
            c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            Tell(c, Strings(c.AssigneesJson).Append(c.CreatedBy), "New comment on a card");
            return Ok(new { id = n.Id, kind = n.Kind, agentId = n.AgentId, text = n.Text, at = n.CreatedAt });
        }
    }
}
