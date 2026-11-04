using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WaTextDto { public string Text { get; set; } = string.Empty; }

    public class WaTemplateSendDto
    {
        public string Template { get; set; } = string.Empty;
        public string Language { get; set; } = "hi";
        public List<string> Values { get; set; } = new();
        /// <summary>The message as the person will read it (for the inbox and the log).</summary>
        public string? Preview { get; set; }
    }

    public class WaNewConversationDto : WaTemplateSendDto
    {
        public string Phone { get; set; } = string.Empty;
        public string? Name { get; set; }
    }

    public class WaConversationUpdateDto
    {
        /// <summary>"" = nobody.</summary>
        public string? AssignedTo { get; set; }
        public string? Status { get; set; }
        public bool? OptOut { get; set; }
        public string? Name { get; set; }
    }

    public class WaPauseDto { public bool Paused { get; set; } }

    /// <summary>
    /// The WhatsApp hub in the CRM: every conversation on the hospital's number, the full message log with resend,
    /// the pause switch and daily limit, and the automation rules.
    /// </summary>
    [ApiController]
    [Route("api/v1/whatsapp")]
    [Authorize]
    [PageAccess(Pages.WhatsApp, Pages.Desk)]
    public class WhatsAppHubController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly WhatsAppOutbox _outbox;
        private readonly IAppSettings _settings;
        private readonly IPermissionService _perms;
        private readonly IWhatsAppSender _wa;

        public WhatsAppHubController(IMarketingDbContext db, WhatsAppOutbox outbox, IAppSettings settings, IPermissionService perms, IWhatsAppSender wa)
        {
            _db = db;
            _outbox = outbox;
            _settings = settings;
            _perms = perms;
            _wa = wa;
        }

        private static readonly Regex TemplateName = new(@"^[a-z0-9_]{1,100}$");
        private static readonly Regex LangCode = new(@"^[a-z]{2,3}(_[A-Z]{2})?$");
        private static bool WindowOpen(WaConversation c) => c.LastInboundAt != null && c.LastInboundAt > DateTime.UtcNow.AddHours(-24);

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
        }

        // ─── Status bar ───
        [HttpGet("status")]
        public async Task<IActionResult> Status(CancellationToken ct)
        {
            var rules = _outbox.Rules;
            var cfg = _outbox.Config;
            var today = IstClock.TodayStartUtc;
            var templatesToday = await _db.WaMessages.CountAsync(m => m.Direction == "out" && m.TemplateName != null && m.Status != "failed" && m.Status != "blocked" && m.CreatedAt >= today, ct);
            var unread = await _db.WaConversations.CountAsync(c => c.Unread > 0, ct);
            var pausedByName = rules.PausedBy != null ? (await NamesAsync(new[] { rules.PausedBy }, ct)).GetValueOrDefault(rules.PausedBy) : null;
            var me = User.AgentIdOf();
            var level = User.IsAdmin() ? Pages.Edit : await _perms.GetLevelAsync(User, Pages.WhatsApp);
            return Ok(new
            {
                connected = cfg.IsConfigured,
                displayPhone = LeadInbox.DisplayPhone(cfg),
                hospital = cfg.HospitalName,
                paused = rules.Paused, pausedBy = pausedByName, pausedAt = rules.PausedAt,
                templatesToday, dailyLimit = rules.DailyTemplateLimit,
                unread,
                canManage = level >= Pages.Edit,
                isAdmin = User.IsAdmin(),
                me,
            });
        }

        // ─── Inbox ───
        [HttpGet("conversations")]
        public async Task<IActionResult> Conversations([FromQuery] string? filter, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 30, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var me = User.AgentIdOf();
            var all = _db.WaConversations.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                all = all.Where(c => c.Name.ToLower().Contains(s) || (digits.Length >= 4 && c.Phone.Contains(digits)) || (c.LastMessage != null && c.LastMessage.ToLower().Contains(s)));
            }
            var counts = new
            {
                open = await all.CountAsync(c => c.Status == "open", ct),
                unread = await all.CountAsync(c => c.Unread > 0, ct),
                mine = await all.CountAsync(c => c.AssignedTo == me && c.Status == "open", ct),
                unassigned = await all.CountAsync(c => c.AssignedTo == null && c.Status == "open", ct),
                done = await all.CountAsync(c => c.Status == "done", ct),
            };
            var list = filter switch
            {
                "unread" => all.Where(c => c.Unread > 0),
                "mine" => all.Where(c => c.AssignedTo == me && c.Status == "open"),
                "unassigned" => all.Where(c => c.AssignedTo == null && c.Status == "open"),
                "leads" => all.Where(c => c.LeadId != null),
                "partners" => all.Where(c => c.PartnerClientId != null),
                "done" => all.Where(c => c.Status == "done"),
                "all" => all,
                _ => all.Where(c => c.Status == "open"),
            };
            var total = await list.CountAsync(ct);
            var rows = await list.OrderByDescending(c => c.Unread > 0).ThenByDescending(c => c.LastMessageAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var names = await NamesAsync(rows.Select(r => r.AssignedTo), ct);
            var pids = rows.Where(r => r.PartnerClientId != null).Select(r => r.PartnerClientId!).Distinct().ToList();
            var partners = pids.Count == 0 ? new Dictionary<string, string>() : await _db.Contacts.AsNoTracking().Where(c => pids.Contains(c.ClientId)).ToDictionaryAsync(c => c.ClientId, c => c.Name, ct);
            var lids = rows.Where(r => r.LeadId != null).Select(r => r.LeadId!.Value).ToList();
            var leads = lids.Count == 0 ? new Dictionary<Guid, string>() : await _db.Leads.AsNoTracking().Where(l => lids.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            return Ok(new
            {
                items = rows.Select(c => new
                {
                    phone = c.Phone, name = c.Name, status = c.Status, unread = c.Unread, optOut = c.OptOut,
                    lastMessage = c.LastMessage, lastDirection = c.LastDirection, lastMessageAt = c.LastMessageAt, windowOpen = WindowOpen(c),
                    assignedTo = c.AssignedTo, assignedName = c.AssignedTo != null ? names.GetValueOrDefault(c.AssignedTo) : null,
                    leadId = c.LeadId, leadStatus = c.LeadId != null ? leads.GetValueOrDefault(c.LeadId.Value) : null,
                    partnerClientId = c.PartnerClientId, partnerName = c.PartnerClientId != null ? partners.GetValueOrDefault(c.PartnerClientId) : null,
                }),
                total, page, pageSize, counts,
            });
        }

        private async Task<WaConversation?> FindAsync(string phone, CancellationToken ct)
        {
            var p = LeadInbox.NormalizePhone(phone) ?? phone;
            return await _db.WaConversations.FirstOrDefaultAsync(c => c.Phone == p, ct);
        }

        [HttpGet("conversations/{phone}")]
        public async Task<IActionResult> Conversation(string phone, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            var msgs = await _db.WaMessages.AsNoTracking().Where(m => m.Phone == c.Phone).OrderByDescending(m => m.CreatedAt).Take(300).ToListAsync(ct);
            msgs.Reverse();
            var names = await NamesAsync(msgs.Select(m => m.SentBy).Append(c.AssignedTo), ct);
            var lead = c.LeadId != null ? await _db.Leads.AsNoTracking().Where(l => l.Id == c.LeadId).Select(l => new { l.Id, l.Name, l.Status, l.OwnerId, l.Source, l.Department }).FirstOrDefaultAsync(ct) : null;
            var partner = c.PartnerClientId != null ? await _db.Contacts.AsNoTracking().Where(x => x.ClientId == c.PartnerClientId).Select(x => new { clientId = x.ClientId, x.Name, x.Role, x.PanchayatId }).FirstOrDefaultAsync(ct) : null;
            var bids = msgs.Where(m => m.BroadcastId != null).Select(m => m.BroadcastId!.Value).Distinct().ToList();
            var broadcasts = bids.Count == 0 ? new Dictionary<Guid, string>() : await _db.Broadcasts.AsNoTracking().Where(b => bids.Contains(b.Id)).ToDictionaryAsync(b => b.Id, b => b.Title, ct);
            return Ok(new
            {
                conversation = new
                {
                    phone = c.Phone, name = c.Name, status = c.Status, unread = c.Unread, optOut = c.OptOut, assignedTo = c.AssignedTo,
                    assignedName = c.AssignedTo != null ? names.GetValueOrDefault(c.AssignedTo) : null, lastInboundAt = c.LastInboundAt, createdAt = c.CreatedAt,
                },
                windowOpen = WindowOpen(c),
                windowClosesAt = c.LastInboundAt?.AddHours(24),
                lead, partner,
                messages = msgs.Select(m => new
                {
                    id = m.Id, at = m.CreatedAt, direction = m.Direction, type = m.Type, text = m.Text, status = m.Status, error = m.Error,
                    source = m.Source, template = m.TemplateName, byName = m.SentBy != null ? names.GetValueOrDefault(m.SentBy) : null,
                    broadcast = m.BroadcastId != null ? broadcasts.GetValueOrDefault(m.BroadcastId.Value) : null,
                }),
            });
        }

        [HttpPost("conversations/{phone}/read")]
        public async Task<IActionResult> Read(string phone, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            c.Unread = 0;
            if (c.LeadId != null)
            {
                var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == c.LeadId, ct);
                if (l != null) l.Unread = 0;
            }
            var me = User.AgentIdOf();
            var refs = new List<string> { c.Phone };
            if (c.LeadId != null) refs.Add(c.LeadId.Value.ToString());
            foreach (var n in await _db.Notifications.Where(n => n.UserId == me && n.Kind == "lead" && n.ReadAt == null && n.RefId != null && refs.Contains(n.RefId)).ToListAsync(ct))
                n.ReadAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>After the desk replies: the conversation (and the lead, if any) counts as answered and gets an owner.</summary>
        private async Task AfterReplyAsync(WaConversation c, WaMessage msg, CancellationToken ct)
        {
            if (msg.Status != "sent") return;
            var me = User.AgentIdOf();
            c.Unread = 0;
            c.AssignedTo ??= me;
            if (c.LeadId == null) return;
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == c.LeadId, ct);
            if (l == null) return;
            var hadOwner = l.OwnerId != null;
            LeadInbox.Touch(l, me, true);
            if (!hadOwner && l.OwnerId == me) _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "owner", Text = "Took this lead (replied in the WhatsApp inbox)", By = me });
            l.LastMessage = "You: " + LeadInbox.Shorten(msg.Text, 150);
            l.Unread = 0;
        }

        [HttpPost("conversations/{phone}/text")]
        public async Task<IActionResult> SendText(string phone, [FromBody] WaTextDto dto, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            var text = (dto.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Write a message first." });
            if (text.Length > 4000) return BadRequest(new { message = "That's too long for one WhatsApp message." });
            if (!WindowOpen(c)) return BadRequest(new { message = "It's been more than 24 hours since they last wrote. WhatsApp only allows an approved template now.", windowClosed = true });
            var msg = await _outbox.SendTextAsync(c.Phone, text, "inbox", User.AgentIdOf(), c.LeadId, ct);
            await AfterReplyAsync(c, msg, ct);
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return BadRequest(new { message = msg.Error ?? "WhatsApp didn't accept the message." });
            return Ok(new { id = msg.Id });
        }

        private string? CheckTemplate(WaTemplateSendDto dto)
        {
            if (!TemplateName.IsMatch(dto.Template ?? "")) return "Pick a template.";
            if (!LangCode.IsMatch(dto.Language ?? "")) return "Unknown template language.";
            if (dto.Values.Count > 10 || dto.Values.Any(v => (v ?? "").Length > 500)) return "Too many or too long values.";
            if (dto.Values.Any(string.IsNullOrWhiteSpace)) return "Fill in every value.";
            return null;
        }

        [HttpPost("conversations/{phone}/template")]
        public async Task<IActionResult> SendTemplate(string phone, [FromBody] WaTemplateSendDto dto, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            var err = CheckTemplate(dto);
            if (err != null) return BadRequest(new { message = err });
            var preview = LeadInbox.Shorten(string.IsNullOrWhiteSpace(dto.Preview) ? $"Template {dto.Template}" : dto.Preview, 1500);
            var msg = await _outbox.SendTemplateAsync(c.Phone, dto.Template, dto.Language, dto.Values.Select(v => v.Trim()).ToList(), preview, "inbox", User.AgentIdOf(), c.LeadId, null, ct);
            await AfterReplyAsync(c, msg, ct);
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return BadRequest(new { message = msg.Error ?? "WhatsApp didn't accept the message." });
            return Ok(new { id = msg.Id });
        }

        /// <summary>Message someone who hasn't written yet: only an approved template can start a conversation.</summary>
        [HttpPost("conversations")]
        public async Task<IActionResult> Start([FromBody] WaNewConversationDto dto, CancellationToken ct)
        {
            var phone = LeadInbox.NormalizePhone(dto.Phone);
            if (phone == null) return BadRequest(new { message = "Enter a 10-digit mobile number." });
            var err = CheckTemplate(dto);
            if (err != null) return BadRequest(new { message = err });
            var c = await _outbox.ConversationAsync(phone, dto.Name, ct);
            var preview = LeadInbox.Shorten(string.IsNullOrWhiteSpace(dto.Preview) ? $"Template {dto.Template}" : dto.Preview, 1500);
            var msg = await _outbox.SendTemplateAsync(phone, dto.Template, dto.Language, dto.Values.Select(v => v.Trim()).ToList(), preview, "inbox", User.AgentIdOf(), c.LeadId, null, ct);
            c.AssignedTo ??= User.AgentIdOf();
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return BadRequest(new { message = msg.Error ?? "WhatsApp didn't accept the message.", phone });
            return Ok(new { phone });
        }

        [HttpPatch("conversations/{phone}")]
        public async Task<IActionResult> Update(string phone, [FromBody] WaConversationUpdateDto dto, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            if (dto.AssignedTo != null)
            {
                var to = dto.AssignedTo.Length == 0 ? null : dto.AssignedTo;
                if (to != null && !await _db.Agents.AnyAsync(a => a.AgentId == to && a.IsActive, ct)) return BadRequest(new { message = "That person isn't active." });
                c.AssignedTo = to;
            }
            if (dto.Status is "open" or "done") { c.Status = dto.Status; if (dto.Status == "done") c.Unread = 0; }
            if (dto.OptOut != null)
            {
                c.OptOut = dto.OptOut.Value;
                if (c.LeadId != null) { var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == c.LeadId, ct); if (l != null) l.OptOut = c.OptOut; }
            }
            if (!string.IsNullOrWhiteSpace(dto.Name)) c.Name = dto.Name.Trim()[..Math.Min(120, dto.Name.Trim().Length)];
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Turns a conversation into a lead in the Leads inbox (or returns the existing one).</summary>
        [HttpPost("conversations/{phone}/lead")]
        public async Task<IActionResult> MakeLead(string phone, CancellationToken ct)
        {
            var c = await FindAsync(phone, ct);
            if (c == null) return NotFound();
            var existing = await _db.Leads.FirstOrDefaultAsync(l => l.Phone == c.Phone, ct);
            if (existing != null) { c.LeadId = existing.Id; await _db.SaveChangesAsync(ct); return Ok(new { id = existing.Id, existed = true }); }
            var me = User.AgentIdOf();
            var now = DateTime.UtcNow;
            var lead = new Lead
            {
                Name = c.Name, Phone = c.Phone, Source = c.PartnerClientId != null ? "partner" : "whatsapp", PartnerClientId = c.PartnerClientId,
                OwnerId = c.AssignedTo ?? me, CreatedBy = me, CreatedAt = now, LastActivityAt = now, LastInboundAt = c.LastInboundAt,
                LastMessage = c.LastMessage, Note = c.LastDirection == "in" ? c.LastMessage : null, Status = "new",
            };
            _db.Leads.Add(lead);
            _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "created", By = me, CreatedAt = now, Text = "Made a lead from the WhatsApp inbox" });
            c.LeadId = lead.Id;
            foreach (var m in await _db.WaMessages.Where(m => m.Phone == c.Phone && m.LeadId == null).ToListAsync(ct)) m.LeadId = lead.Id;
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = lead.Id, existed = false });
        }

        // ─── Message log ───
        [HttpGet("messages")]
        public async Task<IActionResult> Messages([FromQuery] string? direction, [FromQuery] string? status, [FromQuery] string? source, [FromQuery] string? q,
            [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);
            var list = _db.WaMessages.AsNoTracking().AsQueryable();
            if (direction is "in" or "out") list = list.Where(m => m.Direction == direction);
            if (!string.IsNullOrWhiteSpace(status)) list = status == "problem" ? list.Where(m => m.Status == "failed" || m.Status == "blocked") : list.Where(m => m.Status == status);
            if (!string.IsNullOrWhiteSpace(source)) list = source == "rule" ? list.Where(m => m.Source.StartsWith("rule:")) : list.Where(m => m.Source == source);
            if (from != null) list = list.Where(m => m.CreatedAt >= DateTime.SpecifyKind(from.Value, DateTimeKind.Utc));
            if (to != null) list = list.Where(m => m.CreatedAt < DateTime.SpecifyKind(to.Value, DateTimeKind.Utc));
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                list = list.Where(m => m.Text.ToLower().Contains(s) || (digits.Length >= 4 && m.Phone.Contains(digits)) || (m.TemplateName != null && m.TemplateName.Contains(s)));
            }
            var total = await list.CountAsync(ct);
            var rows = await list.OrderByDescending(m => m.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var phones = rows.Select(r => r.Phone).Distinct().ToList();
            var convNames = await _db.WaConversations.AsNoTracking().Where(c => phones.Contains(c.Phone)).ToDictionaryAsync(c => c.Phone, c => c.Name, ct);
            var names = await NamesAsync(rows.Select(r => r.SentBy), ct);

            var since = DateTime.UtcNow.AddDays(-7);
            var week = await _db.WaMessages.AsNoTracking().Where(m => m.Direction == "out" && m.CreatedAt >= since).GroupBy(m => m.Status).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
            int n(string k) => week.FirstOrDefault(w => w.Key == k)?.N ?? 0;
            var received7 = await _db.WaMessages.CountAsync(m => m.Direction == "in" && m.CreatedAt >= since, ct);
            return Ok(new
            {
                items = rows.Select(m => new
                {
                    id = m.Id, at = m.CreatedAt, phone = m.Phone, name = convNames.GetValueOrDefault(m.Phone), direction = m.Direction, type = m.Type,
                    source = m.Source, template = m.TemplateName, text = m.Text, status = m.Status, error = m.Error,
                    byName = m.SentBy != null ? names.GetValueOrDefault(m.SentBy) : null, leadId = m.LeadId,
                    canResend = m.Direction == "out" && (m.Status == "failed" || m.Status == "blocked") && (m.TemplateName != null || m.Type == "text"),
                }),
                total, page, pageSize,
                week = new { sent = n("sent") + n("delivered") + n("read"), delivered = n("delivered") + n("read"), read = n("read"), failed = n("failed"), blocked = n("blocked"), received = received7 },
            });
        }

        [HttpPost("messages/{id:guid}/resend")]
        public async Task<IActionResult> Resend(Guid id, CancellationToken ct)
        {
            var m = await _db.WaMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound();
            if (m.Direction != "out" || (m.Status != "failed" && m.Status != "blocked")) return BadRequest(new { message = "Only messages that didn't go out can be sent again." });
            WaMessage msg;
            if (m.TemplateName != null)
            {
                var values = string.IsNullOrEmpty(m.ParamsJson) ? new List<string>() : JsonSerializer.Deserialize<List<string>>(m.ParamsJson) ?? new List<string>();
                msg = await _outbox.SendTemplateAsync(m.Phone, m.TemplateName, m.TemplateLanguage ?? _outbox.Config.HindiCode, values, m.Text, "resend", User.AgentIdOf(), m.LeadId, m.BroadcastId, ct);
            }
            else
            {
                var c = await FindAsync(m.Phone, ct);
                if (c == null || !WindowOpen(c)) return BadRequest(new { message = "More than 24 hours since they last wrote: send a template from the inbox instead." });
                msg = await _outbox.SendTextAsync(m.Phone, m.Text, "resend", User.AgentIdOf(), m.LeadId, ct);
            }
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return BadRequest(new { message = msg.Error ?? "Still not sent." });
            return Ok(new { id = msg.Id });
        }

        // ─── Automation & controls ───
        [HttpGet("automation")]
        public async Task<IActionResult> Automation(CancellationToken ct)
        {
            var ids = await LeadInbox.DeskPeopleAsync(_db, _perms, ct);
            var people = await _db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId)).OrderBy(a => a.Name).Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role }).ToListAsync(ct);
            var cfg = _outbox.Config;
            return Ok(new { rules = _outbox.Rules, people, autoReply = cfg.AutoReply, connected = cfg.IsConfigured });
        }

        [HttpPut("automation")]
        [PageAccess(Pages.WhatsApp)]
        public async Task<IActionResult> SaveAutomation([FromBody] WaAutomation dto, CancellationToken ct)
        {
            var current = _outbox.Rules;
            if (dto.DailyTemplateLimit < 0 || dto.DailyTemplateLimit > 100000) return BadRequest(new { message = "Daily limit must be between 0 (no limit) and 100,000." });
            if (dto.ReplyTargetMinutes < 1 || dto.ReplyTargetMinutes > 1440) return BadRequest(new { message = "Reply target must be between 1 minute and 24 hours." });
            if (WaAutomation.ParseTime(dto.OfficeStart) == null || WaAutomation.ParseTime(dto.OfficeEnd) == null) return BadRequest(new { message = "Office hours look like 09:00 and 18:00." });
            if (WaAutomation.ParseTime(dto.OfficeStart) >= WaAutomation.ParseTime(dto.OfficeEnd)) return BadRequest(new { message = "Office hours must end after they start." });
            if (dto.OfficeDays.Any(d => d < 0 || d > 6)) return BadRequest(new { message = "Unknown day." });
            if ((dto.AfterHoursReply ?? "").Length > 1000) return BadRequest(new { message = "The after-hours reply is too long." });
            if (dto.AssignMode is not ("none" or "balance")) return BadRequest(new { message = "Unknown assignment mode." });
            if (dto.Keywords.Count > 50) return BadRequest(new { message = "Up to 50 keyword replies." });
            foreach (var k in dto.Keywords)
            {
                k.Words = k.Words.Select(w => w.Trim()).Where(w => w.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(20).ToList();
                if (k.Words.Count == 0) return BadRequest(new { message = "Each keyword reply needs at least one word." });
                if (k.Words.Any(w => w.Length > 40)) return BadRequest(new { message = "Keywords are short words like OPD or timing." });
                if (string.IsNullOrWhiteSpace(k.Reply) || k.Reply.Length > 1000) return BadRequest(new { message = $"Write a reply (up to 1,000 characters) for “{k.Words[0]}”." });
                if (string.IsNullOrWhiteSpace(k.Id) || k.Id.Length > 20 || !k.Id.All(char.IsLetterOrDigit)) k.Id = Guid.NewGuid().ToString("n")[..8];
            }
            dto.StopWords = dto.StopWords.Select(w => w.Trim()).Where(w => w.Length > 0 && w.Length <= 30).Distinct(StringComparer.OrdinalIgnoreCase).Take(20).ToList();
            if (dto.StopWords.Count == 0) dto.StopWords = new WaAutomation().StopWords;
            dto.AssignTo = dto.AssignTo.Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().Take(50).ToList();
            // The pause switch has its own button (and keeps who paused it).
            dto.Paused = current.Paused;
            dto.PausedBy = current.PausedBy;
            dto.PausedAt = current.PausedAt;
            await dto.SaveAsync(_settings, User.AgentIdOf(), ct);
            return Ok(new { ok = true });
        }

        [HttpPost("pause")]
        [PageAccess(Pages.WhatsApp)]
        public async Task<IActionResult> Pause([FromBody] WaPauseDto dto, CancellationToken ct)
        {
            var rules = _outbox.Rules;
            rules.Paused = dto.Paused;
            rules.PausedBy = dto.Paused ? User.AgentIdOf() : null;
            rules.PausedAt = dto.Paused ? DateTime.UtcNow : null;
            await rules.SaveAsync(_settings, User.AgentIdOf(), ct);
            return Ok(new { paused = rules.Paused });
        }
    }
}
