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
    /// WhatsApp Cloud API sender. Configuration (appsettings "WhatsApp" section or env vars):
    ///   WhatsApp__PhoneNumberId   – the hospital's WhatsApp business phone number id
    ///   WhatsApp__AccessToken     – a permanent system-user access token
    ///   WhatsApp__ApiVersion      – Graph API version, default v21.0
    ///   WhatsApp__Templates__doctor_availability (etc.) – approved template names per broadcast kind
    /// Without PhoneNumberId + AccessToken nothing is sent and broadcasts fail with a clear message.
    /// </summary>
    public class WhatsAppCloudSender : IWhatsAppSender
    {
        private readonly IHttpClientFactory _http;
        private readonly IConfiguration _config;
        private readonly ILogger<WhatsAppCloudSender> _logger;

        public WhatsAppCloudSender(IHttpClientFactory http, IConfiguration config, ILogger<WhatsAppCloudSender> logger)
        {
            _http = http;
            _config = config;
            _logger = logger;
        }

        private string? PhoneNumberId => _config["WhatsApp:PhoneNumberId"];
        private string? AccessToken => _config["WhatsApp:AccessToken"];

        public bool IsConfigured => !string.IsNullOrWhiteSpace(PhoneNumberId) && !string.IsNullOrWhiteSpace(AccessToken);

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
            if (!IsConfigured) return new WhatsAppSendResult { Ok = false, Error = "WhatsApp is not configured on the server." };

            var to = NormalizeIndianPhone(toPhone);
            if (to == null) return new WhatsAppSendResult { Ok = false, Error = "Phone number is not a valid Indian mobile number." };

            string template = _config[$"WhatsApp:Templates:{kind}"] ?? kind;
            string version = _config["WhatsApp:ApiVersion"] ?? "v21.0";
            string langCode = language == "en" ? (_config["WhatsApp:EnglishCode"] ?? "en") : (_config["WhatsApp:HindiCode"] ?? "hi");

            var payload = new
            {
                messaging_product = "whatsapp",
                to,
                type = "template",
                template = new
                {
                    name = template,
                    language = new { code = langCode },
                    components = new object[]
                    {
                        new
                        {
                            type = "body",
                            parameters = bodyParams.Select(p => new { type = "text", text = string.IsNullOrWhiteSpace(p) ? "-" : p }).ToArray(),
                        },
                    },
                },
            };

            try
            {
                var client = _http.CreateClient("whatsapp");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{version}/{PhoneNumberId}/messages");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
                req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                using var res = await client.SendAsync(req, ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode)
                {
                    _logger.LogWarning("WhatsApp send failed ({Status}): {Body}", (int)res.StatusCode, body);
                    string error = $"WhatsApp returned {(int)res.StatusCode}";
                    try
                    {
                        using var errDoc = JsonDocument.Parse(body);
                        if (errDoc.RootElement.TryGetProperty("error", out var err) && err.TryGetProperty("message", out var msg))
                            error = msg.GetString() ?? error;
                    }
                    catch (JsonException) { }
                    return new WhatsAppSendResult { Ok = false, Error = error };
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
