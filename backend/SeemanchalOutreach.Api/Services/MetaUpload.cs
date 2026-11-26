using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Files sent to Meta for WhatsApp: the resumable upload (gives a handle, for the profile photo and for the sample
    /// picture a template with a picture needs for review), and the media upload (gives a media ID to send in messages).
    /// </summary>
    public static class MetaUpload
    {
        public const string AppIdKey = WhatsAppConfig.Prefix + "appId";
        private static readonly Regex Digits = new(@"^\d{5,25}$");

        /// <summary>image/jpeg | image/png | application/pdf | video/mp4, from the first bytes; null for anything else.</summary>
        public static string? Sniff(byte[] b)
        {
            if (b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8) return "image/jpeg";
            if (b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
            if (b.Length > 4 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46) return "application/pdf";
            if (b.Length > 12 && b[4] == 0x66 && b[5] == 0x74 && b[6] == 0x79 && b[7] == 0x70) return "video/mp4";
            return null;
        }

        /// <summary>The header kind WhatsApp uses for a file type.</summary>
        public static string? HeaderType(string mime) => mime switch
        {
            "image/jpeg" or "image/png" => "image",
            "application/pdf" => "document",
            "video/mp4" => "video",
            _ => null,
        };

        /// <summary>Meta's size limits for sending.</summary>
        public static long MaxBytes(string headerType) => headerType switch { "image" => 5L << 20, _ => 16L << 20 };

        private static string? Str(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        public static string MetaError(string json, string fallback)
        {
            try
            {
                using var d = JsonDocument.Parse(json);
                if (d.RootElement.TryGetProperty("error", out var e))
                {
                    var m = Str(e, "error_user_msg") ?? Str(e, "message");
                    if (!string.IsNullOrWhiteSpace(m)) return $"{fallback}: {m}";
                }
            }
            catch (JsonException) { }
            return fallback + ".";
        }

        /// <summary>
        /// Resumable upload → handle. The app it goes through: the one typed in, saved before, asked of Meta from the
        /// token, or the Facebook &amp; Instagram setup's. A working one is remembered.
        /// </summary>
        public static async Task<(string? Handle, string? Error, bool NeedAppId)> HandleAsync(
            IHttpClientFactory http, IWhatsAppSender wa, IAppSettings settings, WhatsAppConfig cfg,
            byte[] bytes, string mime, string fileName, string? appIdTyped, string by, CancellationToken ct)
        {
            var app = (appIdTyped ?? "").Trim();
            if (app.Length > 0 && !Digits.IsMatch(app)) return (null, "The App ID is digits only (Meta app → App settings → Basic).", true);
            if (app.Length == 0) app = settings.Get(AppIdKey) ?? "";
            if (app.Length == 0)
            {
                var me = await wa.GraphGetAsync("app?fields=id", null, null, ct);
                if (me.Ok) { using var d = JsonDocument.Parse(me.Json!); app = Str(d.RootElement, "id") ?? ""; }
            }
            if (app.Length == 0)
            {
                var meta = MetaConfig.Load(settings).AppId;
                if (!string.IsNullOrWhiteSpace(meta)) app = meta.Trim();
            }
            if (app.Length == 0) return (null, "Enter the Meta App ID (Meta app → App settings → Basic) and try again.", true);

            var client = http.CreateClient("meta");
            var baseUrl = $"https://graph.facebook.com/{cfg.ApiVersion}";
            string? handle;
            try
            {
                using var start = new HttpRequestMessage(HttpMethod.Post,
                    $"{baseUrl}/{app}/uploads?file_name={Uri.EscapeDataString(fileName)}&file_length={bytes.Length}&file_type={Uri.EscapeDataString(mime)}");
                start.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
                using var sr = await client.SendAsync(start, ct);
                var sj = await sr.Content.ReadAsStringAsync(ct);
                if (!sr.IsSuccessStatusCode) return (null, MetaError(sj, "Meta didn't accept the upload"), true);
                string? session;
                using (var sd = JsonDocument.Parse(sj)) session = Str(sd.RootElement, "id");
                if (string.IsNullOrEmpty(session) || !session.StartsWith("upload:")) return (null, "Meta didn't start the upload.", false);

                using var up = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/{session}");
                up.Headers.TryAddWithoutValidation("Authorization", "OAuth " + cfg.AccessToken);
                up.Headers.TryAddWithoutValidation("file_offset", "0");
                up.Content = new ByteArrayContent(bytes);
                up.Content.Headers.ContentType = new MediaTypeHeaderValue(mime);
                using var ur = await client.SendAsync(up, ct);
                var uj = await ur.Content.ReadAsStringAsync(ct);
                if (!ur.IsSuccessStatusCode) return (null, MetaError(uj, "The file didn't upload"), false);
                using (var ud = JsonDocument.Parse(uj)) handle = Str(ud.RootElement, "h");
                if (string.IsNullOrEmpty(handle)) return (null, "Meta didn't return the file.", false);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
            {
                return (null, "Couldn't reach Meta. Try again.", false);
            }
            if (settings.Get(AppIdKey) != app)
                await settings.SetAsync(new Dictionary<string, string?> { [AppIdKey] = app }, WhatsAppConfig.SecretKeys.ToList(), by, ct);
            return (handle, null, false);
        }

        /// <summary>Media upload to the phone number → a media ID to send (Meta keeps it 30 days).</summary>
        public static async Task<(string? Id, string? Error)> MediaAsync(IHttpClientFactory http, WhatsAppConfig cfg, byte[] bytes, string mime, string fileName, CancellationToken ct)
        {
            try
            {
                var client = http.CreateClient("meta");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.facebook.com/{cfg.ApiVersion}/{cfg.PhoneNumberId}/media");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
                var form = new MultipartFormDataContent();
                form.Add(new StringContent("whatsapp"), "messaging_product");
                form.Add(new StringContent(mime), "type");
                var file = new ByteArrayContent(bytes);
                file.Headers.ContentType = new MediaTypeHeaderValue(mime);
                form.Add(file, "file", fileName);
                req.Content = form;
                using var res = await client.SendAsync(req, ct);
                var j = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode) return (null, MetaError(j, "WhatsApp didn't take the file"));
                using var d = JsonDocument.Parse(j);
                var id = Str(d.RootElement, "id");
                return id == null ? (null, "WhatsApp didn't return the file.") : (id, null);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException)
            {
                return (null, "Couldn't reach WhatsApp. Try again.");
            }
        }

        /// <summary>A file name safe to pass on: letters, digits, dot, dash, underscore; at most 60 characters.</summary>
        public static string SafeName(string? name, string fallback)
        {
            var n = Regex.Replace(System.IO.Path.GetFileName(name ?? ""), @"[^\w.\- ]", "").Trim();
            if (n.Length == 0) n = fallback;
            return n.Length > 60 ? n[^60..] : n;
        }
    }
}
