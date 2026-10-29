using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.SeedData;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// The CRM Surveys page: panchayat insights, every response, and the six questions the app asks.
    /// Reading needs Analytics access; editing or deleting answers and changing questions is Admin only.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Analytics, Level = Pages.View)]
    [Route("api/v1/surveys")]
    public class SurveyWorkController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        public SurveyWorkController(IMarketingDbContext db) => _db = db;

        private IActionResult? AdminOnly() =>
            User.IsAdmin() ? null : StatusCode(403, new { message = "Only an admin can change survey answers or questions." });

        private sealed record Resp(Guid Id, string? ContactId, string? PanchayatId, string AgentId, bool IsSkipped, string? SkipReason, DateTime CreatedAt, string AnswersJson);

        private async Task<List<Resp>> ResponsesAsync(CancellationToken ct) =>
            (await _db.SurveyResponses.AsNoTracking()
                .Select(r => new { r.Id, r.ContactId, r.PanchayatId, r.AgentId, r.IsSkipped, r.SkipReason, r.CreatedAt, r.AnswersJson })
                .ToListAsync(ct))
            .Select(r => new Resp(r.Id, r.ContactId, r.PanchayatId, r.AgentId, r.IsSkipped, r.SkipReason, r.CreatedAt, r.AnswersJson ?? "{}")).ToList();

        private static object QuestionMeta(SurveyQuestion q) => new
        {
            id = q.Id,
            questionId = q.QuestionId,
            title = SurveyCore.Title(q),
            text = q.Text,
            type = q.Type,
            options = SurveyCore.Options(q).Select(o => new { full = o, label = GeoController.ShortLabel(o) }),
        };

        // ─── Insights ──────────────────────────────────────────────────────────

        private static readonly (string Key, string[] Words)[] SpecialistWords =
        {
            ("gyn", new[] { "gyn", "obst", "mahila", "prasav", "delivery" }),
            ("ortho", new[] { "ortho", "haddi", "bone", "trauma" }),
            ("uro", new[] { "uro", "pathri", "stone", "kidney", "nephro" }),
            ("paed", new[] { "paed", "pedia", "child", "bachh", "neonat" }),
            ("cardio", new[] { "cardio", "heart", "dil " }),
            ("surg", new[] { "surg", "laparo" }),
            ("eye", new[] { "ophthal", "eye", "aankh" }),
            ("neuro", new[] { "neuro", "brain", "spine" }),
        };
        private static string? SpecialistKey(string s)
        {
            var l = s.ToLowerInvariant();
            foreach (var (k, w) in SpecialistWords) if (w.Any(l.Contains)) return k;
            return null;
        }
        private static bool Outflow(string dest)
        {
            var l = dest.ToLowerInvariant();
            return l.Contains("siliguri") || l.Contains("purn") || l.Contains("patna") || l.Contains("kolkata") || l.Contains("islampur") || l.Contains("katihar") || l.Contains("untreated") || l.Contains("ilaaj chhod");
        }

        [HttpGet("insights")]
        public async Task<IActionResult> Insights([FromQuery] string? district, [FromQuery] string? block, CancellationToken ct)
        {
            var questions = await SurveyCore.ActiveAsync(_db, ct);
            var qids = questions.Select(q => q.QuestionId).ToList();
            var opts = questions.ToDictionary(q => q.QuestionId, SurveyCore.Options);
            var places = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing)
                .Select(p => new { p.PanchayatId, p.Name, p.Block, p.District }).ToListAsync(ct);
            var blocks = places.GroupBy(p => (p.District, p.Block)).Select(g => new { district = g.Key.District, block = g.Key.Block }).OrderBy(b => b.district).ThenBy(b => b.block).ToList();
            var scoped = places.Where(p => (string.IsNullOrWhiteSpace(district) || p.District == district) && (string.IsNullOrWhiteSpace(block) || p.Block == block)).ToList();
            var placeById = scoped.ToDictionary(p => p.PanchayatId);
            bool byPanchayat = !string.IsNullOrWhiteSpace(block);

            var all = await ResponsesAsync(ct);
            var monthStart = AttendanceService.StartUtc(new DateOnly(IstClock.NowIst.Year, IstClock.NowIst.Month, 1));
            var parsed = all.Where(r => !r.IsSkipped && r.PanchayatId != null && placeById.ContainsKey(r.PanchayatId))
                .Select(r => (r, a: SurveyCore.Parse(r.AnswersJson)))
                .Where(x => SurveyCore.Answers(x.a, qids)).ToList();

            // Units: panchayats inside one block, otherwise blocks.
            string UnitOf(string pid) => byPanchayat ? pid : $"{placeById[pid].District}|{placeById[pid].Block}";
            var unitNames = byPanchayat
                ? scoped.ToDictionary(p => p.PanchayatId, p => (name: p.Name, sub: p.Block))
                : scoped.GroupBy(p => $"{p.District}|{p.Block}").ToDictionary(g => g.Key, g => (name: g.First().Block, sub: g.First().District));

            var deptNames = await _db.Departments.AsNoTracking().Where(d => d.IsActive).Select(d => d.Name).ToListAsync(ct);
            var haveKeys = deptNames.Select(SpecialistKey).Where(k => k != null).ToHashSet();

            var units = unitNames.Select(kv =>
            {
                var rs = parsed.Where(x => UnitOf(x.r.PanchayatId!) == kv.Key).ToList();
                var counts = new Dictionary<string, Dictionary<string, int>>();
                var answered = new Dictionary<string, int>();
                foreach (var qid in qids)
                {
                    var c = new Dictionary<string, int>();
                    int n = 0;
                    foreach (var (_, a) in rs)
                    {
                        if (!a.TryGetValue(qid, out var el)) continue;
                        var vals = SurveyCore.Values(el, opts[qid]);
                        if (vals.Count == 0) continue;
                        n++;
                        foreach (var b in vals.Select(v => SurveyCore.Bucket(v, opts[qid])).Distinct()) c[b] = c.GetValueOrDefault(b) + 1;
                    }
                    counts[qid] = c;
                    answered[qid] = n;
                }
                // Where to focus: people miss a specialist we have, and they travel far (or go untreated) today.
                string? topSpec = counts.TryGetValue("specialist_deficit", out var sc) && sc.Count > 0 ? sc.OrderByDescending(x => x.Value).First().Key : null;
                string? topDest = counts.TryGetValue("treatment_destination", out var dc) && dc.Count > 0 ? dc.OrderByDescending(x => x.Value).First().Key : null;
                int specN = answered.GetValueOrDefault("specialist_deficit"), destN = answered.GetValueOrDefault("treatment_destination");
                double needShare = specN == 0 ? 0 : sc!.Where(x => haveKeys.Contains(SpecialistKey(x.Key))).Select(x => x.Value).DefaultIfEmpty(0).Max() / (double)specN;
                double outShare = destN == 0 ? 0 : dc!.Where(x => Outflow(x.Key)).Sum(x => x.Value) / (double)destN;
                double confidence = Math.Min(rs.Count, 8) / 8.0;
                int score = rs.Count == 0 ? 0 : (int)Math.Round(100 * (0.5 * needShare + 0.5 * Math.Min(outShare, 1)) * confidence);
                return new
                {
                    id = kv.Key,
                    name = kv.Value.name,
                    sub = kv.Value.sub,
                    responses = rs.Count,
                    lastAt = rs.Count == 0 ? (DateTime?)null : rs.Max(x => x.r.CreatedAt),
                    score,
                    topSpecialist = topSpec == null ? null : GeoController.ShortLabel(topSpec),
                    topSpecialistWeHave = topSpec != null && haveKeys.Contains(SpecialistKey(topSpec)),
                    topDestination = topDest == null ? null : GeoController.ShortLabel(topDest),
                    answered,
                    counts = counts.ToDictionary(q => q.Key, q => q.Value.OrderByDescending(x => x.Value).ToDictionary(x => x.Key, x => x.Value)),
                };
            }).OrderByDescending(u => u.score).ThenByDescending(u => u.responses).ThenBy(u => u.name).ToList();

            var scopedSkipped = all.Where(r => r.IsSkipped && r.CreatedAt >= monthStart && (r.PanchayatId == null || placeById.ContainsKey(r.PanchayatId))).Count();
            return Ok(new
            {
                unit = byPanchayat ? "panchayat" : "block",
                district,
                block,
                blocks,
                departments = deptNames,
                questions = questions.Select(QuestionMeta),
                totals = new
                {
                    responses = parsed.Count,
                    places = unitNames.Count,
                    placesWithAnswers = units.Count(u => u.responses > 0),
                    panchayats = scoped.Count,
                    panchayatsWithAnswers = parsed.Select(x => x.r.PanchayatId).Distinct().Count(),
                    thisMonth = parsed.Count(x => x.r.CreatedAt >= monthStart),
                    skippedThisMonth = scopedSkipped,
                },
                units,
            });
        }

        // ─── Responses ─────────────────────────────────────────────────────────

        [HttpGet("responses")]
        public async Task<IActionResult> Responses([FromQuery] string? view, [FromQuery] string? block, [FromQuery] string? agentId,
            [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 10, 100);
            var questions = await SurveyCore.ActiveAsync(_db, ct);
            var qids = questions.Select(x => x.QuestionId).ToList();
            var all = await ResponsesAsync(ct);
            var places = (await _db.Panchayats.AsNoTracking().Select(p => new { p.PanchayatId, p.Name, p.Block }).ToListAsync(ct))
                .GroupBy(p => p.PanchayatId).ToDictionary(g => g.Key, g => g.First());
            var contactIds = all.Select(r => r.ContactId).Where(x => x != null).Distinct().ToList();
            var contacts = (await _db.Contacts.AsNoTracking().Where(c => contactIds.Contains(c.ClientId)).Select(c => new { c.ClientId, c.Name, c.Role }).ToListAsync(ct))
                .GroupBy(c => c.ClientId).ToDictionary(g => g.Key, g => g.First());
            var agents = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);

            var rows = all.Select(r =>
            {
                var a = SurveyCore.Parse(r.AnswersJson);
                bool current = SurveyCore.Answers(a, qids);
                var pl = r.PanchayatId != null ? places.GetValueOrDefault(r.PanchayatId) : null;
                var c = r.ContactId != null ? contacts.GetValueOrDefault(r.ContactId) : null;
                return new
                {
                    id = r.Id,
                    kind = r.IsSkipped ? "skipped" : current ? "current" : "older",
                    contactId = r.ContactId,
                    contactName = c?.Name,
                    contactType = c?.Role,
                    panchayat = pl?.Name,
                    block = pl?.Block,
                    agentId = r.AgentId,
                    agent = agents.GetValueOrDefault(r.AgentId) ?? r.AgentId,
                    createdAt = r.CreatedAt,
                    answered = qids.Count(id => a.TryGetValue(id, out var el) && !string.IsNullOrWhiteSpace(el.ToString())),
                    answerCount = a.Count(kv => !string.IsNullOrWhiteSpace(kv.Value.ToString())),
                    skipReason = r.SkipReason,
                };
            }).ToList();

            var counts = new { current = rows.Count(r => r.kind == "current"), skipped = rows.Count(r => r.kind == "skipped"), older = rows.Count(r => r.kind == "older") };
            var v = view is "skipped" or "older" ? view : "current";
            var list = rows.Where(r => r.kind == v);
            if (!string.IsNullOrWhiteSpace(block)) list = list.Where(r => r.block == block);
            if (!string.IsNullOrWhiteSpace(agentId)) list = list.Where(r => r.agentId == agentId);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var t = q.Trim().ToLowerInvariant();
                list = list.Where(r => (r.contactName ?? "").ToLowerInvariant().Contains(t) || (r.panchayat ?? "").ToLowerInvariant().Contains(t) || (r.agent ?? "").ToLowerInvariant().Contains(t));
            }
            var filtered = list.OrderByDescending(r => r.createdAt).ToList();
            return Ok(new
            {
                counts,
                total = filtered.Count,
                page,
                pageSize,
                asked = qids.Count,
                canEdit = User.IsAdmin(),
                agents = rows.Select(r => new { r.agentId, r.agent }).Distinct().OrderBy(a => a.agent),
                blocks = rows.Select(r => r.block).Where(b => b != null).Distinct().OrderBy(b => b),
                rows = filtered.Skip((page - 1) * pageSize).Take(pageSize),
            });
        }

        [HttpGet("responses/{id:guid}")]
        public async Task<IActionResult> Response(Guid id, CancellationToken ct)
        {
            var r = await _db.SurveyResponses.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "Survey response not found." });
            var allQ = await _db.SurveyQuestions.AsNoTracking().OrderBy(q => q.Order).ToListAsync(ct);
            var a = SurveyCore.Parse(r.AnswersJson);
            var active = allQ.Where(q => q.IsActive).ToList();
            bool current = SurveyCore.Answers(a, active.Select(q => q.QuestionId));
            var shown = current ? active : allQ.Where(q => a.ContainsKey(q.QuestionId)).ToList();
            var c = r.ContactId == null ? null : await _db.Contacts.AsNoTracking().Where(x => x.ClientId == r.ContactId).Select(x => new { x.ClientId, x.Name, x.Role }).FirstOrDefaultAsync(ct);
            var p = r.PanchayatId == null ? null : await _db.Panchayats.AsNoTracking().Where(x => x.PanchayatId == r.PanchayatId).Select(x => new { x.Name, x.Block }).FirstOrDefaultAsync(ct);
            var agent = await _db.Agents.AsNoTracking().Where(x => x.AgentId == r.AgentId).Select(x => x.Name).FirstOrDefaultAsync(ct);
            var edits = await _db.SurveyEdits.AsNoTracking().Where(e => e.ResponseId == id).OrderByDescending(e => e.ChangedAt).ToListAsync(ct);
            var editorIds = edits.Select(e => e.ChangedBy).Distinct().ToList();
            var editors = await _db.Agents.AsNoTracking().Where(x => editorIds.Contains(x.AgentId)).ToDictionaryAsync(x => x.AgentId, x => x.Name, ct);
            var unknownKeys = a.Keys.Where(k => !allQ.Any(q => q.QuestionId == k)).ToList();

            return Ok(new
            {
                id = r.Id,
                kind = r.IsSkipped ? "skipped" : current ? "current" : "older",
                contact = c == null ? null : new { clientId = c.ClientId, name = c.Name, type = c.Role },
                panchayat = p?.Name,
                block = p?.Block,
                agent = agent ?? r.AgentId,
                createdAt = r.CreatedAt,
                skipReason = r.SkipReason,
                canEdit = User.IsAdmin() && current,
                canDelete = User.IsAdmin(),
                questions = shown.Select(q =>
                {
                    var options = SurveyCore.Options(q);
                    var vals = a.TryGetValue(q.QuestionId, out var el) ? SurveyCore.Values(el, options) : new List<string>();
                    return new
                    {
                        questionId = q.QuestionId,
                        title = SurveyCore.Title(q),
                        text = q.Text,
                        type = q.Type,
                        options = options.Select(o => new { full = o, label = GeoController.ShortLabel(o) }),
                        values = vals,
                        labels = vals.Select(GeoController.ShortLabel),
                    };
                }),
                extra = unknownKeys.Select(k => new { questionId = k, value = a[k].ToString() }),
                history = edits.Select(e => new { e.Action, e.Summary, by = editors.GetValueOrDefault(e.ChangedBy) ?? e.ChangedBy, at = e.ChangedAt }),
            });
        }

        public class EditDto { public Dictionary<string, List<string>> Answers { get; set; } = new(); }

        [HttpPut("responses/{id:guid}")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> Edit(Guid id, [FromBody] EditDto dto, CancellationToken ct)
        {
            if (AdminOnly() is { } deny) return deny;
            var r = await _db.SurveyResponses.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "Survey response not found." });
            var questions = await SurveyCore.ActiveAsync(_db, ct);
            var a = SurveyCore.Parse(r.AnswersJson);
            var before = r.AnswersJson;
            var changes = new List<string>();
            var next = a.ToDictionary(kv => kv.Key, kv => (object)kv.Value);
            foreach (var (qid, vals) in dto.Answers)
            {
                var q = questions.FirstOrDefault(x => x.QuestionId == qid);
                if (q == null) return BadRequest(new { message = "One of the answers is for a question that isn't asked any more." });
                var clean = (vals ?? new()).Select(v => v.Trim()).Where(v => v.Length > 0).Distinct().ToList();
                if (q.Type == "single" && clean.Count > 1) return BadRequest(new { message = $"“{SurveyCore.Title(q)}” takes one answer." });
                var opts = SurveyCore.Options(q);
                var old = a.TryGetValue(qid, out var el) ? SurveyCore.Values(el, opts) : new List<string>();
                if (old.OrderBy(x => x).SequenceEqual(clean.OrderBy(x => x))) continue;
                if (clean.Count == 0) next.Remove(qid);
                else next[qid] = q.Type == "single" || q.Type == "text" ? clean[0] : string.Join(", ", clean);
                string Short(List<string> l) => l.Count == 0 ? "(blank)" : string.Join(", ", l.Select(GeoController.ShortLabel));
                changes.Add($"{SurveyCore.Title(q)}: {Short(old)} → {Short(clean)}");
            }
            if (changes.Count == 0) return Ok(new { id, changed = 0 });
            r.AnswersJson = JsonSerializer.Serialize(next);
            _db.SurveyEdits.Add(new SurveyEdit
            {
                ResponseId = id,
                Action = "edit",
                ChangedBy = User.AgentIdOf() ?? "",
                BeforeJson = before,
                AfterJson = r.AnswersJson,
                Summary = string.Join("; ", changes),
            });
            await _db.SaveChangesAsync(ct);
            return Ok(new { id, changed = changes.Count });
        }

        [HttpDelete("responses/{id:guid}")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
        {
            if (AdminOnly() is { } deny) return deny;
            var r = await _db.SurveyResponses.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "Survey response not found." });
            // Keep a full copy so a mistaken delete can be put back by hand.
            _db.SurveyEdits.Add(new SurveyEdit
            {
                ResponseId = id,
                Action = "delete",
                ChangedBy = User.AgentIdOf() ?? "",
                BeforeJson = JsonSerializer.Serialize(new { r.ClientId, r.DeviceId, r.AgentId, r.ContactId, r.PanchayatId, r.IsSkipped, r.SkipReason, r.AnswersJson, r.CreatedAt, r.SyncedAt }),
                Summary = "Response deleted",
            });
            _db.SurveyResponses.Remove(r);
            await _db.SaveChangesAsync(ct);
            return NoContent();
        }

        // ─── Questions ─────────────────────────────────────────────────────────

        [HttpGet("questions")]
        public async Task<IActionResult> Questions(CancellationToken ct)
        {
            var all = await _db.SurveyQuestions.AsNoTracking().OrderBy(q => q.Order).ToListAsync(ct);
            var answers = await ResponsesAsync(ct);
            var used = new Dictionary<string, int>();
            foreach (var r in answers.Where(r => !r.IsSkipped))
                foreach (var kv in SurveyCore.Parse(r.AnswersJson))
                    if (!string.IsNullOrWhiteSpace(kv.Value.ToString())) used[kv.Key] = used.GetValueOrDefault(kv.Key) + 1;
            object Dto(SurveyQuestion q) => new
            {
                id = q.Id,
                questionId = q.QuestionId,
                title = SurveyCore.Title(q),
                text = q.Text,
                type = q.Type,
                order = q.Order,
                options = SurveyCore.Options(q),
                answers = used.GetValueOrDefault(q.QuestionId),
            };
            return Ok(new
            {
                canEdit = User.IsAdmin(),
                asked = all.Where(q => q.IsActive).Select(Dto),
                retired = all.Where(q => !q.IsActive).Select(Dto),
            });
        }

        public class QuestionEditDto
        {
            public string? Text { get; set; }
            public string? Type { get; set; }
            public List<string>? AddOptions { get; set; }
        }

        /// <summary>Change the wording or answer type, or add choices. Existing choices can't be renamed — past answers are stored by their text.</summary>
        [HttpPut("questions/{id:guid}")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> EditQuestion(Guid id, [FromBody] QuestionEditDto dto, CancellationToken ct)
        {
            if (AdminOnly() is { } deny) return deny;
            var q = await _db.SurveyQuestions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (q == null) return NotFound(new { message = "Question not found." });
            if (dto.Text != null)
            {
                var t = dto.Text.Trim();
                if (t.Length < 8) return BadRequest(new { message = "The question needs a few more words." });
                q.Text = t;
            }
            if (dto.Type != null)
            {
                if (dto.Type is not ("single" or "multi")) return BadRequest(new { message = "Pick one answer or several answers." });
                if (q.Type == "text") return BadRequest(new { message = "A free-text question can't be turned into a choice question here." });
                q.Type = dto.Type;
            }
            if (dto.AddOptions is { Count: > 0 })
            {
                var opts = SurveyCore.Options(q);
                foreach (var o in dto.AddOptions.Select(x => x.Trim()).Where(x => x.Length > 0))
                    if (!opts.Contains(o, StringComparer.OrdinalIgnoreCase))
                    {
                        int otherAt = opts.IndexOf("Other");
                        if (otherAt >= 0) opts.Insert(otherAt, o); else opts.Add(o);
                    }
                q.OptionsJson = JsonSerializer.Serialize(opts);
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = q.Id });
        }

        public class OrderDto { public List<Guid> Ids { get; set; } = new(); }

        [HttpPost("questions/order")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> Reorder([FromBody] OrderDto dto, CancellationToken ct)
        {
            if (AdminOnly() is { } deny) return deny;
            var active = await _db.SurveyQuestions.Where(q => q.IsActive).ToListAsync(ct);
            if (dto.Ids.Count != active.Count || !dto.Ids.All(id => active.Any(q => q.Id == id)))
                return BadRequest(new { message = "Send all the asked questions in their new order." });
            for (int i = 0; i < dto.Ids.Count; i++) active.First(q => q.Id == dto.Ids[i]).Order = i + 1;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        public class SwapDto { public Guid RetireId { get; set; } public Guid BringInId { get; set; } }

        /// <summary>Swap a retired question in for one of the asked ones, so the app always asks the same number.</summary>
        [HttpPost("questions/swap")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> Swap([FromBody] SwapDto dto, CancellationToken ct)
        {
            if (AdminOnly() is { } deny) return deny;
            var outQ = await _db.SurveyQuestions.FirstOrDefaultAsync(q => q.Id == dto.RetireId && q.IsActive, ct);
            var inQ = await _db.SurveyQuestions.FirstOrDefaultAsync(q => q.Id == dto.BringInId && !q.IsActive, ct);
            if (outQ == null || inQ == null) return BadRequest(new { message = "Pick one asked question and one retired question." });
            inQ.IsActive = true;
            inQ.Order = outQ.Order;
            inQ.Section = SurveyQuestionSeeder.CoreSection;
            inQ.IsOptional = false;
            outQ.IsActive = false;
            outQ.Order = outQ.Order + 100;
            await _db.SaveChangesAsync(ct);
            return Ok(new { asked = inQ.Id, retired = outQ.Id });
        }
    }
}
