using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// "Forgot password": a 6-digit code sent to the person's own email and WhatsApp, good for ten minutes and five tries.
    /// The rules are here on their own so they can be tested without a server.
    /// </summary>
    public static class Recovery
    {
        public const int CodeMinutes = 10;
        public const int MaxTries = 5;
        public const int MaxSendsPerHour = 3;

        /// <summary>What is kept (in the server's short-lived memory) while a code is waiting: never the code itself.</summary>
        public sealed record Pending(string Hash, DateTime Expires, int Tries);

        public enum Result { Ok, Wrong, Expired, TooManyTries, None }

        public static string NewCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

        public static string Hash(string agentId, string code) =>
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{agentId.Trim().ToLowerInvariant()}:{(code ?? "").Trim()}")));

        public static Result Check(Pending? p, string agentId, string? code, DateTime now)
        {
            if (p == null) return Result.None;
            if (now >= p.Expires) return Result.Expired;
            if (p.Tries >= MaxTries) return Result.TooManyTries;
            var given = new string((code ?? "").Where(char.IsDigit).ToArray());
            if (given.Length != 6) return Result.Wrong;
            return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(agentId, given)), Encoding.ASCII.GetBytes(p.Hash)) ? Result.Ok : Result.Wrong;
        }

        public static string CacheKey(string agentId) => "pw-recovery:" + agentId.Trim().ToLowerInvariant();
        public static string SendsKey(string agentId) => "pw-recovery-sends:" + agentId.Trim().ToLowerInvariant();

        /// <summary>The email for someone creating a new organisation: proves the address is theirs.</summary>
        public static string SignupEmailText(string code, string orgName) =>
            $"Your NexEagle code is {code}\n\nUse it to finish creating {orgName} on NexEagle. It works for {CodeMinutes} minutes.\n\n" +
            "If you did not ask for this, ignore this message. Never share this code, even with the NexEagle team.";

        public static string EmailText(string code, string orgName) =>
            $"Your NexEagle code is {code}\n\nUse it to set a new password for {orgName}. It works for {CodeMinutes} minutes.\n\n" +
            "If you did not ask for this, ignore this message: your password has not changed. Never share this code, even with the NexEagle team.";
    }

    /// <summary>
    /// Sends email through the server's own mail account. Set Email__SmtpHost, Email__SmtpPort (587), Email__SmtpUser,
    /// Email__SmtpPassword and Email__From on the server. Never in the repository. Without them no email is sent.
    /// </summary>
    public class EmailSender
    {
        private readonly IConfiguration _config;
        private readonly ILogger<EmailSender> _log;
        public EmailSender(IConfiguration config, ILogger<EmailSender> log) { _config = config; _log = log; }

        public bool Configured => !string.IsNullOrWhiteSpace(_config["Email:SmtpHost"]) && !string.IsNullOrWhiteSpace(_config["Email:From"]);

        public async Task<bool> SendAsync(string to, string subject, string body, CancellationToken ct = default)
        {
            if (!Configured) return false;
            try
            {
                using var msg = new MailMessage(_config["Email:From"]!, to, subject, body);
                using var smtp = new SmtpClient(_config["Email:SmtpHost"], int.TryParse(_config["Email:SmtpPort"], out var port) ? port : 587)
                {
                    EnableSsl = !string.Equals(_config["Email:SmtpSsl"], "false", StringComparison.OrdinalIgnoreCase),
                    Timeout = 15000,
                };
                var user = _config["Email:SmtpUser"];
                if (!string.IsNullOrWhiteSpace(user)) smtp.Credentials = new NetworkCredential(user, _config["Email:SmtpPassword"]);
                await smtp.SendMailAsync(msg, ct);
                return true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning("Email could not be sent: {Error}", ex.Message);   // the address is not logged
                return false;
            }
        }
    }

    /// <summary>
    /// Sends a 6-digit code to an email address and a WhatsApp number, from the platform's own mail account and
    /// WhatsApp number whichever organisation asks. Used for "forgot password" and for checking a new sign-up.
    /// WhatsApp needs an approved authentication template: Platform__OtpTemplate (its name), Platform__OtpTemplateLang
    /// (default en) and Platform__OtpTemplateButton=false if the template has no copy-code button.
    /// </summary>
    public class CodeSender
    {
        private readonly IConfiguration _config;
        private readonly EmailSender _email;
        private readonly IWhatsAppSender _wa;
        private readonly IAppSettings _settings;
        private readonly ILogger<CodeSender> _log;

        public CodeSender(IConfiguration config, EmailSender email, IWhatsAppSender wa, IAppSettings settings, ILogger<CodeSender> log)
        {
            _config = config; _email = email; _wa = wa; _settings = settings; _log = log;
        }

        private string? Template => string.IsNullOrWhiteSpace(_config["Platform:OtpTemplate"]) ? null : _config["Platform:OtpTemplate"]!.Trim();

        public bool EmailReady => _email.Configured;
        public bool WhatsAppReady { get { using (OrgScope.Enter(null)) return Template != null && _wa.IsConfigured; } }
        public bool Ready => EmailReady || WhatsAppReady;

        public async Task<(bool ByEmail, bool ByWhatsApp)> SendAsync(string? email, string? phone, string code, string subject, string emailText, CancellationToken ct)
        {
            var byEmail = false; var byWhatsApp = false;
            if (_email.Configured && !string.IsNullOrWhiteSpace(email))
                byEmail = await _email.SendAsync(email!.Trim(), subject, emailText, ct);
            if (!string.IsNullOrWhiteSpace(phone) && Template is { } template)
            {
                using (OrgScope.Enter(null))   // from the platform's own number
                {
                    if (_wa.IsConfigured)
                    {
                        var wa = LeadInbox.Wa(_settings, _config);
                        var to = new string(phone!.Where(char.IsDigit).ToArray());
                        if (to.Length == 10) to = "91" + to;
                        var components = new List<object> { new { type = "body", parameters = new[] { new { type = "text", text = code } } } };
                        // Meta's "authentication" templates carry the code in a copy-code button as well.
                        if (!string.Equals(_config["Platform:OtpTemplateButton"], "false", StringComparison.OrdinalIgnoreCase))
                            components.Add(new { type = "button", sub_type = "url", index = "0", parameters = new[] { new { type = "text", text = code } } });
                        var (ok, _, error) = await _wa.GraphPostAsync($"{wa.PhoneNumberId}/messages", new
                        {
                            messaging_product = "whatsapp", to, type = "template",
                            template = new { name = template, language = new { code = _config["Platform:OtpTemplateLang"] ?? "en" }, components },
                        }, ct);
                        byWhatsApp = ok;
                        if (!ok) _log.LogWarning("A code could not be sent on WhatsApp: {Error}", error);
                    }
                }
            }
            return (byEmail, byWhatsApp);
        }
    }
}
