using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The leads inbox: everyone who might become a patient, from WhatsApp, a partner's QR code, a camp, an ad or
    /// a call to the desk. Shared by the leads API and the WhatsApp webhook.
    /// </summary>
    public static class LeadInbox
    {
        public static readonly string[] Statuses = { "new", "contacted", "appointment", "arrived", "admitted", "lost" };
        public static readonly string[] Open = { "new", "contacted", "appointment" };
        public static readonly string[] Sources = { "whatsapp", "partner_qr", "partner", "ad", "camp", "missed_call", "walk_in", "desk", "agent", "web" };

        public static string StatusLabel(string s) => s switch
        {
            "new" => "New",
            "contacted" => "Contacted",
            "appointment" => "Appointment booked",
            "arrived" => "Arrived",
            "admitted" => "Admitted",
            "lost" => "Not interested",
            _ => s,
        };

        public static string SourceLabel(string s) => s switch
        {
            "whatsapp" => "WhatsApp",
            "partner_qr" => "Partner QR code",
            "partner" => "Partner",
            "ad" => "Facebook / Instagram ad",
            "camp" => "Health camp",
            "missed_call" => "Missed call",
            "walk_in" => "Walk-in",
            "desk" => "Call to desk",
            "agent" => "Field agent",
            "web" => "Website",
            _ => s,
        };

        /// <summary>Any Indian mobile format → 91XXXXXXXXXX, or null.</summary>
        public static string? NormalizePhone(string? phone)
        {
            if (string.IsNullOrWhiteSpace(phone)) return null;
            var digits = new string(phone.Where(char.IsDigit).ToArray()).TrimStart('0');
            if (digits.Length == 10) return "91" + digits;
            if (digits.Length == 12 && digits.StartsWith("91")) return digits;
            return null;
        }

        public static string Last10(string phone) => phone.Length >= 10 ? phone[^10..] : phone;

        /// <summary>WhatsApp lets the hospital reply freely for 24 hours after the person's last message.</summary>
        public static bool WindowOpen(Lead l) => l.LastInboundAt != null && l.LastInboundAt > DateTime.UtcNow.AddHours(-24);

        // ─── Codes on QR posters and links ───
        private const string CodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
        private static readonly Regex RefRx = new(@"\b(?:ref|referral|code|कोड)\s*[:#\-]?\s*([A-Za-z0-9]{5,10})\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex CampRx = new(@"\bcamp\s*[:#\-]\s*([^\n\r]{2,60})", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static string NewCode() => "G" + new string(Enumerable.Range(0, 5).Select(_ => CodeChars[RandomNumberGenerator.GetInt32(CodeChars.Length)]).ToArray());

        public static (string? Ref, string? Camp) ParseTags(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return (null, null);
            var r = RefRx.Match(text);
            var c = CampRx.Match(text);
            return (r.Success ? r.Groups[1].Value.ToUpperInvariant() : null, c.Success ? c.Groups[1].Value.Trim().TrimEnd('.', '!') : null);
        }

        /// <summary>The hospital's WhatsApp number as people dial it (WhatsApp:DisplayPhone), digits only.</summary>
        public static string? DisplayPhone(IConfiguration config) => NormalizePhone(config["WhatsApp:DisplayPhone"]);

        /// <summary>A wa.me link that opens a chat with the hospital, the message already typed in.</summary>
        public static string? WaLink(IConfiguration config, string message)
        {
            var phone = DisplayPhone(config);
            return phone == null ? null : $"https://wa.me/{phone}?text={Uri.EscapeDataString(message)}";
        }

        public static string QrMessage(IConfiguration config, string? code, string? camp)
        {
            var greeting = config["Leads:QrGreeting"] ?? "नमस्ते, मुझे अस्पताल में दिखाना है। Hello, I would like to visit the hospital.";
            if (!string.IsNullOrWhiteSpace(code)) return $"{greeting}\nRef: {code}";
            if (!string.IsNullOrWhiteSpace(camp)) return $"{greeting}\nCamp: {camp}";
            return greeting;
        }

        /// <summary>Office people who work the leads inbox: admins, and anyone who can open the Referral desk or WhatsApp pages.</summary>
        public static async Task<List<string>> DeskPeopleAsync(IMarketingDbContext db, IPermissionService perms, CancellationToken ct)
        {
            var people = await db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct);
            var result = new List<string>();
            var cache = new Dictionary<string, bool>();
            foreach (var p in people)
            {
                var role = RoleChecks.CanonicalDashboardRole(p.Role);
                if (role == null) continue;
                if (role == RoleChecks.Admin) { result.Add(p.AgentId); continue; }
                if (!cache.TryGetValue(role, out var ok))
                {
                    var levels = await perms.GetLevelsAsync(role);
                    ok = (levels.TryGetValue(Pages.Desk, out var d) && d >= Pages.View) || (levels.TryGetValue(Pages.WhatsApp, out var w) && w >= Pages.View);
                    cache[role] = ok;
                }
                if (ok) result.Add(p.AgentId);
            }
            return result;
        }

        public static string Shorten(string? s, int n = 120) => string.IsNullOrEmpty(s) ? "" : s.Length > n ? s[..n] + "…" : s;

        public class Inbound
        {
            public string From { get; set; } = string.Empty;
            public string? ProfileName { get; set; }
            public string Type { get; set; } = "text";
            public string Text { get; set; } = string.Empty;
            public string? WaMessageId { get; set; }
            /// <summary>Set when they tapped a Click-to-WhatsApp ad.</summary>
            public string? AdRef { get; set; }
        }

        /// <summary>
        /// A message someone sent to the hospital's WhatsApp number. Saves it, finds or creates their lead (credited
        /// to a partner when it carries their code), and tells the lead's owner, or the desk when nobody has it yet.
        /// Returns the lead, or null for a STOP message.
        /// </summary>
        public static async Task<Lead?> IngestAsync(IMarketingDbContext db, IPermissionService perms, INotifier notifier, IConfiguration config,
            IWhatsAppSender wa, Inbound m, bool isStop, CancellationToken ct)
        {
            var phone = NormalizePhone(m.From) ?? m.From;
            if (!string.IsNullOrEmpty(m.WaMessageId) && await db.WaMessages.AnyAsync(x => x.WaMessageId == m.WaMessageId, ct)) return null; // WhatsApp retried

            var now = DateTime.UtcNow;
            var lead = db.Leads.Local.FirstOrDefault(l => l.Phone == phone) ?? await db.Leads.FirstOrDefaultAsync(l => l.Phone == phone, ct);
            var msg = new WaMessage { Phone = phone, Direction = "in", Type = m.Type, Text = m.Text, WaMessageId = m.WaMessageId, Status = "received", CreatedAt = now };
            db.WaMessages.Add(msg);

            if (isStop)
            {
                if (lead != null)
                {
                    lead.OptOut = true;
                    msg.LeadId = lead.Id;
                    db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "note", Text = "Asked not to be messaged on WhatsApp (STOP)." });
                }
                return null;
            }

            var (code, camp) = ParseTags(m.Text);
            OutreachContact? partner = null;
            if (code != null) partner = await db.Contacts.AsNoTracking().FirstOrDefaultAsync(c => c.ReferralCode == code && !c.IsMerged, ct);
            // The sender may be a partner themselves (an ASHA worker or RMP doctor writing about a patient).
            var last10 = Last10(phone);
            var senderPartner = partner == null
                ? await db.Contacts.AsNoTracking().Where(c => c.Phone != null && c.Phone.EndsWith(last10) && !c.IsMerged).FirstOrDefaultAsync(ct)
                : null;

            bool isNew = lead == null, reopened = false;
            if (lead == null)
            {
                lead = new Lead
                {
                    Phone = phone,
                    Name = !string.IsNullOrWhiteSpace(m.ProfileName) ? m.ProfileName!.Trim() : senderPartner?.Name ?? ("+" + phone),
                    Source = partner != null ? "partner_qr" : m.AdRef != null ? "ad" : camp != null ? "camp" : senderPartner != null ? "partner" : "whatsapp",
                    SourceRef = partner != null ? code : m.AdRef ?? camp,
                    PartnerClientId = partner?.ClientId ?? senderPartner?.ClientId,
                    Note = Shorten(m.Text, 500),
                    CreatedAt = now,
                };
                db.Leads.Add(lead);
                db.LeadActivities.Add(new LeadActivity
                {
                    LeadId = lead.Id, Kind = "created", CreatedAt = now,
                    Text = partner != null ? $"Messaged on WhatsApp using {partner.Name}'s code {code}" : $"Messaged on WhatsApp ({SourceLabel(lead.Source)}{(lead.SourceRef != null ? ": " + lead.SourceRef : "")})",
                });
            }
            else
            {
                if (lead.ClosedAt != null && lead.ClosedAt < now.AddDays(-7))
                {
                    // A new enquiry from someone whose last one was closed a while ago.
                    reopened = true;
                    db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "reopened", Text = $"Wrote again after being marked {StatusLabel(lead.Status).ToLowerInvariant()}; back to New.", CreatedAt = now });
                    lead.Status = "new";
                    lead.ClosedAt = null;
                    lead.FirstResponseAt = null;
                    lead.LostReason = null;
                }
                if (partner != null && lead.PartnerClientId == null)
                {
                    lead.PartnerClientId = partner.ClientId;
                    lead.Source = "partner_qr";
                    lead.SourceRef = code;
                    db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "source", Text = $"Credited to {partner.Name} (code {code})", CreatedAt = now });
                }
                if (lead.Name.StartsWith("+") && !string.IsNullOrWhiteSpace(m.ProfileName)) lead.Name = m.ProfileName!.Trim();
            }
            msg.LeadId = lead.Id;
            lead.LastInboundAt = now;
            lead.LastActivityAt = now;
            lead.LastMessage = Shorten(m.Text, 160);
            lead.Unread++;
            if (lead.OptOut && !isStop) lead.OptOut = false; // writing to us again means they're happy to hear back

            // Optional instant acknowledgement (free inside the 24-hour window), e.g. "Thank you, our desk will call you shortly".
            var auto = config["Leads:AutoReply"];
            if ((isNew || reopened) && !string.IsNullOrWhiteSpace(auto) && wa.IsConfigured)
            {
                var r = await wa.SendTextAsync(phone, auto, ct);
                db.WaMessages.Add(new WaMessage
                {
                    Phone = phone, LeadId = lead.Id, Direction = "out", Type = "text", Text = auto, WaMessageId = r.MessageId,
                    Status = r.Ok ? "sent" : "failed", Error = r.Error, SentBy = null, CreatedAt = now.AddMilliseconds(1),
                });
            }

            var to = lead.OwnerId != null ? new List<string> { lead.OwnerId } : await DeskPeopleAsync(db, perms, ct);
            var partnerName = partner?.Name ?? (lead.PartnerClientId != null ? senderPartner?.Name : null);
            notifier.Notify(new NotifyJob
            {
                To = to,
                Kind = "lead",
                Title = isNew || reopened
                    ? $"New lead: {lead.Name}{(partnerName != null ? $" (via {partnerName})" : "")}"
                    : $"WhatsApp from {lead.Name}",
                Body = string.IsNullOrEmpty(m.Text) ? "(" + m.Type + ")" : Shorten(m.Text, 200),
                Link = $"lead:{lead.Id}",
                RefId = lead.Id.ToString(),
            });
            return lead;
        }

        /// <summary>Somebody on the desk did something with a lead: the first time counts as the response time.</summary>
        public static void Touch(Lead l, string by, bool responded)
        {
            var now = DateTime.UtcNow;
            l.LastActivityAt = now;
            if (responded && l.FirstResponseAt == null) l.FirstResponseAt = now;
            if (responded && l.Status == "new") l.Status = "contacted";
            if (l.OwnerId == null) l.OwnerId = by; // whoever replies first takes it
        }
    }
}
