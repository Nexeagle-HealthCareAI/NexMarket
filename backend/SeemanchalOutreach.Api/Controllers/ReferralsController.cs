using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [PageAccess(Pages.Pipeline, Pages.Desk)]
    public class ReferralsController : ControllerBase
    {
        private readonly IMarketingDbContext _context;
        private readonly ILiveEvents _live;

        private readonly INotifier _notifier;
        private readonly IAppSettings _settings;

        public ReferralsController(IMarketingDbContext context, ILiveEvents live, INotifier notifier, IAppSettings settings)
        {
            _context = context;
            _live = live;
            _notifier = notifier;
            _settings = settings;
        }

        /// <summary>Stages a referral moves through. "pending" = referred; "converted" is the old name for admitted.</summary>
        public static readonly string[] Stages = { "pending", "arrived", "opd", "admitted", "procedure", "discharged", "lost" };

        public static string StageLabel(string? status) => status switch
        {
            "pending" => "Referred",
            "arrived" => "Arrived",
            "opd" => "Seen in OPD",
            "admitted" or "converted" => "Admitted",
            "procedure" => "Procedure done",
            "discharged" => "Discharged",
            "lost" => "Did not come",
            _ => status ?? "",
        };

        public class UpdateReferralStatusDto
        {
            public string Status { get; set; } = string.Empty;
            public string? Notes { get; set; }
        }

        [HttpGet]
        public async Task<IActionResult> GetReferrals(
            [FromQuery] string? status,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] string? search = null,
            [FromQuery] string? department = null,
            [FromQuery] int? days = null,
            [FromQuery] string? agentId = null)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 1000);

            var query = _context.Referrals.AsNoTracking().AsQueryable();

            if (!string.IsNullOrEmpty(status))
            {
                var statuses = status.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                if (statuses.Contains("admitted")) statuses.Add("converted");
                query = query.Where(r => statuses.Contains(r.Status));
            }

            if (!string.IsNullOrWhiteSpace(department))
            {
                query = query.Where(r => r.Department == department);
            }

            if (days is > 0)
            {
                var since = IstClock.TodayStartUtc.AddDays(-Math.Min(days.Value, 3650));
                query = query.Where(r => r.CreatedAt >= since || (r.UpdatedAt != null && r.UpdatedAt >= since));
            }

            if (!string.IsNullOrWhiteSpace(agentId))
            {
                query = query.Where(r => r.AgentId == agentId);
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var searchLower = search.ToLower();
                query = query.Where(r => r.PatientName.ToLower().Contains(searchLower) || r.ClientPhone != null && r.ClientPhone.Contains(searchLower));
            }

            var totalCount = await query.CountAsync();

            var referrals = await query
                .OrderByDescending(r => r.ReferralDate ?? r.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return Ok(new { TotalCount = totalCount, Items = await EnrichAsync(referrals) });
        }

        /// <summary>Front desk: find a referred patient by phone, name or referral code.</summary>
        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string q)
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 3) return Ok(Array.Empty<object>());
            var term = q.Trim().ToLower();
            var digits = new string(term.Where(char.IsDigit).ToArray());

            var query = _context.Referrals.AsNoTracking().Where(r =>
                r.PatientName.ToLower().Contains(term)
                || r.ClientId.ToLower().StartsWith(term)
                || (digits.Length >= 4 && r.ClientPhone != null && r.ClientPhone.Contains(digits)));

            var list = await query.OrderByDescending(r => r.CreatedAt).Take(20).ToListAsync();
            return Ok(await EnrichAsync(list));
        }

        /// <summary>Front desk: referrals from the last 7 days whose patient hasn't arrived yet.</summary>
        [HttpGet("expected")]
        public async Task<IActionResult> Expected()
        {
            var since = IstClock.TodayStartUtc.AddDays(-7);
            var list = await _context.Referrals.AsNoTracking()
                .Where(r => r.Status == "pending" && r.CreatedAt >= since)
                .OrderByDescending(r => r.Urgent).ThenBy(r => r.CreatedAt)
                .Take(50)
                .ToListAsync();
            var arrivedToday = await _context.Referrals.CountAsync(r => r.ArrivedAt >= IstClock.TodayStartUtc);
            return Ok(new { arrivedToday, items = await EnrichAsync(list) });
        }

        /// <summary>Numbers for the top of the board.</summary>
        [HttpGet("summary")]
        public async Task<IActionResult> Summary()
        {
            var today = IstClock.TodayStartUtc;
            var month = IstClock.MonthStartUtc;
            var cutoff48 = DateTime.UtcNow.AddHours(-48);
            return Ok(new
            {
                expected = await _context.Referrals.CountAsync(r => r.Status == "pending" && r.CreatedAt >= today.AddDays(-7)),
                late = await _context.Referrals.CountAsync(r => r.Status == "pending" && r.CreatedAt < cutoff48 && r.CreatedAt >= today.AddDays(-30)),
                referredToday = await _context.Referrals.CountAsync(r => r.CreatedAt >= today),
                arrivedToday = await _context.Referrals.CountAsync(r => r.ArrivedAt >= today),
                admittedToday = await _context.Referrals.CountAsync(r => r.AdmittedAt >= today),
                inHospital = await _context.Referrals.CountAsync(r => (r.Status == "admitted" || r.Status == "converted" || r.Status == "procedure") && r.UpdatedAt >= today.AddDays(-60)),
                admittedMonth = await _context.Referrals.CountAsync(r => r.AdmittedAt >= month),
                referredMonth = await _context.Referrals.CountAsync(r => r.CreatedAt >= month),
            });
        }

        /// <summary>One referral (e.g. opened from a notification link).</summary>
        [HttpGet("{clientId}")]
        public async Task<IActionResult> One(string clientId)
        {
            var r = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId);
            if (r == null) return NotFound("Referral not found");
            return Ok((await EnrichAsync(new List<PatientReferral> { r }))[0]);
        }

        [HttpGet("{clientId}/history")]
        public async Task<IActionResult> History(string clientId)
        {
            var referral = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(r => r.ClientId == clientId);
            if (referral == null) return NotFound("Referral not found");

            var entries = await _context.ReferralStatusEntries.AsNoTracking()
                .Where(e => e.ReferralClientId == clientId)
                .OrderByDescending(e => e.ChangedAt)
                .ToListAsync();
            var names = await NamesAsync(entries.Select(e => e.ChangedBy).Append(referral.AgentId));

            var items = entries.Select(e => new
            {
                status = e.Status,
                label = StageLabel(e.Status),
                note = e.Note,
                by = names.GetValueOrDefault(e.ChangedBy, e.ChangedBy),
                at = e.ChangedAt,
            }).ToList<object>();
            items.Add(new
            {
                status = "pending",
                label = "Referred",
                note = (string?)null,
                by = names.GetValueOrDefault(referral.AgentId, referral.AgentId),
                at = referral.CreatedAt,
            });
            return Ok(items);
        }

        [HttpPut("{clientId}/status")]
        public async Task<IActionResult> UpdateStatus(string clientId, [FromBody] UpdateReferralStatusDto dto)
        {
            var status = (dto.Status ?? "").Trim().ToLowerInvariant();
            if (status == "converted") status = "admitted";
            if (status == "referred") status = "pending";
            if (!Stages.Contains(status)) return BadRequest("Unknown status.");

            var referral = await _context.Referrals.FirstOrDefaultAsync(r => r.ClientId == clientId);
            if (referral == null) return NotFound("Referral not found");

            var now = DateTime.UtcNow;
            bool hadArrived = referral.ArrivedAt != null, hadAdmitted = referral.AdmittedAt != null;
            referral.Status = status;
            if (status == "arrived" && referral.ArrivedAt == null) referral.ArrivedAt = now;
            if ((status == "opd" || status == "admitted" || status == "procedure" || status == "discharged") && referral.ArrivedAt == null) referral.ArrivedAt = now;
            if ((status == "admitted" || status == "procedure" || status == "discharged") && referral.AdmittedAt == null) referral.AdmittedAt = now;

            if (!string.IsNullOrEmpty(dto.Notes))
            {
                var prefix = string.IsNullOrEmpty(referral.Notes) ? "" : referral.Notes + "\n\n";
                referral.Notes = prefix + $"[Hospital - {IstClock.NowIst:yyyy-MM-dd}]: {dto.Notes}";
            }

            referral.UpdatedAt = now;

            _context.ReferralStatusEntries.Add(new ReferralStatusEntry
            {
                ReferralClientId = clientId,
                Status = status,
                Note = dto.Notes,
                ChangedBy = User.AgentIdOf(),
                ChangedAt = now,
            });

            // The agent's incentive under the hospital's rule (still needs an admin's approval).
            await PatientMoney.ApplyRuleAsync(_context, _settings, referral,
                !hadArrived && referral.ArrivedAt != null, !hadAdmitted && referral.AdmittedAt != null, User.AgentIdOf(), HttpContext.RequestAborted);

            await _context.SaveChangesAsync();

            string kind = status switch
            {
                "arrived" => "arrived",
                "opd" => "opd",
                "admitted" or "procedure" => "admit",
                "discharged" => "discharged",
                "lost" => "lost",
                _ => "referral",
            };
            string dept = string.IsNullOrWhiteSpace(referral.Department) ? "" : $" ({referral.Department})";
            await _live.PublishAsync(new LiveEvent
            {
                Kind = kind,
                Text = $"{referral.PatientName}{dept} marked {StageLabel(status).ToLower()}",
                RefId = clientId,
            });
            // The agent who referred the patient hears how it went.
            if (!string.IsNullOrEmpty(referral.AgentId))
            {
                _notifier.Notify(new NotifyJob
                {
                    To = new() { referral.AgentId }, Except = User.AgentIdOf(), Kind = "referral",
                    Title = $"{referral.PatientName}: {StageLabel(status)}",
                    Body = $"Your patient{dept} is now {StageLabel(status).ToLower()}.",
                    Link = $"referral:{clientId}", RefId = clientId,
                });
            }

            return Ok(new { message = "Status updated successfully" });
        }

        // ─── Money for one referred patient ─────────────────────────────────

        public class BillDto
        {
            public string Kind { get; set; } = "ipd";
            public decimal Amount { get; set; }
            public decimal Collected { get; set; }
            public string Scheme { get; set; } = "cash";
            public string? BillNumber { get; set; }
            public string? Note { get; set; }
            public DateTime? BilledOn { get; set; }
        }
        public class CollectDto { public decimal Collected { get; set; } public string? BillNumber { get; set; } public string? Note { get; set; } }
        public class VoidDto { public string Reason { get; set; } = ""; }
        public class ServicePaymentDto { public string Purpose { get; set; } = ""; public decimal Amount { get; set; } public string? Notes { get; set; } }

        /// <summary>
        /// Everything to do with money for this patient: what the hospital billed and collected, the partner's service
        /// payments for this patient (with approval and paid status), and the field agent's incentive.
        /// </summary>
        [HttpGet("{clientId}/money")]
        public async Task<IActionResult> Money(string clientId)
        {
            var ct = HttpContext.RequestAborted;
            var r = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (r == null) return NotFound("Referral not found");
            var bills = await _context.ReferralBills.AsNoTracking().Where(b => b.ReferralClientId == clientId).OrderBy(b => b.BilledOn).ToListAsync(ct);
            var pays = await _context.PartnerPayments.AsNoTracking().Where(p => p.ReferralClientId == clientId).OrderBy(p => p.CreatedAt).ToListAsync(ct);
            var incs = await _context.AgentIncentives.AsNoTracking().Where(i => i.ReferralClientId == clientId).OrderBy(i => i.CreatedAt).ToListAsync(ct);
            // The partner's payments overall, so the desk can see nothing for them is stuck.
            var partnerAll = await _context.PartnerPayments.AsNoTracking().Where(p => p.ContactClientId == r.ContactId && p.Status != "rejected")
                .Select(p => new { p.Status, p.Amount }).ToListAsync(ct);
            var names = await NamesAsync(bills.Select(b => b.CreatedBy).Concat(pays.Select(p => p.CreatedBy)).Concat(incs.Select(i => i.AgentId))
                .Concat(pays.SelectMany(p => new[] { p.CashAgentId, p.ProofBy, p.ReceivedConfirmedBy }).Where(x => x != null).Cast<string>()));
            string? name(string? id) => id == null ? null : names.GetValueOrDefault(id, id);
            var livePays = pays.Where(p => p.Status != "rejected").ToList();
            var active = bills.Where(b => b.Status == "active").ToList();
            var before = DateTime.UtcNow.AddDays(-7);
            return Ok(new
            {
                billed = active.Sum(b => b.Amount),
                collected = active.Sum(b => b.Collected),
                due = active.Sum(b => b.Amount - b.Collected),
                bills = bills.Select(b => new
                {
                    b.Id, b.Kind, kindLabel = PatientMoney.KindLabel(b.Kind), b.Amount, b.Collected, b.Scheme, schemeLabel = PatientMoney.SchemeLabel(b.Scheme),
                    b.BillNumber, b.Note, b.BilledOn, b.Status, b.VoidReason, by = names.GetValueOrDefault(b.CreatedBy, b.CreatedBy), b.CreatedAt,
                }),
                partnerPayments = pays.Select(p => new
                {
                    p.Id, p.Purpose, p.Amount, p.Status, p.Notes, p.CreatedAt, p.ApprovedAt, p.PaidAt, p.PaymentReference,
                    overdue = p.Status == "approved" && (p.DueDate ?? p.ApprovedAt ?? DateTime.UtcNow) < before,
                    by = names.GetValueOrDefault(p.CreatedBy, p.CreatedBy),
                    proof = PaymentProof.Info(p, name),
                }),
                // For this patient: everything the partner is to get, what is paid, what is still to pay.
                partnerForPatient = new
                {
                    total = livePays.Sum(p => p.Amount),
                    paid = livePays.Where(p => p.Status == "paid").Sum(p => p.Amount),
                    pending = livePays.Where(p => p.Status != "paid").Sum(p => p.Amount),
                    unconfirmed = livePays.Count(p => p.Status == "paid" && p.ReceivedConfirmedAt == null),
                },
                partnerOverall = new
                {
                    total = partnerAll.Sum(p => p.Amount),
                    paid = partnerAll.Where(p => p.Status == "paid").Sum(p => p.Amount),
                    open = partnerAll.Where(p => p.Status != "paid").Sum(p => p.Amount),
                },
                incentives = incs.Select(i => new
                {
                    i.Id, i.Reason, i.Amount, i.Status, i.Auto, i.CreatedAt, i.ApprovedAt, i.PaidAt, i.PaymentReference,
                    agent = names.GetValueOrDefault(i.AgentId, i.AgentId),
                }),
                purposes = PatientMoney.ServicePurposes,
            });
        }

        /// <summary>The desk records a bill for this patient (and how much was collected).</summary>
        [HttpPost("{clientId}/bills")]
        public async Task<IActionResult> AddBill(string clientId, [FromBody] BillDto dto)
        {
            var ct = HttpContext.RequestAborted;
            var r = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (r == null) return NotFound("Referral not found");
            if (!PatientMoney.BillKinds.Contains(dto.Kind)) return BadRequest("Pick what the bill is for.");
            if (!PatientMoney.Schemes.Contains(dto.Scheme)) return BadRequest("Pick how the patient pays.");
            if (dto.Amount <= 0 || dto.Amount > 10_000_000) return BadRequest("Enter the bill amount.");
            if (dto.Collected < 0 || dto.Collected > dto.Amount) return BadRequest("Collected can't be more than the bill.");
            var b = new ReferralBill
            {
                ReferralClientId = clientId, Kind = dto.Kind, Amount = Math.Round(dto.Amount, 2), Collected = Math.Round(dto.Collected, 2), Scheme = dto.Scheme,
                BillNumber = Clean(dto.BillNumber, 60), Note = Clean(dto.Note, 500),
                BilledOn = dto.BilledOn.HasValue ? DateTime.SpecifyKind(dto.BilledOn.Value, DateTimeKind.Utc) : DateTime.UtcNow,
                CreatedBy = User.AgentIdOf(),
            };
            _context.ReferralBills.Add(b);
            await _context.SaveChangesAsync(ct);
            return Ok(new { b.Id });
        }

        /// <summary>Records a later collection on a bill (e.g. the insurer paid), or fixes the bill number / note.</summary>
        [HttpPut("bills/{id:guid}")]
        public async Task<IActionResult> UpdateBill(Guid id, [FromBody] CollectDto dto)
        {
            var b = await _context.ReferralBills.FirstOrDefaultAsync(x => x.Id == id, HttpContext.RequestAborted);
            if (b == null) return NotFound();
            if (b.Status != "active") return BadRequest("This bill was voided.");
            if (dto.Collected < 0 || dto.Collected > b.Amount) return BadRequest("Collected can't be more than the bill.");
            b.Collected = Math.Round(dto.Collected, 2);
            if (dto.BillNumber != null) b.BillNumber = Clean(dto.BillNumber, 60);
            if (dto.Note != null) b.Note = Clean(dto.Note, 500);
            b.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync(HttpContext.RequestAborted);
            return Ok(new { b.Id });
        }

        /// <summary>A wrong bill is voided with a reason, never deleted, so the record stays complete.</summary>
        [HttpPost("bills/{id:guid}/void")]
        public async Task<IActionResult> VoidBill(Guid id, [FromBody] VoidDto dto)
        {
            var b = await _context.ReferralBills.FirstOrDefaultAsync(x => x.Id == id, HttpContext.RequestAborted);
            if (b == null) return NotFound();
            var reason = Clean(dto.Reason, 300);
            if (reason == null) return BadRequest("Say why this bill is wrong.");
            b.Status = "void";
            b.VoidReason = reason;
            b.VoidedBy = User.AgentIdOf();
            b.VoidedAt = DateTime.UtcNow;
            b.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync(HttpContext.RequestAborted);
            return Ok(new { b.Id, b.Status });
        }

        /// <summary>
        /// Asks for a payment to the referring partner for a service for this patient (travel, escort, ambulance…).
        /// It goes to Payments for an admin's approval like any other partner payment.
        /// </summary>
        [HttpPost("{clientId}/partner-payment")]
        public async Task<IActionResult> AddServicePayment(string clientId, [FromBody] ServicePaymentDto dto)
        {
            var ct = HttpContext.RequestAborted;
            var r = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (r == null) return NotFound("Referral not found");
            var purpose = (dto.Purpose ?? "").Trim();
            if (!PatientMoney.ServicePurposes.Contains(purpose)) return BadRequest("Pick the service the partner provided.");
            var notes = Clean(dto.Notes, 500);
            if (purpose == "Other service" && notes == null) return BadRequest("Describe the service.");
            if (dto.Amount <= 0 || dto.Amount > 100_000) return BadRequest("Enter the amount.");
            var partner = await _context.Contacts.AsNoTracking().Where(c => c.ClientId == r.ContactId).Select(c => c.Name).FirstOrDefaultAsync(ct);
            if (partner == null) return BadRequest("The referring partner wasn't found.");
            var p = new PartnerPayment
            {
                ContactClientId = r.ContactId, ReferralClientId = clientId, Purpose = purpose, Amount = Math.Round(dto.Amount, 2),
                Notes = notes == null ? $"For patient {r.PatientName}" : $"For patient {r.PatientName}: {notes}",
                Status = "pending_approval", CreatedBy = User.AgentIdOf(), CreatedAt = DateTime.UtcNow,
            };
            _context.PartnerPayments.Add(p);
            await _context.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "payment", Text = $"₹{p.Amount:N0} for {partner} ({purpose.ToLower()}) sent for approval", RefId = p.Id.ToString() });
            return Ok(new { p.Id });
        }

        private static string? Clean(string? v, int max)
        {
            var t = (v ?? "").Trim();
            return t.Length == 0 ? null : t.Length > max ? t[..max] : t;
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string> agentIds)
        {
            var ids = agentIds.Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
            return await _context.Agents.AsNoTracking()
                .Where(a => ids.Contains(a.AgentId))
                .ToDictionaryAsync(a => a.AgentId, a => a.Name);
        }

        private async Task<List<object>> EnrichAsync(List<PatientReferral> referrals)
        {
            var agents = await NamesAsync(referrals.Select(r => r.AgentId));

            var contactIds = referrals.Select(r => r.ContactId).Distinct().ToList();
            var contacts = await _context.Contacts.AsNoTracking()
                .Where(c => contactIds.Contains(c.ClientId))
                .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId })
                .ToListAsync();
            var panchayatIds = contacts.Select(c => c.PanchayatId).Distinct().ToList();
            var blocks = await _context.Panchayats.AsNoTracking()
                .Where(p => panchayatIds.Contains(p.PanchayatId))
                .ToDictionaryAsync(p => p.PanchayatId, p => p.Block);
            var contactMap = contacts.ToDictionary(c => c.ClientId);
            var money = await PatientMoney.TotalsAsync(_context, referrals.Select(r => r.ClientId).ToList(), HttpContext.RequestAborted);

            return referrals.Select(r =>
            {
                contactMap.TryGetValue(r.ContactId, out var c);
                money.TryGetValue(r.ClientId, out var m);
                return (object)new
                {
                    r.Id,
                    r.ClientId,
                    r.ContactId,
                    ContactName = c?.Name ?? "Unknown contact",
                    ContactRole = c?.Role,
                    Block = c != null ? blocks.GetValueOrDefault(c.PanchayatId) : null,
                    r.AgentId,
                    AgentName = agents.GetValueOrDefault(r.AgentId, "Unknown agent"),
                    r.PatientName,
                    r.PatientAge,
                    r.PatientSex,
                    r.Urgent,
                    r.Department,
                    r.Notes,
                    r.ClientPhone,
                    r.ReferralDate,
                    Status = r.Status == "converted" ? "admitted" : r.Status,
                    StageLabel = StageLabel(r.Status),
                    r.ArrivedAt,
                    r.AdmittedAt,
                    r.CreatedAt,
                    r.UpdatedAt,
                    // Where it came from, and how long it sat on the phone before it reached the server (no signal).
                    Source = r.DeviceId == "crm-leads" ? "leads" : r.DeviceId == "crm" ? "crm" : "app",
                    SyncDelayMinutes = r.DeviceId == "crm-leads" || r.DeviceId == "crm" ? (int?)null : Math.Max(0, (int)(r.ServerReceivedAt - r.CreatedAt).TotalMinutes),
                    r.ServerReceivedAt,
                    Money = m == null ? null : new
                    {
                        billed = m.Billed, collected = m.Collected,
                        payoutsPaid = m.PayoutsPaid, payoutsOpen = m.PayoutsOpen, payouts = m.PayoutsCount,
                        incentivesPaid = m.IncentivesPaid, incentivesOpen = m.IncentivesOpen,
                    },
                };
            }).ToList();
        }

        // ─── Link with the agents' app ───────────────────────────────────

        /// <summary>
        /// How well each field agent's phone is connected: when the app last talked to the server, whether push
        /// notifications can reach it, how long referrals waited on the phone before syncing, and stage changes
        /// made here since the phone last checked in (so the agent may not have seen them yet).
        /// </summary>
        [HttpGet("app-link")]
        public async Task<IActionResult> AppLink()
        {
            var now = DateTime.UtcNow;
            var since30 = now.AddDays(-30);
            var agents = (await _context.Agents.AsNoTracking().Where(a => a.IsActive)
                    .Select(a => new { a.AgentId, a.Name, a.Role, a.Block }).ToListAsync())
                .Where(a => !RoleChecks.IsDashboardRole(a.Role)).ToList();
            var ids = agents.Select(a => a.AgentId).ToList();

            var sessions = await _context.AgentRefreshTokens.AsNoTracking()
                .Where(t => ids.Contains(t.AgentId) && t.RevokedAt == null)
                .GroupBy(t => t.AgentId).Select(g => new { AgentId = g.Key, Seen = g.Max(t => t.LastSeenAt), Devices = g.Count() })
                .ToDictionaryAsync(x => x.AgentId);
            var pushes = await _context.PushDevices.AsNoTracking()
                .Where(p => ids.Contains(p.UserId) && p.Enabled)
                .GroupBy(p => p.UserId).Select(g => new { UserId = g.Key, Seen = g.Max(p => p.LastSeenAt) })
                .ToDictionaryAsync(x => x.UserId);
            var since2 = now.AddDays(-2);
            var points = await _context.TrajectoryPoints.AsNoTracking()
                .Where(p => ids.Contains(p.AgentId) && p.ServerReceivedAt >= since2)
                .GroupBy(p => p.AgentId).Select(g => new { AgentId = g.Key, At = g.Max(p => p.ServerReceivedAt) })
                .ToDictionaryAsync(x => x.AgentId, x => x.At);
            var refs = await _context.Referrals.AsNoTracking()
                .Where(r => ids.Contains(r.AgentId) && (r.CreatedAt >= since30 || (r.UpdatedAt != null && r.UpdatedAt >= since30)))
                .Select(r => new { r.AgentId, r.DeviceId, r.CreatedAt, r.ServerReceivedAt, r.UpdatedAt })
                .ToListAsync();

            var rows = agents.Select(a =>
            {
                var mine = refs.Where(r => r.AgentId == a.AgentId).ToList();
                var fromApp = mine.Where(r => r.DeviceId != "crm-leads" && r.DeviceId != "crm" && r.CreatedAt >= since30).ToList();
                DateTime? session = sessions.TryGetValue(a.AgentId, out var s) ? s.Seen : null;
                DateTime? point = points.TryGetValue(a.AgentId, out var p) ? p : null;
                DateTime? data = fromApp.Count > 0 ? fromApp.Max(r => r.ServerReceivedAt) : null;
                var lastOnline = new[] { session, point, data }.Where(x => x != null).Select(x => x!.Value).DefaultIfEmpty().Max();
                DateTime? online = lastOnline == default ? null : lastOnline;
                // Stage changes made in the CRM after the phone last checked in.
                var unseen = online == null ? mine.Count(r => r.UpdatedAt != null) : mine.Count(r => r.UpdatedAt != null && r.UpdatedAt > online);
                var delays = fromApp.Select(r => Math.Max(0, (r.ServerReceivedAt - r.CreatedAt).TotalMinutes)).OrderBy(x => x).ToList();
                var state = online == null ? "never" : (now - online.Value).TotalHours <= 2 ? "ok" : (now - online.Value).TotalHours <= 24 ? "quiet" : "offline";
                return new
                {
                    agentId = a.AgentId, name = a.Name, block = a.Block,
                    state, lastOnlineAt = online,
                    push = pushes.ContainsKey(a.AgentId),
                    devices = sessions.TryGetValue(a.AgentId, out var s2) ? s2.Devices : 0,
                    referrals30 = fromApp.Count,
                    medianDelayMinutes = delays.Count == 0 ? (int?)null : (int)Math.Round(delays[delays.Count / 2]),
                    lateSyncs = delays.Count(d => d >= 60),
                    unseenUpdates = unseen,
                };
            })
            .OrderBy(r => r.state switch { "never" => 0, "offline" => 1, "quiet" => 2, _ => 3 })
            .ThenByDescending(r => r.unseenUpdates).ThenBy(r => r.name)
            .ToList();

            return Ok(new
            {
                summary = new
                {
                    agents = rows.Count,
                    online = rows.Count(r => r.state == "ok"),
                    quiet = rows.Count(r => r.state == "quiet"),
                    offline = rows.Count(r => r.state is "offline" or "never"),
                    noPush = rows.Count(r => !r.push),
                    unseenUpdates = rows.Sum(r => r.unseenUpdates),
                    lateSyncs = rows.Sum(r => r.lateSyncs),
                    lastReferralReceivedAt = refs.Where(r => r.DeviceId != "crm-leads" && r.DeviceId != "crm").Select(r => (DateTime?)r.ServerReceivedAt).DefaultIfEmpty().Max(),
                },
                agents = rows,
            });
        }
    }
}
