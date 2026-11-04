using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class NewLeadDto
    {
        public string Name { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string? Source { get; set; }
        public string? SourceRef { get; set; }
        public string? PartnerClientId { get; set; }
        public string? Department { get; set; }
        public string? Note { get; set; }
        public bool AssignToMe { get; set; } = true;
    }

    public class UpdateLeadDto
    {
        public string? Name { get; set; }
        public string? Status { get; set; }
        public string? LostReason { get; set; }
        /// <summary>"" to leave it unassigned.</summary>
        public string? OwnerId { get; set; }
        public string? Department { get; set; }
        public string? PartnerClientId { get; set; }
    }

    public class LeadNoteDto
    {
        public string Text { get; set; } = string.Empty;
        /// <summary>note | call</summary>
        public string? Kind { get; set; }
    }

    public class LeadMessageDto
    {
        public string Text { get; set; } = string.Empty;
    }

    /// <summary>
    /// The leads inbox: everyone who might become a patient, from WhatsApp, partner QR codes, camps, ads and calls,
    /// with the WhatsApp conversation, an owner, a status and how fast the desk replied.
    /// </summary>
    [ApiController]
    [Route("api/v1/leads")]
    [Authorize]
    [PageAccess(Pages.Desk, Pages.WhatsApp)]
    public class LeadsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IWhatsAppSender _wa;
        private readonly IConfiguration _config;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        private readonly IPermissionService _perms;
        private readonly IAppSettings _settings;

        public LeadsController(IMarketingDbContext db, IWhatsAppSender wa, IConfiguration config, INotifier notifier, ILiveEvents live, IPermissionService perms, IAppSettings settings)
        {
            _settings = settings;
            _db = db;
            _wa = wa;
            _config = config;
            _notifier = notifier;
            _live = live;
            _perms = perms;
        }

        /// <summary>A lead counts as waiting too long when it's still New this many minutes after it came in.</summary>
        public const int DefaultReplyTargetMinutes = 15;
        private int ReplyTargetMinutes => Math.Clamp(WaAutomation.Load(_settings).ReplyTargetMinutes, 1, 24 * 60);

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? source, [FromQuery] string? q,
            [FromQuery] bool mine = false, [FromQuery] bool unassigned = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 30, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var me = User.AgentIdOf();

            var all = _db.Leads.AsNoTracking().AsQueryable();
            if (mine) all = all.Where(l => l.OwnerId == me);
            if (unassigned) all = all.Where(l => l.OwnerId == null);
            if (!string.IsNullOrWhiteSpace(source)) all = all.Where(l => l.Source == source);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                all = all.Where(l => l.Name.ToLower().Contains(s) || (digits.Length >= 4 && l.Phone.Contains(digits))
                    || (l.SourceRef != null && l.SourceRef.ToLower().Contains(s)) || (l.Department != null && l.Department.ToLower().Contains(s)));
            }

            // Counts per status for the tabs (before the status filter).
            var counts = await all.GroupBy(l => l.Status).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
            var waitingSince = DateTime.UtcNow.AddMinutes(-ReplyTargetMinutes);
            var overdue = await all.CountAsync(l => l.Status == "new" && l.FirstResponseAt == null && l.CreatedAt < waitingSince, ct);
            var unread = await all.Where(l => l.Unread > 0).CountAsync(ct);

            var list = all;
            if (status == "open") list = list.Where(l => LeadInbox.Open.Contains(l.Status));
            else if (!string.IsNullOrWhiteSpace(status)) list = list.Where(l => l.Status == status);

            var total = await list.CountAsync(ct);
            var rows = await list.OrderByDescending(l => l.Unread > 0).ThenByDescending(l => l.LastActivityAt)
                .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

            var names = await NamesAsync(rows.Select(r => r.OwnerId), ct);
            var partners = await PartnersAsync(rows.Select(r => r.PartnerClientId), ct);

            return Ok(new
            {
                items = rows.Select(l => Row(l, names, partners)),
                total, page, pageSize,
                counts, overdue, unread,
                replyTargetMinutes = ReplyTargetMinutes,
                whatsappConfigured = _wa.IsConfigured,
            });
        }

        /// <summary>Headline numbers for the top of the page: this month's leads by source and how many became patients.</summary>
        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken ct)
        {
            var monthStart = IstClock.MonthStartUtc;
            var today = IstClock.TodayStartUtc;
            var month = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= monthStart)
                .Select(l => new { l.Source, l.Status, l.CreatedAt, l.FirstResponseAt }).ToListAsync(ct);
            var responded = month.Where(l => l.FirstResponseAt != null).Select(l => (l.FirstResponseAt!.Value - l.CreatedAt).TotalMinutes).OrderBy(x => x).ToList();
            double? median = responded.Count == 0 ? null : Math.Round(responded[responded.Count / 2]);
            return Ok(new
            {
                today = month.Count(l => l.CreatedAt >= today),
                month = month.Count,
                booked = month.Count(l => l.Status is "appointment" or "arrived" or "admitted"),
                arrived = month.Count(l => l.Status is "arrived" or "admitted"),
                admitted = month.Count(l => l.Status == "admitted"),
                medianReplyMinutes = median,
                bySource = month.GroupBy(l => l.Source).Select(g => new
                {
                    source = g.Key, label = LeadInbox.SourceLabel(g.Key), n = g.Count(),
                    arrived = g.Count(x => x.Status is "arrived" or "admitted"),
                }).OrderByDescending(x => x.n),
            });
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var l = await _db.Leads.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var acts = await _db.LeadActivities.AsNoTracking().Where(a => a.LeadId == id).OrderBy(a => a.CreatedAt).Take(500).ToListAsync(ct);
            var msgs = await _db.WaMessages.AsNoTracking().Where(m => m.LeadId == id || (m.LeadId == null && m.Phone == l.Phone))
                .OrderByDescending(m => m.CreatedAt).Take(300).ToListAsync(ct);
            msgs.Reverse();
            var names = await NamesAsync(acts.Select(a => a.By).Concat(msgs.Select(m => m.SentBy)).Append(l.OwnerId), ct);
            var partners = await PartnersAsync(new[] { l.PartnerClientId }, ct);
            var partner = l.PartnerClientId != null
                ? await _db.Contacts.AsNoTracking().Where(c => c.ClientId == l.PartnerClientId)
                    .Select(c => new { clientId = c.ClientId, c.Name, c.Role, c.Phone, c.PanchayatId, c.ReferralCode }).FirstOrDefaultAsync(ct)
                : null;
            var referral = await _db.Referrals.AsNoTracking().Where(r => r.ClientId == "lead-" + id.ToString())
                .Select(r => new { r.ClientId, r.Status }).FirstOrDefaultAsync(ct);

            var timeline = acts.Select(a => new TimelineItem
            {
                Id = a.Id, At = a.CreatedAt, Type = "activity", Kind = a.Kind, Text = a.Text, By = a.By, ByName = a.By != null && names.TryGetValue(a.By, out var n) ? n : null,
            }).Concat(msgs.Select(m => new TimelineItem
            {
                Id = m.Id, At = m.CreatedAt, Type = "message", Kind = m.Direction, MsgType = m.Type, Text = m.Text, Status = m.Status, Error = m.Error,
                By = m.SentBy, ByName = m.SentBy != null && names.TryGetValue(m.SentBy, out var n2) ? n2 : null,
            })).OrderBy(x => x.At).ToList();

            return Ok(new
            {
                lead = Row(l, names, partners),
                partner,
                referral,
                timeline,
                windowOpen = LeadInbox.WindowOpen(l),
                windowClosesAt = l.LastInboundAt?.AddHours(24),
                whatsappConfigured = _wa.IsConfigured,
                templateReady = _wa.IsConfigured && LeadInbox.Wa(_settings, _config).Template("lead_followup") != null,
            });
        }

        public class TimelineItem
        {
            public Guid Id { get; set; }
            public DateTime At { get; set; }
            public string Type { get; set; } = "";
            public string Kind { get; set; } = "";
            public string? MsgType { get; set; }
            public string Text { get; set; } = "";
            public string? Status { get; set; }
            public string? Error { get; set; }
            public string? By { get; set; }
            public string? ByName { get; set; }
        }

        /// <summary>Someone called the desk, walked in, or a field agent passed on a name. One lead per phone number.</summary>
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] NewLeadDto dto, CancellationToken ct)
        {
            var phone = LeadInbox.NormalizePhone(dto.Phone);
            if (phone == null) return BadRequest(new { message = "Enter a 10-digit mobile number." });
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest(new { message = "Enter the person's name." });
            var source = LeadInbox.Sources.Contains(dto.Source ?? "") ? dto.Source! : "desk";
            var me = User.AgentIdOf();
            var now = DateTime.UtcNow;

            string? partnerId = null;
            if (!string.IsNullOrWhiteSpace(dto.PartnerClientId))
                partnerId = await _db.Contacts.Where(c => c.ClientId == dto.PartnerClientId).Select(c => c.ClientId).FirstOrDefaultAsync(ct);

            var existing = await _db.Leads.FirstOrDefaultAsync(l => l.Phone == phone, ct);
            if (existing != null)
            {
                // Same person again: note it on their lead instead of making a second one.
                var text = $"Came in again ({LeadInbox.SourceLabel(source)})" + (string.IsNullOrWhiteSpace(dto.Note) ? "" : $": {dto.Note!.Trim()}");
                _db.LeadActivities.Add(new LeadActivity { LeadId = existing.Id, Kind = "note", Text = text, By = me, CreatedAt = now });
                if (!LeadInbox.Open.Contains(existing.Status))
                {
                    _db.LeadActivities.Add(new LeadActivity { LeadId = existing.Id, Kind = "reopened", Text = "Back to New.", By = me, CreatedAt = now.AddMilliseconds(1) });
                    existing.Status = "new";
                    existing.ClosedAt = null;
                }
                existing.PartnerClientId ??= partnerId;
                existing.Department ??= string.IsNullOrWhiteSpace(dto.Department) ? null : dto.Department.Trim();
                existing.LastActivityAt = now;
                await _db.SaveChangesAsync(ct);
                return Ok(new { id = existing.Id, existed = true });
            }

            var lead = new Lead
            {
                Name = name, Phone = phone, Source = source,
                SourceRef = string.IsNullOrWhiteSpace(dto.SourceRef) ? null : dto.SourceRef.Trim(),
                PartnerClientId = partnerId,
                Department = string.IsNullOrWhiteSpace(dto.Department) ? null : dto.Department.Trim(),
                Note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim(),
                OwnerId = dto.AssignToMe ? me : null,
                CreatedBy = me, CreatedAt = now, LastActivityAt = now,
                // Someone on the desk is already talking to them.
                FirstResponseAt = source is "desk" or "walk_in" ? now : null,
                Status = source is "desk" or "walk_in" ? "contacted" : "new",
            };
            _db.Leads.Add(lead);
            _db.LeadActivities.Add(new LeadActivity
            {
                LeadId = lead.Id, Kind = "created", By = me, CreatedAt = now,
                Text = $"Added ({LeadInbox.SourceLabel(source)})" + (lead.Note != null ? $": {lead.Note}" : ""),
            });
            await _db.SaveChangesAsync(ct);
            if (lead.OwnerId == null)
            {
                _notifier.Notify(new NotifyJob
                {
                    To = await LeadInbox.DeskPeopleAsync(_db, _perms, ct), Except = me, Kind = "lead",
                    Title = $"New lead: {lead.Name}", Body = lead.Note ?? LeadInbox.SourceLabel(source), Link = $"lead:{lead.Id}", RefId = lead.Id.ToString(),
                });
            }
            await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"New lead: {lead.Name} ({LeadInbox.SourceLabel(source)})", RefId = lead.Id.ToString() });
            return Ok(new { id = lead.Id, existed = false });
        }

        [HttpPatch("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] UpdateLeadDto dto, CancellationToken ct)
        {
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var me = User.AgentIdOf();
            var now = DateTime.UtcNow;
            var myName = (await NamesAsync(new[] { me }, ct)).GetValueOrDefault(me) ?? "Someone";

            if (!string.IsNullOrWhiteSpace(dto.Name) && dto.Name.Trim() != l.Name)
            {
                _db.LeadActivities.Add(new LeadActivity { LeadId = id, Kind = "note", Text = $"Name changed from {l.Name} to {dto.Name.Trim()}", By = me, CreatedAt = now });
                l.Name = dto.Name.Trim();
            }
            if (dto.Department != null && dto.Department.Trim() != (l.Department ?? ""))
            {
                l.Department = dto.Department.Trim().Length == 0 ? null : dto.Department.Trim();
                _db.LeadActivities.Add(new LeadActivity { LeadId = id, Kind = "note", Text = l.Department == null ? "Department cleared" : $"Department: {l.Department}", By = me, CreatedAt = now });
            }
            if (dto.PartnerClientId != null && dto.PartnerClientId != (l.PartnerClientId ?? ""))
            {
                var p = dto.PartnerClientId.Length == 0 ? null : await _db.Contacts.AsNoTracking().Where(c => c.ClientId == dto.PartnerClientId).Select(c => new { c.ClientId, c.Name }).FirstOrDefaultAsync(ct);
                if (dto.PartnerClientId.Length > 0 && p == null) return BadRequest(new { message = "Partner not found." });
                l.PartnerClientId = p?.ClientId;
                _db.LeadActivities.Add(new LeadActivity { LeadId = id, Kind = "source", Text = p == null ? "No longer credited to a partner" : $"Credited to {p.Name}", By = me, CreatedAt = now });
            }
            if (dto.OwnerId != null && dto.OwnerId != (l.OwnerId ?? ""))
            {
                string? owner = dto.OwnerId.Length == 0 ? null : dto.OwnerId;
                if (owner != null && !await _db.Agents.AnyAsync(a => a.AgentId == owner && a.IsActive, ct)) return BadRequest(new { message = "That person isn't active." });
                l.OwnerId = owner;
                var ownerName = owner == null ? null : (await NamesAsync(new[] { owner }, ct)).GetValueOrDefault(owner);
                _db.LeadActivities.Add(new LeadActivity
                {
                    LeadId = id, Kind = "owner", By = me, CreatedAt = now,
                    Text = owner == null ? "Unassigned" : owner == me ? $"{myName} took this lead" : $"Assigned to {ownerName}",
                });
                if (owner != null && owner != me)
                {
                    _notifier.Notify(new NotifyJob
                    {
                        To = new() { owner }, Kind = "lead", Title = $"Lead assigned to you: {l.Name}",
                        Body = $"{myName} gave you this lead. {l.LastMessage ?? l.Note ?? ""}".Trim(), Link = $"lead:{l.Id}", RefId = l.Id.ToString(),
                    });
                }
            }

            string? newStatus = dto.Status?.Trim().ToLowerInvariant();
            if (!string.IsNullOrEmpty(newStatus) && newStatus != l.Status)
            {
                if (!LeadInbox.Statuses.Contains(newStatus)) return BadRequest(new { message = "Unknown status." });
                var from = l.Status;
                l.Status = newStatus;
                l.LostReason = newStatus == "lost" ? (string.IsNullOrWhiteSpace(dto.LostReason) ? null : dto.LostReason.Trim()) : null;
                l.ClosedAt = newStatus is "admitted" or "lost" ? now : null;
                _db.LeadActivities.Add(new LeadActivity
                {
                    LeadId = id, Kind = "status", By = me, CreatedAt = now,
                    Text = $"{LeadInbox.StatusLabel(from)} → {LeadInbox.StatusLabel(newStatus)}" + (l.LostReason != null ? $" ({l.LostReason})" : ""),
                });
                LeadInbox.Touch(l, me, newStatus != "new");
                l.Status = newStatus; // Touch may have moved New to Contacted
                await SyncReferralAsync(l, newStatus, me, now, ct);
            }

            l.LastActivityAt = now;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>
        /// A lead a partner sent who books or arrives goes to the Referral desk as that partner's patient, so they're credited
        /// (and paid) like any other referral. Later status changes follow it there.
        /// </summary>
        private async Task SyncReferralAsync(Lead l, string status, string me, DateTime now, CancellationToken ct)
        {
            if (l.PartnerClientId == null) return;
            var refId = "lead-" + l.Id;
            var r = await _db.Referrals.FirstOrDefaultAsync(x => x.ClientId == refId, ct);
            string? stage = status switch { "appointment" => "pending", "arrived" => "arrived", "admitted" => "admitted", "lost" => "lost", _ => null };
            if (stage == null) return;
            if (r == null)
            {
                if (stage == "lost") return;
                var partner = await _db.Contacts.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == l.PartnerClientId, ct);
                if (partner == null) return;
                r = new PatientReferral
                {
                    ClientId = refId, DeviceId = "crm-leads", ContactId = partner.ClientId, AgentId = partner.AgentId,
                    PatientName = l.Name, Department = l.Department ?? "", ClientPhone = l.Phone.Length == 12 ? l.Phone[2..] : l.Phone,
                    Notes = $"From the leads inbox ({LeadInbox.SourceLabel(l.Source)}).", ReferralDate = now, CreatedAt = now, Status = "pending",
                };
                _db.Referrals.Add(r);
                _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "note", By = me, CreatedAt = now.AddMilliseconds(2), Text = $"Added to the Referral desk as {partner.Name}'s patient" });
            }
            if (r.Status == stage) return;
            r.Status = stage;
            if (stage is "arrived" or "admitted" && r.ArrivedAt == null) r.ArrivedAt = now;
            if (stage == "admitted" && r.AdmittedAt == null) r.AdmittedAt = now;
            r.UpdatedAt = now;
            _db.ReferralStatusEntries.Add(new ReferralStatusEntry { ReferralClientId = refId, Status = stage, ChangedBy = me, ChangedAt = now, Note = "From the leads inbox" });
            if (!string.IsNullOrEmpty(r.AgentId))
            {
                _notifier.Notify(new NotifyJob
                {
                    To = new() { r.AgentId }, Except = me, Kind = "referral",
                    Title = $"{r.PatientName}: {ReferralsController.StageLabel(stage)}",
                    Body = "A patient from your partner's QR code / WhatsApp.", Link = $"referral:{refId}", RefId = refId,
                });
            }
        }

        [HttpPost("{id:guid}/notes")]
        public async Task<IActionResult> AddNote(Guid id, [FromBody] LeadNoteDto dto, CancellationToken ct)
        {
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var text = (dto.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Write something first." });
            var me = User.AgentIdOf();
            var kind = dto.Kind == "call" ? "call" : "note";
            _db.LeadActivities.Add(new LeadActivity { LeadId = id, Kind = kind, Text = text.Length > 2000 ? text[..2000] : text, By = me });
            var hadOwner = l.OwnerId != null;
            LeadInbox.Touch(l, me, kind == "call");
            if (!hadOwner && l.OwnerId == me) _db.LeadActivities.Add(new LeadActivity { LeadId = id, Kind = "owner", Text = "Took this lead", By = me, CreatedAt = DateTime.UtcNow.AddMilliseconds(1) });
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("{id:guid}/read")]
        public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
        {
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            if (l.Unread != 0) { l.Unread = 0; await _db.SaveChangesAsync(ct); }
            // Clear the bell for this lead too.
            var me = User.AgentIdOf();
            var key = id.ToString();
            var ns = await _db.Notifications.Where(n => n.UserId == me && n.Kind == "lead" && n.RefId == key && n.ReadAt == null).ToListAsync(ct);
            foreach (var n in ns) n.ReadAt = DateTime.UtcNow;
            if (ns.Count > 0) await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>A WhatsApp reply typed by the desk. Only allowed within 24 hours of the person's last message.</summary>
        [HttpPost("{id:guid}/whatsapp")]
        public async Task<IActionResult> SendText(Guid id, [FromBody] LeadMessageDto dto, [FromServices] WhatsAppOutbox outbox, CancellationToken ct)
        {
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var text = (dto.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Write a message first." });
            if (l.OptOut) return BadRequest(new { message = "They asked not to get WhatsApp messages." });
            if (!LeadInbox.WindowOpen(l)) return BadRequest(new { message = "It's been more than 24 hours since they last wrote, so WhatsApp only allows the follow-up template now.", windowClosed = true });

            var me = User.AgentIdOf();
            var msg = await outbox.SendTextAsync(l.Phone, text, "lead", me, l.Id, ct);
            return await SavedAsync(l, me, msg, ct);
        }

        /// <summary>The approved follow-up template (chosen in WhatsApp → Setup), for when the 24-hour window has closed.</summary>
        [HttpPost("{id:guid}/whatsapp/template")]
        public async Task<IActionResult> SendTemplate(Guid id, [FromServices] WhatsAppOutbox outbox, CancellationToken ct)
        {
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            if (l.OptOut) return BadRequest(new { message = "They asked not to get WhatsApp messages." });
            var cfg = outbox.Config;
            if (cfg.Template("lead_followup") == null) return BadRequest(new { message = "No follow-up template is chosen yet. An admin can pick one in WhatsApp → Setup." });

            var me = User.AgentIdOf();
            var first = l.Name.StartsWith("+") ? "" : l.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
            var preview = $"Follow-up message ({cfg.Template("lead_followup")}) sent to {(first.Length > 0 ? first : "them")}";
            var msg = await outbox.SendUseAsync(l.Phone, "lead_followup", "hi", new[] { first.Length > 0 ? first : "जी", cfg.HospitalName }, preview, "followup", me, l.Id, null, ct);
            return await SavedAsync(l, me, msg, ct);
        }

        private async Task<IActionResult> SavedAsync(Lead l, string me, WaMessage msg, CancellationToken ct)
        {
            var ok = msg.Status == "sent";
            if (ok)
            {
                var hadOwner = l.OwnerId != null;
                LeadInbox.Touch(l, me, true);
                if (!hadOwner && l.OwnerId == me) _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "owner", Text = "Took this lead", By = me, CreatedAt = DateTime.UtcNow });
                l.LastMessage = "You: " + LeadInbox.Shorten(msg.Text, 150);
                l.Unread = 0;
            }
            await _db.SaveChangesAsync(ct);
            if (!ok) return BadRequest(new { message = msg.Error ?? "WhatsApp didn't accept the message.", id = msg.Id });
            return Ok(new { id = msg.Id, status = msg.Status });
        }

        /// <summary>People who can take leads, for the owner picker.</summary>
        [HttpGet("people")]
        public async Task<IActionResult> People(CancellationToken ct)
        {
            var ids = await LeadInbox.DeskPeopleAsync(_db, _perms, ct);
            var open = await _db.Leads.AsNoTracking().Where(l => l.OwnerId != null && LeadInbox.Open.Contains(l.Status))
                .GroupBy(l => l.OwnerId!).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
            var people = await _db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId))
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, photoUrl = a.PhotoUrl }).ToListAsync(ct);
            return Ok(people.OrderBy(p => p.name).Select(p => new { p.agentId, p.name, p.role, p.photoUrl, open = open.GetValueOrDefault(p.agentId) }));
        }

        /// <summary>A WhatsApp link (and the text for a QR code) for a camp or poster, e.g. ?camp=Kasba 12 Nov.</summary>
        [HttpGet("link")]
        public IActionResult Link([FromQuery] string? camp)
        {
            var c = string.IsNullOrWhiteSpace(camp) ? null : camp.Trim();
            var cfg = LeadInbox.Wa(_settings, _config);
            var message = LeadInbox.QrMessage(cfg, null, c);
            return Ok(new { message, waLink = LeadInbox.WaLink(cfg, message), displayPhone = LeadInbox.DisplayPhone(cfg), hospital = cfg.HospitalName });
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
        }

        private async Task<Dictionary<string, string>> PartnersAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return await _db.Contacts.AsNoTracking().Where(c => list.Contains(c.ClientId)).ToDictionaryAsync(c => c.ClientId, c => c.Name, ct);
        }

        private static object Row(Lead l, Dictionary<string, string> names, Dictionary<string, string> partners) => new
        {
            id = l.Id, name = l.Name, phone = l.Phone,
            source = l.Source, sourceLabel = LeadInbox.SourceLabel(l.Source), sourceRef = l.SourceRef,
            partnerClientId = l.PartnerClientId,
            partnerName = l.PartnerClientId != null && partners.TryGetValue(l.PartnerClientId, out var pn) ? pn : null,
            department = l.Department, status = l.Status, lostReason = l.LostReason,
            ownerId = l.OwnerId, ownerName = l.OwnerId != null && names.TryGetValue(l.OwnerId, out var on) ? on : null,
            note = l.Note, lastMessage = l.LastMessage, unread = l.Unread, optOut = l.OptOut,
            createdAt = l.CreatedAt, lastActivityAt = l.LastActivityAt, firstResponseAt = l.FirstResponseAt, lastInboundAt = l.LastInboundAt,
            windowOpen = LeadInbox.WindowOpen(l),
        };
    }

    /// <summary>
    /// A partner's own referral code: printed on their QR poster and in the WhatsApp link they share. Patients who use it
    /// land in the leads inbox already credited to that partner. Field agents can fetch it too, to share from the app.
    /// </summary>
    [ApiController]
    [Route("api/v1/partners")]
    [Authorize]
    public class PartnerReferralLinkController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IConfiguration _config;
        private readonly IAppSettings _settings;

        public PartnerReferralLinkController(IMarketingDbContext db, IConfiguration config, IAppSettings settings)
        {
            _db = db;
            _config = config;
            _settings = settings;
        }

        [HttpGet("{clientId}/referral-link")]
        public async Task<IActionResult> Get(string clientId, CancellationToken ct)
        {
            var c = await _db.Contacts.FirstOrDefaultAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (c == null) return NotFound();
            if (string.IsNullOrEmpty(c.ReferralCode))
            {
                for (var i = 0; i < 8; i++)
                {
                    var code = LeadInbox.NewCode();
                    if (!await _db.Contacts.AnyAsync(x => x.ReferralCode == code, ct)) { c.ReferralCode = code; break; }
                }
                if (string.IsNullOrEmpty(c.ReferralCode)) return StatusCode(500, new { message = "Could not make a code. Try again." });
                await _db.SaveChangesAsync(ct);
            }
            var cfg = LeadInbox.Wa(_settings, _config);
            var message = LeadInbox.QrMessage(cfg, c.ReferralCode, null);
            var leads = await _db.Leads.AsNoTracking().Where(l => l.PartnerClientId == c.ClientId).Select(l => l.Status).ToListAsync(ct);
            return Ok(new
            {
                code = c.ReferralCode,
                name = c.Name,
                message,
                waLink = LeadInbox.WaLink(cfg, message),
                displayPhone = LeadInbox.DisplayPhone(cfg),
                hospital = cfg.HospitalName,
                leads = leads.Count,
                arrived = leads.Count(s => s is "arrived" or "admitted"),
                admitted = leads.Count(s => s == "admitted"),
            });
        }
    }
}
