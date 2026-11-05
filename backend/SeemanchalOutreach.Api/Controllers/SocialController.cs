using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
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
    public class SocialReplyDto { public string Text { get; set; } = string.Empty; }
    public class SocialLeadDto { public string Phone { get; set; } = string.Empty; public string? Name { get; set; } }
    public class SocialUpdateDto { public string? Status { get; set; } public string? AssignedTo { get; set; } }

    /// <summary>
    /// Facebook &amp; Instagram in the CRM: Page and Instagram messages (with replies), Lead Ads form submissions, and ad
    /// spend against the leads and patients it brought.
    /// </summary>
    [ApiController]
    [Route("api/v1/social")]
    [Authorize]
    [PageAccess(Pages.Social)]
    public class SocialController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly MetaService _meta;
        private readonly IPermissionService _perms;

        public SocialController(IMarketingDbContext db, MetaService meta, IPermissionService perms)
        {
            _db = db;
            _meta = meta;
            _perms = perms;
        }

        private static bool WindowOpen(SocialConversation c) => c.LastInboundAt != null && c.LastInboundAt > DateTime.UtcNow.AddHours(-24);

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
        }

        [HttpGet("status")]
        public async Task<IActionResult> Status(CancellationToken ct)
        {
            var cfg = _meta.Config;
            var today = IstClock.TodayStartUtc;
            var level = User.IsAdmin() ? Pages.Edit : await _perms.GetLevelAsync(User, Pages.Social);
            return Ok(new
            {
                connected = cfg.PageConnected,
                page = cfg.PageName, instagram = cfg.IgUsername, adAccount = cfg.AdAccountName, hasAds = !string.IsNullOrWhiteSpace(cfg.AdAccountId), currency = cfg.Currency,
                unread = await _db.SocialConversations.CountAsync(c => c.Unread > 0, ct),
                formsToday = await _db.AdLeads.CountAsync(a => a.ReceivedAt >= today, ct),
                canManage = level >= Pages.Edit,
                isAdmin = User.IsAdmin(),
                me = User.AgentIdOf(),
            });
        }

        // ─── Messages ───

        [HttpGet("conversations")]
        public async Task<IActionResult> Conversations([FromQuery] string? channel, [FromQuery] string? filter, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 30, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var me = User.AgentIdOf();
            var all = _db.SocialConversations.AsNoTracking().AsQueryable();
            if (channel is "messenger" or "instagram") all = all.Where(c => c.Channel == channel);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                all = all.Where(c => c.Name.ToLower().Contains(s) || (c.Username != null && c.Username.ToLower().Contains(s)) || (c.Phone != null && c.Phone.Contains(s)) || (c.LastMessage != null && c.LastMessage.ToLower().Contains(s)));
            }
            var counts = new
            {
                open = await all.CountAsync(c => c.Status == "open", ct),
                unread = await all.CountAsync(c => c.Unread > 0, ct),
                mine = await all.CountAsync(c => c.AssignedTo == me && c.Status == "open", ct),
                done = await all.CountAsync(c => c.Status == "done", ct),
            };
            var list = filter switch
            {
                "unread" => all.Where(c => c.Unread > 0),
                "mine" => all.Where(c => c.AssignedTo == me && c.Status == "open"),
                "leads" => all.Where(c => c.LeadId != null),
                "done" => all.Where(c => c.Status == "done"),
                "all" => all,
                _ => all.Where(c => c.Status == "open"),
            };
            var total = await list.CountAsync(ct);
            var rows = await list.OrderByDescending(c => c.Unread > 0).ThenByDescending(c => c.LastMessageAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var names = await NamesAsync(rows.Select(r => r.AssignedTo), ct);
            var lids = rows.Where(r => r.LeadId != null).Select(r => r.LeadId!.Value).ToList();
            var leads = lids.Count == 0 ? new Dictionary<Guid, string>() : await _db.Leads.AsNoTracking().Where(l => lids.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            return Ok(new
            {
                items = rows.Select(c => new
                {
                    id = c.Id, channel = c.Channel, name = c.Name, username = c.Username, phone = c.Phone, status = c.Status, unread = c.Unread,
                    lastMessage = c.LastMessage, lastDirection = c.LastDirection, lastMessageAt = c.LastMessageAt, windowOpen = WindowOpen(c),
                    assignedTo = c.AssignedTo, assignedName = c.AssignedTo != null ? names.GetValueOrDefault(c.AssignedTo) : null,
                    leadId = c.LeadId, leadStatus = c.LeadId != null ? leads.GetValueOrDefault(c.LeadId.Value) : null,
                }),
                total, page, pageSize, counts,
            });
        }

        [HttpGet("conversations/{id:guid}")]
        public async Task<IActionResult> Conversation(Guid id, CancellationToken ct)
        {
            var c = await _db.SocialConversations.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var msgs = await _db.SocialMessages.AsNoTracking().Where(m => m.ConversationId == id).OrderByDescending(m => m.CreatedAt).Take(300).ToListAsync(ct);
            msgs.Reverse();
            var names = await NamesAsync(msgs.Select(m => m.SentBy).Append(c.AssignedTo), ct);
            var lead = c.LeadId != null ? await _db.Leads.AsNoTracking().Where(l => l.Id == c.LeadId).Select(l => new { id = l.Id, name = l.Name, phone = l.Phone, status = l.Status, source = l.Source }).FirstOrDefaultAsync(ct) : null;
            return Ok(new
            {
                conversation = new
                {
                    id = c.Id, channel = c.Channel, name = c.Name, username = c.Username, phone = c.Phone, status = c.Status, unread = c.Unread,
                    assignedTo = c.AssignedTo, assignedName = c.AssignedTo != null ? names.GetValueOrDefault(c.AssignedTo) : null,
                    lastInboundAt = c.LastInboundAt, createdAt = c.CreatedAt,
                },
                windowOpen = WindowOpen(c),
                windowClosesAt = c.LastInboundAt?.AddHours(24),
                lead,
                messages = msgs.Select(m => new
                {
                    id = m.Id, at = m.CreatedAt, direction = m.Direction, type = m.Type, text = m.Text, status = m.Status, error = m.Error,
                    byName = m.SentBy != null ? names.GetValueOrDefault(m.SentBy) : null,
                }),
            });
        }

        [HttpPost("conversations/{id:guid}/read")]
        public async Task<IActionResult> Read(Guid id, CancellationToken ct)
        {
            var c = await _db.SocialConversations.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            c.Unread = 0;
            var me = User.AgentIdOf();
            var refs = new List<string> { c.Id.ToString() };
            if (c.LeadId != null) refs.Add(c.LeadId.Value.ToString());
            foreach (var n in await _db.Notifications.Where(n => n.UserId == me && n.Kind == "lead" && n.ReadAt == null && n.RefId != null && refs.Contains(n.RefId)).ToListAsync(ct))
                n.ReadAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("conversations/{id:guid}/reply")]
        [PageAccess(Pages.Social, Level = Pages.Edit)]
        public async Task<IActionResult> Reply(Guid id, [FromBody] SocialReplyDto dto, CancellationToken ct)
        {
            var c = await _db.SocialConversations.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var text = (dto.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Write a message first." });
            if (text.Length > (c.Channel == "instagram" ? 1000 : 2000)) return BadRequest(new { message = "That's too long for one message." });
            if (!WindowOpen(c)) return BadRequest(new { message = $"It's been more than 24 hours since they last wrote, so {(c.Channel == "instagram" ? "Instagram" : "Facebook")} won't deliver a reply from here. Answer in Meta Business Suite, or wait for them to write again.", windowClosed = true });
            var me = User.AgentIdOf();
            var msg = await _meta.ReplyAsync(c, text, me, ct);
            if (msg.Status == "sent")
            {
                c.Unread = 0;
                if (c.LeadId != null && await _db.Leads.FirstOrDefaultAsync(x => x.Id == c.LeadId, ct) is { } l)
                {
                    var hadOwner = l.OwnerId != null;
                    LeadInbox.Touch(l, me, true);
                    if (!hadOwner && l.OwnerId == me) _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "owner", Text = $"Took this lead (replied on {(c.Channel == "instagram" ? "Instagram" : "Facebook")})", By = me });
                    l.LastMessage = "You: " + LeadInbox.Shorten(text, 150);
                }
            }
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return BadRequest(new { message = msg.Error ?? "Facebook didn't accept the message." });
            return Ok(new { id = msg.Id });
        }

        /// <summary>Turns the person into a lead with the phone number they gave (or links them to their existing lead).</summary>
        [HttpPost("conversations/{id:guid}/lead")]
        [PageAccess(Pages.Social, Level = Pages.Edit)]
        public async Task<IActionResult> MakeLead(Guid id, [FromBody] SocialLeadDto dto, CancellationToken ct)
        {
            var c = await _db.SocialConversations.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var phone = LeadInbox.NormalizePhone(dto.Phone);
            if (phone == null) return BadRequest(new { message = "Enter their 10-digit mobile number." });
            var name = (dto.Name ?? "").Trim();
            if (name.Length > 120) return BadRequest(new { message = "Name is too long." });
            var (lead, isNew) = await _meta.LinkLeadAsync(c, phone, name.Length > 0 ? name : null, User.AgentIdOf(), ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { leadId = lead.Id, isNew });
        }

        [HttpPatch("conversations/{id:guid}")]
        [PageAccess(Pages.Social, Level = Pages.Edit)]
        public async Task<IActionResult> Update(Guid id, [FromBody] SocialUpdateDto dto, CancellationToken ct)
        {
            var c = await _db.SocialConversations.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            if (dto.Status != null)
            {
                if (dto.Status is not ("open" or "done")) return BadRequest(new { message = "Unknown status." });
                c.Status = dto.Status;
                if (dto.Status == "done") c.Unread = 0;
            }
            if (dto.AssignedTo != null)
            {
                if (dto.AssignedTo == "") c.AssignedTo = null;
                else if (!await _db.Agents.AnyAsync(a => a.AgentId == dto.AssignedTo && a.IsActive, ct)) return BadRequest(new { message = "Unknown person." });
                else c.AssignedTo = dto.AssignedTo;
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ─── Lead Ads forms ───

        [HttpGet("forms")]
        public async Task<IActionResult> Forms([FromQuery] string? platform, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var all = _db.AdLeads.AsNoTracking().AsQueryable();
            if (platform is "fb" or "ig") all = all.Where(a => a.Platform == platform);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                all = all.Where(a => (a.Name != null && a.Name.ToLower().Contains(s)) || (a.Phone != null && a.Phone.Contains(s)) || (a.CampaignName != null && a.CampaignName.ToLower().Contains(s)) || (a.FormName != null && a.FormName.ToLower().Contains(s)));
            }
            var total = await all.CountAsync(ct);
            var rows = await all.OrderByDescending(a => a.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var lids = rows.Where(r => r.LeadId != null).Select(r => r.LeadId!.Value).ToList();
            var leads = lids.Count == 0 ? new() : await _db.Leads.AsNoTracking().Where(l => lids.Contains(l.Id)).Select(l => new { l.Id, l.Status, l.OwnerId }).ToDictionaryAsync(l => l.Id, ct);
            var owners = await NamesAsync(leads.Values.Select(l => l.OwnerId), ct);
            var since7 = DateTime.UtcNow.AddDays(-7);
            var week = await _db.AdLeads.AsNoTracking().Where(a => a.CreatedAt >= since7).GroupBy(a => a.Platform).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
            return Ok(new
            {
                items = rows.Select(a => new
                {
                    id = a.Id, platform = a.Platform, name = a.Name, phone = a.Phone, at = a.CreatedAt, form = a.FormName, campaign = a.CampaignName, ad = a.AdName,
                    organic = a.IsOrganic, error = a.Error,
                    answers = MetaService.Answers(a.FieldsJson).Select(x => new { q = x.Q, a = x.A }),
                    leadId = a.LeadId,
                    leadStatus = a.LeadId != null && leads.TryGetValue(a.LeadId.Value, out var l) ? l.Status : null,
                    owner = a.LeadId != null && leads.TryGetValue(a.LeadId.Value, out var l2) && l2.OwnerId != null ? owners.GetValueOrDefault(l2.OwnerId) : null,
                }),
                total, page, pageSize,
                week = new { fb = week.FirstOrDefault(w => w.Key == "fb")?.N ?? 0, ig = week.FirstOrDefault(w => w.Key == "ig")?.N ?? 0 },
            });
        }

        /// <summary>Fetches form submissions Meta has that the CRM doesn't (e.g. from before it was connected).</summary>
        [HttpPost("forms/sync")]
        [PageAccess(Pages.Social, Level = Pages.Edit)]
        public async Task<IActionResult> SyncForms([FromQuery] int days = 30, CancellationToken ct = default)
        {
            var (added, error) = await _meta.SyncLeadFormsAsync(days, ct);
            if (error != null && added == 0) return BadRequest(new { message = error });
            return Ok(new { added, warning = error });
        }

        // ─── Ads ───

        /// <param name="from">yyyy-MM-dd (India time); default 30 days ago.</param>
        [HttpGet("ads")]
        public async Task<IActionResult> Ads([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            var f = DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var a) ? a : today.AddDays(-29);
            var t = DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var b) ? b : today;
            if (t > today) t = today;
            if (f > t) return BadRequest(new { message = "The start date is after the end date." });
            if (t.DayNumber - f.DayNumber > 366) return BadRequest(new { message = "Pick up to a year." });
            var (rows, currency, error) = await _meta.AdsAsync(f, t, ct);
            var totals = new
            {
                spend = rows.Sum(r => r.Spend), impressions = rows.Sum(r => r.Impressions), clicks = rows.Sum(r => r.Clicks),
                metaLeads = rows.Sum(r => r.MetaLeads), chats = rows.Sum(r => r.Chats), crmLeads = rows.Sum(r => r.CrmLeads), arrived = rows.Sum(r => r.Arrived),
            };
            var leadsForCost = totals.metaLeads > 0 ? totals.metaLeads : totals.crmLeads;
            return Ok(new
            {
                from = f.ToString("yyyy-MM-dd"), to = t.ToString("yyyy-MM-dd"), currency, error, rows, totals,
                costPerLead = leadsForCost > 0 && totals.spend > 0 ? Math.Round(totals.spend / leadsForCost, 2) : (decimal?)null,
                costPerArrival = totals.arrived > 0 && totals.spend > 0 ? Math.Round(totals.spend / totals.arrived, 2) : (decimal?)null,
            });
        }
    }
}
