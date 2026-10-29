using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The AI helper in the field agent app. It only ever sees the signed-in agent's own work:
    /// their block, the partners they added, their follow-ups and results, plus the hospital's
    /// departments and doctors so they can tell partners what is on offer. Read-only.
    /// </summary>
    public class FieldAssistant
    {
        private static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        public const int DailyQuestionLimit = 40;

        private readonly IMarketingDbContext _db;
        private readonly BusinessData _data;
        private readonly GroqClient _groq;
        private readonly IMemoryCache _cache;
        private readonly ILogger<FieldAssistant> _logger;

        public FieldAssistant(IMarketingDbContext db, BusinessData data, GroqClient groq, IMemoryCache cache, ILogger<FieldAssistant> logger)
        {
            _db = db;
            _data = data;
            _groq = groq;
            _cache = cache;
            _logger = logger;
        }

        public bool Configured => _groq.Configured;

        private static string LanguageRule(string? lang) => lang switch
        {
            "hi" => "Always reply in simple Hindi written in Devanagari script.",
            "bn" => "Always reply in simple Bengali written in Bangla script.",
            "hinglish" => "Always reply in Hinglish: simple Hindi written in English (Roman) letters, the way people text in Bihar.",
            _ => "Always reply in simple English.",
        };

        private static string Context(string name, string? lang) =>
            $"You are Vita, the friendly NexEagle eagle and AI helper inside NexMarket AI, the field app of Glisan Akbari SuperSpeciality Hospital's outreach team in Seemanchal, Bihar. " +
            $"You are talking to {name}, a field agent. Agents visit panchayats, sign up partners (ASHA workers, RMPs, doctors, chemists, " +
            "nursing homes, mukhiyas), ask them six survey questions, log patient referrals, and follow up. " +
            "Help the agent plan the day, decide whom to visit or call first, prepare what to say to a partner (which hospital department " +
            "or doctor fits what people in that area need), and understand their own results. Look things up with the tools before answering; " +
            "never invent names, numbers or doctors. Keep answers short and practical for someone on a phone in the field: " +
            "at most 6 short lines or a short list. Do not reveal phone numbers. " + LanguageRule(lang);

        // ─── Tools (all scoped to the calling agent) ───────────────────────────

        private static JsonArray Tools() => JsonNode.Parse("""
        [
          {"type":"function","function":{"name":"get_my_day","description":"The agent's block, shift status, open tasks from their manager, follow-ups due today or overdue, and panchayats in their block not visited in the last 30 days.","parameters":{"type":"object","properties":{},"required":[]}}},
          {"type":"function","function":{"name":"get_my_partners","description":"Partners this agent added. filter: top = sent most patients (90 days), quiet = sent patients before but none in 60 days, champions, followups = follow-up due, all.","parameters":{"type":"object","properties":{"filter":{"type":"string","enum":["top","quiet","champions","followups","all"]},"limit":{"type":"integer"}},"required":["filter"]}}},
          {"type":"function","function":{"name":"get_partner","description":"Everything about one of the agent's partners by name: type, panchayat, priority, follow-up, latest notes, patients sent, survey answers.","parameters":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}}},
          {"type":"function","function":{"name":"get_my_month","description":"This agent's results this month compared with last month: visits, new partners, surveys, referrals, admissions, days worked.","parameters":{"type":"object","properties":{},"required":[]}}},
          {"type":"function","function":{"name":"get_block_needs","description":"What the survey says people in the agent's block need: common illnesses, missing specialists, where they go today, who decides, how they pay, transport.","parameters":{"type":"object","properties":{},"required":[]}}},
          {"type":"function","function":{"name":"get_hospital_services","description":"The hospital's departments and doctors with OPD days and timings, to tell partners what is available.","parameters":{"type":"object","properties":{"department":{"type":"string","description":"Optional department name to narrow down"}},"required":[]}}}
        ]
        """)!.AsArray();

        private async Task<(string? Block, string? District)> BlockAsync(string agentId, CancellationToken ct)
        {
            var a = await _db.BlockAssignments.AsNoTracking().Where(x => x.AgentId == agentId && x.Status == "Active")
                .OrderByDescending(x => x.AssignedAt).Select(x => new { x.Block, x.District }).FirstOrDefaultAsync(ct);
            if (a != null) return (a.Block, a.District);
            var me = await _db.Agents.AsNoTracking().Where(x => x.AgentId == agentId).Select(x => new { x.Block, x.District }).FirstOrDefaultAsync(ct);
            return (me?.Block, me?.District);
        }

        private async Task<object> ToolAsync(string agentId, string name, JsonObject args, CancellationToken ct)
        {
            var todayStart = IstClock.TodayStartUtc;
            switch (name)
            {
                case "get_my_day":
                {
                    var (block, district) = await BlockAsync(agentId, ct);
                    var onShift = await _db.Shifts.AnyAsync(s => s.AgentId == agentId && s.EndTime == null && s.StartTime >= todayStart.AddHours(-12), ct);
                    var due = await _db.Contacts.AsNoTracking()
                        .Where(c => c.AgentId == agentId && !c.IsMerged && c.FollowUpDate != null && c.FollowUpDate < todayStart.AddDays(1))
                        .OrderBy(c => c.FollowUpDate).Take(15)
                        .Select(c => new { c.Name, c.Role, c.PanchayatId, c.Priority, c.FollowUpDate }).ToListAsync(ct);
                    var pids = due.Select(d => d.PanchayatId).Distinct().ToList();
                    var names = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
                    var since = DateTime.UtcNow.AddDays(-30);
                    var visited = await _db.Visits.AsNoTracking().Where(v => v.AgentId == agentId && v.CheckInAt >= since).Select(v => v.PanchayatId).Distinct().ToListAsync(ct);
                    var notVisited = block == null ? new List<string>() : await _db.Panchayats.AsNoTracking()
                        .Where(p => p.Block == block && (district == null || p.District == district) && p.IsActiveForMarketing && !visited.Contains(p.PanchayatId))
                        .OrderBy(p => p.Name).Select(p => p.Name).Take(20).ToListAsync(ct);
                    var taskRows = await _db.AgentTasks.AsNoTracking().Where(t => t.AgentId == agentId && t.Status == "open")
                        .OrderBy(t => t.DueDate == null).ThenBy(t => t.DueDate).Take(10).ToListAsync(ct);
                    var tasks = (await Controllers.TaskViews.ShapeAsync(_db, taskRows, ct)).Select(o => JsonSerializer.SerializeToElement(o, Json))
                        .Select(e => new
                        {
                            title = e.GetProperty("title").GetString(),
                            detail = e.GetProperty("detail").GetString(),
                            priority = e.GetProperty("priority").GetString(),
                            due = e.GetProperty("dueDate").GetString(),
                            overdue = e.GetProperty("overdue").GetBoolean(),
                            panchayats = e.GetProperty("panchayats").EnumerateArray().Select(x => x.GetProperty("name").GetString()).ToList(),
                            partner = e.GetProperty("partner").ValueKind == JsonValueKind.Object ? e.GetProperty("partner").GetProperty("name").GetString() : null,
                        }).ToList();
                    return new
                    {
                        today = IstClock.NowIst.ToString("dddd d MMMM"),
                        tasksFromManager = tasks,
                        block,
                        district,
                        onShift,
                        followUps = due.Select(d => new
                        {
                            d.Name, type = d.Role, panchayat = names.GetValueOrDefault(d.PanchayatId), priority = d.Priority ?? "normal",
                            overdueDays = d.FollowUpDate < todayStart ? (int)Math.Ceiling((todayStart - d.FollowUpDate!.Value).TotalDays) : 0,
                        }),
                        panchayatsNotVisitedIn30Days = notVisited,
                    };
                }
                case "get_my_partners":
                {
                    var filter = (args["filter"] as JsonValue)?.ToString() ?? "top";
                    int limit = 12;
                    if (args["limit"] is JsonValue lv && lv.TryGetValue<int>(out var l)) limit = Math.Clamp(l, 1, 30);
                    var mine = await _db.Contacts.AsNoTracking().Where(c => c.AgentId == agentId && !c.IsMerged)
                        .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId, c.Priority, c.IsChampion, c.FollowUpDate }).ToListAsync(ct);
                    var ids = mine.Select(c => c.ClientId).ToList();
                    var refs = await _db.Referrals.AsNoTracking().Where(r => ids.Contains(r.ContactId))
                        .Select(r => new { r.ContactId, r.CreatedAt, r.Status }).ToListAsync(ct);
                    var pnames = await _db.Panchayats.AsNoTracking().Where(p => mine.Select(m => m.PanchayatId).Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
                    var d90 = DateTime.UtcNow.AddDays(-90); var d60 = DateTime.UtcNow.AddDays(-60);
                    var rows = mine.Select(c =>
                    {
                        var rs = refs.Where(r => r.ContactId == c.ClientId).ToList();
                        return new
                        {
                            c.Name, type = c.Role, panchayat = pnames.GetValueOrDefault(c.PanchayatId), priority = c.Priority ?? "normal", champion = c.IsChampion,
                            followUp = c.FollowUpDate, referrals90 = rs.Count(r => r.CreatedAt >= d90), admitted90 = rs.Count(r => r.CreatedAt >= d90 && AdmittedStatuses.Contains(r.Status)),
                            referralsAll = rs.Count, lastReferral = rs.Count == 0 ? (DateTime?)null : rs.Max(r => r.CreatedAt),
                        };
                    });
                    rows = filter switch
                    {
                        "quiet" => rows.Where(r => r.referralsAll > 0 && r.lastReferral < d60).OrderByDescending(r => r.referralsAll),
                        "champions" => rows.Where(r => r.champion).OrderByDescending(r => r.referrals90),
                        "followups" => rows.Where(r => r.followUp != null && r.followUp < todayStart.AddDays(1)).OrderBy(r => r.followUp),
                        "all" => rows.OrderBy(r => r.Name),
                        _ => rows.Where(r => r.referrals90 > 0).OrderByDescending(r => r.admitted90).ThenByDescending(r => r.referrals90),
                    };
                    return new { total = mine.Count, partners = rows.Take(limit) };
                }
                case "get_partner":
                {
                    var term = ((args["name"] as JsonValue)?.ToString() ?? "").Trim().ToLowerInvariant();
                    if (term.Length < 2) return new { error = "Give at least part of the partner's name." };
                    var matches = await _db.Contacts.AsNoTracking().Where(c => c.AgentId == agentId && !c.IsMerged && c.Name.ToLower().Contains(term))
                        .Take(3).ToListAsync(ct);
                    if (matches.Count == 0) return new { error = "No partner of yours has that name." };
                    var c = matches[0];
                    var place = await _db.Panchayats.AsNoTracking().Where(p => p.PanchayatId == c.PanchayatId).Select(p => p.Name).FirstOrDefaultAsync(ct);
                    var notes = await _db.ContactNotes.AsNoTracking().Where(n => n.ContactClientId == c.ClientId).OrderByDescending(n => n.CreatedAt).Take(5)
                        .Select(n => new { n.Text, n.Source, n.CreatedAt }).ToListAsync(ct);
                    var refs = await _db.Referrals.AsNoTracking().Where(r => r.ContactId == c.ClientId).OrderByDescending(r => r.CreatedAt).Take(10)
                        .Select(r => new { r.Department, r.Status, r.CreatedAt }).ToListAsync(ct);
                    var survey = await _db.SurveyResponses.AsNoTracking().Where(s => s.ContactId == c.ClientId && !s.IsSkipped).OrderByDescending(s => s.CreatedAt)
                        .Select(s => s.AnswersJson).FirstOrDefaultAsync(ct);
                    var asked = await SurveyCore.ActiveAsync(_db, ct);
                    var a = SurveyCore.Parse(survey);
                    return new
                    {
                        name = c.Name, type = c.Role, profession = c.Profession, panchayat = place, priority = c.Priority ?? "normal", champion = c.IsChampion,
                        followUp = c.FollowUpDate, status = c.Status, lastCallOutcome = c.LastCallOutcome,
                        otherMatches = matches.Skip(1).Select(m => m.Name),
                        notes,
                        patientsSent = refs.Select(r => new { r.Department, stage = ReferralsStage(r.Status), r.CreatedAt }),
                        surveyAnswers = asked.Where(q => a.ContainsKey(q.QuestionId)).Select(q => new
                        {
                            question = SurveyCore.Title(q),
                            answer = string.Join(", ", SurveyCore.Values(a[q.QuestionId], SurveyCore.Options(q)).Select(Controllers.GeoController.ShortLabel)),
                        }),
                    };
                }
                case "get_my_month":
                {
                    var first = new DateOnly(IstClock.NowIst.Year, IstClock.NowIst.Month, 1);
                    var from = AttendanceService.StartUtc(first); var prevFrom = AttendanceService.StartUtc(first.AddMonths(-1));
                    async Task<object> Range(DateTime a, DateTime b) => new
                    {
                        visits = await _db.Visits.CountAsync(v => v.AgentId == agentId && v.CheckInAt >= a && v.CheckInAt < b, ct),
                        newPartners = await _db.Contacts.CountAsync(c => c.AgentId == agentId && !c.IsMerged && c.CreatedAt >= a && c.CreatedAt < b, ct),
                        surveys = await _db.SurveyResponses.CountAsync(s => s.AgentId == agentId && !s.IsSkipped && s.CreatedAt >= a && s.CreatedAt < b, ct),
                        surveysSkipped = await _db.SurveyResponses.CountAsync(s => s.AgentId == agentId && s.IsSkipped && s.CreatedAt >= a && s.CreatedAt < b, ct),
                        referrals = await _db.Referrals.CountAsync(r => r.AgentId == agentId && r.CreatedAt >= a && r.CreatedAt < b, ct),
                        admitted = await _db.Referrals.CountAsync(r => r.AgentId == agentId && r.CreatedAt >= a && r.CreatedAt < b && AdmittedStatuses.Contains(r.Status), ct),
                        daysWorked = (await _db.Shifts.AsNoTracking().Where(s => s.AgentId == agentId && s.StartTime >= a && s.StartTime < b).Select(s => s.StartTime).ToListAsync(ct))
                            .Select(AttendanceService.IstDate).Distinct().Count(),
                    };
                    return new { thisMonth = await Range(from, DateTime.UtcNow.AddMinutes(1)), lastMonth = await Range(prevFrom, from) };
                }
                case "get_block_needs":
                {
                    var (block, _) = await BlockAsync(agentId, ct);
                    return block == null ? new { error = "No block assigned yet." } : await _data.SurveyNeedsAsync(block, ct);
                }
                case "get_hospital_services":
                {
                    var dept = ((args["department"] as JsonValue)?.ToString() ?? "").Trim().ToLowerInvariant();
                    var depts = await _db.Departments.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Order).ToListAsync(ct);
                    if (dept.Length > 0) depts = depts.Where(d => d.Name.ToLower().Contains(dept)).ToList();
                    var ids = depts.Select(d => (Guid?)d.Id).ToList();
                    var docs = await _db.Doctors.AsNoTracking().Where(d => d.IsActive && ids.Contains(d.DepartmentId)).ToListAsync(ct);
                    return depts.Select(d => new
                    {
                        department = d.Name,
                        doctors = docs.Where(x => x.DepartmentId == d.Id).Select(x => new { x.Name, x.Qualification, x.OpdDays, x.OpdTimings }),
                    });
                }
                default:
                    return new { error = "Unknown tool" };
            }
        }

        private static string ReferralsStage(string s) => Controllers.ReferralsController.StageLabel(s);

        private async Task<(string Answer, List<string> Used)> LoopAsync(string agentId, JsonArray messages, CancellationToken ct)
        {
            var used = new List<string>();
            var tools = Tools();
            for (int round = 0; round < 5; round++)
            {
                var (msg, _) = await _groq.ChatAsync(messages, tools, null, ct);
                var calls = msg["tool_calls"] as JsonArray;
                var content = (msg["content"] as JsonValue)?.ToString() ?? "";
                var keep = new JsonObject { ["role"] = "assistant", ["content"] = content };
                if (calls != null && calls.Count > 0) keep["tool_calls"] = calls.DeepClone();
                messages.Add(keep);
                if (calls == null || calls.Count == 0) return (content.Trim(), used);
                foreach (var call in calls)
                {
                    var fn = call!["function"]!;
                    var name = fn["name"]!.ToString();
                    JsonObject args;
                    try { args = JsonNode.Parse((fn["arguments"] as JsonValue)?.ToString() ?? "{}") as JsonObject ?? new JsonObject(); }
                    catch (JsonException) { args = new JsonObject(); }
                    string output;
                    try { output = JsonSerializer.Serialize(await ToolAsync(agentId, name, args, ct), Json); }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        _logger.LogWarning(ex, "Field assistant tool {Tool} failed", name);
                        output = "{\"error\":\"That lookup failed.\"}";
                    }
                    if (output.Length > 6000) output = output[..6000] + "…(cut)";
                    messages.Add(new JsonObject { ["role"] = "tool", ["tool_call_id"] = call["id"]!.ToString(), ["content"] = output });
                    used.Add(name);
                }
            }
            messages.Add(new JsonObject { ["role"] = "user", ["content"] = "Answer now with what you have." });
            var (last, _) = await _groq.ChatAsync(messages, null, null, ct);
            return (((last["content"] as JsonValue)?.ToString() ?? "").Trim(), used);
        }

        public record Turn(string Role, string Content);

        public async Task<(string Answer, List<string> Used)> AskAsync(string agentId, string question, List<Turn> history, string? lang, CancellationToken ct)
        {
            var count = _cache.GetOrCreate($"fa-count:{agentId}:{AttendanceService.TodayIst}", e => { e.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(26); return 0; });
            if (count >= DailyQuestionLimit) throw new AnalystUnavailableException("You have asked a lot today. The helper will be back tomorrow.");
            _cache.Set($"fa-count:{agentId}:{AttendanceService.TodayIst}", count + 1, TimeSpan.FromHours(26));

            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == agentId).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? "the agent";
            var messages = new JsonArray { new JsonObject { ["role"] = "system", ["content"] = Context(name, lang) } };
            foreach (var h in history.TakeLast(8))
            {
                if (h.Role is not ("user" or "assistant") || string.IsNullOrWhiteSpace(h.Content)) continue;
                messages.Add(new JsonObject { ["role"] = h.Role, ["content"] = h.Content.Length > 2000 ? h.Content[..2000] : h.Content });
            }
            messages.Add(new JsonObject { ["role"] = "user", ["content"] = question.Length > 1000 ? question[..1000] : question });
            return await LoopAsync(agentId, messages, ct);
        }

        /// <summary>Three short tips for today, made once per agent per day and language.</summary>
        public async Task<object> TipsAsync(string agentId, string? lang, bool refresh, CancellationToken ct)
        {
            var key = $"fa-tips:{agentId}:{lang}:{AttendanceService.TodayIst}";
            if (!refresh && _cache.TryGetValue(key, out object? cached) && cached != null) return cached;

            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == agentId).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? "the agent";
            var pack = new
            {
                day = await ToolAsync(agentId, "get_my_day", new JsonObject(), ct),
                month = await ToolAsync(agentId, "get_my_month", new JsonObject(), ct),
                quietPartners = await ToolAsync(agentId, "get_my_partners", new JsonObject { ["filter"] = "quiet", ["limit"] = 5 }, ct),
                blockNeeds = await ToolAsync(agentId, "get_block_needs", new JsonObject(), ct),
            };
            var schema = JsonNode.Parse("""
            {"type":"object","additionalProperties":false,"required":["greeting","tips"],
             "properties":{"greeting":{"type":"string","description":"one short encouraging line using the agent's results"},
               "tips":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["title","detail"],
                 "properties":{"title":{"type":"string"},"detail":{"type":"string"}}}}}}
            """);
            var messages = new JsonArray
            {
                new JsonObject { ["role"] = "system", ["content"] = Context(name, lang) },
                new JsonObject { ["role"] = "user", ["content"] =
                    $"Give {name} three tips for today, most useful first: tasks from their manager (especially overdue ones), whom to follow up, which panchayat to visit, what to tell partners there. " +
                    $"Use real names from the data. Each tip: a title of a few words and one or two short sentences. Data:\n{JsonSerializer.Serialize(pack, Json)}" },
            };
            JsonObject result;
            try
            {
                var (msg, _) = await _groq.ChatAsync(messages, null, new JsonObject { ["type"] = "json_schema", ["json_schema"] = new JsonObject { ["name"] = "tips", ["schema"] = schema } }, ct);
                result = JsonNode.Parse((msg["content"] as JsonValue)?.ToString() ?? "{}")!.AsObject();
            }
            catch (AnalystUnavailableException)
            {
                messages[1]!["content"] += "\nReply with one JSON object: {\"greeting\": string, \"tips\": [{\"title\": string, \"detail\": string}]}.";
                var (msg, _) = await _groq.ChatAsync(messages, null, new JsonObject { ["type"] = "json_object" }, ct);
                result = JsonNode.Parse((msg["content"] as JsonValue)?.ToString() ?? "{}")!.AsObject();
            }
            var tips = new
            {
                greeting = (result["greeting"] as JsonValue)?.ToString() ?? "",
                tips = (result["tips"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Take(4)
                    .Select(t => new { title = (t["title"] as JsonValue)?.ToString() ?? "", detail = (t["detail"] as JsonValue)?.ToString() ?? "" }).ToList(),
                madeAt = DateTime.UtcNow,
            };
            _cache.Set(key, (object)tips, TimeSpan.FromHours(12));
            return tips;
        }
    }
}
