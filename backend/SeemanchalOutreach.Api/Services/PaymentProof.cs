using Microsoft.AspNetCore.Http;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Proof that a partner was paid: a UPI or bank screenshot (or receipt) added by the office, or a photo of the cash
    /// handover with the person, taken in the agent app with its time and place. Stored privately; shown only to the
    /// office with access to Payments and to the partner's own agent.
    /// </summary>
    public static class PaymentProof
    {
        public const long MaxBytes = 10 * 1024 * 1024;
        public static readonly string[] Methods = { "upi", "bank", "cash", "cheque" };
        private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".webp"] = "image/webp", [".heic"] = "image/heic", [".pdf"] = "application/pdf",
        };

        public static string MethodLabel(string? m) => m switch { "upi" => "UPI", "bank" => "Bank transfer", "cash" => "Cash", "cheque" => "Cheque", _ => "—" };

        /// <summary>Checks and stores the file. Returns an error message for the person, or null when saved.</summary>
        public static async Task<string?> SaveAsync(IFileStore files, PartnerPayment p, IFormFile? file, string kind, string by, CancellationToken ct)
        {
            if (file == null || file.Length == 0) return kind == "cash_photo" ? "Take a photo of the cash handover with the person." : "Attach the payment screenshot or receipt.";
            if (file.Length > MaxBytes) return "The proof can be up to 10 MB.";
            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!Allowed.TryGetValue(ext, out var mime))
            {
                // Phones sometimes send no extension; trust an image content type.
                if (file.ContentType is "image/jpeg" or "image/png" or "image/webp") { mime = file.ContentType; ext = mime == "image/png" ? ".png" : mime == "image/webp" ? ".webp" : ".jpg"; }
                else return "Use a photo (JPG, PNG) or a PDF.";
            }
            await using var s = file.OpenReadStream();
            p.ProofKey = await files.SaveAsync("payment-proofs", $"payment-{p.Id:N}{ext}", s, mime, ct);
            p.ProofMime = mime;
            p.ProofKind = kind;
            p.ProofBy = by;
            p.ProofAt ??= DateTime.UtcNow;
            return null;
        }

        /// <summary>What the screens show about a payment's proof and receipt.</summary>
        public static object Info(PartnerPayment p, Func<string?, string?> name) => new
        {
            method = p.Method,
            methodLabel = MethodLabel(p.Method),
            hasProof = p.ProofKey != null,
            proofKind = p.ProofKind,
            proofAt = p.ProofAt,
            proofLat = p.ProofLat,
            proofLng = p.ProofLng,
            proofBy = name(p.ProofBy),
            cashAgentId = p.CashAgentId,
            cashAgent = name(p.CashAgentId),
            receivedAt = p.ReceivedConfirmedAt,
            receivedBy = name(p.ReceivedConfirmedBy),
        };
    }
}
