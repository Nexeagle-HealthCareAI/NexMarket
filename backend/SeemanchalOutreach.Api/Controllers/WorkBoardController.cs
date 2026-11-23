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
        /// <summary>The issue it belongs under (an epic, feature, story…); Guid.Empty to take it out.</summary>
        public Guid? ParentId { get; set; }
        /// <summary>epic | feature | story | task | bug | subtask</summary>
        public string? Type { get; set; }
        /// <summary>yyyy-MM-dd, or "" to clear.</summary>
        public string? StartDate { get; set; }
        /// <summary>Story points; -1 to clear.</summary>
        public int? StoryPoints { get; set; }
        /// <summary>Original estimate: "2h 30m", "1d"…; "" to clear.</summary>
        public string? Estimate { get; set; }
        /// <summary>The sprint; Guid.Empty = the backlog.</summary>
        public Guid? SprintId { get; set; }
        public string? Reporter { get; set; }
        /// <summary>Bugs: blocker | critical | major | minor | trivial; "" to clear.</summary>
        public string? Severity { get; set; }
        public string? Environment { get; set; }
        public string? Steps { get; set; }
        public string? Expected { get; set; }
        public string? Actual { get; set; }
        public string? Acceptance { get; set; }
        /// <summary>done | wont_do | duplicate | cannot_reproduce (only for a done issue).</summary>
        public string? Resolution { get; set; }
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
    public partial class WorkBoardController : ControllerBase
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
        private record Family(Dictionary<Guid, (int Total, int Done)> Subs, Dictionary<Guid, (int Number, string Title, string Type)> Parents);

        private async Task<Family> FamilyAsync(IEnumerable<WorkCard> cards, CancellationToken ct)
        {
            var list = cards.ToList();
            var ids = list.Select(c => c.Id).ToList();
            var subs = (await _db.WorkCards.AsNoTracking().Where(x => x.ParentId != null && ids.Contains(x.ParentId.Value) && !x.Archived)
                    .Select(x => new { x.ParentId, x.Status }).ToListAsync(ct))
                .GroupBy(x => x.ParentId!.Value).ToDictionary(g => g.Key, g => (g.Count(), g.Count(x => x.Status == "done")));
            var pids = list.Where(c => c.ParentId != null).Select(c => c.ParentId!.Value).Distinct().ToList();
            var parents = pids.Count == 0 ? new Dictionary<Guid, (int, string, string)>()
                : (await _db.WorkCards.AsNoTracking().Where(x => pids.Contains(x.Id)).Select(x => new { x.Id, x.Number, x.Title, x.Type }).ToListAsync(ct))
                    .ToDictionary(x => x.Id, x => (x.Number, x.Title, x.Type));
            return new Family(subs, parents);
        }

        private static object View(WorkCard c, Family? f = null)
        {
            var checks = Checks(c.ChecklistJson);
            var sub = f != null && f.Subs.TryGetValue(c.Id, out var s) ? s : (0, 0);
            var parent = c.ParentId != null && f != null && f.Parents.TryGetValue(c.ParentId.Value, out var pp) ? new { id = c.ParentId.Value, number = pp.Number, title = pp.Title, type = pp.Type } : null;
            return new
            {
                id = c.Id, number = c.Number, title = c.Title, description = c.Description, status = c.Status, order = c.Order, priority = c.Priority,
                dueDate = c.DueDate, assignees = Strings(c.AssigneesJson), labels = Strings(c.LabelsJson), project = c.Project,
                checklist = checks, checkDone = checks.Count(x => x.Done), checkTotal = checks.Count, link = c.Link, repeat = c.Repeat,
                comments = c.CommentCount, archived = c.Archived, createdBy = c.CreatedBy, createdAt = c.CreatedAt, updatedAt = c.UpdatedAt,
                startedAt = c.StartedAt, doneAt = c.DoneAt, doneBy = c.DoneBy,
                overdue = c.DueDate != null && c.Status != "done" && c.DueDate < Today,
                parentId = c.ParentId, parent, subTotal = sub.Item1, subDone = sub.Item2,
                type = c.Type, startDate = c.StartDate, storyPoints = c.StoryPoints, estimateMinutes = c.EstimateMinutes, spentMinutes = c.SpentMinutes,
                sprintId = c.SprintId, rank = c.Rank, reporter = c.Reporter ?? c.CreatedBy, severity = c.Severity, resolution = c.Resolution,
                environment = c.Environment, steps = c.Steps, expected = c.Expected, actual = c.Actual, acceptance = c.Acceptance,
                watchers = Strings(c.WatchersJson),
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
            var all = await _db.WorkCards.AsNoTracking().Where(c => !c.Archived).Select(c => new { c.Id, c.ParentId, c.Type, c.StoryPoints, c.LabelsJson, c.Project, c.Status, c.DueDate, c.DoneAt, c.AssigneesJson }).ToListAsync(ct);
            var sprints = await _db.WorkSprints.AsNoTracking().Where(s => s.Status != "closed").OrderBy(s => s.Status == "active" ? 0 : 1).ThenBy(s => s.StartDate).ThenBy(s => s.CreatedAt).ToListAsync(ct);
            // Progress of epics and features: everything under them, all the way down.
            var kidsOf = all.Where(x => x.ParentId != null).ToLookup(x => x.ParentId!.Value);
            var rollup = all.Where(x => x.Type == "epic" || x.Type == "feature").ToDictionary(x => x.Id, x =>
            {
                var under = new List<(string Status, int? Points)>();
                var frontier = new List<Guid> { x.Id };
                for (var depth = 0; depth < 4 && frontier.Count > 0; depth++)
                {
                    var next = frontier.SelectMany(f => kidsOf[f]).ToList();
                    under.AddRange(next.Select(n => (n.Status, n.StoryPoints)));
                    frontier = next.Select(n => n.Id).ToList();
                }
                return new { total = under.Count, done = under.Count(u => u.Status == "done"), points = under.Sum(u => u.Points ?? 0), pointsDone = under.Where(u => u.Status == "done").Sum(u => u.Points ?? 0) };
            });
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
                sprints = sprints.Select(SprintView),
                rollup,
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
            if (d.StartDate != null)
            {
                DateOnly? start = d.StartDate == "" ? null : DateOnly.TryParse(d.StartDate, out var x) ? x : c.StartDate;
                if (start != c.StartDate && c.Title != "") changes.Add(start == null ? "removed the start date" : $"set start date {start:d MMM}");
                c.StartDate = start;
            }
            if (c.StartDate != null && c.DueDate != null && c.DueDate < c.StartDate) return "The due date is before the start date.";
            if (d.StoryPoints != null)
            {
                int? pts = d.StoryPoints < 0 ? null : Math.Min(d.StoryPoints.Value, 1000);
                if (pts != c.StoryPoints && c.Title != "") changes.Add(pts == null ? "removed the story points" : $"set story points to {pts}");
                c.StoryPoints = pts;
            }
            if (d.Estimate != null)
            {
                if (d.Estimate.Trim() == "") c.EstimateMinutes = null;
                else if (WorkIssues.Minutes(d.Estimate) is int mins) { if (mins != c.EstimateMinutes && c.Title != "") changes.Add($"set the estimate to {WorkIssues.Duration(mins)}"); c.EstimateMinutes = mins; }
                else return "Write the estimate like 2h 30m, 1d or 45m.";
            }
            if (d.Reporter != null) c.Reporter = Clip(d.Reporter, 60);
            if (d.Severity != null)
            {
                if (d.Severity == "") c.Severity = null;
                else if (WorkIssues.Severities.Contains(d.Severity)) { if (d.Severity != c.Severity && c.Title != "") changes.Add($"set severity to {d.Severity}"); c.Severity = d.Severity; }
            }
            if (d.Environment != null) c.Environment = Clip(d.Environment, 1000);
            if (d.Steps != null) c.Steps = Clip(d.Steps, 8000);
            if (d.Expected != null) c.Expected = Clip(d.Expected, 4000);
            if (d.Actual != null) c.Actual = Clip(d.Actual, 4000);
            if (d.Acceptance != null) c.Acceptance = Clip(d.Acceptance, 8000);
            if (d.Resolution != null && WorkIssues.Resolutions.Contains(d.Resolution) && c.Status == "done" && d.Resolution != c.Resolution)
            {
                if (c.Title != "") changes.Add($"set the resolution to {d.Resolution.Replace('_', ' ')}");
                c.Resolution = d.Resolution;
            }
            return null;
        }

        /// <summary>Type, parent and sprint: these need the database, so they are checked here.</summary>
        private async Task<string?> PlaceAsync(WorkCard c, WorkCardDto d, List<string> changes, bool isNew, CancellationToken ct)
        {
            var type = d.Type != null ? d.Type : c.Type;
            if (!WorkIssues.Types.Contains(type)) return "Choose a type: epic, feature, story, task, bug or sub-task.";
            var parentId = d.ParentId == null ? c.ParentId : d.ParentId == Guid.Empty ? null : d.ParentId;
            WorkCard? parent = null;
            if (parentId != null)
            {
                if (parentId == c.Id) return "An issue can't go under itself.";
                parent = await _db.WorkCards.FirstOrDefaultAsync(x => x.Id == parentId, ct);
                if (parent == null || parent.Archived) return "That issue isn't on the board any more.";
            }
            var childTypes = isNew ? new List<string>() : await _db.WorkCards.AsNoTracking().Where(x => x.ParentId == c.Id && !x.Archived).Select(x => x.Type).ToListAsync(ct);
            if (WorkIssues.TypeProblem(type, parent?.Type, childTypes) is string problem) return problem;
            if (!isNew && type != c.Type) changes.Add($"changed the type to {WorkIssues.Label(type)}");
            if (!isNew && parentId != c.ParentId) changes.Add(parent == null ? "took it out of its parent" : $"put it under #{parent.Number} {parent.Title}");
            c.Type = type;
            c.ParentId = parentId;
            if (d.SprintId != null)
            {
                var sid = d.SprintId == Guid.Empty ? (Guid?)null : d.SprintId;
                if (sid != null)
                {
                    var sp = await _db.WorkSprints.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sid, ct);
                    if (sp == null || sp.Status == "closed") return "That sprint isn't open any more.";
                    if (c.Type == "epic") return "Epics stay out of sprints: put their stories and tasks in the sprint instead.";
                    if (sid != c.SprintId && !isNew) changes.Add($"moved it to the sprint {sp.Name}");
                }
                else if (c.SprintId != null && !isNew) changes.Add("moved it to the backlog");
                c.SprintId = sid;
            }
            return null;
        }

        private void Note(Guid card, string text, string kind = "activity") =>
            _db.WorkNotes.Add(new WorkNote { CardId = card, Kind = kind, AgentId = User.AgentIdOf(), Text = text });

        /// <summary>Everyone who follows an issue: the people on it, whoever made or reported it, and its watchers.</summary>
        private static IEnumerable<string> Followers(WorkCard c) =>
            Strings(c.AssigneesJson).Append(c.CreatedBy).Append(c.Reporter ?? c.CreatedBy).Concat(Strings(c.WatchersJson));

        /// <summary>
        /// Tells people about a change on an issue (never the person who made it). Kinds: work (changes on my work),
        /// work_mention (someone @mentioned me), work_due (reminders); each can be turned off in notification settings.
        /// </summary>
        private void Tell(WorkCard c, IEnumerable<string> to, string title, string? body = null, string kind = "work")
        {
            var me = User.AgentIdOf();
            var list = to.Where(a => !string.IsNullOrEmpty(a) && a != me).Distinct().ToList();
            if (list.Count == 0) return;
            _notifier.Notify(new NotifyJob
            {
                To = list, Kind = kind, Except = me, Title = title,
                Body = body == null ? $"#{c.Number} {c.Title}" : $"{body} · #{c.Number} {c.Title}", Link = $"work:{c.Id}", RefId = c.Id.ToString(),
            });
        }

        private string? _myName;
        /// <summary>The name of whoever is making the change, for "Imran moved #43 to Check".</summary>
        private async Task<string> MyNameAsync(CancellationToken ct)
        {
            if (_myName != null) return _myName;
            var me = User.AgentIdOf();
            var n = await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct);
            return _myName = string.IsNullOrWhiteSpace(n) ? "Someone" : n.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
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
            WorkCard? parent = d.ParentId is Guid pid && pid != Guid.Empty ? await _db.WorkCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == pid, ct) : null;
            // Under a story, task or bug it is a sub-task unless said otherwise; under a feature a story; otherwise a task.
            d.Type ??= parent == null ? "task" : WorkIssues.Level(parent.Type) == 2 ? "subtask" : parent.Type == "feature" ? "story" : "task";
            if (await PlaceAsync(c, d, new(), true, ct) is string placeErr) return BadRequest(new { message = placeErr });
            if (parent != null)
            {
                c.Project ??= parent.Project;
                if (d.Labels == null) c.LabelsJson = parent.LabelsJson;
                if (d.SprintId == null && c.Type == "subtask") c.SprintId = parent.SprintId;   // a sub-task goes in its parent's sprint
            }
            c.Reporter ??= c.CreatedBy;
            c.Number = (await _db.WorkCards.MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1;
            c.Order = await EndOrderAsync(c.Status, ct);
            c.Rank = (await _db.WorkCards.MaxAsync(x => (double?)x.Rank, ct) ?? 0) + 1000;
            if (c.Status == "doing") c.StartedAt = DateTime.UtcNow;
            if (c.Status == "done") { c.DoneAt = DateTime.UtcNow; c.DoneBy = c.CreatedBy; }
            _db.WorkCards.Add(c);
            Note(c.Id, parent == null ? $"created the {WorkIssues.Label(c.Type)}" : $"created it as a {WorkIssues.Label(c.Type)} under #{parent.Number}");
            if (parent != null) Note(parent.Id, $"added {WorkIssues.Label(c.Type)} #{c.Number} {c.Title}");
            await _db.SaveChangesAsync(ct);
            Tell(c, assigned, $"{await MyNameAsync(ct)} gave you {WorkIssues.Label(c.Type)} #{c.Number}", c.DueDate is DateOnly due ? $"Due {due:d MMM}" : null);
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
            // Only the documents this person may open (a private plan linked to the card stays private).
            var docs = await LinkedDocsAsync(id, ct);
            return Ok(new
            {
                card = View(c, family),
                notes,
                subtasks = subs.OrderBy(x => x.Status == "done").ThenBy(x => x.Rank).ThenBy(x => x.CreatedAt).Select(x => View(x, family)),
                docs,
                path = await PathAsync(c, ct),
                links = await LinksAsync(id, ct),
                worklog = await _db.WorkLogs.AsNoTracking().Where(w => w.CardId == id).OrderByDescending(w => w.Day).ThenByDescending(w => w.CreatedAt).Take(200)
                    .Select(w => new { id = w.Id, agentId = w.AgentId, minutes = w.Minutes, day = w.Day, note = w.Note, at = w.CreatedAt }).ToListAsync(ct),
                sprint = c.SprintId == null ? null : await _db.WorkSprints.AsNoTracking().Where(x => x.Id == c.SprintId).Select(x => new { id = x.Id, name = x.Name, status = x.Status }).FirstOrDefaultAsync(ct),
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
            if ((d.Type != null || d.ParentId != null || d.SprintId != null) && await PlaceAsync(c, d, changes, false, ct) is string placeErr) return BadRequest(new { message = placeErr });
            if (d.Status != null && Statuses.Contains(d.Status) && d.Status != c.Status) await MoveAsync(c, d.Status, null, null, changes, ct);
            c.UpdatedAt = DateTime.UtcNow;
            foreach (var ch in changes) Note(c.Id, ch);
            await _db.SaveChangesAsync(ct);
            var who = await MyNameAsync(ct);
            Tell(c, assigned, $"{who} added you to #{c.Number}");
            // Everyone else following it hears what changed (a move to another column is told by MoveAsync).
            var told = changes.Where(x => x != "changed who is on it" && !x.StartsWith("moved it to ", StringComparison.Ordinal) || x.StartsWith("moved it to the sprint", StringComparison.Ordinal) || x == "moved it to the backlog").ToList();
            if (told.Count > 0) Tell(c, Followers(c).Except(assigned), $"{who} updated #{c.Number}", WorkIssues.Clip(string.Join("; ", told), 160));
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
                if (status != "done") Tell(c, Followers(c), $"{await MyNameAsync(ct)} moved #{c.Number} to {StatusLabel[status]}");
                if (status == "doing") c.StartedAt ??= DateTime.UtcNow;
                if (status == "done")
                {
                    c.DoneAt = DateTime.UtcNow; c.DoneBy = me;
                    if (c.ParentId != null) Note(c.ParentId.Value, $"finished sub-task #{c.Number} {c.Title}");
                    c.Resolution ??= "done";
                    Tell(c, Followers(c), $"{await MyNameAsync(ct)} finished #{c.Number}");
                    if (c.Repeat != "none") next = await RepeatAsync(c, ct);
                }
                else { c.DoneAt = null; c.DoneBy = null; c.Resolution = null; }
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
                Type = c.Type, ParentId = c.ParentId, StoryPoints = c.StoryPoints, EstimateMinutes = c.EstimateMinutes, Reporter = c.Reporter, WatchersJson = c.WatchersJson,
                Acceptance = c.Acceptance, Rank = c.Rank + 1,
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
                    Type = s.Type, StoryPoints = s.StoryPoints, EstimateMinutes = s.EstimateMinutes, Reporter = s.Reporter, Rank = next.Rank + n,
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
            // Everything under it (an epic's stories and their sub-tasks…) goes to the archive with it, and comes back with it.
            var level = new List<Guid> { c.Id };
            for (var depth = 0; depth < 4 && level.Count > 0; depth++)
            {
                var kids = await _db.WorkCards.Where(x => x.ParentId != null && level.Contains(x.ParentId.Value) && x.Archived == undo).ToListAsync(ct);
                foreach (var s in kids) { s.Archived = !undo; s.UpdatedAt = DateTime.UtcNow; }
                level = kids.Select(x => x.Id).ToList();
            }
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
            var who = await MyNameAsync(ct);
            var people = (await _db.Agents.AsNoTracking().Where(a => a.Name != "").Select(a => new { a.AgentId, a.Name }).ToListAsync(ct)).Select(a => (a.AgentId, a.Name));
            var mentioned = WorkIssues.MentionedIn(text, people);
            Tell(c, mentioned, $"{who} mentioned you on #{c.Number}", $"“{WorkIssues.Clip(text)}”", "work_mention");
            Tell(c, Followers(c).Except(mentioned), $"{who} commented on #{c.Number}", $"“{WorkIssues.Clip(text)}”");
            return Ok(new { id = n.Id, kind = n.Kind, agentId = n.AgentId, text = n.Text, at = n.CreatedAt });
        }
    }
}
