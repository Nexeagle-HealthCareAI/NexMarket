using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    public class WhatsAppSendResult
    {
        public bool Ok { get; set; }
        public string? MessageId { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>Sends WhatsApp template messages through the WhatsApp Business Platform (Cloud API).</summary>
    public interface IWhatsAppSender
    {
        bool IsConfigured { get; }

        /// <param name="toPhone">Any Indian phone format; normalised to 91XXXXXXXXXX.</param>
        /// <param name="kind">Broadcast kind; mapped to an approved template name in config.</param>
        /// <param name="language">"hi" or "en".</param>
        /// <param name="bodyParams">Values for the template's {{1}}, {{2}} … in order.</param>
        Task<WhatsAppSendResult> SendTemplateAsync(string toPhone, string kind, string language, IReadOnlyList<string> bodyParams, CancellationToken ct = default);

        /// <summary>
        /// A free-text reply. WhatsApp only delivers these within 24 hours of the person's last message to the
        /// hospital (the "customer service window"); after that only an approved template can be sent.
        /// </summary>
        Task<WhatsAppSendResult> SendTextAsync(string toPhone, string text, CancellationToken ct = default);
    }
}
