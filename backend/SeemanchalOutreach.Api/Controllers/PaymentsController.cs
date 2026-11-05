using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class CreatePaymentDto
    {
        public string ContactClientId { get; set; } = string.Empty;
        public string Purpose { get; set; } = string.Empty;
        public string? Period { get; set; }
        public decimal Amount { get; set; }
        public DateTime? DueDate { get; set; }
        public string? Notes { get; set; }
        /// <summary>Optional: the referred patient this service was for.</summary>
        public string? ReferralClientId { get; set; }
    }

    public class IncentiveDto
    {
        public string AgentId { get; set; } = string.Empty;
        public string? ReferralClientId { get; set; }
        public decimal Amount { get; set; }
        public string Reason { get; set; } = string.Empty;
        public string? Notes { get; set; }
    }

    public class IncentiveRuleDto { public decimal PerArrival { get; set; } public decimal PerAdmission { get; set; } }

    public class MarkPaidDto
    {
        public string? Reference { get; set; }
    }

    /// <summary>
    /// Ledger of amounts owed to partners for services (camp support, travel with patients,
    /// ambulance coordination …). Entries need Admin approval before they can be paid.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Payments)]
    [Route("api/v1/payments")]
    public class PaymentsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;
        private readonly INotifier _notifier;
        private readonly IAppSettings _settings;
        private readonly IFileStore _files;

        public PaymentsController(IMarketingDbContext db, ILiveEvents live, INotifier notifier, IAppSettings settings, IFileStore files)
        {
            _files = files;
            _db = db;
            _live = live;
            _notifier = notifier;
            _settings = settings;
        }

        private static bool IsAdmitted(string s) => s == "admitted" || s == "converted" || s == "procedure" || s == "discharged";

        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken ct)
        {
            var month = IstClock.MonthStartUtc;
            var overdueBefore = DateTime.UtcNow.AddDays(-7);
            var all = await _db.PartnerPayments.AsNoTracking()
                .Where(p => p.Status != "rejected")
                .Select(p => new { p.Status, p.Amount, p.ContactClientId, p.ApprovedAt, p.DueDate, p.PaidAt })
                .ToListAsync(ct);

            var pending = all.Where(p => p.Status == "pending_approval").ToList();
            var approved = all.Where(p => p.Status == "approved").ToList();
            var paidMonth = all.Where(p => p.Status == "paid" && p.PaidAt >= month).ToList();
            int overdue = approved.Count(p => (p.DueDate ?? p.ApprovedAt ?? DateTime.UtcNow) < overdueBefore);

            return Ok(new
            {
                pendingAmount = pending.Sum(p => p.Amount),
                pendingCount = pending.Count,
                approvedAmount = approved.Sum(p => p.Amount),
                approvedPartners = approved.Select(p => p.ContactClientId).Distinct().Count(),
                overdue,
                paidMonthAmount = paidMonth.Sum(p => p.Amount),
                paidMonthCount = paidMonth.Count,
            });
        }

        /// <summary>status: pending_approval | approved | paid | overdue | (empty = all)</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? search, CancellationToken ct)
        {
            var rows = await Query(status, search).OrderByDescending(p => p.CreatedAt).Take(500).ToListAsync(ct);
            return Ok(await EnrichAsync(rows, ct));
        }

        [HttpGet("export")]
        public async Task<IActionResult> Export([FromQuery] string? status, CancellationToken ct)
        {
            var rows = await Query(status, null).OrderByDescending(p => p.CreatedAt).ToListAsync(ct);
            var items = await EnrichAsync(rows, ct);
            var sb = new StringBuilder();
            sb.AppendLine("Partner,Type,Block,Phone,Purpose,Patient,Period,Amount (INR),Status,Created,Approved,Paid,Reference");
            foreach (var i in items)
            {
                sb.AppendLine(string.Join(",", new[]
                {
                    Csv(i.Partner), Csv(i.PartnerType), Csv(i.Block), Csv(i.Phone), Csv(i.Purpose), Csv(i.PatientName), Csv(i.Period),
                    i.Amount.ToString("0.00"), Csv(i.Status), Csv(Ist(i.CreatedAt)), Csv(Ist(i.ApprovedAt)), Csv(Ist(i.PaidAt)), Csv(i.PaymentReference),
                }));
            }
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
            return File(bytes, "text/csv", $"partner-payments-{IstClock.NowIst:yyyy-MM-dd}.csv");
        }

        /// <summary>Partner picker for "Add amount owed".</summary>
        [HttpGet("partners")]
        public async Task<IActionResult> Partners([FromQuery] string? q, CancellationToken ct)
        {
            var query = _db.Contacts.AsNoTracking().Where(c => !c.IsMerged);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                query = query.Where(c => c.Name.ToLower().Contains(s) || (c.Phone != null && c.Phone.Contains(s)));
            }
            var rows = await query.OrderByDescending(c => c.IsImportant).ThenBy(c => c.Name).Take(20)
                .Select(c => new { c.ClientId, c.Name, c.Role, c.Phone }).ToListAsync(ct);
            return Ok(rows);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreatePaymentDto dto, CancellationToken ct)
        {
            if (dto.Amount <= 0) return BadRequest("Amount must be more than zero.");
            if (string.IsNullOrWhiteSpace(dto.Purpose)) return BadRequest("Say what the payment is for.");
            var contact = await _db.Contacts.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == dto.ContactClientId, ct);
            if (contact == null) return NotFound("Partner not found.");
            string? referralId = null;
            if (!string.IsNullOrWhiteSpace(dto.ReferralClientId))
            {
                var rc = await _db.Referrals.AsNoTracking().Where(r => r.ClientId == dto.ReferralClientId).Select(r => r.ContactId).FirstOrDefaultAsync(ct);
                if (rc == null) return BadRequest("That patient wasn't found.");
                if (rc != dto.ContactClientId) return BadRequest("That patient was referred by a different partner.");
                referralId = dto.ReferralClientId;
            }

            var p = new PartnerPayment
            {
                ContactClientId = dto.ContactClientId,
                Purpose = dto.Purpose.Trim(),
                Period = string.IsNullOrWhiteSpace(dto.Period) ? null : dto.Period.Trim(),
                Amount = Math.Round(dto.Amount, 2),
                DueDate = dto.DueDate.HasValue ? DateTime.SpecifyKind(dto.DueDate.Value, DateTimeKind.Utc) : null,
                Notes = dto.Notes,
                ReferralClientId = referralId,
                Status = "pending_approval",
                CreatedBy = User.AgentIdOf(),
                CreatedAt = DateTime.UtcNow,
            };
            _db.PartnerPayments.Add(p);
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "payment", Text = $"₹{p.Amount:N0} for {contact.Name} sent for approval", RefId = p.Id.ToString() });
            return Ok(new { p.Id });
        }

        [HttpPost("{id:guid}/approve")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> Approve(Guid id, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status != "pending_approval") return BadRequest("Only entries waiting for approval can be approved.");
            p.Status = "approved";
            p.ApprovedBy = User.AgentIdOf();
            p.ApprovedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { p.Id, p.Status });
        }

        [HttpPost("{id:guid}/reject")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> Reject(Guid id, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status == "paid") return BadRequest("A paid entry can't be rejected.");
            p.Status = "rejected";
            await _db.SaveChangesAsync(ct);
            return Ok(new { p.Id, p.Status });
        }

        [HttpPost("{id:guid}/paid")]
        public async Task<IActionResult> MarkPaid(Guid id, [FromBody] MarkPaidDto dto, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status != "approved") return BadRequest("Only approved entries can be marked paid.");
            // Every payment needs proof, so it can't be disputed later. Use "pay" with the screenshot, or let the agent pay in cash.
            if (p.ProofKey == null) return BadRequest(new { message = "Attach the payment screenshot or receipt first." });
            p.Status = "paid";
            p.PaidAt = DateTime.UtcNow;
            p.PaidBy = User.AgentIdOf();
            p.PaymentReference = string.IsNullOrWhiteSpace(dto.Reference) ? p.PaymentReference : dto.Reference.Trim();
            await _db.SaveChangesAsync(ct);
            await NotifyPaidAsync(p, ct);
            return Ok(new { p.Id, p.Status });
        }

        /// <summary>
        /// Pay an approved entry with proof in one step: UPI / bank / cheque with a screenshot or receipt (photo or PDF),
        /// or cash paid at the hospital with a photo.
        /// </summary>
        [HttpPost("{id:guid}/pay")]
        [RequestSizeLimit(PaymentProof.MaxBytes + 1_000_000)]
        [RequestFormLimits(MultipartBodyLengthLimit = PaymentProof.MaxBytes + 1_000_000)]
        public async Task<IActionResult> Pay(Guid id, [FromForm] IFormFile? file, [FromForm] string? method, [FromForm] string? reference, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status != "approved") return BadRequest(new { message = "Only approved entries can be paid." });
            if (string.IsNullOrWhiteSpace(method) || !PaymentProof.Methods.Contains(method)) return BadRequest(new { message = "Choose how it was paid: UPI, bank, cash or cheque." });
            var me = User.AgentIdOf();
            p.ProofAt = DateTime.UtcNow;
            var err = await PaymentProof.SaveAsync(_files, p, file, method == "cash" ? "cash_photo" : "screenshot", me, ct);
            if (err != null) return BadRequest(new { message = err });
            p.Method = method;
            p.Status = "paid";
            p.PaidAt = DateTime.UtcNow;
            p.PaidBy = me;
            p.CashAgentId = method == "cash" ? p.CashAgentId : null;
            var r = (reference ?? "").Trim();
            p.PaymentReference = r.Length == 0 ? null : r[..Math.Min(r.Length, 80)];
            await _db.SaveChangesAsync(ct);
            await NotifyPaidAsync(p, ct);
            return Ok(new { p.Id, p.Status });
        }

        public class CashAgentDto { public string? AgentId { get; set; } }

        /// <summary>The partner's field agent (or another agent) will hand this over in cash and record it with a photo in the app.</summary>
        [HttpPost("{id:guid}/cash-agent")]
        public async Task<IActionResult> CashByAgent(Guid id, [FromBody] CashAgentDto dto, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status != "approved") return BadRequest(new { message = "Approve it first." });
            var partner = await _db.Contacts.AsNoTracking().Where(c => c.ClientId == p.ContactClientId).Select(c => new { c.Name, c.AgentId }).FirstOrDefaultAsync(ct);
            var agentId = string.IsNullOrWhiteSpace(dto.AgentId) ? partner?.AgentId : dto.AgentId.Trim();
            if (string.IsNullOrEmpty(agentId) || !await _db.Agents.AnyAsync(a => a.AgentId == agentId, ct)) return BadRequest(new { message = "Pick the agent who will hand over the cash." });
            p.Method = "cash";
            p.CashAgentId = agentId;
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = new() { agentId }, Except = User.AgentIdOf(), Kind = "payment",
                Title = $"Hand over ₹{p.Amount:N0} cash to {partner?.Name}",
                Body = $"{p.Purpose}. When you give it, open Money in the app and take a photo with them as proof.",
                Link = "money:", RefId = p.Id.ToString(),
            });
            return Ok(new { p.Id, p.CashAgentId });
        }

        [HttpPost("{id:guid}/cash-agent/cancel")]
        public async Task<IActionResult> CancelCashByAgent(Guid id, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status == "paid") return BadRequest(new { message = "It's already paid." });
            p.CashAgentId = null;
            if (p.Method == "cash") p.Method = null;
            await _db.SaveChangesAsync(ct);
            return Ok(new { p.Id });
        }

        /// <summary>The partner said they got the money.</summary>
        [HttpPost("{id:guid}/received")]
        public async Task<IActionResult> Received(Guid id, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Status != "paid") return BadRequest(new { message = "Only a paid entry can be confirmed as received." });
            p.ReceivedConfirmedAt ??= DateTime.UtcNow;
            p.ReceivedConfirmedBy ??= User.AgentIdOf();
            await _db.SaveChangesAsync(ct);
            return Ok(new { p.Id, p.ReceivedConfirmedAt });
        }

        private async Task NotifyPaidAsync(PartnerPayment p, CancellationToken ct)
        {
            var partner = await _db.Contacts.AsNoTracking().Where(c => c.ClientId == p.ContactClientId).Select(c => new { c.Name, c.AgentId }).FirstOrDefaultAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "payment", Text = $"₹{p.Amount:N0} paid to {partner?.Name}", RefId = p.Id.ToString() });
            // The agent who looks after this partner can tell them it's done.
            if (!string.IsNullOrEmpty(partner?.AgentId))
            {
                var patient = p.ReferralClientId == null ? null : await _db.Referrals.AsNoTracking().Where(r => r.ClientId == p.ReferralClientId).Select(r => r.PatientName).FirstOrDefaultAsync(ct);
                _notifier.Notify(new NotifyJob
                {
                    To = new() { partner.AgentId }, Except = User.AgentIdOf(), Kind = "payment",
                    Title = $"₹{p.Amount:N0} paid to {partner.Name}",
                    Body = $"{p.Purpose}{(patient != null ? $" · patient {patient}" : "")}{(p.PaymentReference != null ? $" · ref {p.PaymentReference}" : "")}",
                    Link = "money:", RefId = p.Id.ToString(),
                });
            }
        }

        // ─── Field agents' incentives ────────────────────────────────────────

        /// <summary>Agents' incentives with totals. status: pending_approval | approved | paid | rejected | (empty = all but rejected).</summary>
        [HttpGet("incentives")]
        public async Task<IActionResult> Incentives([FromQuery] string? status, [FromQuery] string? agentId, CancellationToken ct)
        {
            var q = _db.AgentIncentives.AsNoTracking().AsQueryable();
            q = string.IsNullOrWhiteSpace(status) ? q.Where(i => i.Status != "rejected") : q.Where(i => i.Status == status);
            if (!string.IsNullOrWhiteSpace(agentId)) q = q.Where(i => i.AgentId == agentId);
            var rows = await q.OrderByDescending(i => i.CreatedAt).Take(500).ToListAsync(ct);
            var agentIds = rows.Select(r => r.AgentId).Distinct().ToList();
            var agents = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => new { a.Name, a.Block }, ct);
            var refIds = rows.Where(r => r.ReferralClientId != null).Select(r => r.ReferralClientId!).Distinct().ToList();
            var refs = await _db.Referrals.AsNoTracking().Where(r => refIds.Contains(r.ClientId))
                .ToDictionaryAsync(r => r.ClientId, r => new { r.PatientName, r.Status, r.Department }, ct);
            var all = await _db.AgentIncentives.AsNoTracking().Where(i => i.Status != "rejected").Select(i => new { i.Status, i.Amount, i.PaidAt }).ToListAsync(ct);
            var month = IstClock.MonthStartUtc;
            return Ok(new
            {
                summary = new
                {
                    pendingAmount = all.Where(i => i.Status == "pending_approval").Sum(i => i.Amount),
                    pendingCount = all.Count(i => i.Status == "pending_approval"),
                    approvedAmount = all.Where(i => i.Status == "approved").Sum(i => i.Amount),
                    paidMonthAmount = all.Where(i => i.Status == "paid" && i.PaidAt >= month).Sum(i => i.Amount),
                },
                rule = IncentiveRule.Load(_settings),
                items = rows.Select(i =>
                {
                    agents.TryGetValue(i.AgentId, out var a);
                    var r = i.ReferralClientId != null ? refs.GetValueOrDefault(i.ReferralClientId) : null;
                    return new
                    {
                        i.Id, i.AgentId, agent = a?.Name ?? i.AgentId, block = a?.Block, i.ReferralClientId,
                        patient = r?.PatientName, patientStage = r == null ? null : ReferralsController.StageLabel(r.Status), department = r?.Department,
                        i.Amount, i.Reason, i.Auto, i.Status, i.CreatedAt, i.ApprovedAt, i.PaidAt, i.PaymentReference, i.Notes,
                    };
                }),
            });
        }

        [HttpPost("incentives")]
        public async Task<IActionResult> AddIncentive([FromBody] IncentiveDto dto, CancellationToken ct)
        {
            if (dto.Amount <= 0 || dto.Amount > 100_000) return BadRequest("Enter the amount.");
            var reason = (dto.Reason ?? "").Trim();
            if (reason.Length == 0) return BadRequest("Say what the incentive is for.");
            var agent = await _db.Agents.AsNoTracking().FirstOrDefaultAsync(a => a.AgentId == dto.AgentId && a.IsActive, ct);
            if (agent == null) return BadRequest("Pick an active field agent.");
            if (!string.IsNullOrWhiteSpace(dto.ReferralClientId) && !await _db.Referrals.AnyAsync(r => r.ClientId == dto.ReferralClientId && r.AgentId == dto.AgentId, ct))
                return BadRequest("That patient wasn't referred by this agent.");
            var i = new AgentIncentive
            {
                AgentId = dto.AgentId, ReferralClientId = string.IsNullOrWhiteSpace(dto.ReferralClientId) ? null : dto.ReferralClientId,
                Amount = Math.Round(dto.Amount, 2), Reason = reason.Length > 200 ? reason[..200] : reason, Notes = dto.Notes, CreatedBy = User.AgentIdOf(),
            };
            _db.AgentIncentives.Add(i);
            await _db.SaveChangesAsync(ct);
            return Ok(new { i.Id });
        }

        [HttpPost("incentives/{id:guid}/approve")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> ApproveIncentive(Guid id, CancellationToken ct)
        {
            var i = await _db.AgentIncentives.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (i == null) return NotFound();
            if (i.Status != "pending_approval") return BadRequest("Only incentives waiting for approval can be approved.");
            i.Status = "approved"; i.ApprovedBy = User.AgentIdOf(); i.ApprovedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { i.Id, i.Status });
        }

        [HttpPost("incentives/{id:guid}/reject")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> RejectIncentive(Guid id, CancellationToken ct)
        {
            var i = await _db.AgentIncentives.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (i == null) return NotFound();
            if (i.Status == "paid") return BadRequest("A paid incentive can't be rejected.");
            i.Status = "rejected";
            await _db.SaveChangesAsync(ct);
            return Ok(new { i.Id, i.Status });
        }

        [HttpPost("incentives/{id:guid}/paid")]
        public async Task<IActionResult> IncentivePaid(Guid id, [FromBody] MarkPaidDto dto, CancellationToken ct)
        {
            var i = await _db.AgentIncentives.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (i == null) return NotFound();
            if (i.Status != "approved") return BadRequest("Only approved incentives can be marked paid.");
            i.Status = "paid"; i.PaidAt = DateTime.UtcNow; i.PaidBy = User.AgentIdOf();
            i.PaymentReference = string.IsNullOrWhiteSpace(dto.Reference) ? null : dto.Reference.Trim();
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = new() { i.AgentId }, Except = User.AgentIdOf(), Kind = "payment",
                Title = $"Your incentive of ₹{i.Amount:N0} is paid",
                Body = $"{i.Reason}{(i.PaymentReference != null ? $" · ref {i.PaymentReference}" : "")}",
                Link = "money:", RefId = i.Id.ToString(),
            });
            return Ok(new { i.Id, i.Status });
        }

        /// <summary>The incentive rule: a fixed amount per patient who arrives / is admitted (0 = off). Admins only.</summary>
        [HttpPut("incentive-rule")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> SaveRule([FromBody] IncentiveRuleDto dto, CancellationToken ct)
        {
            if (dto.PerArrival < 0 || dto.PerAdmission < 0 || dto.PerArrival > 100_000 || dto.PerAdmission > 100_000) return BadRequest("Enter amounts between 0 and 1,00,000.");
            var rule = new IncentiveRule { PerArrival = Math.Round(dto.PerArrival, 2), PerAdmission = Math.Round(dto.PerAdmission, 2) };
            await rule.SaveAsync(_settings, User.AgentIdOf(), ct);
            return Ok(rule);
        }

        private IQueryable<PartnerPayment> Query(string? status, string? search)
        {
            var q = _db.PartnerPayments.AsNoTracking().AsQueryable();
            if (status == "overdue")
            {
                var before = DateTime.UtcNow.AddDays(-7);
                q = q.Where(p => p.Status == "approved" && (p.DueDate ?? p.ApprovedAt) < before);
            }
            else if (!string.IsNullOrWhiteSpace(status))
            {
                q = q.Where(p => p.Status == status);
            }
            else
            {
                q = q.Where(p => p.Status != "rejected");
            }
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                var ids = _db.Contacts.Where(c => c.Name.ToLower().Contains(s)).Select(c => c.ClientId);
                q = q.Where(p => ids.Contains(p.ContactClientId) || p.Purpose.ToLower().Contains(s));
            }
            return q;
        }

        public class PaymentRow
        {
            public Guid Id { get; set; }
            public string ContactClientId { get; set; } = "";
            public string Partner { get; set; } = "";
            public string? PartnerType { get; set; }
            public string? Block { get; set; }
            public string? Phone { get; set; }
            public int PatientsSent { get; set; }
            public int Admitted { get; set; }
            public string Purpose { get; set; } = "";
            public string? Period { get; set; }
            public decimal Amount { get; set; }
            public string Status { get; set; } = "";
            public bool Overdue { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime? DueDate { get; set; }
            public DateTime? ApprovedAt { get; set; }
            public DateTime? PaidAt { get; set; }
            public string? PaymentReference { get; set; }
            public string? Notes { get; set; }
            public string? ReferralClientId { get; set; }
            public string? PatientName { get; set; }
            public object? Proof { get; set; }
        }

        private async Task<List<PaymentRow>> EnrichAsync(List<PartnerPayment> rows, CancellationToken ct)
        {
            var ids = rows.Select(r => r.ContactClientId).Distinct().ToList();
            var contacts = await _db.Contacts.AsNoTracking().Where(c => ids.Contains(c.ClientId))
                .Select(c => new { c.ClientId, c.Name, c.Role, c.Phone, c.PanchayatId }).ToListAsync(ct);
            var pids = contacts.Select(c => c.PanchayatId).Distinct().ToList();
            var blocks = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Block, ct);
            var referrals = await _db.Referrals.AsNoTracking().Where(r => ids.Contains(r.ContactId))
                .Select(r => new { r.ContactId, r.Status }).ToListAsync(ct);
            var cmap = contacts.ToDictionary(c => c.ClientId);
            var before = DateTime.UtcNow.AddDays(-7);
            var refIds = rows.Where(r => r.ReferralClientId != null).Select(r => r.ReferralClientId!).Distinct().ToList();
            var patients = refIds.Count == 0 ? new Dictionary<string, string>()
                : await _db.Referrals.AsNoTracking().Where(r => refIds.Contains(r.ClientId)).ToDictionaryAsync(r => r.ClientId, r => r.PatientName, ct);

            var people = rows.SelectMany(r => new[] { r.CashAgentId, r.ProofBy, r.ReceivedConfirmedBy }).Where(x => x != null).Distinct().ToList();
            var names = await _db.Agents.AsNoTracking().Where(a => people.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            string? name(string? id) => id == null ? null : names.GetValueOrDefault(id) ?? id;
            return rows.Select(r =>
            {
                cmap.TryGetValue(r.ContactClientId, out var c);
                var mine = referrals.Where(x => x.ContactId == r.ContactClientId).ToList();
                return new PaymentRow
                {
                    Id = r.Id,
                    ContactClientId = r.ContactClientId,
                    Partner = c?.Name ?? "Unknown partner",
                    PartnerType = c?.Role,
                    Block = c != null ? blocks.GetValueOrDefault(c.PanchayatId) : null,
                    Phone = c?.Phone,
                    PatientsSent = mine.Count,
                    Admitted = mine.Count(x => IsAdmitted(x.Status)),
                    Purpose = r.Purpose,
                    Period = r.Period,
                    Amount = r.Amount,
                    Status = r.Status,
                    Overdue = r.Status == "approved" && (r.DueDate ?? r.ApprovedAt ?? DateTime.UtcNow) < before,
                    CreatedAt = r.CreatedAt,
                    DueDate = r.DueDate,
                    ApprovedAt = r.ApprovedAt,
                    PaidAt = r.PaidAt,
                    PaymentReference = r.PaymentReference,
                    Notes = r.Notes,
                    ReferralClientId = r.ReferralClientId,
                    PatientName = r.ReferralClientId != null ? patients.GetValueOrDefault(r.ReferralClientId) : null,
                    Proof = PaymentProof.Info(r, name),
                };
            }).ToList();
        }

        private static string Ist(DateTime? utc) => utc.HasValue ? (utc.Value + IstClock.Offset).ToString("yyyy-MM-dd HH:mm") : "";

        private static string Csv(string? v)
        {
            if (string.IsNullOrEmpty(v)) return "";
            // Neutralise spreadsheet formulas and quote everything.
            if ("=+-@".IndexOf(v[0]) >= 0) v = "'" + v;
            return "\"" + v.Replace("\"", "\"\"") + "\"";
        }
    }
}
