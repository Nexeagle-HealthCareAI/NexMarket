using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
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
        public MyMoneyController(IMarketingDbContext db) { _db = db; }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var since = DateTime.UtcNow.AddDays(-365);
            var myPartners = _db.Contacts.Where(c => c.AgentId == me).Select(c => c.ClientId);
            var pays = await _db.PartnerPayments.AsNoTracking()
                .Where(p => myPartners.Contains(p.ContactClientId) && p.Status != "rejected" && p.CreatedAt >= since)
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
                },
                partnerPayments = pays.Select(p => new
                {
                    id = p.Id, contactClientId = p.ContactClientId, partner = names.GetValueOrDefault(p.ContactClientId) ?? "Partner",
                    referralClientId = p.ReferralClientId, patient = p.ReferralClientId != null ? patients.GetValueOrDefault(p.ReferralClientId) : null,
                    purpose = p.Purpose, amount = p.Amount, status = p.Status, createdAt = p.CreatedAt, approvedAt = p.ApprovedAt, paidAt = p.PaidAt,
                    reference = p.PaymentReference,
                }),
                incentives = incs.Select(i => new
                {
                    id = i.Id, referralClientId = i.ReferralClientId, patient = i.ReferralClientId != null ? patients.GetValueOrDefault(i.ReferralClientId) : null,
                    reason = i.Reason, amount = i.Amount, status = i.Status, createdAt = i.CreatedAt, approvedAt = i.ApprovedAt, paidAt = i.PaidAt,
                    reference = i.PaymentReference,
                }),
            });
        }
    }
}
