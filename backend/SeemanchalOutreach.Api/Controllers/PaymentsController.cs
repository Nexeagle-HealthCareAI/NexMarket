using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
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
    }

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

        public PaymentsController(IMarketingDbContext db, ILiveEvents live)
        {
            _db = db;
            _live = live;
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
            sb.AppendLine("Partner,Type,Block,Phone,Purpose,Period,Amount (INR),Status,Created,Approved,Paid,Reference");
            foreach (var i in items)
            {
                sb.AppendLine(string.Join(",", new[]
                {
                    Csv(i.Partner), Csv(i.PartnerType), Csv(i.Block), Csv(i.Phone), Csv(i.Purpose), Csv(i.Period),
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

            var p = new PartnerPayment
            {
                ContactClientId = dto.ContactClientId,
                Purpose = dto.Purpose.Trim(),
                Period = string.IsNullOrWhiteSpace(dto.Period) ? null : dto.Period.Trim(),
                Amount = Math.Round(dto.Amount, 2),
                DueDate = dto.DueDate.HasValue ? DateTime.SpecifyKind(dto.DueDate.Value, DateTimeKind.Utc) : null,
                Notes = dto.Notes,
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
            p.Status = "paid";
            p.PaidAt = DateTime.UtcNow;
            p.PaidBy = User.AgentIdOf();
            p.PaymentReference = string.IsNullOrWhiteSpace(dto.Reference) ? null : dto.Reference.Trim();
            await _db.SaveChangesAsync(ct);
            var name = await _db.Contacts.Where(c => c.ClientId == p.ContactClientId).Select(c => c.Name).FirstOrDefaultAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "payment", Text = $"₹{p.Amount:N0} paid to {name}", RefId = p.Id.ToString() });
            return Ok(new { p.Id, p.Status });
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
