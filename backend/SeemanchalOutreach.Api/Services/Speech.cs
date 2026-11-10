using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Speech to text with Groq's Whisper models: a short clip from the app comes back as written text in the speaker's
    /// language (Hindi, Bangla, English; Hinglish is written in Latin letters). The clip goes to Groq only to be written
    /// out; neither the audio nor the text is kept on the server, and only the length is logged.
    /// </summary>
    public class SpeechService
    {
        public const long MaxBytes = 4 * 1024 * 1024;   // about 2–4 minutes of the app's compressed audio
        private readonly IHttpClientFactory _http;
        private readonly AnalystSettings _settings;
        private readonly IMemoryCache _cache;
        private readonly ILogger<SpeechService> _logger;

        public SpeechService(IHttpClientFactory http, IOptions<AnalystSettings> settings, IMemoryCache cache, ILogger<SpeechService> logger)
        {
            _http = http;
            _settings = settings.Value;
            _cache = cache;
            _logger = logger;
        }

        public bool Configured => !string.IsNullOrWhiteSpace(_settings.ApiKey);

        private static string DayKey(string who) => $"speech:{who}:{IstClock.NowIst:yyyyMMdd}";

        /// <summary>Seconds of speech this person has had written out today (kept in memory; resets at IST midnight or a restart).</summary>
        public double UsedToday(string who) => _cache.TryGetValue(DayKey(who), out double s) ? s : 0;

        public bool OverDailyLimit(string who) => UsedToday(who) >= _settings.SpeechDailyMinutes * 60;

        private void AddUse(string who, double seconds)
        {
            var key = DayKey(who);
            _cache.Set(key, UsedToday(who) + seconds, TimeSpan.FromHours(26));
        }

        /// <summary>Whisper's language code for the app's language. Hinglish has no code of its own: Whisper picks it up from the hint.</summary>
        public static string? WhisperLanguage(string? lang) => (lang ?? "").Trim().ToLowerInvariant() switch
        {
            "hi" or "hindi" => "hi",
            "bn" or "bangla" or "bengali" => "bn",
            "en" or "english" => "en",
            _ => null,
        };

        public async Task<(string Text, double Seconds, string? Language)> TranscribeAsync(Stream audio, string fileName, string contentType, string who, string? lang, string hint, CancellationToken ct)
        {
            if (!Configured) throw new AnalystUnavailableException("Speech to text isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey).");
            using var form = new MultipartFormDataContent();
            var file = new StreamContent(audio);
            file.Headers.ContentType = new MediaTypeHeaderValue(string.IsNullOrWhiteSpace(contentType) ? "audio/mp4" : contentType);
            form.Add(file, "file", fileName);
            form.Add(new StringContent(_settings.SpeechModel), "model");
            form.Add(new StringContent("verbose_json"), "response_format");
            form.Add(new StringContent("0"), "temperature");
            var code = WhisperLanguage(lang);
            if (code != null) form.Add(new StringContent(code), "language");
            if (!string.IsNullOrWhiteSpace(hint)) form.Add(new StringContent(hint.Length > 600 ? hint[..600] : hint), "prompt");

            var client = _http.CreateClient("groq");
            using var req = new HttpRequestMessage(HttpMethod.Post, _settings.BaseUrl.TrimEnd('/') + "/audio/transcriptions") { Content = form };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);
            using var res = await client.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                // Never log the body of a success (it is what was said); errors carry no speech.
                _logger.LogWarning("Groq speech returned {Status}: {Body}", (int)res.StatusCode, body.Length > 400 ? body[..400] : body);
                throw new AnalystUnavailableException((int)res.StatusCode switch
                {
                    401 => "The Groq API key was refused. Check Groq__ApiKey on the server.",
                    413 => "That recording is too long. Keep it under a minute.",
                    429 => "Speech to text is busy just now. Try again in a minute, or type it.",
                    _ => "Couldn't turn the recording into text just now. Try again, or type it.",
                });
            }
            var json = JsonNode.Parse(body)?.AsObject();
            var text = (json?["text"]?.GetValue<string>() ?? "").Trim();
            var seconds = json?["duration"]?.GetValue<double>() ?? 0;
            var language = json?["language"]?.GetValue<string>();
            AddUse(who, Math.Max(seconds, 1));
            _logger.LogInformation("Speech to text: {Seconds:0.0}s for {Who}", seconds, who);
            return (text, seconds, language);
        }
    }

    /// <summary>The app's microphone: a short recording in, written text out.</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/speech")]
    public class SpeechController : ControllerBase
    {
        private static readonly string[] AudioExt = { ".m4a", ".mp4", ".aac", ".mp3", ".wav", ".ogg", ".opus", ".webm", ".flac", ".3gp", ".amr" };
        private readonly SpeechService _speech;
        private readonly IMarketingDbContext _db;

        public SpeechController(SpeechService speech, IMarketingDbContext db)
        {
            _speech = speech;
            _db = db;
        }

        /// <summary>Whether the microphone can be offered, and how much of today's allowance is left.</summary>
        [HttpGet("status")]
        public IActionResult Status([FromServices] IOptions<AnalystSettings> settings)
        {
            var me = User.AgentIdOf();
            var limit = settings.Value.SpeechDailyMinutes * 60;
            return Ok(new { on = _speech.Configured, secondsLeftToday = Math.Max(0, (int)(limit - _speech.UsedToday(me))) });
        }

        /// <summary>
        /// Turns a recording into text. <c>lang</c> is the app's language (hi, bn, en, hinglish); <c>field</c> says what it is
        /// for (note, name, chat, question) so names come out spelt as names.
        /// </summary>
        [HttpPost("transcribe")]
        [RequestSizeLimit(SpeechService.MaxBytes + 200_000)]
        [RequestFormLimits(MultipartBodyLengthLimit = SpeechService.MaxBytes + 200_000)]
        public async Task<IActionResult> Transcribe([FromForm] IFormFile file, [FromForm] string? lang, [FromForm] string? field, CancellationToken ct)
        {
            if (!_speech.Configured) return StatusCode(503, new { message = "Speech to text isn't switched on yet. Ask your manager." });
            var me = User.AgentIdOf();
            if (string.IsNullOrEmpty(me)) return Unauthorized();
            if (file == null || file.Length == 0) return BadRequest(new { message = "Nothing was recorded. Hold the button and speak." });
            if (file.Length > SpeechService.MaxBytes) return BadRequest(new { message = "That recording is too long. Keep it under a minute." });
            var ext = System.IO.Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!AudioExt.Contains(ext)) return BadRequest(new { message = "That isn't a recording the app can send." });
            if (_speech.OverDailyLimit(me)) return StatusCode(429, new { message = "Today's speech allowance is used up. Please type for now; it's back tomorrow." });

            var hint = await HintAsync(lang, field, ct);
            try
            {
                await using var s = file.OpenReadStream();
                var (text, seconds, language) = await _speech.TranscribeAsync(s, "clip" + ext, file.ContentType, me, lang, hint, ct);
                if (text.Length == 0) return Ok(new { text = "", seconds, language, message = "Couldn't hear any words. Try again a little closer to the phone." });
                return Ok(new { text, seconds, language });
            }
            catch (AnalystUnavailableException ex) { return StatusCode(502, new { message = ex.Message }); }
            catch (HttpRequestException) { return StatusCode(502, new { message = "Couldn't reach speech to text just now. Try again, or type it." }); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return StatusCode(504, new { message = "Speech to text took too long. Try a shorter recording." }); }
        }

        /// <summary>
        /// Words Whisper should expect, so they come out spelt right: the hospital's departments and everyday field words.
        /// For Hinglish the hint itself is in Latin letters, which makes Whisper write in Latin letters too.
        /// </summary>
        private async Task<string> HintAsync(string? lang, string? field, CancellationToken ct)
        {
            var depts = await _db.Departments.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Order).Select(d => d.Name).Take(20).ToListAsync(ct);
            var words = "OPD, ASHA, ANM, PHC, mukhiya, panchayat, referral, camp, " + string.Join(", ", depts);
            var l = (lang ?? "").Trim().ToLowerInvariant();
            var lead = l switch
            {
                "hinglish" => "Doctor sahab se mile, kal OPD mein do patient bhejenge. ",
                "hi" or "hindi" => "डॉक्टर साहब से मिले, कल ओपीडी में दो मरीज़ भेजेंगे। ",
                "bn" or "bangla" or "bengali" => "ডাক্তারবাবুর সঙ্গে দেখা হয়েছে, কাল ওপিডিতে দুজন রোগী পাঠাবেন। ",
                _ => "Met the doctor; he will send two patients to the OPD tomorrow. ",
            };
            var kind = (field ?? "").Trim().ToLowerInvariant() == "name" ? "A person's name. " : "";
            return kind + lead + words;
        }
    }
}
