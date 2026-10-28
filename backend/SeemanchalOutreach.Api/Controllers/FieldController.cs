using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// Field force, live: where every agent is right now and everything one agent did on a day,
    /// as a single timeline with the route they took.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field)]
    [Route("api/v1/field")]
    public class FieldController : ControllerBase
    {
        /// <summary>No GPS point for this long while on shift → shown as "no signal".</summary>
        private const int OfflineAfterMinutes = 15;
        /// <summary>Points worse than this are ignored for the route and distance.</summary>
        private const double MaxAccuracyM = 150;

        private readonly IMarketingDbContext _db;

        public FieldController(IMarketingDbContext db) => _db = db;

        private record Pt(double Lat, double Lng, DateTime At, double? Acc);

        private static double DistanceKm(IReadOnlyList<Pt> pts)
        {
            double km = 0;
            for (int i = 1; i < pts.Count; i++)
            {
                var d = PanchayatLocator.Km((pts[i - 1].Lat, pts[i - 1].Lng), (pts[i].Lat, pts[i].Lng));
                var hours = Math.Max((pts[i].At - pts[i - 1].At).TotalHours, 1.0 / 3600);
                if (d < 0.03 || d / hours > 90) continue; // standing still, or a GPS jump no bike can make
                km += d;
            }
            return Math.Round(km, 1);
        }

        // ─── Everyone, now ──────────────────────────────────────────────────────

        [HttpGet("live")]
        public async Task<IActionResult> Live(CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var today = IstClock.TodayStartUtc;
            var agents = (await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                .Select(a => new { a.AgentId, a.Name, a.Phone, a.Role, a.Block, a.District, a.PhotoUrl }).ToListAsync(ct))
                .Where(a => !RoleChecks.IsDashboardRole(a.Role)).ToList();
            var ids = agents.Select(a => a.AgentId).ToList();

            var points = (await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => t.RecordedAt >= today && ids.Contains(t.AgentId))
                .Select(t => new { t.AgentId, t.Lat, t.Lng, t.RecordedAt, t.AccuracyM }).ToListAsync(ct))
                .GroupBy(t => t.AgentId)
                .ToDictionary(g => g.Key, g => g.OrderBy(t => t.RecordedAt).Select(t => new Pt(t.Lat, t.Lng, t.RecordedAt, t.AccuracyM)).ToList());
            var shifts = await _db.Shifts.AsNoTracking()
                .Where(s => ids.Contains(s.AgentId) && (s.EndTime == null || s.StartTime >= today) && s.StartTime >= today.AddHours(-12))
                .Select(s => new { s.AgentId, s.StartTime, s.EndTime, s.StartLat, s.StartLng }).ToListAsync(ct);
            var visits = await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= today && ids.Contains(v.AgentId))
                .Select(v => new { v.AgentId, v.PanchayatId, v.CheckInAt, v.CheckOutAt, v.CheckInLat, v.CheckInLng }).ToListAsync(ct);
            var contactsToday = await _db.Contacts.AsNoTracking().Where(c => c.CreatedAt >= today && ids.Contains(c.AgentId))
                .GroupBy(c => c.AgentId).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
            var refsToday = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= today && ids.Contains(r.AgentId))
                .GroupBy(r => r.AgentId).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
            var pids = visits.Select(v => v.PanchayatId).Distinct().ToList();
            var placeNames = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId))
                .Select(p => new { p.PanchayatId, p.Name }).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);

            var rows = agents.Select(a =>
            {
                var pts = points.GetValueOrDefault(a.AgentId) ?? new List<Pt>();
                var good = pts.Where(p => p.Acc == null || p.Acc <= MaxAccuracyM).ToList();
                var last = pts.LastOrDefault();
                var shift = shifts.Where(s => s.AgentId == a.AgentId).OrderByDescending(s => s.StartTime).FirstOrDefault();
                bool onShift = shift != null && shift.EndTime == null;
                var myVisits = visits.Where(v => v.AgentId == a.AgentId).OrderBy(v => v.CheckInAt).ToList();
                var open = myVisits.LastOrDefault(v => v.CheckOutAt == null);
                double? staleMin = last == null ? null : Math.Round((now - last.At).TotalMinutes);

                // Last known spot: newest GPS point, else the open visit's check-in, else the shift start.
                double? lat = last?.Lat, lng = last?.Lng;
                DateTime? at = last?.At;
                if (last == null && open != null) { lat = open.CheckInLat; lng = open.CheckInLng; at = open.CheckInAt; }
                else if (last == null && shift != null && shift.StartLat != 0) { lat = shift.StartLat; lng = shift.StartLng; at = shift.StartTime; }

                string status;
                if (!onShift) status = "off_shift";
                else if (open != null) status = "on_visit";
                else if (staleMin == null || staleMin > OfflineAfterMinutes) status = "no_signal";
                else
                {
                    var recent = good.Where(p => p.At >= now.AddMinutes(-20)).ToList();
                    bool still = recent.Count >= 2 && recent.All(p => PanchayatLocator.Km((p.Lat, p.Lng), (recent[^1].Lat, recent[^1].Lng)) < 0.15);
                    status = still ? "idle" : "moving";
                }

                return new
                {
                    agentId = a.AgentId,
                    name = a.Name,
                    phone = a.Phone,
                    block = a.Block,
                    district = a.District,
                    photoUrl = a.PhotoUrl,
                    status,
                    lat,
                    lng,
                    at,
                    accuracyM = last?.Acc,
                    minutesSinceSeen = at.HasValue ? Math.Round((now - at.Value).TotalMinutes) : (double?)null,
                    shiftStartedAt = onShift ? shift!.StartTime : (DateTime?)null,
                    currentPlace = open != null ? placeNames.GetValueOrDefault(open.PanchayatId) : null,
                    currentPlaceSince = open?.CheckInAt,
                    today = new
                    {
                        visits = myVisits.Count,
                        panchayats = myVisits.Select(v => v.PanchayatId).Distinct().Count(),
                        partners = contactsToday.FirstOrDefault(x => x.Key == a.AgentId)?.N ?? 0,
                        referrals = refsToday.FirstOrDefault(x => x.Key == a.AgentId)?.N ?? 0,
                        km = DistanceKm(good),
                    },
                    // A short tail so the map can draw where they have just been.
                    trail = good.Skip(Math.Max(0, good.Count - 40)).Select(p => new[] { Math.Round(p.Lng, 5), Math.Round(p.Lat, 5) }),
                };
            })
            .OrderBy(r => r.status switch { "on_visit" => 0, "moving" => 1, "idle" => 2, "no_signal" => 3, _ => 4 })
            .ThenBy(r => r.name)
            .ToList();

            return Ok(new
            {
                at = now,
                onShift = rows.Count(r => r.status != "off_shift"),
                total = rows.Count,
                noSignal = rows.Count(r => r.status == "no_signal"),
                agents = rows,
            });
        }

        // ─── One agent, one day ────────────────────────────────────────────────

        [HttpGet("agents/{agentId}/activity")]
        public async Task<IActionResult> Activity(string agentId, [FromQuery] string? date, CancellationToken ct)
        {
            var agent = await _db.Agents.AsNoTracking().Where(a => a.AgentId == agentId)
                .Select(a => new { a.AgentId, a.Name, a.Phone, a.Block, a.District, a.PhotoUrl }).FirstOrDefaultAsync(ct);
            if (agent == null) return NotFound(new { message = "Agent not found." });

            DateTime start = IstClock.TodayStartUtc;
            if (!string.IsNullOrWhiteSpace(date) && DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                start = DateTime.SpecifyKind(d - IstClock.Offset, DateTimeKind.Utc);
            var end = start.AddDays(1);

            var pts = (await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => t.AgentId == agentId && t.RecordedAt >= start && t.RecordedAt < end)
                .OrderBy(t => t.RecordedAt)
                .Select(t => new { t.Lat, t.Lng, t.RecordedAt, t.AccuracyM }).ToListAsync(ct))
                .Select(t => new Pt(t.Lat, t.Lng, t.RecordedAt, t.AccuracyM)).ToList();
            var good = pts.Where(p => p.Acc == null || p.Acc <= MaxAccuracyM).ToList();

            var shifts = await _db.Shifts.AsNoTracking()
                .Where(s => s.AgentId == agentId && s.StartTime < end && (s.EndTime == null || s.EndTime >= start))
                .OrderBy(s => s.StartTime).ToListAsync(ct);
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == agentId && v.CheckInAt >= start && v.CheckInAt < end)
                .OrderBy(v => v.CheckInAt).ToListAsync(ct);
            var contacts = await _db.Contacts.AsNoTracking()
                .Where(c => c.AgentId == agentId && c.CreatedAt >= start && c.CreatedAt < end)
                .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId, c.CreatedAt, c.Latitude, c.Longitude, c.IsImportant }).ToListAsync(ct);
            var referrals = await _db.Referrals.AsNoTracking()
                .Where(r => r.AgentId == agentId && r.CreatedAt >= start && r.CreatedAt < end)
                .Select(r => new { r.ClientId, r.PatientName, r.Department, r.ContactId, r.CreatedAt, r.Status, r.Urgent }).ToListAsync(ct);
            var docs = await _db.ContactDocuments.AsNoTracking()
                .Where(x => x.AgentId == agentId && x.CreatedAt >= start && x.CreatedAt < end)
                .Select(x => new { x.ContactClientId, x.Label, x.Url, x.MimeType, x.CreatedAt, x.ExifLatitude, x.ExifLongitude }).ToListAsync(ct);
            var surveys = await _db.SurveyResponses.AsNoTracking()
                .Where(s => s.AgentId == agentId && s.CreatedAt >= start && s.CreatedAt < end)
                .Select(s => new { s.ContactId, s.PanchayatId, s.IsSkipped, s.SkipReason, s.CreatedAt }).ToListAsync(ct);

            var pids = visits.Select(v => v.PanchayatId).Concat(contacts.Select(c => c.PanchayatId))
                .Concat(surveys.Where(s => s.PanchayatId != null).Select(s => s.PanchayatId!)).Distinct().ToList();
            var places = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId))
                .Select(p => new { p.PanchayatId, p.Name, p.Block }).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
            var partnerIds = referrals.Select(r => r.ContactId).Concat(docs.Select(x => x.ContactClientId))
                .Concat(surveys.Where(s => s.ContactId != null).Select(s => s.ContactId!)).Distinct().ToList();
            var partnerNames = (await _db.Contacts.AsNoTracking().Where(c => partnerIds.Contains(c.ClientId))
                .Select(c => new { c.ClientId, c.Name }).ToListAsync(ct))
                .GroupBy(c => c.ClientId).ToDictionary(g => g.Key, g => g.First().Name);
            string Place(string? id) => id != null && places.TryGetValue(id, out var n) ? n : "a panchayat";
            string Partner(string? id) => id != null && partnerNames.TryGetValue(id, out var n) ? n : "a partner";

            var events = new List<TimelineEvent>();
            foreach (var s in shifts)
            {
                if (s.StartTime >= start)
                    events.Add(new("shift_start", s.StartTime, "Started shift", null, s.StartLat, s.StartLng));
                if (s.EndTime is DateTime e && e < end)
                    events.Add(new("shift_end", e, "Ended shift", $"{Math.Round((e - s.StartTime).TotalHours, 1)} h on shift", s.EndLat, s.EndLng));
            }
            foreach (var v in visits)
            {
                var mins = v.CheckOutAt.HasValue ? (int)Math.Round((v.CheckOutAt.Value - v.CheckInAt).TotalMinutes) : (int?)null;
                events.Add(new("visit_in", v.CheckInAt, $"Checked in at {Place(v.PanchayatId)}", mins.HasValue ? $"Stayed {mins} min" : "Still there", v.CheckInLat, v.CheckInLng, v.PanchayatId));
                if (v.CheckOutAt is DateTime o)
                    events.Add(new("visit_out", o, $"Left {Place(v.PanchayatId)}", null, v.CheckOutLat, v.CheckOutLng, v.PanchayatId));
            }
            foreach (var c in contacts)
                events.Add(new("partner", c.CreatedAt, $"Added partner {c.Name}", $"{c.Role.Replace('_', ' ')} · {Place(c.PanchayatId)}{(c.IsImportant ? " · important" : "")}", c.Latitude, c.Longitude, c.PanchayatId, c.ClientId));
            foreach (var r in referrals)
                events.Add(new("referral", r.CreatedAt, $"Referred {r.PatientName}", $"{(string.IsNullOrEmpty(r.Department) ? "" : r.Department + " · ")}via {Partner(r.ContactId)}{(r.Urgent ? " · urgent" : "")}", null, null, null, r.ClientId));
            foreach (var x in docs)
                events.Add(new("photo", x.CreatedAt, x.MimeType.StartsWith("image") ? "Took a photo" : "Added a document", $"{x.Label ?? "Partner document"} · {Partner(x.ContactClientId)}", x.ExifLatitude, x.ExifLongitude, null, x.ContactClientId, x.Url));
            foreach (var s in surveys)
                events.Add(new("survey", s.CreatedAt, s.IsSkipped ? "Skipped the survey" : "Completed the panchayat survey", s.IsSkipped ? s.SkipReason : $"{Partner(s.ContactId)} · {Place(s.PanchayatId)}", null, null, s.PanchayatId));

            // Gaps: on shift but no GPS for 30+ minutes (phone off, app closed, or no signal).
            var onShiftWindows = shifts.Select(s => (From: s.StartTime < start ? start : s.StartTime, To: s.EndTime ?? (end < DateTime.UtcNow ? end : DateTime.UtcNow))).ToList();
            var stamps = good.Select(p => p.At).Concat(events.Select(e => e.At)).OrderBy(t => t).ToList();
            foreach (var w in onShiftWindows)
            {
                var inside = stamps.Where(t => t >= w.From && t <= w.To).Prepend(w.From).Append(w.To).OrderBy(t => t).ToList();
                for (int i = 1; i < inside.Count; i++)
                {
                    var gap = inside[i] - inside[i - 1];
                    if (gap.TotalMinutes >= 30)
                        events.Add(new("gap", inside[i - 1], $"No location for {(gap.TotalMinutes >= 90 ? Math.Round(gap.TotalHours, 1) + " h" : Math.Round(gap.TotalMinutes) + " min")}", "Phone off, app closed or no signal", null, null));
                }
            }

            var ordered = events.OrderBy(e => e.At).ToList();
            double shiftMinutes = onShiftWindows.Sum(w => Math.Max(0, (w.To - w.From).TotalMinutes));

            return Ok(new
            {
                agent,
                date = (start + IstClock.Offset).ToString("yyyy-MM-dd"),
                stats = new
                {
                    km = DistanceKm(good),
                    shiftHours = Math.Round(shiftMinutes / 60, 1),
                    firstSeen = good.FirstOrDefault()?.At ?? ordered.FirstOrDefault()?.At,
                    lastSeen = good.LastOrDefault()?.At ?? ordered.LastOrDefault()?.At,
                    visits = visits.Count,
                    panchayats = visits.Select(v => v.PanchayatId).Distinct().Count(),
                    minutesInPanchayats = (int)visits.Where(v => v.CheckOutAt.HasValue).Sum(v => (v.CheckOutAt!.Value - v.CheckInAt).TotalMinutes),
                    partners = contacts.Count,
                    referrals = referrals.Count,
                    photos = docs.Count,
                    surveys = surveys.Count(s => !s.IsSkipped),
                    gaps = ordered.Count(e => e.Kind == "gap"),
                    gpsPoints = pts.Count,
                },
                route = good.Select(p => new { lat = Math.Round(p.Lat, 6), lng = Math.Round(p.Lng, 6), at = p.At }),
                events = ordered.Select(e => new
                {
                    kind = e.Kind,
                    at = e.At,
                    title = e.Title,
                    detail = e.Detail,
                    lat = e.Lat,
                    lng = e.Lng,
                    panchayatId = e.PanchayatId,
                    refId = e.RefId,
                    url = e.Url,
                }),
            });
        }

        private record TimelineEvent(
            string Kind, DateTime At, string Title, string? Detail, double? Lat, double? Lng,
            string? PanchayatId = null, string? RefId = null, string? Url = null);
    }
}
