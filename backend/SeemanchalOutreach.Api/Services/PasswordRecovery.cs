using System;
using System.Linq;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

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
}
