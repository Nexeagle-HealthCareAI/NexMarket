using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Infrastructure.Services
{
    /// <summary>
    /// WhatsApp Cloud API sender. Set up from the CRM (Settings → WhatsApp); anything left empty there falls back to
    /// the server configuration:
    ///   WhatsApp__PhoneNumberId   – the hospital's WhatsApp business phone number id
    ///   WhatsApp__AccessToken     – a permanent system-user access token
    ///   WhatsApp__ApiVersion      – Graph API version, default v21.0
    ///   WhatsApp__Templates__doctor_availability (etc.) – approved template names per use
    /// Without PhoneNumberId + AccessToken nothing is sent and broadcasts fail with a clear message.
    /// </summary>
    public class WhatsAppCloudSender : IWhatsAppSender
    {
        private readonly IHttpClientFactory _http;
        private readonly IConfiguration _config;
        private readonly IAppSettings _settings;
        private readonly ILogger<WhatsAppCloudSender> _logger;

        public WhatsAppCloudSender(IHttpClientFactory http, IConfiguration config, IAppSettings settings, ILogger<WhatsAppCloudSender> logger)
        {
            _http = http;
            _config = config;
            _settings = settings;
            _logger = logger;
        }

        private WhatsAppConfig Cfg => WhatsAppConfig.Load(_settings, k => _config[k]);

        public bool IsConfigured => Cfg.IsConfigured;

        public static string? NormalizeIndianPhone(string? phone)
        {
            if (string.IsNullOrWhiteSpace(phone)) return null;
            var digits = new string(phone.Where(char.IsDigit).ToArray());
            if (digits.StartsWith("0")) digits = digits.TrimStart('0');
            if (digits.Length == 10) return "91" + digits;
            if (digits.Length == 12 && digits.StartsWith("91")) return digits;
            return null;
        }

        public async Task<WhatsAppSendResult> SendTemplateAsync(string toPhone, string kind, string language, IReadOnlyList<string> bodyParams, CancellationToken ct = default)
        {
            var cfg = Cfg;
            if (!cfg.IsConfigured) return new WhatsAppSendResult { Ok = false, Error = "WhatsApp isn't connected yet (Settings → WhatsApp)." };
            string? template = cfg.Template(kind);
            if (template == null) return new WhatsAppSendResult { Ok = false, Error = "No approved template is chosen for this message yet (Settings → WhatsApp)." };
            string langCode = language == "en" ? cfg.EnglishCode : cfg.HindiCode;
            return await SendNamedTemplateAsync(toPhone, template, langCode, bodyParams, ct);
        }

        public async Task<WhatsAppSendResult> SendNamedTemplateAsync(string toPhone, string template, string langCode, IReadOnlyList<string> bodyParams, CancellationToken ct = default)
        {
            var cfg = Cfg;
            if (!cfg.IsConfigured) return new WhatsAppSendResult { Ok = false, Error = "WhatsApp isn't connected yet (Settings → WhatsApp)." };
            var to = NormalizeIndianPhone(toPhone);
            if (to == null) return new WhatsAppSendResult { Ok = false, Error = "Phone number is not a valid Indian mobile number." };

            var payload = new
            {
                messaging_product = "whatsapp",
                to,
                type = "template",
                template = new
                {
                    name = template,
                    language = new { code = langCode },
                    components = bodyParams.Count == 0 ? Array.Empty<object>() : new object[]
                    {
                        new
                        {
                            type = "body",
                            parameters = bodyParams.Select(p => new { type = "text", text = string.IsNullOrWhiteSpace(p) ? "-" : p }).ToArray(),
                        },
                    },
                },
            };

            return await PostAsync(cfg, payload, ct);
        }

        public async Task<WhatsAppSendResult> SendTextAsync(string toPhone, string text, CancellationToken ct = default)
        {
            var cfg = Cfg;
            if (!cfg.IsConfigured) return new WhatsAppSendResult { Ok = false, Error = "WhatsApp isn't connected yet (Settings → WhatsApp)." };
            var to = NormalizeIndianPhone(toPhone);
            if (to == null) return new WhatsAppSendResult { Ok = false, Error = "Phone number is not a valid Indian mobile number." };
            if (string.IsNullOrWhiteSpace(text)) return new WhatsAppSendResult { Ok = false, Error = "Message is empty." };
            var payload = new
            {
                messaging_product = "whatsapp",
                recipient_type = "individual",
                to,
                type = "text",
                text = new { preview_url = false, body = text.Length > 4000 ? text.Substring(0, 4000) : text },
            };
            return await PostAsync(cfg, payload, ct);
        }

        public async Task<(bool Ok, string? Json, string? Error)> GraphGetAsync(string pathAndQuery, string? accessToken = null, string? apiVersion = null, CancellationToken ct = default)
        {
            var cfg = Cfg;
            var token = string.IsNullOrWhiteSpace(accessToken) ? cfg.AccessToken : accessToken;
            if (string.IsNullOrWhiteSpace(token)) return (false, null, "Add the access token first.");
            var version = string.IsNullOrWhiteSpace(apiVersion) ? cfg.ApiVersion : apiVersion;
            try
            {
                var client = _http.CreateClient("whatsapp");
                using var req = new HttpRequestMessage(HttpMethod.Get, $"https://graph.facebook.com/{version}/{pathAndQuery.TrimStart('/')}");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var res = await client.SendAsync(req, ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (res.IsSuccessStatusCode) return (true, body, null);
                return (false, null, ErrorOf(body, (int)res.StatusCode));
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                _logger.LogWarning(ex, "WhatsApp Graph read failed");
                return (false, null, "Could not reach WhatsApp.");
            }
        }

        public async Task<(bool Ok, string? Json, string? Error)> GraphPostAsync(string path, object body, CancellationToken ct = default)
        {
            var cfg = Cfg;
            if (string.IsNullOrWhiteSpace(cfg.AccessToken)) return (false, null, "WhatsApp isn't connected yet (Settings → WhatsApp setup).");
            try
            {
                var client = _http.CreateClient("whatsapp");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{cfg.ApiVersion}/{path.TrimStart('/')}");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
                req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                using var res = await client.SendAsync(req, ct);
                var text = await res.Content.ReadAsStringAsync(ct);
                if (res.IsSuccessStatusCode) return (true, text, null);
                _logger.LogWarning("WhatsApp Graph write failed ({Status}): {Body}", (int)res.StatusCode, text);
                return (false, null, ErrorOf(text, (int)res.StatusCode));
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                _logger.LogWarning(ex, "WhatsApp Graph write failed");
                return (false, null, "Could not reach WhatsApp.");
            }
        }

        private static string ErrorOf(string body, int status)
        {
            string error = $"WhatsApp returned {status}";
            try
            {
                using var errDoc = JsonDocument.Parse(body);
                if (errDoc.RootElement.TryGetProperty("error", out var err))
                {
                    if (err.TryGetProperty("error_user_msg", out var um) && um.GetString() is string u && u.Length > 0) return u;
                    if (err.TryGetProperty("message", out var msg)) error = msg.GetString() ?? error;
                }
            }
            catch (JsonException) { }
            return error;
        }

        private async Task<WhatsAppSendResult> PostAsync(WhatsAppConfig cfg, object payload, CancellationToken ct)
        {
            try
            {
                var client = _http.CreateClient("whatsapp");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{cfg.ApiVersion}/{cfg.PhoneNumberId}/messages");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
                req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                using var res = await client.SendAsync(req, ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode)
                {
                    _logger.LogWarning("WhatsApp send failed ({Status}): {Body}", (int)res.StatusCode, body);
                    return new WhatsAppSendResult { Ok = false, Error = ErrorOf(body, (int)res.StatusCode) };
                }

                using var doc = JsonDocument.Parse(body);
                string? id = null;
                if (doc.RootElement.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array && msgs.GetArrayLength() > 0
                    && msgs[0].TryGetProperty("id", out var idProp))
                {
                    id = idProp.GetString();
                }
                return new WhatsAppSendResult { Ok = true, MessageId = id };
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException || ex is JsonException)
            {
                _logger.LogWarning(ex, "WhatsApp send error");
                return new WhatsAppSendResult { Ok = false, Error = "Could not reach WhatsApp." };
            }
        }
    }
}
