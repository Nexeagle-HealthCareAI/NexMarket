using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// For the field agent's app: payments to the agent's own partners (waiting approval, approved, paid with the
    /// reference) and the agent's own incentives, each tied to a patient where there is one. Hospital bills are
    /// not shown here.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/money")]
    public class MyMoneyController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly ILiveEvents _live;
        public MyMoneyController(IMarketingDbContext db, IFileStore files, ILiveEvents live) { _db = db; _files = files; _live = live; }

        /// <summary>A payment this agent may see: to one of their partners, or one they were asked to hand over in cash.</summary>
        private async Task<PartnerPayment?> MineAsync(Guid id, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var p = await _db.PartnerPayments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return null;
            if (p.CashAgentId == me) return p;
            return await _db.Contacts.AnyAsync(c => c.ClientId == p.ContactClientId && c.AgentId == me, ct) ? p : null;
        }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var since = DateTime.UtcNow.AddDays(-365);
            var myPartners = _db.Contacts.Where(c => c.AgentId == me).Select(c => c.ClientId);
            var pays = await _db.PartnerPayments.AsNoTracking()
                .Where(p => (myPartners.Contains(p.ContactClientId) || p.CashAgentId == me) && p.Status != "rejected" && p.CreatedAt >= since)
                .OrderByDescending(p => p.CreatedAt).Take(300).ToListAsync(ct);
            var incs = await _db.AgentIncentives.AsNoTracking()
                .Where(i => i.AgentId == me && i.Status != "rejected" && i.CreatedAt >= since)
                .OrderByDescending(i => i.CreatedAt).Take(300).ToListAsync(ct);
            var cids = pays.Select(p => p.ContactClientId).Distinct().ToList();
            var names = await _db.Contacts.AsNoTracking().Where(c => cids.Contains(c.ClientId)).ToDictionaryAsync(c => c.ClientId, c => c.Name, ct);
            var rids = pays.Select(p => p.ReferralClientId).Concat(incs.Select(i => i.ReferralClientId)).Where(x => x != null).Cast<string>().Distinct().ToList();
            var patients = await _db.Referrals.AsNoTracking().Where(r => rids.Contains(r.ClientId)).ToDictionaryAsync(r => r.ClientId, r => r.PatientName, ct);
            var before = DateTime.UtcNow.AddDays(-7);
            return Ok(new
            {
                summary = new
                {
                    partnerPaid = pays.Where(p => p.Status == "paid").Sum(p => p.Amount),
                    partnerWaiting = pays.Where(p => p.Status != "paid").Sum(p => p.Amount),
                    partnerOverdue = pays.Count(p => p.Status == "approved" && (p.DueDate ?? p.ApprovedAt ?? DateTime.UtcNow) < before),
                    myPaid = incs.Where(i => i.Status == "paid").Sum(i => i.Amount),
                    myWaiting = incs.Where(i => i.Status != "paid").Sum(i => i.Amount),
                    cashToHandOver = pays.Where(p => p.Status == "approved" && p.CashAgentId == me).Sum(p => p.Amount),
                    cashToHandOverCount = pays.Count(p => p.Status == "approved" && p.CashAgentId == me),
                    notConfirmed = pays.Count(p => p.Status == "paid" && p.ReceivedConfirmedAt == null),
                },
                partnerPayments = pays.Select(p => new
                {
                    id = p.Id, contactClientId = p.ContactClientId, partner = names.GetValueOrDefault(p.ContactClientId) ?? "Partner",
                    referralClientId = p.ReferralClientId, patient = p.ReferralClientId != null ? patients.GetValueOrDefault(p.ReferralClientId) : null,
                    purpose = p.Purpose, amount = p.Amount, status = p.Status, createdAt = p.CreatedAt, approvedAt = p.ApprovedAt, paidAt = p.PaidAt,
                    reference = p.PaymentReference,
                    method = p.Method, methodLabel = PaymentProof.MethodLabel(p.Method), hasProof = p.ProofKey != null, proofKind = p.ProofKind, proofAt = p.ProofAt, proofIsPdf = p.ProofMime == "application/pdf",
                    cashByMe = p.Status == "approved" && p.CashAgentId == me, receivedAt = p.ReceivedConfirmedAt,
                }),
                incentives = incs.Select(i => new
                {
                    id = i.Id, referralClientId = i.ReferralClientId, patient = i.ReferralClientId != null ? patients.GetValueOrDefault(i.ReferralClientId) : null,
                    reason = i.Reason, amount = i.Amount, status = i.Status, createdAt = i.CreatedAt, approvedAt = i.ApprovedAt, paidAt = i.PaidAt,
                    reference = i.PaymentReference,
                }),
            });
        }

        /// <summary>
        /// The agent handed over cash: a photo with the person, taken in the app, with the time and place. This is the
        /// proof; the payment is marked paid.
        /// </summary>
        [HttpPost("payments/{id:guid}/cash")]
        [RequestSizeLimit(PaymentProof.MaxBytes + 1_000_000)]
        [RequestFormLimits(MultipartBodyLengthLimit = PaymentProof.MaxBytes + 1_000_000)]
        public async Task<IActionResult> CashHandover(Guid id, [FromForm] IFormFile? file, [FromForm] double? lat, [FromForm] double? lng, [FromForm] DateTime? takenAt, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var p = await MineAsync(id, ct);
            if (p == null) return NotFound();
            if (p.Status == "paid") return Ok(new { p.Id, p.Status });
            if (p.Status != "approved" || p.CashAgentId != me) return BadRequest(new { message = "This payment wasn't given to you to pay in cash." });
            var now = DateTime.UtcNow;
            var at = takenAt?.ToUniversalTime();
            p.ProofAt = at != null && at <= now.AddMinutes(5) && at >= now.AddHours(-6) ? at : now;
            var err = await PaymentProof.SaveAsync(_files, p, file, "cash_photo", me, ct);
            if (err != null) return BadRequest(new { message = err });
            if (lat is > 5 and < 38 && lng is > 65 and < 100) { p.ProofLat = lat; p.ProofLng = lng; }
            p.Method = "cash";
            p.Status = "paid";
            p.PaidAt = now;
            p.PaidBy = me;
            await _db.SaveChangesAsync(ct);
            var partner = await _db.Contacts.AsNoTracking().Where(c => c.ClientId == p.ContactClientId).Select(c => c.Name).FirstOrDefaultAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "payment", Text = $"₹{p.Amount:N0} cash handed to {partner} (photo proof)", RefId = p.Id.ToString() });
            return Ok(new { p.Id, p.Status });
        }

        /// <summary>The partner told the agent they got the money.</summary>
        [HttpPost("payments/{id:guid}/received")]
        public async Task<IActionResult> Received(Guid id, CancellationToken ct)
        {
            var p = await MineAsync(id, ct);
            if (p == null) return NotFound();
            if (p.Status != "paid") return BadRequest(new { message = "It isn't paid yet." });
            p.ReceivedConfirmedAt ??= DateTime.UtcNow;
            p.ReceivedConfirmedBy ??= User.AgentIdOf();
            await _db.SaveChangesAsync(ct);
            return Ok(new { p.Id, p.ReceivedConfirmedAt });
        }

        /// <summary>The proof (UPI screenshot, receipt or cash photo), to show the partner if they ask.</summary>
        [HttpGet("payments/{id:guid}/proof")]
        public async Task<IActionResult> Proof(Guid id, CancellationToken ct)
        {
            var p = await MineAsync(id, ct);
            if (p?.ProofKey == null) return NotFound();
            var f = await _files.OpenAsync(p.ProofKey, ct);
            if (f == null) return NotFound(new { message = "The proof is no longer in storage." });
            Response.Headers["Cache-Control"] = "private, max-age=3600";
            return File(f.Value.Content, p.ProofMime ?? f.Value.ContentType);
        }
    }
}
