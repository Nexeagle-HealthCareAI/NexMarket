using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ChatAiSwitchesDto
    {
        public bool Translate { get; set; }
        public bool Replies { get; set; }
        public bool Summary { get; set; }
        public bool Tasks { get; set; }
    }

    public class ChatAiTranslateDto
    {
        public List<Guid> Ids { get; set; } = new();
        public string? Lang { get; set; }
    }

    public class ChatAiLangDto
    {
        public string? Lang { get; set; }
        /// <summary>Summary only: start from here instead of my last read.</summary>
        public DateTime? Since { get; set; }
    }

    public class ChatAiMessageDto
    {
        public Guid? MessageId { get; set; }
        /// <summary>Or the sender's own id for it (the app knows only this until the message is on the server).</summary>
        public string? ClientId { get; set; }
    }

    /// <summary>
    /// Smart chat (see <see cref="ChatAiService"/>). Same access rules as the rest of chat: only people who can read a chat
    /// can ask the AI about it. The AI only suggests; sending a reply, making a task or marking one done stays a person's tap.
    /// </summary>
    public partial class ChatController
    {
        private ObjectResult AiError(ChatAiException ex) => StatusCode(ex.Status, new { message = ex.Message });

        /// <summary>Which smart chat features are on (and, for admins, that they can change them).</summary>
        [HttpGet("ai/status")]
        public IActionResult AiStatus([FromServices] ChatAiService ai) =>
            Ok(new { status = ai.Status(), canManage = User.IsAdmin() });

        /// <summary>Admins switch each feature on or off. All are off until switched on.</summary>
        [HttpPut("ai/settings")]
        public async Task<IActionResult> AiSettings([FromBody] ChatAiSwitchesDto dto, [FromServices] ChatAiService ai, [FromServices] IAppSettings settings, CancellationToken ct)
        {
            if (!User.IsAdmin()) return StatusCode(403, new { message = "Only an admin can change smart chat." });
            static string? V(bool on) => on ? "on" : null;
            await settings.SetAsync(new Dictionary<string, string?>
            {
                [ChatAiService.Keys[ChatAiFeature.Translate]] = V(dto.Translate),
                [ChatAiService.Keys[ChatAiFeature.Replies]] = V(dto.Replies),
                [ChatAiService.Keys[ChatAiFeature.Summary]] = V(dto.Summary),
                [ChatAiService.Keys[ChatAiFeature.Tasks]] = V(dto.Tasks),
            }, Array.Empty<string>(), Me, ct);
            return Ok(new { status = ai.Status(), canManage = true });
        }

        /// <summary>
        /// Messages in this chat written in the reader's language. Only messages that need it come back; the app shows them
        /// with "Translated · show original".
        /// </summary>
        [HttpPost("threads/{id:guid}/ai/translate")]
        public async Task<IActionResult> AiTranslate(Guid id, [FromBody] ChatAiTranslateDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var ids = (dto.Ids ?? new()).Distinct().Take(40).ToList();
            if (ids.Count == 0) return Ok(new { items = Array.Empty<object>() });
            var me = Me;
            var rows = await _db.ChatMessages.AsNoTracking()
                .Where(m => m.ThreadId == id && ids.Contains(m.Id) && m.SenderId != me && m.Text != null && m.Text != "")
                .Select(m => new { m.Id, m.Text, m.CreatedAt }).ToListAsync(ct);
            try
            {
                var done = await ai.TranslateAsync(me, rows.OrderBy(r => r.CreatedAt).Select(r => new ChatAiService.TranslateIn(r.Id, r.Text!)).ToList(), dto.Lang ?? "en", ct);
                return Ok(new { items = done.Where(kv => kv.Value != null).Select(kv => new { id = kv.Key, text = kv.Value }) });
            }
            catch (ChatAiException ex) { return AiError(ex); }
        }

        /// <summary>Three short replies I could send next, in my language. None when the last word was mine.</summary>
        [HttpPost("threads/{id:guid}/ai/replies")]
        public async Task<IActionResult> AiReplies(Guid id, [FromBody] ChatAiLangDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var recent = (await _db.ChatMessages.AsNoTracking().Where(m => m.ThreadId == id && !m.ClientId.StartsWith("call:"))
                .OrderByDescending(m => m.CreatedAt).Take(14).ToListAsync(ct)).OrderBy(m => m.CreatedAt).ToList();
            var last = recent.LastOrDefault();
            // In an agent's chat the office replies as one: a colleague's message counts as "ours".
            var mine = last == null || last.SenderId == Me || (office && t.Kind == "agent" && t.AgentId != Me && last.FromOffice);
            if (mine) return Ok(new { replies = Array.Empty<string>() });
            try { return Ok(new { replies = await ai.RepliesAsync(Me, MyName, office && t.Kind != "direct", recent, dto.Lang ?? "en", ct), forMessage = last!.Id }); }
            catch (ChatAiException ex) { return AiError(ex); }
        }

        /// <summary>
        /// "What did I miss": the chat since my last read (or since <c>since</c>), in a few points and what's still to do.
        /// </summary>
        [HttpPost("threads/{id:guid}/ai/summary")]
        public async Task<IActionResult> AiSummary(Guid id, [FromBody] ChatAiLangDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var from = dto.Since?.ToUniversalTime();
            if (from == null)
            {
                var read = await _db.ChatReads.AsNoTracking().Where(r => r.ThreadId == id && r.UserId == Me).Select(r => (DateTime?)r.LastReadAt).FirstOrDefaultAsync(ct);
                var newSince = read == null ? 0 : await _db.ChatMessages.CountAsync(m => m.ThreadId == id && m.CreatedAt > read && m.SenderId != Me, ct);
                from = newSince >= 3 ? read : DateTime.UtcNow.AddHours(-24);
            }
            var list = (await _db.ChatMessages.AsNoTracking().Where(m => m.ThreadId == id && m.CreatedAt > from)
                .OrderByDescending(m => m.CreatedAt).Take(150).ToListAsync(ct)).OrderBy(m => m.CreatedAt).ToList();
            if (list.Count < 3)
            {
                // Quiet chat: sum up the last 30 messages instead.
                list = (await _db.ChatMessages.AsNoTracking().Where(m => m.ThreadId == id)
                    .OrderByDescending(m => m.CreatedAt).Take(30).ToListAsync(ct)).OrderBy(m => m.CreatedAt).ToList();
                if (list.Count < 3) return BadRequest(new { message = "There's not enough in this chat to sum up yet." });
            }
            try
            {
                var s = await ai.SummaryAsync(Me, t.Kind == "team" ? "Field team group chat" : t.Kind == "agent" ? $"office chat with field agent {t.Title}" : "one-to-one chat", list, dto.Lang ?? "en", ct);
                return Ok(new { points = s.Points, todo = s.ToDo, count = list.Count, from = list.First().CreatedAt, to = list.Last().CreatedAt });
            }
            catch (ChatAiException ex) { return AiError(ex); }
        }

        /// <summary>
        /// The office's morning digest: one line per field agent who wrote in the last <c>hours</c>, urgent ones first,
        /// whether they are still waiting for a reply, and a short overview.
        /// </summary>
        [HttpGet("ai/digest")]
        public async Task<IActionResult> AiDigest([FromServices] ChatAiService ai, [FromQuery] int hours = 24, CancellationToken ct = default)
        {
            if (!await IsOfficeAsync()) return StatusCode(403, new { message = "The digest is for the office." });
            hours = Math.Clamp(hours, 4, 72);
            var from = DateTime.UtcNow.AddHours(-hours);
            var (threads, agents) = await VisibleAsync(true, false, ct);
            var active = threads.Where(t => t.Kind == "agent" && t.LastMessageAt > from && t.AgentId != Me).ToList();
            if (active.Count == 0) return Ok(new { overview = "", chats = Array.Empty<object>(), count = 0, hours });
            var ids = active.Select(t => t.Id).ToList();
            var msgs = await _db.ChatMessages.AsNoTracking().Where(m => ids.Contains(m.ThreadId) && m.CreatedAt > from && !m.ClientId.StartsWith("call:"))
                .OrderBy(m => m.CreatedAt).ToListAsync(ct);
            var byThread = msgs.GroupBy(m => m.ThreadId).ToDictionary(g => g.Key, g => g.TakeLast(40).ToList());
            // Only chats where the agent said something; the office's own broadcasts don't need a digest.
            var chats = active.Where(t => byThread.TryGetValue(t.Id, out var l) && l.Any(m => !m.FromOffice))
                .OrderByDescending(t => t.LastMessageAt).Take(40).ToList();
            if (chats.Count == 0) return Ok(new { overview = "", chats = Array.Empty<object>(), count = 0, hours });
            var keyed = chats.Select((t, i) => (Key: $"A{i + 1}", Thread: t)).ToList();
            var latest = chats.Max(t => t.LastMessageAt);
            try
            {
                var d = await ai.DigestAsync(Me, keyed.Select(k => new ChatAiService.DigestChat(k.Key,
                    agents.TryGetValue(k.Thread.AgentId!, out var a) ? a.Name : k.Thread.Title, byThread[k.Thread.Id])).ToList(),
                    $"chatai:digest:{hours}:{latest.Ticks}:{chats.Count}", ct);
                var lines = d.Chats.ToDictionary(c => c.Key);
                var rows = keyed.Select(k =>
                {
                    var list = byThread[k.Thread.Id];
                    lines.TryGetValue(k.Key, out var line);
                    var name = agents.TryGetValue(k.Thread.AgentId!, out var a) ? a.Name : k.Thread.Title;
                    return new
                    {
                        threadId = k.Thread.Id,
                        agentId = k.Thread.AgentId,
                        name,
                        block = agents.TryGetValue(k.Thread.AgentId!, out var b) ? b.Block : null,
                        summary = line?.Summary ?? "",
                        urgent = line?.Urgent ?? false,
                        why = line?.Why,
                        waiting = !list.Last().FromOffice,
                        messages = list.Count(m => !m.FromOffice),
                        lastAt = list.Last().CreatedAt,
                    };
                })
                .Where(r => r.summary.Length > 0)
                .OrderByDescending(r => r.urgent).ThenByDescending(r => r.waiting).ThenByDescending(r => r.lastAt).ToList();
                return Ok(new { overview = d.Overview, chats = rows, count = rows.Count, hours });
            }
            catch (ChatAiException ex) { return AiError(ex); }
        }

        /// <summary>
        /// The office wrote to an agent: does it ask them to do something? If so, the task it would make (the CRM offers
        /// "Make it a task"; the task itself is made with POST /api/v1/tasks as usual).
        /// </summary>
        [HttpPost("threads/{id:guid}/ai/task")]
        public async Task<IActionResult> AiTask(Guid id, [FromBody] ChatAiMessageDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            if (!office || t.Kind != "agent" || t.AgentId == null) return Ok(new { isTask = false });
            if (dto.MessageId == null) return Ok(new { isTask = false });
            var m = await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == dto.MessageId && x.ThreadId == id, ct);
            if (m == null || !m.FromOffice || string.IsNullOrWhiteSpace(m.Text)) return Ok(new { isTask = false });
            var before = (await _db.ChatMessages.AsNoTracking().Where(x => x.ThreadId == id && x.CreatedAt < m.CreatedAt)
                .OrderByDescending(x => x.CreatedAt).Take(6).ToListAsync(ct)).OrderBy(x => x.CreatedAt).ToList();
            try
            {
                var idea = await ai.TaskFromAsync(Me, m, before, ct);
                if (!idea.IsTask) return Ok(new { isTask = false });
                var already = await _db.AgentTasks.AsNoTracking().AnyAsync(x => x.AgentId == t.AgentId && x.Status != "cancelled" && x.Title == idea.Title && x.CreatedAt > m.CreatedAt.AddMinutes(-1), ct);
                return Ok(new
                {
                    isTask = !already,
                    title = idea.Title,
                    detail = idea.Detail,
                    dueDate = idea.DueDate,
                    priority = idea.Priority,
                    agentId = t.AgentId,
                    agentName = t.Title,
                    contactClientId = m.ContactClientId,
                    messageId = m.Id,
                });
            }
            catch (ChatAiException ex) { return AiError(ex); }
        }

        /// <summary>
        /// An agent wrote to the office: does it finish one of their open tasks? The app then asks "Mark '…' done?".
        /// </summary>
        [HttpPost("threads/{id:guid}/ai/done")]
        public async Task<IActionResult> AiDone(Guid id, [FromBody] ChatAiMessageDto dto, [FromServices] ChatAiService ai, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null || t.Kind != "agent" || t.AgentId != Me) return Ok(new { task = (object?)null });
            var me = Me;
            var m = dto.MessageId != null
                ? await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == dto.MessageId && x.ThreadId == id && x.SenderId == me, ct)
                : string.IsNullOrWhiteSpace(dto.ClientId) ? null
                    : await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == dto.ClientId && x.ThreadId == id && x.SenderId == me, ct);
            if (m == null) return Ok(new { task = (object?)null });
            var open = await _db.AgentTasks.AsNoTracking().Where(x => x.AgentId == Me && x.Status == "open")
                .OrderBy(x => x.DueDate == null).ThenBy(x => x.DueDate).ThenByDescending(x => x.CreatedAt).Take(20).ToListAsync(ct);
            try
            {
                var task = await ai.DoneMatchAsync(Me, m, open, ct);
                return Ok(new { task = task == null ? null : (object)new { id = task.Id, title = task.Title, dueDate = task.DueDate } });
            }
            catch (ChatAiException ex) { return AiError(ex); }
        }
    }
}
