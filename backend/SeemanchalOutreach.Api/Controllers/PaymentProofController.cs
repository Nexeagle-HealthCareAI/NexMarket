using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// The proof of a partner payment (screenshot, receipt or cash handover photo), for the CRM: Payments, and the
    /// referral desk and pipeline where the patient's money is shown. The agent app reads it through /me/money.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Payments, Pages.Pipeline, Pages.Desk)]
    [Route("api/v1/payment-proofs")]
    public class PaymentProofController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        public PaymentProofController(IMarketingDbContext db, IFileStore files) { _db = db; _files = files; }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var p = await _db.PartnerPayments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p?.ProofKey == null) return NotFound();
            var f = await _files.OpenAsync(p.ProofKey, ct);
            if (f == null) return NotFound(new { message = "The proof is no longer in storage." });
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.Headers["Cache-Control"] = "private, max-age=3600";
            Response.Headers["Content-Disposition"] = $"inline; filename=\"payment-proof-{id:N}\"";
            return File(f.Value.Content, p.ProofMime ?? f.Value.ContentType);
        }
    }
}
