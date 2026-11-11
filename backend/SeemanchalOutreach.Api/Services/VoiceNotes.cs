using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Voice notes people send on WhatsApp, written out as text. Many people here speak rather than type, and a voice
    /// note used to show only as "🎤 Voice message" until someone played it. Now the words appear in the inbox, and the
    /// Lead Responder can read the question like any other.
    ///
    /// Runs after the webhook has answered Meta (never delays it). The recording is fetched from Meta, sent to the same
    /// speech service the app's microphone uses, and not kept: only the text is saved. If anything fails the message
    /// simply stays "🎤 Voice message" and a person listens to it, as before.
    /// </summary>
    public class VoiceNotes
    {
        public const string Marker = "🎤 Voice message";
        private const string Who = "whatsapp-leads";       // one shared daily allowance for all incoming voice notes
        private const long MaxBytes = 4 * 1024 * 1024;     // about 4 minutes; longer ones are left for a person
        private readonly IHttpClientFactory _http;
        private readonly IServiceScopeFactory _scopes;
        private readonly SpeechService _speech;
        private readonly AgentEvents _agents;
        private readonly ILogger<VoiceNotes> _log;

        public VoiceNotes(IHttpClientFactory http, IServiceScopeFactory scopes, SpeechService speech, AgentEvents agents, ILogger<VoiceNotes> log)
        {
            _http = http; _scopes = scopes; _speech = speech; _agents = agents; _log = log;
        }

        public record Note(string WaMessageId, string MediaId, Guid? LeadId);

        /// <summary>Starts the work and returns at once. The Vita agents are told about each lead when its note is done (or has failed).</summary>
        public void Queue(IReadOnlyCollection<Note> notes)
        {
            if (notes.Count == 0) return;
            _ = Task.Run(async () =>
            {
                foreach (var n in notes)
                {
                    try { await OneAsync(n); }
                    catch (Exception ex) { _log.LogInformation("Voice note not written out: {Error}", ex.Message); }
                    if (n.LeadId != null) _agents.Publish("lead.message", n.LeadId.Value.ToString());
                }
            });
        }

        /// <summary>What is saved for a voice note once its words are known.</summary>
        public static string Written(string said)
        {
            said = (said ?? "").Trim();
            if (said.Length > 1500) said = said[..1500] + "…";
            return said.Length == 0 ? Marker : $"{Marker}: “{said}”";
        }

        private async Task OneAsync(Note n)
        {
            if (!_speech.Configured || _speech.OverDailyLimit(Who)) return;
            using var scope = _scopes.CreateScope();
            var sp = scope.ServiceProvider;
            var cfg = LeadInbox.Wa(sp.GetRequiredService<IAppSettings>(), sp.GetRequiredService<IConfiguration>());
            if (!cfg.IsConfigured) return;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(75));
            var ct = cts.Token;
            var client = _http.CreateClient("meta");

            // 1. Where the recording is (Meta gives a short-lived address).
            using var infoReq = new HttpRequestMessage(HttpMethod.Get, $"https://graph.facebook.com/{cfg.ApiVersion}/{Uri.EscapeDataString(n.MediaId)}");
            infoReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
            using var infoRes = await client.SendAsync(infoReq, ct);
            if (!infoRes.IsSuccessStatusCode) throw new InvalidOperationException($"Meta media lookup {(int)infoRes.StatusCode}");
            using var info = JsonDocument.Parse(await infoRes.Content.ReadAsStringAsync(ct));
            var url = info.RootElement.TryGetProperty("url", out var u) ? u.GetString() : null;
            var mime = info.RootElement.TryGetProperty("mime_type", out var mt) ? (mt.GetString() ?? "audio/ogg") : "audio/ogg";
            var size = info.RootElement.TryGetProperty("file_size", out var fs) && fs.TryGetInt64(out var b) ? b : 0;
            if (string.IsNullOrEmpty(url) || !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
            if (size > MaxBytes) return;

            // 2. The recording itself, held in memory only.
            using var fileReq = new HttpRequestMessage(HttpMethod.Get, url);
            fileReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", cfg.AccessToken);
            using var fileRes = await client.SendAsync(fileReq, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!fileRes.IsSuccessStatusCode) throw new InvalidOperationException($"Meta media download {(int)fileRes.StatusCode}");
            if (fileRes.Content.Headers.ContentLength > MaxBytes) return;
            await using var audio = new MemoryStream();
            await fileRes.Content.CopyToAsync(audio, ct);
            if (audio.Length == 0 || audio.Length > MaxBytes) return;
            audio.Position = 0;

            // 3. Words. No language is forced: people write to the hospital in Hindi, Hinglish, Bangla, Urdu and Surjapuri.
            var type = mime.Split(';')[0].Trim();
            var ext = type.EndsWith("mpeg") ? ".mp3" : type.EndsWith("mp4") || type.EndsWith("aac") ? ".m4a" : type.EndsWith("amr") ? ".amr" : ".ogg";
            var (text, _, _) = await _speech.TranscribeAsync(audio, "voice" + ext, type, Who, null,
                "A person asking a hospital on WhatsApp: doctor, OPD timing, appointment, camp, report, fees.", ct);
            if (string.IsNullOrWhiteSpace(text)) return;

            // 4. Save the words on the message, and wherever the inbox shows its last line.
            var db = sp.GetRequiredService<IMarketingDbContext>();
            var msg = await db.WaMessages.FirstOrDefaultAsync(m => m.WaMessageId == n.WaMessageId && m.Direction == "in", ct);
            if (msg == null) return;
            var written = Written(text);
            msg.Text = written;
            var shortLine = LeadInbox.Shorten(written, 150);
            if (msg.LeadId != null || n.LeadId != null)
            {
                var leadId = msg.LeadId ?? n.LeadId;
                var lead = await db.Leads.FirstOrDefaultAsync(l => l.Id == leadId, ct);
                if (lead != null)
                {
                    if (lead.LastMessage == Marker) lead.LastMessage = shortLine;
                    if (lead.Note == Marker) lead.Note = LeadInbox.Shorten(written, 500);
                }
            }
            var conv = await db.WaConversations.FirstOrDefaultAsync(c => c.Phone == msg.Phone, ct);
            if (conv != null && conv.LastMessage == Marker) conv.LastMessage = shortLine;
            await db.SaveChangesAsync(ct);
            await sp.GetRequiredService<ILiveEvents>().PublishAsync(new LiveEvent { Kind = "lead", Text = "A voice message was written out", RefId = (msg.LeadId ?? n.LeadId)?.ToString() });
        }
    }
}
