using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>
    /// Settings an admin changes from the CRM, kept in the database (secrets encrypted). Reads are cached for a few
    /// seconds, so they're cheap to call on every request.
    /// </summary>
    public interface IAppSettings
    {
        /// <summary>The saved value (decrypted), or null when it isn't set.</summary>
        string? Get(string key);

        /// <summary>True when a secret is saved but can't be decrypted any more (the server's encryption key changed).</summary>
        bool Unreadable(string key);

        DateTime? UpdatedAt(string key);

        /// <summary>Saves values; null or "" clears one. Keys in <paramref name="secretKeys"/> are encrypted.</summary>
        Task SetAsync(IDictionary<string, string?> values, ICollection<string> secretKeys, string updatedBy, CancellationToken ct = default);
    }

    /// <summary>
    /// The WhatsApp Business connection and its messages. Each value comes from WhatsApp → Setup in the CRM, or,
    /// when that's empty, from the server configuration (WhatsApp__PhoneNumberId etc.), so existing setups keep working.
    /// </summary>
    public class WhatsAppConfig
    {
        public const string Prefix = "whatsapp.";

        /// <summary>What each template is used for, the values it is sent with ({{1}}, {{2}}…), in order.</summary>
        public static readonly (string Kind, string Label, string[] Params)[] TemplateUses =
        {
            ("lead_followup", "Lead follow-up (after 24 hours)", new[] { "Person's first name", "Hospital name" }),
            ("doctor_availability", "Broadcast: doctor available", new[] { "Name", "Doctor", "Department", "Date", "Timing", "Note" }),
            ("schedule_change", "Broadcast: schedule change", new[] { "Name", "Doctor", "Department", "Details" }),
            ("camp_invite", "Broadcast: health camp invite", new[] { "Name", "Place", "Date", "Details" }),
            ("general_update", "Broadcast: general update", new[] { "Name", "Message" }),
        };

        /// <summary>Setting key → server configuration key it falls back to.</summary>
        public static readonly (string Key, string ConfigKey, bool Secret)[] Fields =
        {
            ("phoneNumberId", "WhatsApp:PhoneNumberId", false),
            ("businessAccountId", "WhatsApp:BusinessAccountId", false),
            ("accessToken", "WhatsApp:AccessToken", true),
            ("appSecret", "WhatsApp:AppSecret", true),
            ("verifyToken", "WhatsApp:VerifyToken", false),
            ("displayPhone", "WhatsApp:DisplayPhone", false),
            ("hospitalName", "WhatsApp:HospitalName", false),
            ("apiVersion", "WhatsApp:ApiVersion", false),
            ("hindiCode", "WhatsApp:HindiCode", false),
            ("englishCode", "WhatsApp:EnglishCode", false),
            ("autoReply", "Leads:AutoReply", false),
            ("qrGreeting", "Leads:QrGreeting", false),
        };

        public static IEnumerable<string> SecretKeys => Fields.Where(f => f.Secret).Select(f => Prefix + f.Key);

        public string? PhoneNumberId { get; set; }
        public string? BusinessAccountId { get; set; }
        public string? AccessToken { get; set; }
        public string? AppSecret { get; set; }
        public string? VerifyToken { get; set; }
        public string? DisplayPhone { get; set; }
        public string HospitalName { get; set; } = "Glisan Akbari Hospital";
        public string ApiVersion { get; set; } = "v21.0";
        public string HindiCode { get; set; } = "hi";
        public string EnglishCode { get; set; } = "en";
        public string? AutoReply { get; set; }
        public string QrGreeting { get; set; } = "नमस्ते, मुझे अस्पताल में दिखाना है। Hello, I would like to visit the hospital.";
        public Dictionary<string, string> Templates { get; set; } = new();
        /// <summary>Where each value came from: "crm", "server" or "none".</summary>
        public Dictionary<string, string> Sources { get; set; } = new();

        public bool IsConfigured => !string.IsNullOrWhiteSpace(PhoneNumberId) && !string.IsNullOrWhiteSpace(AccessToken);

        /// <summary>The approved template name for a use, or null when none is chosen.</summary>
        public string? Template(string kind) => Templates.TryGetValue(kind, out var t) && !string.IsNullOrWhiteSpace(t) ? t : null;

        /// <param name="serverConfig">Reads the server configuration, e.g. <c>k => configuration[k]</c>.</param>
        public static WhatsAppConfig Load(IAppSettings settings, Func<string, string?> serverConfig)
        {
            var c = new WhatsAppConfig();
            string? pick(string key, string configKey)
            {
                var v = settings.Get(Prefix + key);
                if (!string.IsNullOrWhiteSpace(v)) { c.Sources[key] = "crm"; return v.Trim(); }
                var s = serverConfig(configKey);
                if (!string.IsNullOrWhiteSpace(s)) { c.Sources[key] = "server"; return s.Trim(); }
                c.Sources[key] = "none";
                return null;
            }
            c.PhoneNumberId = pick("phoneNumberId", "WhatsApp:PhoneNumberId");
            c.BusinessAccountId = pick("businessAccountId", "WhatsApp:BusinessAccountId");
            c.AccessToken = pick("accessToken", "WhatsApp:AccessToken");
            c.AppSecret = pick("appSecret", "WhatsApp:AppSecret");
            c.VerifyToken = pick("verifyToken", "WhatsApp:VerifyToken");
            c.DisplayPhone = pick("displayPhone", "WhatsApp:DisplayPhone");
            c.HospitalName = pick("hospitalName", "WhatsApp:HospitalName") ?? c.HospitalName;
            c.ApiVersion = pick("apiVersion", "WhatsApp:ApiVersion") ?? c.ApiVersion;
            c.HindiCode = pick("hindiCode", "WhatsApp:HindiCode") ?? c.HindiCode;
            c.EnglishCode = pick("englishCode", "WhatsApp:EnglishCode") ?? c.EnglishCode;
            c.AutoReply = pick("autoReply", "Leads:AutoReply");
            c.QrGreeting = pick("qrGreeting", "Leads:QrGreeting") ?? c.QrGreeting;
            foreach (var (kind, _, _) in TemplateUses)
            {
                var t = pick("template." + kind, "WhatsApp:Templates:" + kind);
                // Before this page existed, a broadcast kind with no template configured was sent as a template of the same name.
                if (t == null && kind != "lead_followup") t = kind;
                if (t != null) c.Templates[kind] = t;
            }
            return c;
        }
    }
}
