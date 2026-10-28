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
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// Panchayat coverage for the live map and the coverage page: where each panchayat is,
    /// how far the field team has got there, who sends patients from it, and what the
    /// six-question snapshot says about it.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field, Pages.Partners, Pages.Analytics)]
    [Route("api/v1/geo")]
    public class GeoController : ControllerBase
    {
        public const int MaxChampionsPerPanchayat = 3;
        private static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };

        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;

        public GeoController(IMarketingDbContext db, ILiveEvents live)
        {
            _db = db;
            _live = live;
        }

        /// <summary>IST calendar dates (yyyy-MM-dd) → UTC range. Default: the last 30 days.</summary>
        private static (DateTime From, DateTime To) Range(string? from, string? to)
        {
            DateTime ParseIst(string s) => DateTime.SpecifyKind(DateTime.ParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture) - IstClock.Offset, DateTimeKind.Utc);
            var end = !string.IsNullOrWhiteSpace(to) && DateTime.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)
                ? ParseIst(to!).AddDays(1) : IstClock.TodayStartUtc.AddDays(1);
            var start = !string.IsNullOrWhiteSpace(from) && DateTime.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)
                ? ParseIst(from!) : IstClock.TodayStartUtc.AddDays(-29);
            return (start, end);
        }

        private static string Status(int visits, int partners, int referrals) =>
            referrals > 0 ? "patients" : partners > 0 ? "partners" : visits > 0 ? "visited" : "untouched";

        // ─── Coverage list (map + table) ────────────────────────────────────────

        [HttpGet("panchayats")]
        public async Task<IActionResult> Coverage(
            [FromQuery] string? district, [FromQuery] string? block, [FromQuery] string? agentId,
            [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var (start, end) = Range(from, to);
            var pq = _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing);
            if (!string.IsNullOrWhiteSpace(district)) pq = pq.Where(p => p.District == district);
            if (!string.IsNullOrWhiteSpace(block)) pq = pq.Where(p => p.Block == block);
            var panchayats = await pq.OrderBy(p => p.District).ThenBy(p => p.Block).ThenBy(p => p.Name).ToListAsync(ct);
            var ids = panchayats.Select(p => p.PanchayatId).ToList();
            bool scoped = !string.IsNullOrWhiteSpace(district) || !string.IsNullOrWhiteSpace(block);

            var visitQ = _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= start && v.CheckInAt < end);
            if (scoped) visitQ = visitQ.Where(v => ids.Contains(v.PanchayatId));
            if (!string.IsNullOrWhiteSpace(agentId)) visitQ = visitQ.Where(v => v.AgentId == agentId);
            var visits = await visitQ.Select(v => new { v.PanchayatId, v.AgentId, v.CheckInAt }).ToListAsync(ct);

            var contactQ = _db.Contacts.AsNoTracking().Where(c => !c.IsMerged);
            if (scoped) contactQ = contactQ.Where(c => ids.Contains(c.PanchayatId));
            if (!string.IsNullOrWhiteSpace(agentId)) contactQ = contactQ.Where(c => c.AgentId == agentId);
            var contacts = await contactQ.Select(c => new { c.ClientId, c.PanchayatId, c.IsImportant, c.IsChampion, c.CreatedAt }).ToListAsync(ct);
            // Referrals belong to a partner; the partner's panchayat is the referral's panchayat.
            var contactPanchayat = (await _db.Contacts.AsNoTracking()
                .Select(c => new { c.ClientId, c.PanchayatId }).ToListAsync(ct))
                .GroupBy(c => c.ClientId).ToDictionary(g => g.Key, g => g.First().PanchayatId);

            var refQ = _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= start && r.CreatedAt < end);
            if (!string.IsNullOrWhiteSpace(agentId)) refQ = refQ.Where(r => r.AgentId == agentId);
            var refs = await refQ.Select(r => new { r.ContactId, r.Status }).ToListAsync(ct);

            var surveyQ = _db.SurveyResponses.AsNoTracking().Where(s => !s.IsSkipped && s.PanchayatId != null);
            if (scoped) surveyQ = surveyQ.Where(s => ids.Contains(s.PanchayatId!));
            var surveys = await surveyQ.GroupBy(s => s.PanchayatId!).Select(g => new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
            var surveyMap = surveys.ToDictionary(s => s.Id, s => s.N);

            var checkIns = await PanchayatLocator.CheckInsAsync(_db, scoped ? ids : null, ct);
            var agentNames = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);

            var visitsBy = visits.GroupBy(v => v.PanchayatId).ToDictionary(g => g.Key, g => g.ToList());
            var contactsBy = contacts.GroupBy(c => c.PanchayatId).ToDictionary(g => g.Key, g => g.ToList());
            var refsBy = refs.Where(r => contactPanchayat.ContainsKey(r.ContactId))
                .GroupBy(r => contactPanchayat[r.ContactId]).ToDictionary(g => g.Key, g => g.ToList());

            var rows = panchayats.Select(p =>
            {
                var v = visitsBy.GetValueOrDefault(p.PanchayatId) ?? new();
                var c = contactsBy.GetValueOrDefault(p.PanchayatId) ?? new();
                var r = refsBy.GetValueOrDefault(p.PanchayatId) ?? new();
                var spot = PanchayatLocator.Resolve(p, checkIns.GetValueOrDefault(p.PanchayatId));
                return new
                {
                    id = p.PanchayatId,
                    name = p.Name,
                    block = p.Block,
                    district = p.District,
                    lat = spot.Lat,
                    lng = spot.Lng,
                    source = spot.Source,
                    visits = v.Count,
                    lastVisitAt = v.Count > 0 ? v.Max(x => x.CheckInAt) : (DateTime?)null,
                    agents = v.Select(x => x.AgentId).Distinct().Select(a => agentNames.GetValueOrDefault(a) ?? a).ToList(),
                    partners = c.Count,
                    newPartners = c.Count(x => x.CreatedAt >= start && x.CreatedAt < end),
                    important = c.Count(x => x.IsImportant),
                    champions = c.Count(x => x.IsChampion),
                    referrals = r.Count,
                    admitted = r.Count(x => AdmittedStatuses.Contains(x.Status)),
                    surveys = surveyMap.GetValueOrDefault(p.PanchayatId),
                    status = Status(v.Count, c.Count, r.Count),
                };
            }).ToList();

            return Ok(new
            {
                from = start,
                to = end,
                total = rows.Count,
                covered = rows.Count(x => x.status != "untouched"),
                withPartners = rows.Count(x => x.partners > 0),
                sendingPatients = rows.Count(x => x.referrals > 0),
                items = rows,
            });
        }

        // ─── One panchayat ─────────────────────────────────────────────────────

        [HttpGet("panchayats/{id}")]
        public async Task<IActionResult> Detail(string id, [FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var p = await _db.Panchayats.AsNoTracking().FirstOrDefaultAsync(x => x.PanchayatId == id, ct);
            if (p == null) return NotFound(new { message = "Panchayat not found." });
            var (start, end) = Range(from, to);

            var checkIns = await PanchayatLocator.CheckInsAsync(_db, new[] { id }, ct);
            var spot = PanchayatLocator.Resolve(p, checkIns.GetValueOrDefault(id));
            var agentNames = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
            string NameOf(string a) => agentNames.GetValueOrDefault(a) ?? a;

            var allVisits = await _db.Visits.AsNoTracking().Where(v => v.PanchayatId == id)
                .OrderByDescending(v => v.CheckInAt).Take(500)
                .Select(v => new { v.AgentId, v.CheckInAt, v.CheckOutAt }).ToListAsync(ct);
            var periodVisits = allVisits.Where(v => v.CheckInAt >= start && v.CheckInAt < end).ToList();

            var contacts = await _db.Contacts.AsNoTracking().Where(c => c.PanchayatId == id && !c.IsMerged)
                .Select(c => new
                {
                    c.ClientId, c.Name, c.Role, c.Profession, c.Phone, c.IsImportant, c.IsChampion, c.ChampionNote,
                    c.AgentId, c.Relation, c.CreatedAt, c.LastConnectedAt,
                }).ToListAsync(ct);
            var contactIds = contacts.Select(c => c.ClientId).ToList();
            var referrals = await _db.Referrals.AsNoTracking().Where(r => contactIds.Contains(r.ContactId))
                .Select(r => new { r.ClientId, r.ContactId, r.PatientName, r.Department, r.Status, r.CreatedAt, r.AgentId })
                .ToListAsync(ct);
            var refsByContact = referrals.GroupBy(r => r.ContactId).ToDictionary(g => g.Key, g => g.ToList());
            var periodRefs = referrals.Where(r => r.CreatedAt >= start && r.CreatedAt < end).ToList();

            var people = contacts.Select(c =>
            {
                var rs = refsByContact.GetValueOrDefault(c.ClientId) ?? new();
                return new
                {
                    clientId = c.ClientId,
                    name = c.Name,
                    role = c.Role,
                    profession = c.Profession,
                    phone = c.Phone,
                    important = c.IsImportant,
                    champion = c.IsChampion,
                    championNote = c.ChampionNote,
                    relation = c.Relation,
                    addedBy = NameOf(c.AgentId),
                    addedAt = c.CreatedAt,
                    lastConnectedAt = c.LastConnectedAt,
                    referrals = rs.Count,
                    referralsInPeriod = rs.Count(x => x.CreatedAt >= start && x.CreatedAt < end),
                    admitted = rs.Count(x => AdmittedStatuses.Contains(x.Status)),
                    lastReferralAt = rs.Count > 0 ? rs.Max(x => x.CreatedAt) : (DateTime?)null,
                };
            })
            .OrderByDescending(x => x.champion).ThenByDescending(x => x.referrals).ThenByDescending(x => x.admitted)
            .ThenByDescending(x => x.important).ThenBy(x => x.name)
            .ToList();

            var contactNames = contacts.GroupBy(c => c.ClientId).ToDictionary(g => g.Key, g => g.First().Name);

            return Ok(new
            {
                id = p.PanchayatId,
                name = p.Name,
                block = p.Block,
                district = p.District,
                lgdCode = p.LgdCode,
                lat = spot.Lat,
                lng = spot.Lng,
                source = spot.Source,
                fieldCheckIns = spot.FieldCheckIns,
                manualSetBy = p.ManualSetBy == null ? null : NameOf(p.ManualSetBy),
                manualSetAt = p.ManualSetAt,
                from = start,
                to = end,
                metrics = new
                {
                    visits = periodVisits.Count,
                    visitsAllTime = allVisits.Count,
                    lastVisitAt = allVisits.FirstOrDefault()?.CheckInAt,
                    partners = contacts.Count,
                    important = contacts.Count(c => c.IsImportant),
                    champions = contacts.Count(c => c.IsChampion),
                    referrals = periodRefs.Count,
                    admitted = periodRefs.Count(r => AdmittedStatuses.Contains(r.Status)),
                    referralsAllTime = referrals.Count,
                    status = Status(periodVisits.Count, contacts.Count, periodRefs.Count),
                },
                agents = allVisits.GroupBy(v => v.AgentId).Select(g => new
                {
                    agentId = g.Key,
                    name = NameOf(g.Key),
                    visits = g.Count(),
                    lastVisitAt = g.Max(x => x.CheckInAt),
                }).OrderByDescending(a => a.lastVisitAt).ToList(),
                visits = allVisits.Take(15).Select(v => new
                {
                    agent = NameOf(v.AgentId),
                    checkInAt = v.CheckInAt,
                    checkOutAt = v.CheckOutAt,
                    minutes = v.CheckOutAt.HasValue ? (int?)Math.Round((v.CheckOutAt.Value - v.CheckInAt).TotalMinutes) : null,
                }),
                people,
                referrals = referrals.OrderByDescending(r => r.CreatedAt).Take(10).Select(r => new
                {
                    clientId = r.ClientId,
                    patientName = r.PatientName,
                    department = r.Department,
                    status = r.Status,
                    stageLabel = ReferralsController.StageLabel(r.Status),
                    createdAt = r.CreatedAt,
                    partner = contactNames.GetValueOrDefault(r.ContactId),
                }),
                snapshot = await SnapshotAsync(id, ct),
            });
        }

        /// <summary>
        /// Adds up the six core survey questions for one panchayat. Multi-choice answers are
        /// stored as one comma-joined string, and some options contain commas themselves, so
        /// answers are matched against the known options rather than split.
        /// </summary>
        private async Task<object> SnapshotAsync(string panchayatId, CancellationToken ct)
        {
            var questions = await _db.SurveyQuestions.AsNoTracking()
                .Where(q => SurveyQuestionSeeder.CoreQuestionIds.Contains(q.QuestionId)).ToListAsync(ct);
            var answers = await _db.SurveyResponses.AsNoTracking()
                .Where(s => s.PanchayatId == panchayatId && !s.IsSkipped)
                .OrderByDescending(s => s.CreatedAt).Take(500)
                .Select(s => new { s.AnswersJson, s.CreatedAt }).ToListAsync(ct);

            var parsed = answers.Select(a =>
            {
                try { return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(a.AnswersJson) ?? new(); }
                catch (JsonException) { return new Dictionary<string, JsonElement>(); }
            }).ToList();

            var result = SurveyQuestionSeeder.CoreQuestionIds.Select(qid =>
            {
                var q = questions.FirstOrDefault(x => x.QuestionId == qid);
                if (q == null) return null;
                List<string> options = new();
                try { options = q.OptionsJson == null ? new() : JsonSerializer.Deserialize<List<string>>(q.OptionsJson) ?? new(); }
                catch (JsonException) { }

                var counts = options.ToDictionary(o => o, _ => 0);
                var others = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                int respondents = 0;
                foreach (var dict in parsed)
                {
                    if (!dict.TryGetValue(qid, out var el)) continue;
                    var text = el.ValueKind == JsonValueKind.Array
                        ? string.Join(", ", el.EnumerateArray().Select(x => x.ToString()))
                        : el.ToString();
                    if (string.IsNullOrWhiteSpace(text)) continue;
                    respondents++;
                    bool matched = false;
                    foreach (var o in options)
                    {
                        if (o == "Other") continue;
                        if (text.Contains(o, StringComparison.Ordinal)) { counts[o]++; matched = true; }
                    }
                    if (!matched || text.Contains("Other", StringComparison.Ordinal))
                    {
                        var other = text.StartsWith("Other: ", StringComparison.Ordinal) ? text[7..].Trim() : (matched ? null : text.Trim());
                        if (!string.IsNullOrEmpty(other)) others[other] = others.GetValueOrDefault(other) + 1;
                    }
                }
                return new
                {
                    questionId = qid,
                    title = ShortTitle(qid),
                    text = q.Text,
                    type = q.Type,
                    respondents,
                    answers = counts.Where(kv => kv.Value > 0).Select(kv => new { label = ShortLabel(kv.Key), full = kv.Key, count = kv.Value })
                        .Concat(others.Select(kv => new { label = kv.Key, full = "Other: " + kv.Key, count = kv.Value }))
                        .OrderByDescending(x => x.count).Take(6).ToList(),
                };
            }).Where(x => x != null).ToList();

            return new
            {
                responses = answers.Count,
                lastAt = answers.FirstOrDefault()?.CreatedAt,
                questions = result,
            };
        }

        public static string ShortTitle(string qid) => qid switch
        {
            "morbidity_profile" => "Common illnesses",
            "specialist_deficit" => "Missing specialist",
            "treatment_destination" => "Where patients go today",
            "referral_decision_maker" => "Who picks the hospital",
            "payment_funding_source" => "How families pay",
            "emergency_transport" => "Emergency transport",
            _ => qid,
        };

        /// <summary>Options read "Hindi phrase: detail" or "Hindi (English)"; keep the readable head.</summary>
        public static string ShortLabel(string option)
        {
            var s = option;
            int paren = s.IndexOf(" (", StringComparison.Ordinal);
            int colon = s.IndexOf(": ", StringComparison.Ordinal);
            int cut = new[] { paren, colon }.Where(i => i > 3).DefaultIfEmpty(-1).Min();
            if (cut > 0) s = s[..cut];
            return s.Length > 60 ? s[..57] + "…" : s;
        }

        // ─── Pins and champions ────────────────────────────────────────────────

        public class PinDto
        {
            public double Lat { get; set; }
            public double Lng { get; set; }
        }

        /// <summary>Place the panchayat's pin by hand (drag on the map). Wins over every estimate.</summary>
        [HttpPut("panchayats/{id}/pin")]
        [PageAccess(Pages.Field)]
        public async Task<IActionResult> SetPin(string id, [FromBody] PinDto dto, CancellationToken ct)
        {
            // Seemanchal and its neighbours — anything outside is a slip of the finger.
            if (dto.Lat < 24.5 || dto.Lat > 27.6 || dto.Lng < 86 || dto.Lng > 89.2)
                return BadRequest(new { message = "That spot is outside the Seemanchal area. Drag the pin onto the panchayat." });
            var p = await _db.Panchayats.FirstOrDefaultAsync(x => x.PanchayatId == id, ct);
            if (p == null) return NotFound(new { message = "Panchayat not found." });
            p.ManualLat = Math.Round(dto.Lat, 6);
            p.ManualLng = Math.Round(dto.Lng, 6);
            p.ManualSetAt = DateTime.UtcNow;
            p.ManualSetBy = User.AgentIdOf();
            await _db.SaveChangesAsync(ct);
            return Ok(new { lat = p.ManualLat, lng = p.ManualLng, source = "manual" });
        }

        /// <summary>Remove a hand-placed pin and go back to the census / field estimate.</summary>
        [HttpDelete("panchayats/{id}/pin")]
        [PageAccess(Pages.Field)]
        public async Task<IActionResult> ClearPin(string id, CancellationToken ct)
        {
            var p = await _db.Panchayats.FirstOrDefaultAsync(x => x.PanchayatId == id, ct);
            if (p == null) return NotFound(new { message = "Panchayat not found." });
            p.ManualLat = null;
            p.ManualLng = null;
            p.ManualSetAt = null;
            p.ManualSetBy = null;
            await _db.SaveChangesAsync(ct);
            var checkIns = await PanchayatLocator.CheckInsAsync(_db, new[] { id }, ct);
            var spot = PanchayatLocator.Resolve(p, checkIns.GetValueOrDefault(id));
            return Ok(new { lat = spot.Lat, lng = spot.Lng, source = spot.Source });
        }

        public class ChampionDto
        {
            public bool Champion { get; set; }
            public string? Note { get; set; }
        }

        /// <summary>Mark or unmark a partner as the panchayat's patient-flow champion.</summary>
        [HttpPut("contacts/{clientId}/champion")]
        [PageAccess(Pages.Partners, Pages.Field)]
        public async Task<IActionResult> SetChampion(string clientId, [FromBody] ChampionDto dto, CancellationToken ct)
        {
            var c = await _db.Contacts.FirstOrDefaultAsync(x => x.ClientId == clientId && !x.IsMerged, ct);
            if (c == null) return NotFound(new { message = "Partner not found." });
            if (dto.Champion && !c.IsChampion)
            {
                int already = await _db.Contacts.CountAsync(x => x.PanchayatId == c.PanchayatId && x.IsChampion && !x.IsMerged, ct);
                if (already >= MaxChampionsPerPanchayat)
                    return Conflict(new { message = $"This panchayat already has {MaxChampionsPerPanchayat} champions. Remove one first." });
            }
            c.IsChampion = dto.Champion;
            c.ChampionNote = dto.Champion ? (string.IsNullOrWhiteSpace(dto.Note) ? c.ChampionNote : dto.Note.Trim()) : null;
            c.ChampionSetAt = dto.Champion ? DateTime.UtcNow : null;
            c.ChampionSetBy = dto.Champion ? User.AgentIdOf() : null;
            c.LastModifiedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            if (dto.Champion)
            {
                var place = await _db.Panchayats.AsNoTracking().Where(p => p.PanchayatId == c.PanchayatId).Select(p => p.Name).FirstOrDefaultAsync(ct);
                await _live.PublishAsync(new LiveEvent { Kind = "partner", Text = $"{c.Name} marked as patient-flow champion for {place ?? "their panchayat"}", RefId = c.ClientId });
            }
            return Ok(new { clientId = c.ClientId, champion = c.IsChampion, note = c.ChampionNote });
        }
    }
}
