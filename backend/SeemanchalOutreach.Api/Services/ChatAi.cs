using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Hides private details before chat text goes to Groq, and puts them back in what comes back.
    /// Phone numbers, ID numbers (12-digit Aadhaar and any other long number), email addresses and the names of
    /// patients the hospital knows about become tokens such as ⟦P1⟧; the AI is told to copy tokens unchanged.
    /// </summary>
    public class Redactor
    {
        private static readonly Regex Aadhaar = new(@"(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)", RegexOptions.Compiled);
        private static readonly Regex Phone = new(@"(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)", RegexOptions.Compiled);
        private static readonly Regex LongNumber = new(@"(?<!\d)\d(?:[\s-]?\d){9,}(?!\d)", RegexOptions.Compiled);
        private static readonly Regex Email = new(@"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", RegexOptions.Compiled);
        private static readonly Regex Token = new(@"⟦[A-Z]\d+⟧", RegexOptions.Compiled);

        private readonly Regex? _names;
        private readonly Dictionary<string, string> _back = new();
        private readonly Dictionary<string, string> _seen = new(StringComparer.OrdinalIgnoreCase);
        private int _n;

        public Redactor(Regex? patientNames) { _names = patientNames; }

        private string Swap(string value, char kind)
        {
            if (_seen.TryGetValue(kind + value, out var t)) return t;
            t = $"⟦{kind}{++_n}⟧";
            _seen[kind + value] = t;
            _back[t] = value;
            return t;
        }

        public string Hide(string? text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var s = Token.Replace(text, "");                    // nobody gets to fake a token
            s = Email.Replace(s, m => Swap(m.Value, 'E'));
            s = Aadhaar.Replace(s, m => Swap(m.Value, 'I'));
            s = Phone.Replace(s, m => Swap(m.Value, 'N'));
            s = LongNumber.Replace(s, m => Swap(m.Value, 'I'));
            if (_names != null) s = _names.Replace(s, m => Swap(m.Value, 'P'));
            return s;
        }

        /// <summary>Puts the hidden details back. A token the AI invented or mangled is dropped.</summary>
        public string Restore(string? text) =>
            string.IsNullOrEmpty(text) ? "" : Token.Replace(text, m => _back.TryGetValue(m.Value, out var v) ? v : "");

        public const string Rule =
            "Text in ⟦ ⟧ (for example ⟦P1⟧, ⟦N2⟧) stands for a hidden name or number: copy each such token exactly as it is, never translate, explain or guess it.";
    }

    public enum ChatAiFeature { Translate, Replies, Summary, Tasks }

    public class ChatAiException : Exception
    {
        public int Status { get; }
        public ChatAiException(int status, string message) : base(message) { Status = status; }
    }

    /// <summary>
    /// Smart chat, powered by Groq: translation into the reader's language, suggested replies, catch-up summaries, the
    /// office's morning digest, and spotting tasks in chat. Each feature is switched on by an admin in the CRM (all off at
    /// first). The AI only suggests: nothing is sent, saved or changed until a person taps. Private details are hidden
    /// first (<see cref="Redactor"/>); results are kept in memory only, never in the database.
    /// </summary>
    public class ChatAiService
    {
        public static readonly Dictionary<ChatAiFeature, string> Keys = new()
        {
            [ChatAiFeature.Translate] = "chatai.translate",
            [ChatAiFeature.Replies] = "chatai.replies",
            [ChatAiFeature.Summary] = "chatai.summary",
            [ChatAiFeature.Tasks] = "chatai.tasks",
        };

        public static readonly Dictionary<string, string> LangNames = new()
        {
            ["en"] = "English",
            ["hi"] = "Hindi (Devanagari script)",
            ["bn"] = "Bengali / Bangla (Bengali script)",
            ["hinglish"] = "Hinglish (Hindi written in Latin letters, the way people text in Bihar, mixing in English words)",
        };

        private readonly GroqClient _groq;
        private readonly AnalystSettings _settings;
        private readonly IAppSettings _app;
        private readonly IMemoryCache _cache;
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<ChatAiService> _logger;

        public ChatAiService(GroqClient groq, IOptions<AnalystSettings> settings, IAppSettings app, IMemoryCache cache,
            IServiceScopeFactory scopes, ILogger<ChatAiService> logger)
        {
            _groq = groq;
            _settings = settings.Value;
            _app = app;
            _cache = cache;
            _scopes = scopes;
            _logger = logger;
        }

        public bool Configured => _groq.Configured;
        public bool On(ChatAiFeature f) => Configured && _app.Get(Keys[f]) == "on";

        public object Status() => new
        {
            configured = Configured,
            translate = On(ChatAiFeature.Translate),
            replies = On(ChatAiFeature.Replies),
            summary = On(ChatAiFeature.Summary),
            tasks = On(ChatAiFeature.Tasks),
        };

        public static string NormLang(string? lang) => (lang ?? "").Trim().ToLowerInvariant() switch
        {
            "hi" or "hindi" => "hi",
            "bn" or "bangla" or "bengali" => "bn",
            "hinglish" => "hinglish",
            _ => "en",
        };

        // ─── Limits ──────────────────────────────────────────────────────────

        private static string DayKey(string who) => $"chatai:{who}:{IstClock.NowIst:yyyyMMdd}";

        /// <summary>Counts one request against today's allowance, or refuses when it is used up.</summary>
        public void Spend(string who, ChatAiFeature f)
        {
            if (!Configured) throw new ChatAiException(503, "Smart chat isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey).");
            if (!On(f)) throw new ChatAiException(503, "This smart chat feature is switched off. An admin can switch it on in Chat → Smart chat.");
            var key = DayKey(who);
            var used = _cache.TryGetValue(key, out int n) ? n : 0;
            if (used >= _settings.ChatAiDailyCalls) throw new ChatAiException(429, "Today's smart chat allowance is used up. It's back tomorrow.");
            _cache.Set(key, used + 1, TimeSpan.FromHours(26));
        }

        // ─── Patient names to hide ───────────────────────────────────────────

        /// <summary>
        /// Names of patients the hospital knows about (referrals from the last year, recent leads and camp patients),
        /// as one pattern, refreshed every 10 minutes.
        /// </summary>
        public async Task<Regex?> PatientNamesAsync(CancellationToken ct)
        {
            if (_cache.TryGetValue("chatai:patients", out Regex? cached)) return cached;
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var since = DateTime.UtcNow.AddDays(-365);
            var recent = DateTime.UtcNow.AddDays(-90);
            var names = new List<string>();
            names.AddRange(await db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= since).OrderByDescending(r => r.CreatedAt)
                .Select(r => r.PatientName).Take(4000).ToListAsync(ct));
            names.AddRange(await db.Leads.AsNoTracking().Where(l => l.CreatedAt >= recent).OrderByDescending(l => l.CreatedAt)
                .Select(l => l.Name).Take(1500).ToListAsync(ct));
            names.AddRange(await db.CampPatients.AsNoTracking().OrderByDescending(p => p.ArrivedAt).Select(p => p.Name).Take(3000).ToListAsync(ct));
            var clean = names.Select(n => Regex.Replace(n ?? "", @"\s+", " ").Trim())
                .Where(n => n.Length >= 3 && n.Any(char.IsLetter))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderByDescending(n => n.Length)                          // "Rekha Devi" before "Rekha"
                .Take(6000)
                .Select(Regex.Escape)
                .ToList();
            Regex? rx = clean.Count == 0 ? null
                : new Regex(@"(?<![\p{L}\p{M}])(?:" + string.Join("|", clean) + @")(?![\p{L}\p{M}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
            _cache.Set("chatai:patients", rx, TimeSpan.FromMinutes(10));
            return rx;
        }

        public async Task<Redactor> RedactorAsync(CancellationToken ct) => new(await PatientNamesAsync(ct));

        // ─── Groq ────────────────────────────────────────────────────────────

        private async Task<JsonObject> AskJsonAsync(string system, string user, string name, JsonObject schema, bool fast, CancellationToken ct, double temperature = 0.2)
        {
            var messages = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = system + "\n" + Redactor.Rule },
                new JsonObject { ["role"] = "user", ["content"] = user },
            };
            var format = new JsonObject { ["type"] = "json_schema", ["json_schema"] = new JsonObject { ["name"] = name, ["schema"] = schema } };
            try
            {
                var (msg, _) = await _groq.ChatAsync(messages, null, format, ct, model: fast ? _settings.FastModel : null,
                    temperature: temperature, reasoningEffort: fast ? "low" : "medium", maxPromptChars: 16000);
                var content = msg["content"]?.ToString() ?? "";
                var start = content.IndexOf('{');
                var end = content.LastIndexOf('}');
                if (start < 0 || end <= start) throw new ChatAiException(502, "The AI's answer couldn't be read. Try again.");
                return JsonNode.Parse(content[start..(end + 1)])!.AsObject();
            }
            catch (AnalystUnavailableException ex) { throw new ChatAiException(502, ex.Message); }
            catch (System.Text.Json.JsonException) { throw new ChatAiException(502, "The AI's answer couldn't be read. Try again."); }
            catch (System.Net.Http.HttpRequestException) { throw new ChatAiException(502, "Couldn't reach the AI just now. Try again."); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new ChatAiException(504, "The AI took too long. Try again."); }
        }

        private static JsonObject Obj(params (string Key, JsonNode Value)[] props)
        {
            var o = new JsonObject();
            foreach (var (k, v) in props) o[k] = v;
            return o;
        }

        private static JsonObject Str() => new() { ["type"] = "string" };
        private static JsonObject Bool() => new() { ["type"] = "boolean" };
        private static JsonObject Arr(JsonObject items, int max) => new() { ["type"] = "array", ["items"] = items, ["maxItems"] = max };
        private static JsonObject Schema(JsonObject props, params string[] required) => new()
        {
            ["type"] = "object",
            ["properties"] = props,
            ["required"] = new JsonArray(required.Select(r => (JsonNode)JsonValue.Create(r)!).ToArray()),
            ["additionalProperties"] = false,
        };

        // ─── 1. Translation ──────────────────────────────────────────────────

        private static int Count(string s, int from, int to) => s.Count(c => c >= from && c <= to);

        /// <summary>Plainly already in the reader's language (by its script), so there is nothing to translate.</summary>
        public static bool AlreadyIn(string text, string lang)
        {
            var letters = text.Count(char.IsLetter);
            if (letters == 0) return true;                                    // emoji, numbers
            var deva = Count(text, 0x0900, 0x097F);
            var beng = Count(text, 0x0980, 0x09FF);
            var latin = text.Count(c => c < 0x250 && char.IsLetter(c));
            return lang switch
            {
                "hi" => deva * 2 >= letters,
                "bn" => beng * 2 >= letters,
                // English readers: Latin letters are English or Hinglish; office staff read Hinglish, so leave it.
                "en" => latin * 2 >= letters,
                _ => false,                                                   // Hinglish readers: the AI decides
            };
        }

        public record TranslateIn(Guid Id, string Text);

        /// <summary>Translations for the messages not already in <paramref name="lang"/>; null for one that needs none.</summary>
        public async Task<Dictionary<Guid, string?>> TranslateAsync(string who, IReadOnlyList<TranslateIn> items, string lang, CancellationToken ct)
        {
            lang = NormLang(lang);
            var result = new Dictionary<Guid, string?>();
            var todo = new List<TranslateIn>();
            foreach (var m in items)
            {
                if (string.IsNullOrWhiteSpace(m.Text) || AlreadyIn(m.Text, lang)) { result[m.Id] = null; continue; }
                if (_cache.TryGetValue($"chatai:tr:{m.Id}:{lang}", out string? done)) { result[m.Id] = done; continue; }
                todo.Add(m);
            }
            if (todo.Count == 0) return result;
            Spend(who, ChatAiFeature.Translate);

            var red = await RedactorAsync(ct);
            var sb = new StringBuilder();
            for (int i = 0; i < todo.Count; i++)
                sb.Append("<m id=\"").Append(i + 1).Append("\">").Append(red.Hide(todo[i].Text.Length > 1500 ? todo[i].Text[..1500] : todo[i].Text)).Append("</m>\n");
            var system =
                "You translate short chat messages between a hospital's marketing office and its field agents in rural Bihar (Seemanchal). " +
                $"Translate each message into {LangNames[lang]}. Keep the meaning, tone and any emoji; keep names of people, villages, " +
                "hospitals, departments and medical words (OPD, ASHA, PHC, X-ray…) as they are, written in the target script where natural. " +
                "Be short and natural, the way a colleague would write it. If a message is already in that language, set same=true and text to \"\". " +
                "Never add explanations.";
            var schema = Schema(Obj(("items", Arr(Schema(Obj(("id", Str()), ("same", Bool()), ("text", Str())), "id", "same", "text"), 40))), "items");
            var json = await AskJsonAsync(system, sb.ToString(), "translations", schema, fast: true, ct);
            foreach (var it in json["items"]?.AsArray() ?? new JsonArray())
            {
                if (!int.TryParse(it?["id"]?.ToString(), out var i) || i < 1 || i > todo.Count) continue;
                var m = todo[i - 1];
                var same = it?["same"]?.GetValue<bool>() ?? false;
                var text = red.Restore(it?["text"]?.ToString()).Trim();
                string? value = same || text.Length == 0 || string.Equals(text, m.Text.Trim(), StringComparison.Ordinal) ? null : text;
                result[m.Id] = value;
                _cache.Set($"chatai:tr:{m.Id}:{lang}", value, TimeSpan.FromDays(3));
            }
            foreach (var m in todo.Where(m => !result.ContainsKey(m.Id))) result[m.Id] = null;
            return result;
        }

        // ─── Conversation text ───────────────────────────────────────────────

        public static string Describe(ChatMessage m)
        {
            var parts = new List<string>();
            if (m.FileName != null) parts.Add((m.FileMime ?? "").StartsWith("image/") ? "[sent a photo]" : $"[sent a file: {m.FileName}]");
            if (m.Lat != null) parts.Add("[shared a location]");
            if (!string.IsNullOrWhiteSpace(m.Text)) parts.Add(m.Text.Trim());
            if (m.ContactName != null) parts.Add($"(about partner {m.ContactName})");
            return string.Join(" ", parts);
        }

        /// <summary>Messages as lines for the AI: "[10 Nov 10:15] Priya (office): …", oldest first, private details hidden.</summary>
        public static string Lines(IEnumerable<ChatMessage> messages, Redactor red, int maxChars, Func<ChatMessage, string>? who = null)
        {
            var lines = messages.Select(m =>
            {
                var at = m.CreatedAt + IstClock.Offset;
                var name = who?.Invoke(m) ?? $"{m.SenderName} ({(m.FromOffice ? "office" : "field agent")})";
                var text = Describe(m);
                if (text.Length > 600) text = text[..600] + "…";
                return $"[{at:d MMM HH:mm}] {name}: {red.Hide(text)}";
            }).ToList();
            // Keep the newest when it doesn't all fit.
            var total = 0;
            var kept = new List<string>();
            for (int i = lines.Count - 1; i >= 0; i--)
            {
                total += lines[i].Length + 1;
                if (total > maxChars) break;
                kept.Add(lines[i]);
            }
            kept.Reverse();
            return string.Join("\n", kept);
        }

        // ─── 2. Suggested replies ────────────────────────────────────────────

        public async Task<List<string>> RepliesAsync(string who, string myName, bool office, List<ChatMessage> recent, string lang, CancellationToken ct)
        {
            lang = NormLang(lang);
            var last = recent.LastOrDefault();
            if (last == null) return new();
            var key = $"chatai:re:{last.Id}:{who}:{lang}";
            if (_cache.TryGetValue(key, out List<string>? done) && done != null) return done;
            Spend(who, ChatAiFeature.Replies);
            var red = await RedactorAsync(ct);
            var convo = Lines(recent, red, 5000);
            var role = office ? "a member of the hospital's marketing office" : "a field agent of the hospital's marketing team, working in villages";
            var system =
                $"You suggest replies for {myName}, {role}, in a work chat of a hospital in Bihar. Suggest exactly 3 different short replies " +
                $"{myName} could send next, in {LangNames[lang]}. Each at most 12 words, practical and polite, like a real colleague texting: " +
                "one agreeing or confirming, one giving a time or status, one asking for what is missing (or saying why not). " +
                "Never promise money, medical advice or anything about a patient's health. Never invent facts, places, numbers or names.";
            var schema = Schema(Obj(("replies", Arr(Str(), 3))), "replies");
            var json = await AskJsonAsync(system, $"The chat so far (newest last):\n{convo}\n\nSuggest {myName}'s next reply.", "replies", schema, fast: true, ct, temperature: 0.5);
            var list = (json["replies"]?.AsArray() ?? new JsonArray())
                .Select(r => red.Restore(r?.ToString()).Trim().Trim('"'))
                .Where(r => r.Length > 0 && r.Length <= 160)
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(3).ToList();
            _cache.Set(key, list, TimeSpan.FromHours(6));
            return list;
        }

        // ─── 4. Catch-up summary and the office digest ───────────────────────

        public record Summary(List<string> Points, List<string> ToDo);

        public async Task<Summary> SummaryAsync(string who, string chatName, List<ChatMessage> messages, string lang, CancellationToken ct)
        {
            lang = NormLang(lang);
            var key = $"chatai:sum:{messages.First().Id}:{messages.Last().Id}:{lang}";
            if (_cache.TryGetValue(key, out Summary? done) && done != null) return done;
            Spend(who, ChatAiFeature.Summary);
            var red = await RedactorAsync(ct);
            var convo = Lines(messages, red, 13000);
            var system =
                $"You summarise a work chat ({chatName}) of a hospital's marketing team in Bihar for someone catching up. Write in {LangNames[lang]}. " +
                "Give up to 6 short points with what happened, what was decided and anything urgent first (a patient waiting, a complaint, " +
                "a payment problem, a partner unhappy). Then up to 4 things still to do, each naming who should do it. Only use what is in " +
                "the chat; never guess. Each point at most 25 words.";
            var schema = Schema(Obj(("points", Arr(Str(), 6)), ("todo", Arr(Str(), 4))), "points", "todo");
            var json = await AskJsonAsync(system, convo, "summary", schema, fast: false, ct);
            static List<string> Take(JsonNode? a, Redactor r) => (a?.AsArray() ?? new JsonArray()).Select(x => r.Restore(x?.ToString()).Trim()).Where(x => x.Length > 0).ToList();
            var s = new Summary(Take(json["points"], red), Take(json["todo"], red));
            _cache.Set(key, s, TimeSpan.FromHours(6));
            return s;
        }

        public record DigestChat(string Key, string Name, List<ChatMessage> Messages);
        public record DigestLine(string Key, string Summary, bool Urgent, string? Why);
        public record Digest(string Overview, List<DigestLine> Chats);

        public async Task<Digest> DigestAsync(string who, List<DigestChat> chats, string cacheKey, CancellationToken ct)
        {
            if (_cache.TryGetValue(cacheKey, out Digest? done) && done != null) return done;
            Spend(who, ChatAiFeature.Summary);
            var red = await RedactorAsync(ct);
            var each = Math.Max(600, 14000 / Math.Max(1, chats.Count));
            var sb = new StringBuilder();
            foreach (var c in chats)
                sb.Append("### Chat ").Append(c.Key).Append(" — field agent ").Append(c.Name).Append('\n')
                  .Append(Lines(c.Messages, red, each)).Append("\n\n");
            var system =
                "You are the morning assistant of a hospital's marketing office in Bihar. Below are the office's chats with its field agents " +
                "since yesterday. For each chat give one line (at most 30 words, English) of what the agent reported or needs, and mark urgent=true " +
                "only for a patient waiting or in trouble, a complaint, a payment problem, a partner about to leave, or an agent stuck; say why in " +
                "a few words. Then write a 2-sentence overview of the day for the office manager. Only use what is in the chats; never guess.";
            var schema = Schema(Obj(
                ("overview", Str()),
                ("chats", Arr(Schema(Obj(("key", Str()), ("summary", Str()), ("urgent", Bool()), ("why", Str())), "key", "summary", "urgent", "why"), 60))),
                "overview", "chats");
            var json = await AskJsonAsync(system, sb.ToString(), "digest", schema, fast: false, ct);
            var keys = chats.Select(c => c.Key).ToHashSet();
            var lines = (json["chats"]?.AsArray() ?? new JsonArray())
                .Select(x => new DigestLine(x?["key"]?.ToString() ?? "", red.Restore(x?["summary"]?.ToString()).Trim(),
                    x?["urgent"]?.GetValue<bool>() ?? false, NullIfEmpty(red.Restore(x?["why"]?.ToString()).Trim())))
                .Where(l => keys.Contains(l.Key) && l.Summary.Length > 0)
                .GroupBy(l => l.Key).Select(g => g.First()).ToList();
            var d = new Digest(red.Restore(json["overview"]?.ToString()).Trim(), lines);
            _cache.Set(cacheKey, d, TimeSpan.FromMinutes(15));
            return d;
        }

        private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;

        // ─── 5. Tasks in chat ────────────────────────────────────────────────

        public record TaskIdea(bool IsTask, string Title, string? Detail, string? DueDate, string Priority);

        /// <summary>Whether an office message asks the agent to do something, and if so the task it would make.</summary>
        public async Task<TaskIdea> TaskFromAsync(string who, ChatMessage m, List<ChatMessage> before, CancellationToken ct)
        {
            var key = $"chatai:task:{m.Id}";
            if (_cache.TryGetValue(key, out TaskIdea? done) && done != null) return done;
            var text = (m.Text ?? "").Trim();
            var none = new TaskIdea(false, "", null, null, "normal");
            if (text.Length < 8) { _cache.Set(key, none, TimeSpan.FromDays(1)); return none; }
            Spend(who, ChatAiFeature.Tasks);
            var red = await RedactorAsync(ct);
            var today = IstClock.NowIst;
            var context = Lines(before, red, 2500);
            var system =
                "You read one message the hospital's marketing office sent to a field agent and decide whether it asks the agent to DO something " +
                "specific (visit someone, collect or send photos or documents, deliver material, call someone, check something, attend a camp). " +
                "Greetings, thanks, questions only asking for information, and general advice are not tasks. If it is a task, write: a title of at most " +
                "10 words starting with a verb, in English; detail (at most 30 words, English) with anything useful from the message, or \"\"; the due date " +
                $"as yyyy-MM-dd if the message gives one (today is {today:yyyy-MM-dd}, {today:dddd}; \"today\", \"kal\"/\"tomorrow\", weekdays count), else \"\"; " +
                "priority high only if urgent (a patient, \"urgent\", \"abhi\", \"turant\"), else normal.";
            var schema = Schema(Obj(("isTask", Bool()), ("title", Str()), ("detail", Str()), ("due", Str()), ("priority", new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("high", "normal") })),
                "isTask", "title", "detail", "due", "priority");
            var json = await AskJsonAsync(system, $"Earlier in the chat:\n{context}\n\nThe message:\n{red.Hide(text)}", "task", schema, fast: true, ct);
            var isTask = json["isTask"]?.GetValue<bool>() ?? false;
            var title = red.Restore(json["title"]?.ToString()).Trim();
            if (title.Length > 200) title = title[..200];
            var due = json["due"]?.ToString();
            if (!DateOnly.TryParseExact(due, "yyyy-MM-dd", out var d) || d < DateOnly.FromDateTime(today)) due = null;
            var idea = isTask && title.Length > 0
                ? new TaskIdea(true, title, NullIfEmpty(red.Restore(json["detail"]?.ToString()).Trim()), due, json["priority"]?.ToString() == "high" ? "high" : "normal")
                : none;
            _cache.Set(key, idea, TimeSpan.FromDays(1));
            return idea;
        }

        private static readonly Regex DoneWords = new(
            @"\b(done|completed?|finished|delivered|submitted|sent|given|ho\s?gaya|ho\s?gya|kar\s?diya|kr\s?diya|de\s?diya|bhej\s?diya|pahuncha\s?diya|ok\s?sir)\b|✅|👍|हो गया|कर दिया|दे दिया|भेज दिया|পাঠিয়ে দিয়েছি|হয়ে গেছে|করে দিয়েছি|দিয়ে দিয়েছি",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>
        /// When an agent writes that something is done (or sends a photo) and has open tasks: which task it most likely
        /// finishes, or null. Only asks the AI when the message looks like a "done".
        /// </summary>
        public async Task<AgentTask?> DoneMatchAsync(string who, ChatMessage m, List<AgentTask> open, CancellationToken ct)
        {
            if (open.Count == 0) return null;
            var text = Describe(m);
            if (m.FileName == null && !DoneWords.IsMatch(m.Text ?? "")) return null;
            var key = $"chatai:done:{m.Id}";
            if (_cache.TryGetValue(key, out Guid? hit)) return hit == null ? null : open.FirstOrDefault(t => t.Id == hit);
            Spend(who, ChatAiFeature.Tasks);
            var red = await RedactorAsync(ct);
            var list = string.Join("\n", open.Take(20).Select((t, i) => $"{i + 1}. {red.Hide(t.Title)}{(t.Detail != null ? " — " + red.Hide(t.Detail) : "")}"));
            var system =
                "A field agent wrote a chat message to the office. Decide whether it reports that ONE of the agent's open tasks below is finished. " +
                "Answer the task number, or 0 when it doesn't clearly finish one (a plan, a question, a partial update, or unrelated).";
            var schema = Schema(Obj(("task", new JsonObject { ["type"] = "integer" })), "task");
            var json = await AskJsonAsync(system, $"Open tasks:\n{list}\n\nThe agent's message:\n{red.Hide(text)}", "done", schema, fast: true, ct);
            var n = json["task"]?.GetValue<int>() ?? 0;
            var task = n >= 1 && n <= Math.Min(open.Count, 20) ? open[n - 1] : null;
            _cache.Set(key, task?.Id, TimeSpan.FromDays(1));
            return task;
        }
    }
}
