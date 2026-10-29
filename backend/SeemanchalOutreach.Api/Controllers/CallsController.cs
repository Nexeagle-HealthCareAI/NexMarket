using System;
using System.Collections.Generic;
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
    public class LogCallDto
    {
        public string ContactClientId { get; set; } = string.Empty;
        public string Outcome { get; set; } = string.Empty;          // connected | no_answer | call_later | wrong_number
        public List<string> Responses { get; set; } = new();          // refer | patient_now | doctor_info | camp | complaint | not_interested
        public string? Note { get; set; }
        public DateTime? CallBackAt { get; set; }
    }

    public class SetImportantDto
    {
        public bool IsImportant { get; set; }
    }

    /// <summary>Daily calls: cyclic calling of every partner by the marketing team.</summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Calls)]
    [Route("api/v1/calls")]
    public class CallsController : ControllerBase
    {
        public static readonly Dictionary<string, string> ResponseLabels = new()
        {
            ["refer"] = "Will refer patients",
            ["patient_now"] = "Has a patient now",
            ["doctor_info"] = "Wants doctor info",
            ["camp"] = "Interested in a camp",
            ["complaint"] = "Has a complaint",
            ["not_interested"] = "Not interested now",
        };

        private static readonly string[] Outcomes = { "connected", "no_answer", "call_later", "wrong_number" };

        private readonly IMarketingDbContext _db;
        private readonly CallCycleService _cycles;
        private readonly ILiveEvents _live;

        public CallsController(IMarketingDbContext db, CallCycleService cycles, ILiveEvents live)
        {
            _db = db;
            _cycles = cycles;
            _live = live;
        }

        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken ct)
        {
            var cycle = await _cycles.EnsureCurrentCycleAsync(ct);
            var now = DateTime.UtcNow;
            var today = IstClock.TodayStartUtc;
            var endOfToday = CallCycleService.EndOfTodayUtc;
            var callable = _cycles.Callable();

            int total = await callable.CountAsync(ct);
            var calledIds = _db.CallLogs.Where(l => l.CycleNumber == cycle.Number).Select(l => l.ContactClientId).Distinct();
            int calledInCycle = await calledIds.CountAsync(ct);
            int connected = await _db.CallLogs.Where(l => l.CycleNumber == cycle.Number && l.Outcome == "connected").Select(l => l.ContactClientId).Distinct().CountAsync(ct);
            int retry = await callable.CountAsync(c => c.LastCallOutcome == "no_answer" && c.LastCallCycleNumber == cycle.Number && c.NextCallAt > now, ct);
            int callBack = await callable.CountAsync(c => c.LastCallOutcome == "call_later" && c.NextCallAt > now, ct);
            int notCalled = await callable.CountAsync(c => !calledIds.Contains(c.ClientId), ct);

            int dueToday = await callable.CountAsync(c => c.NextCallAt == null || c.NextCallAt < endOfToday, ct);
            int doneToday = await _db.CallLogs.CountAsync(l => l.CreatedAt >= today, ct);
            int important = await callable.CountAsync(c => c.IsImportant, ct);
            int needsVisit = await _db.Contacts.CountAsync(c => c.NeedsVisit && !c.IsMerged, ct);

            return Ok(new
            {
                cycle = new { cycle.Number, startDate = cycle.StartDate, endDate = cycle.EndDate, nextStart = cycle.EndDate.AddDays(1) },
                settings = _cycles.Settings,
                total,
                calledInCycle,
                connected,
                retry,
                callBack,
                notCalled,
                dueToday,
                doneToday,
                important,
                needsVisit,
            });
        }

        /// <summary>filter: due (default) | retry | important | done | needs_visit</summary>
        [HttpGet("queue")]
        public async Task<IActionResult> Queue([FromQuery] string filter = "due", [FromQuery] string? search = null, CancellationToken ct = default)
        {
            var cycle = await _cycles.EnsureCurrentCycleAsync(ct);
            var today = IstClock.TodayStartUtc;
            var endOfToday = CallCycleService.EndOfTodayUtc;
            IQueryable<OutreachContact> q = _cycles.Callable();

            switch (filter)
            {
                case "retry":
                    q = q.Where(c => c.LastCallOutcome == "no_answer" && c.NextCallAt != null && c.NextCallAt < endOfToday);
                    break;
                case "important":
                    q = q.Where(c => c.IsImportant);
                    break;
                case "done":
                    var doneIds = _db.CallLogs.Where(l => l.CreatedAt >= today).Select(l => l.ContactClientId);
                    q = _db.Contacts.Where(c => doneIds.Contains(c.ClientId));
                    break;
                case "needs_visit":
                    q = _db.Contacts.Where(c => c.NeedsVisit && !c.IsMerged);
                    break;
                default:
                    // EF's null semantics make `!= "no_answer"` also match partners never called (null).
                    q = q.Where(c => (c.NextCallAt == null || c.NextCallAt < endOfToday) && c.LastCallOutcome != "no_answer");
                    break;
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(c => c.Name.ToLower().Contains(s) || (c.Phone != null && c.Phone.Contains(s)));
            }

            var rows = await q
                .OrderByDescending(c => c.IsImportant)
                .ThenBy(c => c.NextCallAt)
                .ThenBy(c => c.Name)
                .Take(200)
                .Select(c => new
                {
                    c.ClientId, c.Name, c.Role, c.Profession, c.Phone, c.PanchayatId, c.IsImportant,
                    c.NextCallAt, c.CallAttempts, c.LastCallOutcome, c.LastCalledAt, c.LastConnectedAt, c.NeedsVisit,
                })
                .ToListAsync(ct);

            var blocks = await BlocksAsync(rows.Select(r => r.PanchayatId), ct);
            var doneTodaySet = (await _db.CallLogs.Where(l => l.CreatedAt >= today).Select(l => l.ContactClientId).Distinct().ToListAsync(ct)).ToHashSet();

            return Ok(rows.Select(r =>
            {
                string tag;
                if (doneTodaySet.Contains(r.ClientId)) tag = "Done today";
                else if (r.NeedsVisit) tag = "Needs a visit";
                else if (r.LastCallOutcome == "no_answer") tag = $"Retry · attempt {r.CallAttempts + 1}";
                else if (r.LastCallOutcome == "call_later") tag = "Call back today";
                else if (r.IsImportant) tag = "Important";
                else tag = r.LastCalledAt == null ? "Never called" : "Due this cycle";
                return new
                {
                    r.ClientId, r.Name, type = r.Role, r.Profession, r.Phone, r.IsImportant,
                    block = blocks.GetValueOrDefault(r.PanchayatId),
                    r.NextCallAt, r.CallAttempts, r.LastCallOutcome, r.LastCalledAt, r.LastConnectedAt, r.NeedsVisit,
                    doneToday = doneTodaySet.Contains(r.ClientId),
                    tag,
                };
            }));
        }

        /// <summary>Everything the caller needs on one partner: details, patients sent, payments, call history.</summary>
        [HttpGet("contact/{clientId}")]
        public async Task<IActionResult> Contact(string clientId, CancellationToken ct)
        {
            var c = await _db.Contacts.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (c == null) return NotFound();

            var panchayat = await _db.Panchayats.AsNoTracking().FirstOrDefaultAsync(p => p.PanchayatId == c.PanchayatId, ct);
            var agent = await _db.Agents.AsNoTracking().Where(a => a.AgentId == c.AgentId).Select(a => a.Name).FirstOrDefaultAsync(ct);

            var patients = await _db.Referrals.AsNoTracking()
                .Where(r => r.ContactId == clientId)
                .OrderByDescending(r => r.CreatedAt)
                .Select(r => new { r.ClientId, r.PatientName, r.Department, r.Status, r.CreatedAt })
                .ToListAsync(ct);

            var payments = await _db.PartnerPayments.AsNoTracking()
                .Where(p => p.ContactClientId == clientId)
                .OrderByDescending(p => p.CreatedAt)
                .ToListAsync(ct);

            var calls = await _db.CallLogs.AsNoTracking()
                .Where(l => l.ContactClientId == clientId)
                .OrderByDescending(l => l.CreatedAt)
                .Take(30)
                .ToListAsync(ct);
            var callerIds = calls.Select(l => l.CalledBy).Distinct().ToList();
            var callers = await _db.Agents.AsNoTracking().Where(a => callerIds.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);

            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == c.AgentId && v.PanchayatId == c.PanchayatId)
                .OrderByDescending(v => v.CheckInAt)
                .Take(5)
                .Select(v => new { v.CheckInAt })
                .ToListAsync(ct);

            var notes = await _db.ContactNotes.AsNoTracking()
                .Where(n => n.ContactClientId == clientId)
                .OrderByDescending(n => n.CreatedAt).Take(20)
                .Select(n => new { n.Text, n.Source, n.CreatedAt, n.AgentId })
                .ToListAsync(ct);

            int admitted = patients.Count(p => p.Status == "admitted" || p.Status == "converted" || p.Status == "procedure" || p.Status == "discharged");
            decimal due = payments.Where(p => p.Status == "pending_approval" || p.Status == "approved").Sum(p => p.Amount);

            return Ok(new
            {
                c.ClientId, c.Name, type = c.Role, c.Profession, c.Phone, c.IsImportant, c.Status, c.Comments,
                priority = c.Priority, c.FollowUpDate,
                notes = notes.Select(n => new { n.Text, n.Source, n.CreatedAt, by = n.AgentId == c.AgentId ? agent : n.AgentId }),
                block = panchayat?.Block, panchayat = panchayat?.Name, district = panchayat?.District,
                agentId = c.AgentId, agentName = agent,
                c.CallAttempts, c.LastCallOutcome, c.LastCalledAt, c.LastConnectedAt, c.NextCallAt, c.NeedsVisit, c.WhatsappOptOut,
                patientsSent = patients.Count,
                admitted,
                amountDue = due,
                patients = patients.Select(p => new { p.ClientId, p.PatientName, p.Department, status = p.Status == "converted" ? "admitted" : p.Status, label = ReferralsController.StageLabel(p.Status), p.CreatedAt }),
                payments = payments.Select(p => new { p.Id, p.Purpose, p.Period, p.Amount, p.Status, p.CreatedAt, p.PaidAt }),
                history = calls.Select(l => new
                {
                    l.Outcome,
                    responses = (l.Responses ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(r => ResponseLabels.GetValueOrDefault(r, r)),
                    l.Note, l.Attempt, l.CreatedAt,
                    by = callers.GetValueOrDefault(l.CalledBy, l.CalledBy),
                }),
                recentVisits = visits.Select(v => v.CheckInAt),
            });
        }

        [HttpPost]
        public async Task<IActionResult> Log([FromBody] LogCallDto dto, CancellationToken ct)
        {
            var outcome = (dto.Outcome ?? "").Trim().ToLowerInvariant();
            if (!Outcomes.Contains(outcome)) return BadRequest("Pick how the call went.");
            if (outcome == "call_later" && dto.CallBackAt == null) return BadRequest("Pick when to call back.");

            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == dto.ContactClientId, ct);
            if (contact == null) return NotFound();

            var cycle = await _cycles.EnsureCurrentCycleAsync(ct);
            int attempt = _cycles.ApplyOutcome(contact, cycle, outcome, dto.CallBackAt);

            var responses = (dto.Responses ?? new List<string>()).Where(r => ResponseLabels.ContainsKey(r)).Distinct().ToList();
            if (outcome == "connected" && contact.Status == "Lead") contact.Status = "Contacted";

            _db.CallLogs.Add(new CallLog
            {
                ContactClientId = contact.ClientId,
                CycleNumber = cycle.Number,
                CalledBy = User.AgentIdOf(),
                Outcome = outcome,
                Responses = responses.Count > 0 ? string.Join(",", responses) : null,
                Note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim(),
                Attempt = attempt,
                CallBackAt = outcome == "call_later" ? contact.NextCallAt : null,
                CreatedAt = DateTime.UtcNow,
            });
            await _db.SaveChangesAsync(ct);

            string what = outcome switch
            {
                "connected" => responses.Count > 0 ? $"connected · {ResponseLabels[responses[0]].ToLower()}" : "connected",
                "no_answer" => "not reachable, retry tomorrow",
                "call_later" => "asked for a call back",
                _ => "wrong number",
            };
            await _live.PublishAsync(new LiveEvent { Kind = "call", Text = $"Call to {contact.Name}: {what}", RefId = contact.ClientId });

            return Ok(new
            {
                contact.ClientId,
                contact.NextCallAt,
                contact.CallAttempts,
                contact.NeedsVisit,
                attempt,
                maxAttempts = _cycles.Settings.MaxAttempts,
            });
        }

        [HttpPut("contact/{clientId}/important")]
        public async Task<IActionResult> SetImportant(string clientId, [FromBody] SetImportantDto dto, CancellationToken ct)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, ct);
            if (contact == null) return NotFound();
            contact.IsImportant = dto.IsImportant;
            contact.LastModifiedAt = DateTime.UtcNow;
            // Important partners are called every week: pull the next call forward if it's further out.
            if (dto.IsImportant && contact.LastConnectedAt != null)
            {
                var weekly = IstClock.StartOfDayUtc(contact.LastConnectedAt.Value).AddDays(_cycles.Settings.ImportantEveryDays);
                if (contact.NextCallAt == null || contact.NextCallAt > weekly) contact.NextCallAt = weekly;
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { contact.ClientId, contact.IsImportant, contact.NextCallAt });
        }

        [HttpPost("contact/{clientId}/visit-done")]
        public async Task<IActionResult> ClearNeedsVisit(string clientId, CancellationToken ct)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, ct);
            if (contact == null) return NotFound();
            contact.NeedsVisit = false;
            await _db.SaveChangesAsync(ct);
            return Ok();
        }

        private async Task<Dictionary<string, string>> BlocksAsync(IEnumerable<string> panchayatIds, CancellationToken ct)
        {
            var ids = panchayatIds.Distinct().ToList();
            return await _db.Panchayats.AsNoTracking()
                .Where(p => ids.Contains(p.PanchayatId))
                .ToDictionaryAsync(p => p.PanchayatId, p => p.Block, ct);
        }
    }
}
