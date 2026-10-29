using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    public class AnalystSettings
    {
        /// <summary>Groq API key. Set it as the environment variable Groq__ApiKey, never in the repo.</summary>
        public string? ApiKey { get; set; }
        public string Model { get; set; } = "openai/gpt-oss-120b";
        public string BaseUrl { get; set; } = "https://api.groq.com/openai/v1";
        /// <summary>Hour of the day (IST) for the automatic briefing; -1 turns it off.</summary>
        public int DailyHourIst { get; set; } = 8;
        public int PeriodDays { get; set; } = 30;
        /// <summary>
        /// Largest prompt (in characters) sent in one request. Groq's free plan allows 8,000 tokens a minute
        /// for gpt-oss-120b, so keep this well under that (~4 characters a token). Raise it on a paid plan.
        /// </summary>
        public int MaxPromptChars { get; set; } = 18000;
    }

    public class AnalystUnavailableException : Exception
    {
        public AnalystUnavailableException(string message) : base(message) { }
    }

    /// <summary>Thin client for Groq's OpenAI-compatible chat completions endpoint.</summary>
    public class GroqClient
    {
        private readonly IHttpClientFactory _http;
        private readonly AnalystSettings _settings;
        private readonly ILogger<GroqClient> _logger;

        public GroqClient(IHttpClientFactory http, IOptions<AnalystSettings> settings, ILogger<GroqClient> logger)
        {
            _http = http;
            _settings = settings.Value;
            _logger = logger;
        }

        public bool Configured => !string.IsNullOrWhiteSpace(_settings.ApiKey);
        public string Model => _settings.Model;

        public async Task<(JsonObject Message, int Tokens)> ChatAsync(JsonArray messages, JsonArray? tools, JsonObject? responseFormat, CancellationToken ct, bool patient = false)
        {
            if (!Configured) throw new AnalystUnavailableException("The AI analyst isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey).");
            var sendMessages = Fit(messages.DeepClone().AsArray(), _settings.MaxPromptChars);
            var body = new JsonObject
            {
                ["model"] = _settings.Model,
                ["messages"] = sendMessages,
                ["temperature"] = 0.2,
            };
            if (tools != null) { body["tools"] = tools.DeepClone(); body["tool_choice"] = "auto"; }
            if (responseFormat != null) body["response_format"] = responseFormat.DeepClone();

            var client = _http.CreateClient("groq");
            var payload = body.ToJsonString();
            HttpResponseMessage res = null!;
            string text = "";
            // Groq's free tier limits tokens per minute. When it says "slow down", wait as long as it asks
            // (capped) and try again a couple of times before giving up.
            for (int attempt = 0; ; attempt++)
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, _settings.BaseUrl.TrimEnd('/') + "/chat/completions")
                {
                    Content = new StringContent(payload, Encoding.UTF8, "application/json"),
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);
                res?.Dispose();
                res = await client.SendAsync(req, ct);
                text = await res.Content.ReadAsStringAsync(ct);
                // Background briefings can wait out the per-minute limit; someone waiting on a question can't.
                if ((int)res.StatusCode != 429 || attempt >= (patient ? 3 : 1) || TooLarge(text)) break;
                var wait = res.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(15 * (attempt + 1));
                if (wait < TimeSpan.FromSeconds(3)) wait = TimeSpan.FromSeconds(3);
                if (wait > TimeSpan.FromSeconds(patient ? 60 : 15)) wait = TimeSpan.FromSeconds(patient ? 60 : 15);
                _logger.LogInformation("Groq rate limit; retrying in {Seconds}s", (int)wait.TotalSeconds);
                await Task.Delay(wait, ct);
            }
            using var _res = res;
            if (!res.IsSuccessStatusCode)
            {
                _logger.LogWarning("Groq returned {Status}: {Body}", (int)res.StatusCode, text.Length > 600 ? text[..600] : text);
                var msg = (int)res.StatusCode switch
                {
                    401 => "The Groq API key was refused. Check Groq__ApiKey on the server.",
                    413 => "This question needs more data than the free Groq plan allows in one go. Ask something narrower, or move to Groq's paid plan.",
                    429 when TooLarge(text) => "This needs more data than the free Groq plan allows in one go. Ask something narrower, or move to Groq's paid plan.",
                    429 when text.Contains("per day", StringComparison.OrdinalIgnoreCase) || text.Contains("TPD", StringComparison.Ordinal) =>
                        "Today's free Groq allowance is used up. The AI is back tomorrow, or move to Groq's paid plan.",
                    429 => "Groq is busy for us right now (the free plan allows little per minute). Try again in a minute.",
                    _ => "The AI analyst couldn't answer just now. Try again in a minute.",
                };
                throw new AnalystUnavailableException(msg);
            }
            var json = JsonNode.Parse(text)!.AsObject();
            var message = json["choices"]![0]!["message"]!.AsObject();
            int tokens = json["usage"]?["total_tokens"]?.GetValue<int>() ?? 0;
            return (message, tokens);
        }

        private static bool TooLarge(string body) =>
            body.Contains("Request too large", StringComparison.OrdinalIgnoreCase) || body.Contains("reduce your message size", StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// Shrink a conversation to fit the prompt budget: older lookup results are cut down first,
        /// then the newest, and finally any very long message. The system prompt and question stay whole.
        /// </summary>
        public static JsonArray Fit(JsonArray messages, int maxChars)
        {
            static string Content(JsonNode? m) => (m?["content"] as JsonValue)?.ToString() ?? "";
            int Total() => messages.Sum(m => Content(m).Length + ((m?["tool_calls"])?.ToJsonString().Length ?? 0));
            if (Total() <= maxChars) return messages;
            const string cut = "\n…(shortened to fit the AI's limit)";
            foreach (var limit in new[] { 2500, 1200, 500 })
            {
                foreach (var m in messages.OfType<JsonObject>().Where(m => (m["role"] as JsonValue)?.ToString() == "tool"))
                {
                    var c = Content(m);
                    if (c.Length > limit) m["content"] = c[..limit] + cut;
                    if (Total() <= maxChars) return messages;
                }
            }
            // Still too big: cut the longest non-system messages.
            foreach (var m in messages.OfType<JsonObject>().Where(m => (m["role"] as JsonValue)?.ToString() != "system").OrderByDescending(m => Content(m).Length))
            {
                var over = Total() - maxChars;
                if (over <= 0) break;
                var c = Content(m);
                var keep = Math.Max(1500, c.Length - over);
                if (c.Length > keep) m["content"] = c[..keep] + cut;
            }
            return messages;
        }
    }

    /// <summary>
    /// The analyst's areas. Each has its own briefing, tracked items and questions, so the team can look at
    /// partners, the field team, referrals or money on their own. "business" is the overall view.
    /// </summary>
    public static class AnalystAreas
    {
        public sealed record Area(string Key, string Label, string Prefix, string Focus, string Look, int AutoEveryDays);

        public static readonly Area[] All =
        {
            new("business", "Overview", "", "",
                "agents, departments, partners gone quiet, survey needs in weak blocks", 1),
            new("partners", "Partners", "p-",
                " This briefing is only about the partner network: who is sending patients and who has stopped, which partner types and blocks convert best, " +
                "champions, new partners who have never referred, the follow-up backlog and open escalations. Actions are mostly for the call desk and field agents: " +
                "whom to ring, whom to visit, whom to make a champion, which partner types to recruit more of.",
                "top partners, partners gone quiet, partner types, follow-ups and escalations", 7),
            new("field", "Field team", "f-",
                " This briefing is only about the field team: visits per agent, coverage of each agent's block, panchayats never visited, new partners per agent, " +
                "follow-up discipline, survey skipping, attendance and leave. Be fair: compare agents with similar blocks, and say what support an agent needs, not only who is behind.",
                "per-agent work, least-covered blocks, survey coverage per agent", 7),
            new("referrals", "Referrals", "r-",
                " This briefing is only about referrals and hospital departments: where the funnel leaks (referred → arrived → admitted), which departments get " +
                "the most and fewest patients, which blocks and partner types send patients who actually arrive, lost patients, and urgent cases. Actions are for the " +
                "referral desk, the call desk and department heads.",
                "departments, blocks and partner types, the funnel", 7),
            new("money", "Money", "m-",
                " This briefing is only about money paid to partners: what was paid against the admissions it brought, cost per admission, payouts waiting for " +
                "approval or overdue, partners paid with no admissions, and which partner types and purposes give the best return. Be careful and factual about money; " +
                "never accuse anyone, point to what should be checked.",
                "the money summary, top partners, partner types", 7),
            new("surveys", "Surveys", "s-", SurveyFocusText,
                "needs in other blocks, survey coverage, admissions that match the needs", 7),
        };

        internal const string SurveyFocusText =
            " This briefing is about the community survey. Read the answers to find what each area needs and how the hospital can serve it: " +
            "which specialist services or health camps to promote where (match them to departments the hospital has), where patients go today " +
            "(competition and outflow to Siliguri, Purnea, Patna, Kolkata, or untreated), how families pay (Ayushman Bharat, Swasthya Sathi, cash, loans) " +
            "and what that means for packages and help desks, emergency transport gaps (ambulance tie-ups), and who decides the hospital (which partner types to court). " +
            "Also judge the survey itself: thin samples, blocks with few answers, agents skipping it or adding contacts without a survey. " +
            "Tie needs to the business numbers where you can (admissions by department and block).";

        public static string Normalize(string? key) => All.Any(a => a.Key == key) ? key! : "business";
        public static Area Get(string? key) => All.First(a => a.Key == Normalize(key));
    }

    /// <summary>
    /// The AI analyst. It reads the business numbers (through read-only, aggregated tools),
    /// writes a briefing, and keeps a list of issues and planned actions that it re-checks
    /// on every run. People decide what happens to each item; the analyst only reports.
    /// </summary>
    public class AnalystAgent
    {
        private bool _patient;
        private readonly IMarketingDbContext _db;
        private readonly BusinessData _data;
        private readonly GroqClient _groq;
        private readonly AnalystSettings _settings;
        private readonly ILogger<AnalystAgent> _logger;
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        private string _scope = "business";

        public AnalystAgent(IMarketingDbContext db, BusinessData data, GroqClient groq, IOptions<AnalystSettings> settings, ILogger<AnalystAgent> logger)
        {
            _db = db;
            _data = data;
            _groq = groq;
            _settings = settings.Value;
            _logger = logger;
        }

        public bool Configured => _groq.Configured;
        public string Model => _groq.Model;

        private const string Context =
            "You are the business analyst for Glisan Akbari SuperSpeciality Hospital's outreach programme in Seemanchal, Bihar " +
            "(Kishanganj, Purnia, Araria and Katihar districts). Field agents visit panchayats and sign up partners: ASHA workers, " +
            "RMPs (rural medical practitioners), independent doctors, chemists, nursing homes, mukhiyas and ward members. " +
            "Partners refer patients to the hospital. A referral moves: referred → arrived → seen in OPD → admitted → procedure → discharged, " +
            "or 'lost' if the patient never came. The hospital pays some partners (payouts). Agents also ask every new partner six survey " +
            "questions about local illnesses, missing specialists, where patients go today, who decides, how families pay and transport. " +
            "Admissions are what the business cares about most, then arrival rate, then active partners, then field coverage. " +
            "Rules: use only numbers you were given or looked up with the tools; never invent figures; quote the numbers behind every point; " +
            "say plainly when the data is too thin to judge; write short, plain sentences a hospital marketing manager in India can act on; " +
            "name the block, partner type, department or agent concerned; every planned action needs an owner (a role such as Marketing manager, " +
            "Call desk, Field agent <name>, Admin) and a realistic number of days.";

        // ─── Tools the analyst may call (all read-only and aggregated) ─────────────

        private static JsonArray Tools() => JsonNode.Parse("""
        [
          {"type":"function","function":{"name":"get_overview","description":"Referral funnel, partners, payouts and 6-month trend for the last N days, with the previous N days for comparison.","parameters":{"type":"object","properties":{"days":{"type":"integer","description":"Length of the period in days, e.g. 7, 30, 90"}},"required":["days"]}}},
          {"type":"function","function":{"name":"get_breakdown","description":"Referred, arrived, admitted, lost and paid, split by block, partner type, field agent or hospital department, for the last N days (with admissions in the previous N days).","parameters":{"type":"object","properties":{"by":{"type":"string","enum":["block","type","agent","department"]},"days":{"type":"integer"}},"required":["by","days"]}}},
          {"type":"function","function":{"name":"get_top_partners","description":"Partners who sent the most patients in the last N days.","parameters":{"type":"object","properties":{"days":{"type":"integer"},"limit":{"type":"integer"}},"required":["days"]}}},
          {"type":"function","function":{"name":"get_gone_quiet_partners","description":"Partners who referred patients before the last N days but none during them.","parameters":{"type":"object","properties":{"days":{"type":"integer"}},"required":["days"]}}},
          {"type":"function","function":{"name":"get_field_work","description":"Visits, panchayats visited vs in scope, least-covered blocks, per-agent visits and new partners, overdue follow-ups, open escalations and pending leave for the last N days.","parameters":{"type":"object","properties":{"days":{"type":"integer"}},"required":["days"]}}},
          {"type":"function","function":{"name":"get_survey_needs","description":"Top answers to the survey questions the app asks, for the whole region or one block.","parameters":{"type":"object","properties":{"block":{"type":"string","description":"Block name, or empty for all"}},"required":[]}}},
          {"type":"function","function":{"name":"get_survey_coverage","description":"How well the survey is being done: answers and panchayats surveyed per block, and per agent how many were answered, skipped, or new contacts left without a survey (last 30 days).","parameters":{"type":"object","properties":{},"required":[]}}},
          {"type":"function","function":{"name":"get_money_summary","description":"Money paid to partners in the last N days against the admissions it brought: total, cost per admission, waiting approval, approved but unpaid, overdue, by purpose and partner type, top paid partners, partners paid with no admissions.","parameters":{"type":"object","properties":{"days":{"type":"integer"}},"required":["days"]}}},
          {"type":"function","function":{"name":"get_tracked_items","description":"Issues, opportunities and planned actions already being tracked, with owner, due date and status.","parameters":{"type":"object","properties":{"status":{"type":"string","enum":["open","in_progress","done","dismissed","all"]}},"required":[]}}}
        ]
        """)!.AsArray();

        /// <summary>Models sometimes send numbers as strings and strings as numbers; read either.</summary>
        private static int? Int(JsonNode? n)
        {
            if (n is not JsonValue v) return null;
            if (v.TryGetValue<int>(out var i)) return i;
            if (v.TryGetValue<double>(out var d)) return (int)Math.Round(d);
            if (v.TryGetValue<string>(out var s) && int.TryParse(s, out var p)) return p;
            return null;
        }
        private static string? Str(JsonNode? n) => n is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToString()) : null;

        private async Task<string> RunToolAsync(string name, JsonObject args, CancellationToken ct)
        {
            int days = Math.Clamp(Int(args["days"]) ?? _settings.PeriodDays, 1, 365);
            var (from, to) = BusinessData.Days(days);
            object result;
            switch (name)
            {
                case "get_overview":
                    result = _data.Overview(await _data.LoadAsync(from, to, ct));
                    break;
                case "get_money_summary":
                    result = await _data.MoneyAsync(await _data.LoadAsync(from, to, ct), ct);
                    break;
                case "get_breakdown":
                    var by = Str(args["by"]) ?? "block";
                    result = _data.Breakdown(await _data.LoadAsync(from, to, ct), by, 40);
                    break;
                case "get_top_partners":
                    result = _data.TopPartners(await _data.LoadAsync(from, to, ct), Math.Clamp(Int(args["limit"]) ?? 10, 1, 30));
                    break;
                case "get_gone_quiet_partners":
                    result = _data.GoneQuiet(await _data.LoadAsync(from, to, ct));
                    break;
                case "get_field_work":
                    result = await _data.FieldAsync(await _data.LoadAsync(from, to, ct), ct);
                    break;
                case "get_survey_needs":
                    result = await _data.SurveyNeedsAsync(Str(args["block"]), ct);
                    break;
                case "get_survey_coverage":
                    result = await _data.SurveyCoverageAsync(ct);
                    break;
                case "get_tracked_items":
                    var st = Str(args["status"]) ?? "open";
                    var q = _db.AiItems.AsNoTracking();
                    q = q.Where(i => i.Scope == _scope);
                    if (st == "open") q = q.Where(i => i.Status == "open" || i.Status == "in_progress");
                    else if (st != "all") q = q.Where(i => i.Status == st);
                    result = await q.OrderByDescending(i => i.UpdatedAt).Take(40)
                        .Select(i => new { id = i.Id, i.Kind, i.Title, i.Area, i.Metric, i.Severity, i.Status, i.Owner, i.DueDate, i.Trend, i.TrendNote, i.Note, i.TimesRaised, firstRaised = i.CreatedAt })
                        .ToListAsync(ct);
                    break;
                default:
                    result = new { error = $"Unknown tool {name}" };
                    break;
            }
            var text = JsonSerializer.Serialize(result, Json);
            return text.Length > 6000 ? text[..6000] + "…(cut)" : text;
        }

        /// <summary>Lets the model look things up until it is ready. Returns tool calls made.</summary>
        private async Task<(int Calls, int Tokens)> InvestigateAsync(JsonArray messages, int maxRounds, List<string> used, CancellationToken ct)
        {
            int calls = 0, tokens = 0;
            var tools = Tools();
            for (int round = 0; round < maxRounds; round++)
            {
                var (msg, t) = await _groq.ChatAsync(messages, tools, null, ct, _patient);
                tokens += t;
                var toolCalls = msg["tool_calls"] as JsonArray;
                // Keep only what the API accepts back in history.
                var keep = new JsonObject { ["role"] = "assistant", ["content"] = msg["content"]?.GetValue<string>() ?? "" };
                if (toolCalls != null && toolCalls.Count > 0) keep["tool_calls"] = toolCalls.DeepClone();
                messages.Add(keep);
                if (toolCalls == null || toolCalls.Count == 0) break;
                foreach (var call in toolCalls)
                {
                    var fn = call!["function"]!;
                    var name = fn["name"]!.GetValue<string>();
                    JsonObject args;
                    try { args = JsonNode.Parse(fn["arguments"]?.GetValue<string>() ?? "{}") as JsonObject ?? new JsonObject(); }
                    catch (JsonException) { args = new JsonObject(); }
                    string output;
                    try { output = await RunToolAsync(name, args, ct); }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        _logger.LogWarning(ex, "Analyst tool {Tool} failed", name);
                        output = JsonSerializer.Serialize(new { error = "That lookup failed." });
                    }
                    messages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = call["id"]!.GetValue<string>(), ["content"] = output });
                    used.Add(name);
                    calls++;
                }
            }
            return (calls, tokens);
        }

        // ─── Briefing ──────────────────────────────────────────────────────────

        private static JsonObject BriefingFormat()
        {
            var item = """{"type":"object","additionalProperties":false,"required":["key","title","detail","area","metric","severity"],"properties":{"key":{"type":"string","description":"short stable slug, e.g. thakurganj-low-arrival"},"title":{"type":"string"},"detail":{"type":"string"},"area":{"type":"string"},"metric":{"type":"string","description":"the number being watched, e.g. 'arrival 41% (was 58%)'"},"severity":{"type":"string","enum":["high","medium","low"]}}}""";
            var schema = """
            {"type":"object","additionalProperties":false,
             "required":["summary","health","wins","issues","opportunities","plan","item_updates","watch_next"],
             "properties":{
               "summary":{"type":"string","description":"3-5 sentences: the state of the business this period"},
               "health":{"type":"string","enum":["good","watch","bad"]},
               "wins":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","detail"],"properties":{"title":{"type":"string"},"detail":{"type":"string"}}}},
               "issues":{"type":"array","items":ITEM},
               "opportunities":{"type":"array","items":ITEM},
               "plan":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["key","title","detail","owner","due_in_days","expected_impact"],"properties":{"key":{"type":"string"},"title":{"type":"string"},"detail":{"type":"string"},"owner":{"type":"string"},"due_in_days":{"type":"integer"},"expected_impact":{"type":"string"}}}},
               "item_updates":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["id","trend","note"],"properties":{"id":{"type":"string"},"trend":{"type":"string","enum":["better","same","worse","resolved"]},"note":{"type":"string"}}}},
               "watch_next":{"type":"array","items":{"type":"string"}}
             }}
            """.Replace("ITEM", item);
            return new JsonObject
            {
                ["type"] = "json_schema",
                ["json_schema"] = new JsonObject { ["name"] = "briefing", ["schema"] = JsonNode.Parse(schema) },
            };
        }

        public async Task<AiBriefing> RunBriefingAsync(string createdBy, CancellationToken ct, string scope = "business")
        {
            _patient = true;
            if (!Configured) throw new AnalystUnavailableException("The AI analyst isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey).");
            _scope = AnalystAreas.Normalize(scope);
            var area = AnalystAreas.Get(_scope);
            var (from, to) = BusinessData.Days(_settings.PeriodDays);
            var briefing = new AiBriefing { CreatedBy = createdBy, Scope = _scope, PeriodFrom = from, PeriodTo = to, Model = Model };
            _db.AiBriefings.Add(briefing);
            await _db.SaveChangesAsync(ct);

            try
            {
                var snap = await _data.LoadAsync(from, to, ct);
                var open = await _db.AiItems.AsNoTracking().Where(i => i.Scope == _scope && (i.Status == "open" || i.Status == "in_progress"))
                    .OrderByDescending(i => i.UpdatedAt).Take(30)
                    .Select(i => new { id = i.Id, i.Kind, i.Title, i.Area, i.Metric, i.Status, i.Owner, i.DueDate, i.Trend, i.Note, raisedOn = i.CreatedAt })
                    .ToListAsync(ct);
                object pack;
                if (_scope == "surveys")
                {
                    var coverage = await _data.SurveyCoverageAsync(ct);
                    var topBlocks = (await _db.SurveyResponses.AsNoTracking().Where(r => !r.IsSkipped && r.PanchayatId != null)
                            .Join(_db.Panchayats, r => r.PanchayatId, p => p.PanchayatId, (r, p) => p.Block)
                            .GroupBy(b => b).Select(g => new { g.Key, n = g.Count() }).OrderByDescending(x => x.n).Take(3).ToListAsync(ct))
                        .Select(x => x.Key).ToList();
                    var needsByBlock = new List<object>();
                    foreach (var blk in topBlocks) needsByBlock.Add(await _data.SurveyNeedsAsync(blk, ct));
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        hospitalDepartments = await _db.Departments.AsNoTracking().Where(d => d.IsActive).Select(d => d.Name).ToListAsync(ct),
                        surveyCoverage = coverage,
                        needsWholeRegion = await _data.SurveyNeedsAsync(null, ct),
                        needsInBusiestBlocks = needsByBlock,
                        admissionsByDepartment = _data.Breakdown(snap, "department", 10),
                        admissionsByBlock = _data.Breakdown(snap, "block", 12),
                        trackedItems = open,
                    };
                }
                else if (_scope == "partners")
                {
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        periodDays = _settings.PeriodDays,
                        overview = _data.Overview(snap),
                        byPartnerType = _data.Breakdown(snap, "type", 12),
                        topPartners = _data.TopPartners(snap, 10),
                        goneQuiet = _data.GoneQuiet(snap, 10),
                        trackedItems = open,
                    };
                }
                else if (_scope == "field")
                {
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        periodDays = _settings.PeriodDays,
                        field = await _data.FieldAsync(snap, ct),
                        byAgent = _data.Breakdown(snap, "agent", 15),
                        trackedItems = open,
                    };
                }
                else if (_scope == "referrals")
                {
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        periodDays = _settings.PeriodDays,
                        overview = _data.Overview(snap),
                        byDepartment = _data.Breakdown(snap, "department", 15),
                        byBlock = _data.Breakdown(snap, "block", 15),
                        byPartnerType = _data.Breakdown(snap, "type", 10),
                        trackedItems = open,
                    };
                }
                else if (_scope == "money")
                {
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        periodDays = _settings.PeriodDays,
                        money = await _data.MoneyAsync(snap, ct),
                        overview = _data.Overview(snap),
                        trackedItems = open,
                    };
                }
                else
                {
                    pack = new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM yyyy"),
                        periodDays = _settings.PeriodDays,
                        overview = _data.Overview(snap),
                        byBlock = _data.Breakdown(snap, "block", 25),
                        byPartnerType = _data.Breakdown(snap, "type", 15),
                        field = await _data.FieldAsync(snap, ct),
                        trackedItems = open,
                    };
                }
                var packJson = JsonSerializer.Serialize(pack, Json);
                briefing.DataJson = packJson;
                // The opening figures must leave room for lookups within the per-request budget.
                var packBudget = Math.Max(4000, _settings.MaxPromptChars / 2);
                if (packJson.Length > packBudget) packJson = packJson[..packBudget] + "…(cut to fit)";
                var context = Context + area.Focus;

                var messages = new JsonArray
                {
                    new JsonObject { ["role"] = "system", ["content"] = context },
                    new JsonObject { ["role"] = "user", ["content"] =
                        $"Prepare the {(area.Key == "business" ? "overall" : area.Label.ToLowerInvariant())} briefing for the last {_settings.PeriodDays} days. Starting figures:\n{packJson}\n\n" +
                        $"Look deeper with the tools where something stands out ({area.Look}). " +
                        "Use at most 6 lookups. When you have enough, reply with the single word DONE." },
                };
                var used = new List<string>();
                var (calls, tokens) = await InvestigateAsync(messages, 4, used, ct);

                // Structured output can't be combined with tool messages, so the findings are folded into one plain prompt.
                var findings = new StringBuilder();
                foreach (var m in messages.Skip(2).OfType<JsonObject>())
                {
                    var role = m["role"]?.GetValue<string>();
                    var c = m["content"]?.GetValue<string>() ?? "";
                    if (role == "tool") findings.Append("Lookup result: ").AppendLine(c);
                    else if (role == "assistant" && c.Trim().Length > 0 && c.Trim() != "DONE") findings.Append("Your notes: ").AppendLine(c);
                }
                var ask = "Write the briefing. 2-4 wins, the most important issues (at most 6), opportunities (at most 4) and a plan of at most 6 concrete actions. " +
                    "Reuse the key of a tracked item when you are talking about the same thing. In item_updates, give every tracked item listed in the figures " +
                    "(use its id exactly) a trend and one sentence saying what the numbers show now. If there are no tracked items, item_updates is an empty list.";
                var final = new JsonArray
                {
                    new JsonObject { ["role"] = "system", ["content"] = context },
                    new JsonObject { ["role"] = "user", ["content"] = $"Figures:\n{packJson}\n\n{findings}\n{ask}" },
                };
                JsonObject result;
                try
                {
                    var (msg, t2) = await _groq.ChatAsync(final, null, BriefingFormat(), ct, _patient);
                    tokens += t2;
                    result = JsonNode.Parse(msg["content"]?.GetValue<string>() ?? "{}")!.AsObject();
                }
                catch (AnalystUnavailableException)
                {
                    // Some models reject strict schemas; fall back to plain JSON mode with the shape spelled out.
                    final[1]!["content"] = final[1]!["content"]!.GetValue<string>() +
                        "\nReply with one JSON object with exactly these fields: summary (string), health (good|watch|bad), wins [{title,detail}], " +
                        "issues [{key,title,detail,area,metric,severity}], opportunities [same as issues], plan [{key,title,detail,owner,due_in_days,expected_impact}], " +
                        "item_updates [{id,trend (better|same|worse|resolved),note}], watch_next [string].";
                    var (msg, t3) = await _groq.ChatAsync(final, null, new JsonObject { ["type"] = "json_object" }, ct, _patient);
                    tokens += t3;
                    result = JsonNode.Parse(msg["content"]?.GetValue<string>() ?? "{}")!.AsObject();
                }

                // JSON mode doesn't enforce the shape: make sure every list is there so the page can always show it.
                foreach (var list in new[] { "wins", "issues", "opportunities", "plan", "item_updates", "watch_next" })
                    if (result[list] is not JsonArray) result[list] = new JsonArray();
                if (result["summary"] is not JsonValue) result["summary"] = "";
                if (Str(result["health"]) is not ("good" or "watch" or "bad")) result["health"] = "watch";
                briefing.ResultJson = result.ToJsonString();
                briefing.Summary = Str(result["summary"]);
                briefing.Health = Str(result["health"]);
                briefing.ToolCalls = calls;
                briefing.TokensUsed = tokens;
                await ApplyItemsAsync(briefing, result, ct);
                briefing.Status = "ok";
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "AI briefing failed");
                briefing.Status = "failed";
                briefing.Error = ex is AnalystUnavailableException ? ex.Message : "The analyst couldn't finish this briefing. Try again in a few minutes.";
            }
            briefing.FinishedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return briefing;
        }

        private static string Slug(string s)
        {
            var k = Regex.Replace(s.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
            return k.Length > 80 ? k[..80] : k;
        }

        private async Task ApplyItemsAsync(AiBriefing b, JsonObject r, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var today = AttendanceService.TodayIst;
            var incoming = new List<(string Kind, JsonObject Node)>();
            foreach (var kind in new[] { ("issues", "issue"), ("opportunities", "opportunity"), ("plan", "plan") })
                foreach (var n in (r[kind.Item1] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
                    incoming.Add((kind.Item2, n));

            string Key(JsonObject node)
            {
                var k = Slug(Str(node["key"]) ?? Str(node["title"]) ?? "");
                return k == "" ? "" : AnalystAreas.Get(_scope).Prefix + k;
            }
            var keys = incoming.Select(x => Key(x.Node)).Where(k => k != "").ToList();
            var existing = await _db.AiItems.Where(i => keys.Contains(i.Key)).ToDictionaryAsync(i => i.Key, ct);

            foreach (var (kind, n) in incoming)
            {
                var key = Key(n);
                if (key == "") continue;
                string F(string f) => Str(n[f])?.Trim() ?? "";
                if (existing.TryGetValue(key, out var item))
                {
                    item.Title = F("title");
                    item.Detail = F("detail");
                    if (F("area") != "") item.Area = F("area");
                    if (F("metric") != "") item.Metric = F("metric");
                    if (F("severity") != "") item.Severity = F("severity");
                    item.LastBriefingId = b.Id;
                    item.TimesRaised++;
                    item.UpdatedAt = now;
                    if (item.Status == "done")
                    {
                        // Closed, but the numbers say it's back.
                        item.Status = "open";
                        item.ClosedAt = null;
                        item.Trend = "worse";
                        item.TrendNote = "Raised again after it was marked done.";
                    }
                    continue;
                }
                int due = Int(n["due_in_days"]) ?? 0;
                var created = new AiItem
                {
                    Key = key,
                    Kind = kind,
                    Scope = _scope,
                    Title = F("title"),
                    Detail = kind == "plan" && F("expected_impact") != "" ? $"{F("detail")} Expected: {F("expected_impact")}" : F("detail"),
                    Area = F("area") == "" ? null : F("area"),
                    Metric = F("metric") == "" ? null : F("metric"),
                    Severity = F("severity") is "high" or "medium" or "low" ? F("severity") : "medium",
                    Owner = kind == "plan" && F("owner") != "" ? F("owner") : null,
                    DueDate = kind == "plan" && due > 0 ? today.AddDays(Math.Min(due, 120)) : null,
                    FirstBriefingId = b.Id,
                    LastBriefingId = b.Id,
                    UpdatedBy = "analyst",
                };
                _db.AiItems.Add(created);
                existing[key] = created;
            }

            foreach (var u in (r["item_updates"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            {
                if (!Guid.TryParse(Str(u["id"]), out var id)) continue;
                var item = await _db.AiItems.FirstOrDefaultAsync(i => i.Id == id, ct);
                if (item == null || item.Status is "done" or "dismissed") continue;
                item.Trend = Str(u["trend"]);
                item.TrendNote = Str(u["note"]);
                item.LastBriefingId = b.Id;
                item.UpdatedAt = now;
            }
        }

        // ─── Questions ─────────────────────────────────────────────────────────

        public record ChatTurn(string Role, string Content);

        public async Task<(string Answer, List<string> Tools)> AskAsync(string question, List<ChatTurn> history, CancellationToken ct, string scope = "business")
        {
            _scope = AnalystAreas.Normalize(scope);
            var (from, to) = BusinessData.Days(_settings.PeriodDays);
            var overview = _data.Overview(await _data.LoadAsync(from, to, ct));
            var messages = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = Context + AnalystAreas.Get(_scope).Focus +
                    " Answer the user's question about the business. Look numbers up with the tools before answering; don't guess. " +
                    "Keep answers short: a direct answer first, then the numbers behind it, then at most three suggested actions. Plain text, short lists allowed." },
                new JsonObject { ["role"] = "system", ["content"] = $"Today is {IstClock.NowIst:dddd d MMMM yyyy}. Last {_settings.PeriodDays} days at a glance: {JsonSerializer.Serialize(overview, Json)}" },
            };
            foreach (var h in history.TakeLast(10))
            {
                if (h.Role is not ("user" or "assistant") || string.IsNullOrWhiteSpace(h.Content)) continue;
                messages.Add(new JsonObject { ["role"] = h.Role, ["content"] = h.Content.Length > 4000 ? h.Content[..4000] : h.Content });
            }
            messages.Add(new JsonObject { ["role"] = "user", ["content"] = question.Length > 2000 ? question[..2000] : question });

            var used = new List<string>();
            await InvestigateAsync(messages, 5, used, ct);
            var last = messages.Last() as JsonObject;
            var answer = last?["role"]?.GetValue<string>() == "assistant" && last["tool_calls"] == null ? last["content"]?.GetValue<string>() ?? "" : "";
            if (string.IsNullOrWhiteSpace(answer))
            {
                messages.Add(new JsonObject { ["role"] = "user", ["content"] = "Answer now with what you have." });
                var (msg, _) = await _groq.ChatAsync(messages, null, null, ct, _patient);
                answer = msg["content"]?.GetValue<string>() ?? "";
            }
            return (answer.Trim(), used.Distinct().ToList());
        }
    }

    /// <summary>Runs the briefing once a day at the configured IST hour.</summary>
    public class AnalystScheduler : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly AnalystSettings _settings;
        private readonly ILogger<AnalystScheduler> _logger;

        public AnalystScheduler(IServiceScopeFactory scopes, IOptions<AnalystSettings> settings, ILogger<AnalystScheduler> logger)
        {
            _scopes = scopes;
            _settings = settings.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (_settings.DailyHourIst < 0 || string.IsNullOrWhiteSpace(_settings.ApiKey)) return;
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (IstClock.NowIst.Hour >= _settings.DailyHourIst)
                    {
                        using var scope = _scopes.CreateScope();
                        var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                        var today = IstClock.TodayStartUtc;
                        bool done = await db.AiBriefings.AnyAsync(b => b.CreatedBy == "auto" && b.Scope == "business" && b.CreatedAt >= today, stoppingToken);
                        if (!done)
                        {
                            var agent = scope.ServiceProvider.GetRequiredService<AnalystAgent>();
                            await agent.RunBriefingAsync("auto", stoppingToken);
                        }
                        // The other areas change slowly: each about once a week, and at most one of them a day,
                        // so the free Groq plan's daily allowance is left for questions and the agents' helper.
                        bool otherToday = await db.AiBriefings.AnyAsync(b => b.CreatedBy == "auto" && b.Scope != "business" && b.CreatedAt >= today, stoppingToken);
                        if (!otherToday)
                        {
                            foreach (var area in AnalystAreas.All.Where(a => a.Key != "business"))
                            {
                                var since = today.AddDays(-(area.AutoEveryDays - 1));
                                if (await db.AiBriefings.AnyAsync(b => b.Scope == area.Key && b.Status == "ok" && b.CreatedAt >= since, stoppingToken)) continue;
                                // Give Groq's per-minute allowance time to refill after the overview run.
                                if (!done) await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
                                using var scope2 = _scopes.CreateScope();
                                var agent2 = scope2.ServiceProvider.GetRequiredService<AnalystAgent>();
                                await agent2.RunBriefingAsync("auto", stoppingToken, area.Key);
                                break;
                            }
                        }
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Daily AI briefing failed");
                }
                try { await Task.Delay(TimeSpan.FromMinutes(10), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }
}
