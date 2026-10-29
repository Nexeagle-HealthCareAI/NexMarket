using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.SeedData;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// The CRM Partners page: one list of everyone who sends patients, with priority, follow-ups
    /// and champions, and a profile that pulls notes from the app, calls and status changes together.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Partners)]
    [Route("api/v1/partners")]
    public class PartnersController : ControllerBase
    {
        private static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };
        public static readonly string[] Priorities = { "very_high", "high", "normal", "low" };

        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;

        public PartnersController(IMarketingDbContext db, ILiveEvents live)
        {
            _db = db;
            _live = live;
        }

        /// <summary>IST midnight at the end of today, in UTC: anything before it is due.</summary>
        private static DateTime DueBefore => IstClock.TodayStartUtc.AddDays(1);

        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? tab, [FromQuery] string? priority, [FromQuery] string? block, [FromQuery] string? type,
            [FromQuery] string? agentId, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 25,
            CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 5, 100);
            var dueBefore = DueBefore;

            var all = _db.Contacts.AsNoTracking().Where(c => !c.IsMerged);
            var counts = new
            {
                all = await all.CountAsync(ct),
                follow = await all.CountAsync(c => c.FollowUpDate != null && c.FollowUpDate < dueBefore, ct),
                champ = await all.CountAsync(c => c.IsChampion, ct),
                escalated = await all.CountAsync(c => c.AgentEscalated && !c.IsEscalationResolved, ct),
                dup = await _db.Contacts.CountAsync(c => c.PotentialDuplicateOf != null && c.PotentialDuplicateOf != "" && !c.IsMerged && c.DuplicateReviewedAt == null, ct),
            };

            var query = all;
            if (tab == "follow") query = query.Where(c => c.FollowUpDate != null && c.FollowUpDate < dueBefore);
            else if (tab == "champ") query = query.Where(c => c.IsChampion);
            else if (tab == "escalated") query = query.Where(c => c.AgentEscalated && !c.IsEscalationResolved);

            if (!string.IsNullOrWhiteSpace(priority) && Priorities.Contains(priority))
                query = priority == "normal"
                    ? query.Where(c => c.Priority == null || c.Priority == "normal")
                    : query.Where(c => c.Priority == priority);
            if (!string.IsNullOrWhiteSpace(type)) query = query.Where(c => c.Role == type);
            if (!string.IsNullOrWhiteSpace(agentId)) query = query.Where(c => c.AgentId == agentId);
            if (!string.IsNullOrWhiteSpace(block))
            {
                var ids = _db.Panchayats.Where(p => p.Block == block).Select(p => p.PanchayatId);
                query = query.Where(c => ids.Contains(c.PanchayatId));
            }
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim().ToLower();
                var pids = _db.Panchayats.Where(p => p.Name.ToLower().Contains(term)).Select(p => p.PanchayatId);
                query = query.Where(c => c.Name.ToLower().Contains(term) || (c.Phone != null && c.Phone.Contains(term)) || pids.Contains(c.PanchayatId));
            }

            int total = await query.CountAsync(ct);
            IQueryable<OutreachContact> ordered = tab == "follow"
                ? query.OrderBy(c => c.FollowUpDate).ThenBy(c => c.Name)
                : query.OrderBy(c => c.Priority == "very_high" ? 0 : c.Priority == "high" ? 1 : c.Priority == "low" ? 3 : 2)
                       .ThenBy(c => c.FollowUpDate == null)
                       .ThenBy(c => c.FollowUpDate)
                       .ThenBy(c => c.Name);

            var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize)
                .Select(c => new { c.ClientId, c.Name, c.Role, c.Profession, c.Phone, c.PanchayatId, c.AgentId, c.Priority, c.IsImportant, c.IsChampion, c.FollowUpDate, c.PhotoUrl, escalated = c.AgentEscalated && !c.IsEscalationResolved })
                .ToListAsync(ct);

            var ids2 = rows.Select(r => r.ClientId).ToList();
            var since = DateTime.UtcNow.AddDays(-90);
            var refs = await _db.Referrals.AsNoTracking()
                .Where(r => r.ContactId != null && ids2.Contains(r.ContactId) && r.CreatedAt >= since)
                .GroupBy(r => r.ContactId!)
                .Select(g => new { id = g.Key, n = g.Count(), adm = g.Count(r => AdmittedStatuses.Contains(r.Status)) })
                .ToDictionaryAsync(x => x.id, ct);
            var places = await PlacesAsync(rows.Select(r => r.PanchayatId), ct);
            var agents = await AgentNamesAsync(rows.Select(r => r.AgentId), ct);

            return Ok(new
            {
                counts,
                total,
                page,
                pageSize,
                rows = rows.Select(r => new
                {
                    clientId = r.ClientId,
                    name = r.Name,
                    type = r.Role,
                    profession = r.Profession,
                    phone = r.Phone,
                    panchayat = places.GetValueOrDefault(r.PanchayatId)?.Name,
                    block = places.GetValueOrDefault(r.PanchayatId)?.Block,
                    agentName = agents.GetValueOrDefault(r.AgentId) ?? r.AgentId,
                    priority = NormalizePriority(r.Priority, r.IsImportant),
                    champion = r.IsChampion,
                    followUpDate = r.FollowUpDate,
                    followState = FollowState(r.FollowUpDate),
                    referrals90 = refs.TryGetValue(r.ClientId, out var x) ? x.n : 0,
                    admitted90 = refs.TryGetValue(r.ClientId, out var y) ? y.adm : 0,
                    photoUrl = r.PhotoUrl,
                    escalated = r.escalated,
                }),
            });
        }

        /// <summary>Values for the filter menus: blocks that have partners, agents who added them, types in use.</summary>
        [HttpGet("filters")]
        public async Task<IActionResult> Filters(CancellationToken ct)
        {
            var live = _db.Contacts.AsNoTracking().Where(c => !c.IsMerged);
            var pids = live.Select(c => c.PanchayatId).Distinct();
            var blocks = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId))
                .Select(p => new { p.Block, p.District }).Distinct().OrderBy(p => p.District).ThenBy(p => p.Block).ToListAsync(ct);
            var aids = live.Select(c => c.AgentId).Distinct();
            var agents = await _db.Agents.AsNoTracking().Where(a => aids.Contains(a.AgentId))
                .OrderBy(a => a.Name).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct);
            var types = await live.GroupBy(c => c.Role).Select(g => new { type = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToListAsync(ct);
            return Ok(new { blocks, agents, types });
        }

        [HttpGet("{clientId}")]
        public async Task<IActionResult> Detail(string clientId, CancellationToken ct)
        {
            var c = await _db.Contacts.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (c == null) return NotFound(new { message = "Partner not found." });
            var p = await _db.Panchayats.AsNoTracking().FirstOrDefaultAsync(x => x.PanchayatId == c.PanchayatId, ct);

            var referrals = await _db.Referrals.AsNoTracking().Where(r => r.ContactId == clientId)
                .OrderByDescending(r => r.CreatedAt).Take(50)
                .Select(r => new { r.ClientId, r.PatientName, r.Department, r.Status, r.CreatedAt }).ToListAsync(ct);
            var since = DateTime.UtcNow.AddDays(-90);

            var notes = await _db.ContactNotes.AsNoTracking().Where(n => n.ContactClientId == clientId)
                .OrderByDescending(n => n.CreatedAt).Take(50).ToListAsync(ct);
            var calls = await _db.CallLogs.AsNoTracking().Where(l => l.ContactClientId == clientId)
                .OrderByDescending(l => l.CreatedAt).Take(30).ToListAsync(ct);
            var history = await _db.ContactHistory.AsNoTracking().Where(h => h.ContactClientId == clientId)
                .OrderByDescending(h => h.Timestamp).Take(30).ToListAsync(ct);
            var lastVisit = await _db.Visits.AsNoTracking()
                .Where(v => v.PanchayatId == c.PanchayatId && v.AgentId == c.AgentId)
                .OrderByDescending(v => v.CheckInAt).Select(v => (DateTime?)v.CheckInAt).FirstOrDefaultAsync(ct);

            var people = await AgentNamesAsync(new[] { c.AgentId }
                .Concat(notes.Select(n => n.AgentId)).Concat(calls.Select(l => l.CalledBy)).Concat(history.Select(h => h.UpdatedBy))
                .Concat(new[] { c.ChampionSetBy ?? "" }), ct);
            string Who(string? id) => string.IsNullOrEmpty(id) ? "Someone" : people.GetValueOrDefault(id) ?? id;

            var timeline = notes.Select(n => new TimelineItem
                {
                    Kind = n.Source is "visit" or "revisit" ? n.Source : n.Source == "call" ? "call" : "note",
                    Text = n.Text,
                    By = Who(n.AgentId),
                    At = n.CreatedAt,
                    FromApp = !n.ClientId.StartsWith("crm-", StringComparison.Ordinal),
                })
                .Concat(calls.Select(l => new TimelineItem
                {
                    Kind = "call",
                    Text = CallText(l),
                    By = Who(l.CalledBy),
                    At = l.CreatedAt,
                }))
                .Concat(history.Where(h => h.PreviousStatus != h.NewStatus || !string.IsNullOrWhiteSpace(h.Comments)).Select(h => new TimelineItem
                {
                    Kind = "change",
                    Text = h.PreviousStatus != h.NewStatus
                        ? $"Status changed from {h.PreviousStatus} to {h.NewStatus}{(string.IsNullOrWhiteSpace(h.Comments) ? "" : ". " + h.Comments)}"
                        : h.Comments!,
                    By = Who(h.UpdatedBy),
                    At = h.Timestamp,
                }))
                .OrderByDescending(t => t.At).Take(60).ToList();

            return Ok(new
            {
                clientId = c.ClientId,
                name = c.Name,
                type = c.Role,
                profession = c.Profession,
                phone = c.Phone,
                photoUrl = c.PhotoUrl,
                status = c.Status,
                priority = NormalizePriority(c.Priority, c.IsImportant),
                champion = c.IsChampion,
                championNote = c.ChampionNote,
                championSetBy = c.IsChampion ? Who(c.ChampionSetBy) : null,
                followUpDate = c.FollowUpDate,
                followState = FollowState(c.FollowUpDate),
                panchayatId = c.PanchayatId,
                panchayat = p?.Name,
                block = p?.Block,
                district = p?.District,
                agentId = c.AgentId,
                agentName = Who(c.AgentId),
                createdAt = c.CreatedAt,
                lastVisit,
                lastCalledAt = c.LastCalledAt,
                whatsappOptOut = c.WhatsappOptOut,
                phoneInvalid = c.PhoneInvalid,
                escalation = c.AgentEscalated ? new
                {
                    note = c.AgentEscalationNote,
                    resolved = c.IsEscalationResolved,
                    resolution = c.AgentEscalationResolution,
                } : null,
                stats = new
                {
                    referrals90 = referrals.Count(r => r.CreatedAt >= since),
                    admitted90 = referrals.Count(r => r.CreatedAt >= since && AdmittedStatuses.Contains(r.Status)),
                    referralsAll = referrals.Count,
                    admittedAll = referrals.Count(r => AdmittedStatuses.Contains(r.Status)),
                },
                referrals = referrals.Take(10).Select(r => new
                {
                    r.ClientId, r.PatientName, r.Department, r.CreatedAt,
                    status = r.Status == "converted" ? "admitted" : r.Status,
                    label = ReferralsController.StageLabel(r.Status),
                }),
                timeline = timeline.Select(t => new { kind = t.Kind, text = t.Text, by = t.By, at = t.At, fromApp = t.FromApp }),
                survey = await SurveyAsync(clientId, ct),
            });
        }

        public class PriorityDto { public string Priority { get; set; } = "normal"; }

        [HttpPut("{clientId}/priority")]
        public async Task<IActionResult> SetPriority(string clientId, [FromBody] PriorityDto dto, CancellationToken ct)
        {
            if (!Priorities.Contains(dto.Priority)) return BadRequest(new { message = "Priority must be very high, high, normal or low." });
            var c = await _db.Contacts.FirstOrDefaultAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (c == null) return NotFound(new { message = "Partner not found." });
            c.Priority = dto.Priority;
            c.IsImportant = dto.Priority == "very_high";
            c.LastModifiedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { clientId, priority = c.Priority });
        }

        public class FollowUpDto
        {
            /// <summary>yyyy-MM-dd (IST). Ignored when Done is true.</summary>
            public string? Date { get; set; }
            public bool Done { get; set; }
            public string? Note { get; set; }
        }

        /// <summary>Set, move or clear the next follow-up. Marking it done clears the date and can log a note.</summary>
        [HttpPut("{clientId}/followup")]
        public async Task<IActionResult> SetFollowUp(string clientId, [FromBody] FollowUpDto dto, CancellationToken ct)
        {
            var c = await _db.Contacts.FirstOrDefaultAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (c == null) return NotFound(new { message = "Partner not found." });

            if (dto.Done || string.IsNullOrWhiteSpace(dto.Date))
            {
                c.FollowUpDate = null;
            }
            else
            {
                if (!DateTime.TryParseExact(dto.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                    return BadRequest(new { message = "Pick a date for the follow-up." });
                if (d.Date < IstClock.NowIst.Date) return BadRequest(new { message = "The follow-up date can't be in the past." });
                // 10:00 IST on that day.
                c.FollowUpDate = DateTime.SpecifyKind(d.Date.AddHours(10).AddMinutes(-330), DateTimeKind.Utc);
            }
            c.LastModifiedAt = DateTime.UtcNow;

            var text = dto.Note?.Trim();
            if (dto.Done) text = string.IsNullOrEmpty(text) ? "Follow-up done." : $"Follow-up done. {text}";
            if (!string.IsNullOrEmpty(text)) _db.ContactNotes.Add(NewNote(clientId, text));
            await _db.SaveChangesAsync(ct);
            return Ok(new { clientId, followUpDate = c.FollowUpDate, followState = FollowState(c.FollowUpDate) });
        }

        public class NoteDto { public string Text { get; set; } = string.Empty; }

        [HttpPost("{clientId}/notes")]
        public async Task<IActionResult> AddNote(string clientId, [FromBody] NoteDto dto, CancellationToken ct)
        {
            var text = dto.Text?.Trim() ?? "";
            if (text.Length == 0) return BadRequest(new { message = "Write something first." });
            if (text.Length > 2000) return BadRequest(new { message = "Keep the note under 2,000 characters." });
            var exists = await _db.Contacts.AnyAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (!exists) return NotFound(new { message = "Partner not found." });
            var note = NewNote(clientId, text);
            _db.ContactNotes.Add(note);
            await _db.SaveChangesAsync(ct);
            return Ok(new { kind = "note", text = note.Text, at = note.CreatedAt, fromApp = false });
        }

        // ─── helpers ───────────────────────────────────────────────────────────

        private ContactNote NewNote(string contactClientId, string text) => new()
        {
            ClientId = "crm-" + Guid.NewGuid().ToString("N"),
            ContactClientId = contactClientId,
            AgentId = User.AgentIdOf() ?? "",
            Text = text,
            Source = "note",
            CreatedAt = DateTime.UtcNow,
        };

        private sealed class TimelineItem
        {
            public string Kind { get; set; } = "note";
            public string Text { get; set; } = "";
            public string By { get; set; } = "";
            public DateTime At { get; set; }
            public bool FromApp { get; set; }
        }

        private static string CallText(CallLog l)
        {
            var outcome = l.Outcome switch
            {
                "connected" => "Call connected",
                "no_answer" => "No answer",
                "call_later" => "Asked to call later",
                "wrong_number" => "Wrong number",
                _ => "Call",
            };
            var responses = (l.Responses ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(r => CallsController.ResponseLabels.GetValueOrDefault(r, r)).ToList();
            var parts = new List<string> { outcome };
            if (responses.Count > 0) parts.Add(string.Join(", ", responses));
            if (!string.IsNullOrWhiteSpace(l.Note)) parts.Add(l.Note!.Trim());
            return string.Join(". ", parts);
        }

        public static string NormalizePriority(string? p, bool important) =>
            p is "very_high" or "high" or "normal" or "low" ? p : important ? "very_high" : "normal";

        public static string FollowState(DateTime? at)
        {
            if (at == null) return "none";
            var today = IstClock.TodayStartUtc;
            if (at < today) return "overdue";
            if (at < today.AddDays(1)) return "today";
            if (at < today.AddDays(7)) return "soon";
            return "later";
        }

        private async Task<Dictionary<string, Panchayat>> PlacesAsync(IEnumerable<string> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
            return (await _db.Panchayats.AsNoTracking().Where(p => list.Contains(p.PanchayatId)).ToListAsync(ct))
                .GroupBy(p => p.PanchayatId).ToDictionary(g => g.Key, g => g.First());
        }

        private async Task<Dictionary<string, string>> AgentNamesAsync(IEnumerable<string> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
            if (list.Count == 0) return new();
            return (await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
        }

        /// <summary>The partner's own answers to the six core questions, latest survey first.</summary>
        private async Task<object?> SurveyAsync(string clientId, CancellationToken ct)
        {
            var s = await _db.SurveyResponses.AsNoTracking()
                .Where(r => r.ContactId == clientId && !r.IsSkipped)
                .OrderByDescending(r => r.CreatedAt).Select(r => new { r.AnswersJson, r.CreatedAt }).FirstOrDefaultAsync(ct);
            if (s == null)
            {
                var skipped = await _db.SurveyResponses.AsNoTracking().AnyAsync(r => r.ContactId == clientId && r.IsSkipped, ct);
                return new { done = false, skipped, at = (DateTime?)null, answers = Array.Empty<object>() };
            }
            Dictionary<string, JsonElement> dict;
            try { dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(s.AnswersJson) ?? new(); }
            catch (JsonException) { dict = new(); }

            var answers = new List<object>();
            var asked = await SurveyCore.ActiveAsync(_db, ct);
            foreach (var aq in asked)
            {
                var qid = aq.QuestionId;
                if (!dict.TryGetValue(qid, out var el)) continue;
                var items = el.ValueKind == JsonValueKind.Array
                    ? el.EnumerateArray().Select(x => x.ToString())
                    : new[] { el.ToString() };
                var text = string.Join(", ", items.Where(x => !string.IsNullOrWhiteSpace(x)).Select(GeoController.ShortLabel));
                if (text.Length > 0) answers.Add(new { question = SurveyCore.Title(aq), answer = text });
            }
            return new { done = true, skipped = false, at = (DateTime?)s.CreatedAt, answers };
        }
    }
}
