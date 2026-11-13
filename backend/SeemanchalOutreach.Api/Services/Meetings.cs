using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>The rules of meetings, kept apart from the web requests so they can be tested on their own.</summary>
    public static class MeetingRules
    {
        public const int MinMinutes = 10, MaxMinutes = 240;
        public const int JoinEarlyMinutes = 15;          // the room opens this long before the start
        public const int RemindMinutes = 10;
        public const int MissedAfterMinutes = 60;        // nobody came this long after the planned end: marked missed
        public const double MaxAudioSeconds = 4 * 3600;  // AI notes listen to at most four hours of one meeting
        public const long MaxClipBytes = 8 * 1024 * 1024;
        public const int MaxTranscript = 400_000;
        public const int MaxNotesTries = 3;

        public static string? Problem(string? title, DateTime startsAtUtc, int minutes, DateTime nowUtc)
        {
            var t = (title ?? "").Trim();
            if (t.Length < 3) return "Give the meeting a name of at least 3 letters.";
            if (t.Length > 120) return "Keep the meeting's name under 120 letters.";
            if (minutes < MinMinutes || minutes > MaxMinutes) return $"A meeting can be {MinMinutes} minutes to {MaxMinutes / 60} hours long.";
            if (startsAtUtc < nowUtc.AddMinutes(-5)) return "That time has already passed.";
            if (startsAtUtc > nowUtc.AddDays(180)) return "Pick a time within the next 6 months.";
            return null;
        }

        /// <summary>The room can be entered from a little before the start until the meeting is over.</summary>
        public static bool CanJoin(Meeting m, DateTime nowUtc) =>
            m.Status == "live" || (m.Status == "scheduled" && nowUtc >= m.StartsAt.AddMinutes(-JoinEarlyMinutes) && nowUtc <= m.StartsAt.AddMinutes(m.Minutes + MissedAfterMinutes));

        public static bool NeedsReminder(Meeting m, DateTime nowUtc) =>
            m.Status == "scheduled" && m.RemindedAt == null && nowUtc >= m.StartsAt.AddMinutes(-RemindMinutes) && nowUtc < m.StartsAt.AddMinutes(m.Minutes);

        public static bool IsMissed(Meeting m, DateTime nowUtc) =>
            m.Status == "scheduled" && nowUtc > m.StartsAt.AddMinutes(m.Minutes + MissedAfterMinutes);

        /// <summary>The call ended: the meeting is done, and its notes are written next if anything was heard.</summary>
        public static void Close(Meeting m, DateTime endedAtUtc)
        {
            m.Status = "done";
            m.EndedAt = endedAtUtc;
            m.AiNotes = false;
            if (!string.IsNullOrWhiteSpace(m.Transcript)) { m.NotesStatus = "writing"; m.NotesError = null; }
            else if (m.NotesStatus == "listening") m.NotesStatus = "none";
        }

        /// <summary>Adds one stretch of speech to the transcript, marked with how far into the listening it started.</summary>
        public static string Append(string? transcript, double atSeconds, string text)
        {
            text = (text ?? "").Trim();
            if (text.Length == 0) return transcript ?? "";
            var at = TimeSpan.FromSeconds(Math.Max(0, atSeconds));
            var line = $"[{(int)at.TotalMinutes:00}:{at.Seconds:00}] {text}";
            var all = string.IsNullOrEmpty(transcript) ? line : transcript + "\n" + line;
            return all.Length > MaxTranscript ? all[..MaxTranscript] : all;
        }

        /// <summary>"Fri 13 Nov, 4:30 pm" in India time, for chat lines and alerts.</summary>
        public static string When(DateTime utc)
        {
            var ist = utc.AddHours(5.5);
            var hour = ist.Hour % 12 == 0 ? 12 : ist.Hour % 12;
            return $"{ist:ddd d MMM}, {hour}:{ist.Minute:00} {(ist.Hour < 12 ? "am" : "pm")}";
        }

        /// <summary>Whose task an action is: the person in the meeting whose name the AI's "who" matches, if exactly one does.</summary>
        public static string? Owner(string? who, IReadOnlyList<(string UserId, string Name)> people)
        {
            var w = (who ?? "").Trim();
            if (w.Length < 2) return null;
            var hits = people.Where(p => p.Name.Contains(w, StringComparison.OrdinalIgnoreCase) || w.Contains(p.Name, StringComparison.OrdinalIgnoreCase)
                || p.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(part => part.Length > 2 && string.Equals(part, w, StringComparison.OrdinalIgnoreCase))).Select(p => p.UserId).Distinct().ToList();
            return hits.Count == 1 ? hits[0] : null;
        }

        // ─── The minutes as a Team board document (the editor's JSON) ────────

        private static JsonObject Text(string s) => new() { ["type"] = "text", ["text"] = s };
        private static JsonObject Para(string s) => new() { ["type"] = "paragraph", ["content"] = new JsonArray(Text(s)) };
        private static JsonObject Head(string s) => new() { ["type"] = "heading", ["attrs"] = new JsonObject { ["level"] = 2 }, ["content"] = new JsonArray(Text(s)) };
        private static JsonObject Bullets(IEnumerable<string> items) => new()
        {
            ["type"] = "bulletList",
            ["content"] = new JsonArray(items.Select(i => (JsonNode)new JsonObject { ["type"] = "listItem", ["content"] = new JsonArray(Para(i)) }).ToArray()),
        };

        public static string ActionLine(ChatAiService.ActionItem a) =>
            a.What + (a.Who != null ? $" ({a.Who})" : "") + (a.Due != null ? $", by {a.Due}" : "");

        public static (string Json, string Plain) Document(Meeting m, ChatAiService.Minutes min, IReadOnlyList<string> people)
        {
            var mins = m.EndedAt != null && m.StartedAt != null ? Math.Max(1, (int)Math.Ceiling((m.EndedAt.Value - m.StartedAt.Value).TotalMinutes)) : m.Minutes;
            var content = new JsonArray();
            var plain = new StringBuilder();
            void Add(JsonObject node, string text) { content.Add(node); plain.AppendLine(text); }
            var facts = $"{When(m.StartedAt ?? m.StartsAt)} · {mins} min" + (people.Count > 0 ? $" · {string.Join(", ", people)}" : "");
            Add(Para(facts), facts);
            if (!string.IsNullOrWhiteSpace(m.Agenda)) { Add(Head("Agenda"), "Agenda"); Add(Para(m.Agenda!.Trim()), m.Agenda!.Trim()); }
            if (min.Summary.Length > 0) { Add(Head("Summary"), "Summary"); Add(Para(min.Summary), min.Summary); }
            void List(string title, List<string> items)
            {
                if (items.Count == 0) return;
                Add(Head(title), title);
                content.Add(Bullets(items));
                foreach (var i in items) plain.AppendLine("- " + i);
            }
            List("Discussed", min.Points);
            List("Decisions", min.Decisions);
            List("Actions", min.Actions.Select(ActionLine).ToList());
            const string foot = "Written by AI from what was said in the meeting. Check it before relying on it: words can be misheard.";
            Add(Para(foot), foot);
            return (new JsonObject { ["type"] = "doc", ["content"] = content }.ToJsonString(), plain.ToString().Trim());
        }

        /// <summary>The short version posted in the chat when the notes are ready.</summary>
        public static string ChatSummary(Meeting m, ChatAiService.Minutes min)
        {
            var sb = new StringBuilder($"📝 Notes from “{m.Title}”\n");
            if (min.Summary.Length > 0) sb.Append(min.Summary).Append('\n');
            if (min.Decisions.Count > 0) { sb.Append("\nDecided:\n"); foreach (var d in min.Decisions.Take(5)) sb.Append("• ").Append(d).Append('\n'); }
            if (min.Actions.Count > 0) { sb.Append("\nTo do:\n"); foreach (var a in min.Actions.Take(8)) sb.Append("• ").Append(ActionLine(a)).Append('\n'); }
            sb.Append("\nFull notes are on the Team board under Plans & docs. Written by AI: please check.");
            var s = sb.ToString();
            return s.Length > 3500 ? s[..3500] : s;
        }
    }

    public class MeetingDto
    {
        public Guid ThreadId { get; set; }
        public string? Title { get; set; }
        public string? Agenda { get; set; }
        public DateTime StartsAt { get; set; }
        public int Minutes { get; set; } = 30;
        public bool Video { get; set; }
    }
    public class MeetingNotesDto { public bool On { get; set; } }

    /// <summary>
    /// Meetings planned from a chat. The office plans one for a chat; everyone who can use that chat is told, reminded and
    /// can join; it runs as a group call. AI notes are off unless someone in the office turns them on for that meeting:
    /// then the office person's browser sends what is said, a minute at a time, to be turned into text. The sound is
    /// passed straight to the speech service and never saved.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/meetings")]
    public class MeetingsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IPermissionService _perms;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        private readonly LiveKitSettings _lk;
        private readonly SpeechService _speech;

        public MeetingsController(IMarketingDbContext db, IPermissionService perms, INotifier notifier, ILiveEvents live, IOptions<LiveKitSettings> lk, SpeechService speech)
        {
            _db = db; _perms = perms; _notifier = notifier; _live = live; _lk = lk.Value; _speech = speech;
        }

        private string Me => User.AgentIdOf();
        private string MyName => User.FindFirst(ClaimTypes.Name)?.Value ?? Me;

        private async Task<bool> IsOfficeAsync()
        {
            if (!User.IsDashboardUser()) return false;
            if (User.IsAdmin() || RoleChecks.CanonicalDashboardRole(User.RoleOf()) == RoleChecks.MarketingManager) return true;
            return await _perms.GetLevelAsync(User, Pages.Field) >= Pages.View;
        }

        /// <summary>The chat, if this person may use it (the same rules as the chat and its calls).</summary>
        private async Task<(ChatThread? Thread, bool Office)> ThreadAsync(Guid id, CancellationToken ct)
        {
            var t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null || t.Kind == "merged") return (null, false);
            var office = await IsOfficeAsync();
            if (t.Kind == "direct") return t.AgentId == Me || t.PeerId == Me ? (t, office) : (null, false);
            if (office || t.Kind == "team" || t.AgentId == Me) return (t, office);
            return (null, false);
        }

        private object Shape(Meeting m, bool office) => new
        {
            id = m.Id, threadId = m.ThreadId, title = m.Title, agenda = m.Agenda, startsAt = m.StartsAt, minutes = m.Minutes, video = m.Video,
            status = m.Status, callId = m.CallId, aiNotes = m.AiNotes, notesStatus = m.NotesStatus,
            notesError = office ? m.NotesError : null, summary = m.Summary, docId = office ? m.DocId : null,
            createdBy = m.CreatedBy, createdByName = m.CreatedByName, startedAt = m.StartedAt, endedAt = m.EndedAt,
            canJoin = _lk.Configured && MeetingRules.CanJoin(m, DateTime.UtcNow),
            heardMinutes = (int)Math.Round(m.AudioSeconds / 60),
            // What this person may do, so the screens need no rules of their own.
            office,
            iTakeNotes = m.AiNotes && m.NotesBy == Me,
        };

        /// <summary>Everyone the chat reaches, except the person who caused the alert.</summary>
        internal static async Task<NotifyJob> ToChatAsync(IMarketingDbContext db, ChatThread t, NotifyJob job, CancellationToken ct)
        {
            if (t.Kind == "direct") { if (t.AgentId != null) job.To.Add(t.AgentId); if (t.PeerId != null) job.To.Add(t.PeerId); }
            else if (t.Kind == "agent") { if (t.AgentId != null) job.To.Add(t.AgentId); job.ToOffice = true; }
            else { job.To.AddRange(await db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => a.AgentId).ToListAsync(ct)); job.ToOffice = true; }
            return job;
        }

        /// <summary>Writes a line into the chat (once: the same key is never written twice).</summary>
        internal static async Task SayAsync(IMarketingDbContext db, ChatThread t, string key, string senderId, string senderName, bool fromOffice, string text, CancellationToken ct)
        {
            if (await db.ChatMessages.AnyAsync(x => x.ClientId == key, ct)) return;
            var msg = new ChatMessage { ClientId = key, ThreadId = t.Id, SenderId = senderId, SenderName = senderName, FromOffice = fromOffice, Text = text };
            db.ChatMessages.Add(msg);
            t.LastMessageAt = msg.CreatedAt;
            t.LastPreview = text.Length > 120 ? text[..120] : text;
        }

        [HttpGet("status")]
        public IActionResult Status() => Ok(new { on = _lk.Configured, aiNotes = _speech.Configured });

        /// <summary>A chat's meetings: what is on now or coming, then the latest that are over.</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] Guid threadId, CancellationToken ct)
        {
            var (t, office) = await ThreadAsync(threadId, ct);
            if (t == null) return NotFound();
            var rows = await _db.Meetings.AsNoTracking().Where(m => m.ThreadId == threadId && m.Status != "cancelled").OrderByDescending(m => m.StartsAt).Take(40).ToListAsync(ct);
            return Ok(rows.OrderBy(m => m.Status is "done" or "missed" ? 1 : 0).ThenBy(m => m.Status is "done" or "missed" ? -m.StartsAt.Ticks : m.StartsAt.Ticks).Select(m => Shape(m, office)));
        }

        /// <summary>My meetings that are on now or in the next two weeks, across every chat I can use.</summary>
        [HttpGet("upcoming")]
        public async Task<IActionResult> Upcoming(CancellationToken ct)
        {
            var until = DateTime.UtcNow.AddDays(14);
            var rows = await _db.Meetings.AsNoTracking().Where(m => (m.Status == "scheduled" || m.Status == "live") && m.StartsAt < until).OrderBy(m => m.StartsAt).Take(60).ToListAsync(ct);
            var result = new List<object>();
            foreach (var m in rows)
            {
                var (t, office) = await ThreadAsync(m.ThreadId, ct);
                if (t != null && !MeetingRules.IsMissed(m, DateTime.UtcNow)) result.Add(Shape(m, office));
            }
            return Ok(result);
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var m = await _db.Meetings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            return Ok(new { meeting = Shape(m, office), transcript = office ? m.Transcript : null });
        }

        /// <summary>The meeting a call belongs to, so the call screen can show its name and whether AI notes are on.</summary>
        [HttpGet("call/{callId:guid}")]
        public async Task<IActionResult> ForCall(Guid callId, CancellationToken ct)
        {
            var m = await _db.Meetings.AsNoTracking().FirstOrDefaultAsync(x => x.CallId == callId, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            return Ok(Shape(m, office));
        }

        /// <summary>Plans a meeting for a chat (office only), says so in the chat and tells everyone in it.</summary>
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] MeetingDto dto, CancellationToken ct)
        {
            var (t, office) = await ThreadAsync(dto.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can plan a meeting." });
            var starts = DateTime.SpecifyKind(dto.StartsAt.ToUniversalTime(), DateTimeKind.Utc);
            if (MeetingRules.Problem(dto.Title, starts, dto.Minutes, DateTime.UtcNow) is { } problem) return BadRequest(new { message = problem });

            var m = new Meeting
            {
                ThreadId = t.Id, Title = dto.Title!.Trim(), Agenda = string.IsNullOrWhiteSpace(dto.Agenda) ? null : dto.Agenda.Trim()[..Math.Min(dto.Agenda.Trim().Length, 2000)],
                StartsAt = starts, Minutes = dto.Minutes, Video = dto.Video, CreatedBy = Me, CreatedByName = MyName,
            };
            _db.Meetings.Add(m);
            await SayAsync(_db, t, $"meeting:{m.Id}:new", Me, MyName, true, $"📅 Meeting planned: “{m.Title}” · {MeetingRules.When(m.StartsAt)} · {m.Minutes} min", ct);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(await ToChatAsync(_db, t, new NotifyJob { Kind = "meeting", Title = $"Meeting: {m.Title}", Body = $"{MeetingRules.When(m.StartsAt)} · planned by {MyName}", Link = $"chat:{t.Id}", RefId = m.Id.ToString(), Except = Me }, ct));
            await _live.PublishChatAsync(t.Id);
            return Ok(Shape(m, true));
        }

        /// <summary>Changes a meeting that hasn't started (office only). A new time is said in the chat.</summary>
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] MeetingDto dto, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can change a meeting." });
            if (m.Status != "scheduled") return Conflict(new { message = "This meeting has already started or finished." });
            var starts = DateTime.SpecifyKind(dto.StartsAt.ToUniversalTime(), DateTimeKind.Utc);
            if (MeetingRules.Problem(dto.Title, starts, dto.Minutes, DateTime.UtcNow) is { } problem) return BadRequest(new { message = problem });
            var moved = m.StartsAt != starts;
            m.Title = dto.Title!.Trim();
            m.Agenda = string.IsNullOrWhiteSpace(dto.Agenda) ? null : dto.Agenda.Trim()[..Math.Min(dto.Agenda.Trim().Length, 2000)];
            m.StartsAt = starts; m.Minutes = dto.Minutes; m.Video = dto.Video;
            if (moved)
            {
                m.RemindedAt = null;
                await SayAsync(_db, t, $"meeting:{m.Id}:moved:{starts.Ticks}", Me, MyName, true, $"📅 Meeting “{m.Title}” moved to {MeetingRules.When(m.StartsAt)}", ct);
            }
            await _db.SaveChangesAsync(ct);
            if (moved) _notifier.Notify(await ToChatAsync(_db, t, new NotifyJob { Kind = "meeting", Title = $"Meeting moved: {m.Title}", Body = MeetingRules.When(m.StartsAt), Link = $"chat:{t.Id}", RefId = m.Id.ToString(), Except = Me }, ct));
            await _live.PublishChatAsync(t.Id);
            return Ok(Shape(m, true));
        }

        [HttpPost("{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can cancel a meeting." });
            if (m.Status != "scheduled") return Conflict(new { message = "This meeting has already started or finished." });
            m.Status = "cancelled";
            await SayAsync(_db, t, $"meeting:{m.Id}:cancelled", Me, MyName, true, $"📅 Meeting “{m.Title}” ({MeetingRules.When(m.StartsAt)}) was cancelled", ct);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(await ToChatAsync(_db, t, new NotifyJob { Kind = "meeting", Title = $"Meeting cancelled: {m.Title}", Body = MeetingRules.When(m.StartsAt), Link = $"chat:{t.Id}", RefId = m.Id.ToString(), Except = Me }, ct));
            await _live.PublishChatAsync(t.Id);
            return Ok(new { ok = true });
        }

        /// <summary>
        /// Opens the meeting's room if nobody has yet, and says which call to join. The first person in starts it; everyone
        /// else in the chat is told it has begun. Joining the call itself is the same as any other call.
        /// </summary>
        [HttpPost("{id:guid}/join")]
        public async Task<IActionResult> Join(Guid id, CancellationToken ct)
        {
            if (!_lk.Configured) return StatusCode(503, new { message = "Calling isn't switched on yet. Ask your manager." });
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (m.Status is "done" or "cancelled") return Conflict(new { message = "This meeting is over." });
            if (!MeetingRules.CanJoin(m, DateTime.UtcNow) && !(office && m.Status is "scheduled" or "missed"))
                return Conflict(new { message = $"The meeting opens {MeetingRules.JoinEarlyMinutes} minutes before it starts." });

            var call = m.CallId != null ? await _db.CallSessions.FirstOrDefaultAsync(c => c.Id == m.CallId && c.Status == "active", ct) : null;
            if (call == null)
            {
                call = new CallSession { ThreadId = t.Id, Kind = "meeting", Video = m.Video, StartedBy = Me, StartedByName = MyName, Status = "active" };
                call.AnsweredAt = call.StartedAt;
                _db.CallSessions.Add(call);
                m.CallId = call.Id; m.Status = "live"; m.StartedAt ??= DateTime.UtcNow; m.RemindedAt ??= DateTime.UtcNow;
                try { await _db.SaveChangesAsync(ct); }
                catch (DbUpdateException) { return Conflict(new { message = "Please try again." }); }
                _notifier.Notify(await ToChatAsync(_db, t, new NotifyJob { Kind = "meeting", Title = $"Meeting started: {m.Title}", Body = $"{MyName} is in. Tap to join.", Link = $"call:{call.Id}", RefId = call.Id.ToString(), Except = Me }, ct));
                await _live.PublishChatAsync(t.Id);
            }
            return Ok(new { meeting = Shape(m, office), callId = call.Id, video = m.Video });
        }

        /// <summary>
        /// Turns AI notes on or off for a meeting that is going on (office only). Everyone in the call sees it within
        /// seconds, and it is written in the chat, so nobody is listened to without knowing.
        /// </summary>
        [HttpPost("{id:guid}/ai-notes")]
        public async Task<IActionResult> AiNotes(Guid id, [FromBody] MeetingNotesDto dto, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can turn AI notes on." });
            if (m.Status != "live") return Conflict(new { message = "AI notes can be turned on once the meeting has started." });
            if (dto.On && !_speech.Configured) return StatusCode(503, new { message = "AI notes aren't switched on yet. Add the Groq API key on the server (Groq__ApiKey)." });
            if (m.AiNotes == dto.On) return Ok(Shape(m, true));
            m.AiNotes = dto.On;
            if (dto.On) { m.NotesBy = Me; m.NotesStatus = "listening"; m.NotesError = null; }
            await SayAsync(_db, t, $"meeting:{m.Id}:notes:{(dto.On ? "on" : "off")}:{DateTime.UtcNow.Ticks}", Me, MyName, true,
                dto.On ? $"🎙 {MyName} turned AI notes on for “{m.Title}”. What is said is being turned into text for the minutes; the sound is not kept."
                       : $"🎙 {MyName} turned AI notes off for “{m.Title}”.", ct);
            await _db.SaveChangesAsync(ct);
            await _live.PublishChatAsync(t.Id);
            return Ok(Shape(m, true));
        }

        /// <summary>
        /// A stretch of the meeting's sound from the office person who is taking AI notes. It is turned into text and added
        /// to the transcript; the sound is passed on as it arrives and never saved.
        /// </summary>
        [HttpPost("{id:guid}/audio")]
        [RequestSizeLimit(MeetingRules.MaxClipBytes + 64 * 1024)]
        public async Task<IActionResult> Audio(Guid id, [FromForm] IFormFile file, [FromForm] double at, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can take AI notes." });
            // The last clip often arrives just after the meeting ends: still take it while the notes aren't written.
            var open = (m.Status == "live" && m.AiNotes) || (m.Status == "done" && m.NotesStatus is "writing" or "listening" && m.EndedAt > DateTime.UtcNow.AddMinutes(-3));
            if (!open) return Conflict(new { message = "AI notes are off for this meeting." });
            if (file == null || file.Length == 0) return BadRequest(new { message = "No sound was sent." });
            if (file.Length > MeetingRules.MaxClipBytes) return StatusCode(413, new { message = "That piece of sound is too big." });
            if (m.AudioSeconds >= MeetingRules.MaxAudioSeconds) return StatusCode(429, new { message = "AI notes have listened to four hours of this meeting, which is the most they take." });

            string text; double seconds;
            try
            {
                await using var stream = file.OpenReadStream();
                var tail = m.Transcript is { Length: > 0 } tr ? tr[Math.Max(0, tr.Length - 200)..] : "";
                (text, seconds, _) = await _speech.TranscribeAsync(stream, string.IsNullOrWhiteSpace(file.FileName) ? "meeting.webm" : file.FileName,
                    file.ContentType, $"meeting:{m.Id}", null, $"{m.Title}. {m.Agenda} {tail}".Trim(), ct);
            }
            catch (AnalystUnavailableException ex) { return StatusCode(502, new { message = ex.Message }); }

            // Read again: another clip may have been added while this one was being turned into text.
            // Only the fields set here are saved, so a meeting that ended meanwhile keeps its new status.
            var fresh = await _db.Meetings.AsNoTracking().Where(x => x.Id == id).Select(x => new { x.Transcript, x.AudioSeconds, x.Status, x.NotesStatus }).FirstAsync(ct);
            m.Transcript = MeetingRules.Append(fresh.Transcript, at, text);
            m.AudioSeconds = fresh.AudioSeconds + Math.Max(seconds, 1);
            if (fresh.Status == "done" && fresh.NotesStatus is "none" or "listening" && !string.IsNullOrWhiteSpace(m.Transcript)) m.NotesStatus = "writing";
            await _db.SaveChangesAsync(ct);
            return Ok(new { heardMinutes = (int)Math.Round(m.AudioSeconds / 60), words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length });
        }

        /// <summary>Ends the meeting for everyone (office only).</summary>
        [HttpPost("{id:guid}/finish")]
        public async Task<IActionResult> Finish(Guid id, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can end a meeting for everyone." });
            if (m.Status != "live") return Ok(Shape(m, true));
            var call = m.CallId != null ? await _db.CallSessions.FirstOrDefaultAsync(c => c.Id == m.CallId, ct) : null;
            if (call != null && call.Status == "active") await CallSweeper.FinishAsync(_db, _notifier, _live, call, "ended", ct);
            else { MeetingRules.Close(m, DateTime.UtcNow); await _db.SaveChangesAsync(ct); await _live.PublishChatAsync(t.Id); }
            return Ok(Shape(m, true));
        }

        /// <summary>Writes the notes again from the transcript (office only), after a failure.</summary>
        [HttpPost("{id:guid}/notes/retry")]
        public async Task<IActionResult> Retry(Guid id, CancellationToken ct)
        {
            var m = await _db.Meetings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            var (t, office) = await ThreadAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            if (!office) return StatusCode(403, new { message = "Only the office can do this." });
            if (m.Status != "done" || string.IsNullOrWhiteSpace(m.Transcript)) return Conflict(new { message = "There is nothing to write notes from." });
            if (m.NotesStatus == "ready") return Ok(Shape(m, true));
            m.NotesStatus = "writing"; m.NotesError = null; m.NotesTries = 0; m.NotesBy = Me;
            await _db.SaveChangesAsync(ct);
            await _live.PublishChatAsync(t.Id);
            return Ok(Shape(m, true));
        }
    }

    /// <summary>
    /// Looks after meetings in the background, for every organisation: reminds people ten minutes before, marks a meeting
    /// nobody came to as missed, and writes the notes of a meeting that was listened to.
    /// </summary>
    public class MeetingWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<MeetingWorker> _logger;
        private readonly OrgDirectory _orgs;
        public MeetingWorker(IServiceScopeFactory scopes, ILogger<MeetingWorker> logger, OrgDirectory orgs) { _scopes = scopes; _logger = logger; _orgs = orgs; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _orgs.ForEachAsync(async _ =>
                    {
                        using var scope = _scopes.CreateScope();
                        var sp = scope.ServiceProvider;
                        await TickAsync(sp.GetRequiredService<IMarketingDbContext>(), sp.GetRequiredService<INotifier>(), sp.GetRequiredService<ILiveEvents>(),
                            sp.GetRequiredService<ChatAiService>(), stoppingToken);
                    });
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex) { _logger.LogError(ex, "The meeting worker failed this round."); }
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }

        public async Task TickAsync(IMarketingDbContext db, INotifier notifier, ILiveEvents live, ChatAiService ai, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var soon = now.AddMinutes(MeetingRules.RemindMinutes);
            var planned = await db.Meetings.Where(m => m.Status == "scheduled" && m.StartsAt <= soon).Take(100).ToListAsync(ct);
            foreach (var m in planned)
            {
                var t = await db.ChatThreads.FirstOrDefaultAsync(x => x.Id == m.ThreadId, ct);
                if (MeetingRules.IsMissed(m, now)) { m.Status = "missed"; continue; }
                if (t == null || !MeetingRules.NeedsReminder(m, now)) continue;
                m.RemindedAt = now;
                var mins = Math.Max(0, (int)Math.Ceiling((m.StartsAt - now).TotalMinutes));
                notifier.Notify(await MeetingsController.ToChatAsync(db, t, new NotifyJob
                {
                    Kind = "meeting", Title = mins > 0 ? $"Meeting in {mins} min: {m.Title}" : $"Meeting now: {m.Title}", Body = "Open the chat to join.", Link = $"chat:{t.Id}", RefId = m.Id.ToString(),
                }, ct));
            }
            if (planned.Count > 0) await db.SaveChangesAsync(ct);

            // Notes: one meeting at a time, a little after it ended so the last piece of sound has arrived.
            var settle = now.AddSeconds(-45);
            var due = await db.Meetings.Where(m => m.Status == "done" && m.NotesStatus == "writing" && m.EndedAt < settle).OrderBy(m => m.EndedAt).FirstOrDefaultAsync(ct);
            if (due != null) await WriteNotesAsync(db, notifier, live, ai, due, ct);
        }

        private async Task WriteNotesAsync(IMarketingDbContext db, INotifier notifier, ILiveEvents live, ChatAiService ai, Meeting m, CancellationToken ct)
        {
            var t = await db.ChatThreads.FirstOrDefaultAsync(x => x.Id == m.ThreadId, ct);
            var joined = m.CallId == null ? new List<CallParticipant>()
                : await db.CallParticipants.AsNoTracking().Where(p => p.CallId == m.CallId && p.JoinedAt != null).ToListAsync(ct);
            var people = joined.Select(p => (p.UserId, Name: p.UserName)).Distinct().ToList();
            var by = m.NotesBy ?? m.CreatedBy;
            m.NotesTries++;
            try
            {
                var min = await ai.MinutesAsync(by, m.Title, m.Agenda, m.Transcript ?? "", people.Select(p => p.Name).ToList(), ct);
                var (json, plain) = MeetingRules.Document(m, min, people.Select(p => p.Name).ToList());
                var doc = new WorkDoc
                {
                    Title = $"Meeting notes: {m.Title} ({MeetingRules.When(m.StartedAt ?? m.StartsAt)})", Kind = "notes", ContentJson = json, PlainText = plain,
                    Project = "Meetings", CreatedBy = by, UpdatedBy = by,
                };
                db.WorkDocs.Add(doc);

                // Each action becomes a Team board card, given to its owner when the name matches one person in the meeting.
                var number = await db.WorkCards.MaxAsync(x => (int?)x.Number, ct) ?? 0;
                var order = (await db.WorkCards.Where(x => x.Status == "todo" && !x.Archived).MaxAsync(x => (double?)x.Order, ct) ?? 0) + 1000;
                foreach (var a in min.Actions)
                {
                    var owner = MeetingRules.Owner(a.Who, people);
                    db.WorkCards.Add(new WorkCard
                    {
                        Number = ++number, Order = order, Status = "todo", Project = "Meetings", LabelsJson = "[\"meeting\"]", CreatedBy = by,
                        Title = a.What.Length > 160 ? a.What[..160] : a.What,
                        Description = $"From the meeting “{m.Title}” on {MeetingRules.When(m.StartedAt ?? m.StartsAt)}." + (a.Who != null ? $" Owner said in the meeting: {a.Who}." : "") + (a.Due != null ? $" By: {a.Due}." : "") + " Written by AI: check it.",
                        AssigneesJson = owner != null ? JsonSerializer.Serialize(new[] { owner }) : "[]",
                    });
                    order += 1000;
                }

                m.Summary = min.Summary; m.DocId = doc.Id; m.NotesStatus = "ready"; m.NotesError = null;
                if (t != null)
                {
                    var office = await db.Agents.AsNoTracking().Where(a => a.AgentId == by).Select(a => a.Role).FirstOrDefaultAsync(ct) is { } role && RoleChecks.IsDashboardRole(role);
                    await MeetingsController.SayAsync(db, t, $"meeting:{m.Id}:notes", by, m.CreatedByName, office, MeetingRules.ChatSummary(m, min), ct);
                }
                await db.SaveChangesAsync(ct);
                if (t != null)
                {
                    notifier.Notify(await MeetingsController.ToChatAsync(db, t, new NotifyJob { Kind = "meeting", Title = $"Meeting notes ready: {m.Title}", Body = min.Summary.Length > 140 ? min.Summary[..140] : min.Summary, Link = $"chat:{t.Id}", RefId = m.Id.ToString() }, ct));
                    await live.PublishChatAsync(t.Id);
                }
            }
            catch (Exception ex) when (ex is ChatAiException or AnalystUnavailableException or System.Net.Http.HttpRequestException or JsonException or InvalidOperationException)
            {
                // Try again next round, three times in all; the transcript stays, so the office can also ask again later.
                m.NotesError = ex is ChatAiException or AnalystUnavailableException ? ex.Message : "The notes couldn't be written just now.";
                if (m.NotesTries >= MeetingRules.MaxNotesTries) m.NotesStatus = "failed";
                _logger.LogWarning("Meeting notes failed (try {Try}): {Type}", m.NotesTries, ex.GetType().Name);
                await db.SaveChangesAsync(ct);
                if (t != null && m.NotesStatus == "failed") await live.PublishChatAsync(t.Id);
            }
        }
    }
}
