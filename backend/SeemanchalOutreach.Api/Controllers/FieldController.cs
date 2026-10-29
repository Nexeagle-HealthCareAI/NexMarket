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

            // ─── Where the time went: stops (stayed put) and travel, from shift start to end ───
            var nearbyPlaces = await NearbyPanchayatsAsync(good, ct);
            var segments = BuildSegments(good, onShiftWindows, visits.Select(v => (v.CheckInAt, v.CheckOutAt, v.PanchayatId)).ToList());
            var segOut = new List<object>();
            int stopNo = 0;
            foreach (var g in segments)
            {
                var inside = ordered.Where(e => e.At >= g.From && e.At < g.To && e.Kind is "partner" or "referral" or "survey" or "photo").ToList();
                string? placeId = g.VisitPanchayatId;
                string? placeName = placeId != null ? Place(placeId) : null;
                double? nearM = null;
                if (g.Kind == "stop" && placeName == null && g.Lat != null)
                {
                    var best = nearbyPlaces.Select(pl => (pl, d: HaversineM(g.Lat.Value, g.Lng!.Value, pl.Lat, pl.Lng))).OrderBy(x => x.d).FirstOrDefault();
                    if (best.pl != null && best.d <= 3000) { placeName = best.pl.Name; placeId = best.pl.Id; nearM = Math.Round(best.d); }
                }
                segOut.Add(new
                {
                    kind = g.Kind,                                   // stop | move | gap
                    no = g.Kind == "stop" ? ++stopNo : (int?)null,
                    from = g.From,
                    to = g.To,
                    minutes = (int)Math.Round((g.To - g.From).TotalMinutes),
                    lat = g.Lat, lng = g.Lng,
                    km = g.Km,
                    kmh = g.Kind == "move" && (g.To - g.From).TotalHours > 0 ? Math.Round(g.Km / (g.To - g.From).TotalHours, 0) : (double?)null,
                    panchayatId = placeId,
                    place = placeName,
                    placeIsNear = nearM != null,                     // true = nearest panchayat, not a check-in
                    nearM,
                    checkedIn = g.VisitPanchayatId != null,
                    activities = inside.Select(e => new { kind = e.Kind, at = e.At, title = e.Title }),
                });
            }
            var stopMins = segments.Where(g => g.Kind == "stop").Sum(g => (g.To - g.From).TotalMinutes);
            var moveMins = segments.Where(g => g.Kind == "move").Sum(g => (g.To - g.From).TotalMinutes);
            var gapMins = segments.Where(g => g.Kind == "gap").Sum(g => (g.To - g.From).TotalMinutes);
            var unregistered = segments.Where(g => g.Kind == "stop" && g.VisitPanchayatId == null && (g.To - g.From).TotalMinutes >= 20).ToList();

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
                segments = segOut,
                time = new
                {
                    shiftFrom = onShiftWindows.Count == 0 ? (DateTime?)null : onShiftWindows.Min(w => w.From),
                    shiftTo = onShiftWindows.Count == 0 ? (DateTime?)null : onShiftWindows.Max(w => w.To),
                    stopMinutes = (int)Math.Round(stopMins),
                    moveMinutes = (int)Math.Round(moveMins),
                    gapMinutes = (int)Math.Round(gapMins),
                    stops = segments.Count(g => g.Kind == "stop"),
                    longestStopMinutes = segments.Where(g => g.Kind == "stop").Select(g => (int)Math.Round((g.To - g.From).TotalMinutes)).DefaultIfEmpty(0).Max(),
                    stopsWithoutCheckIn = unregistered.Count,
                    minutesStoppedWithoutCheckIn = (int)Math.Round(unregistered.Sum(g => (g.To - g.From).TotalMinutes)),
                },
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

        // ─── Stops and travel ──────────────────────────────────────────────────

        private const double StopRadiusM = 150;     // staying within this counts as one place
        private static readonly TimeSpan StopMin = TimeSpan.FromMinutes(8);
        private static readonly TimeSpan GapMin = TimeSpan.FromMinutes(30);

        private sealed record Seg(string Kind, DateTime From, DateTime To, double? Lat, double? Lng, double Km, string? VisitPanchayatId);

        private static double HaversineM(double lat1, double lng1, double lat2, double lng2)
        {
            const double R = 6371000;
            double dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
            double a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
            return 2 * R * Math.Asin(Math.Min(1, Math.Sqrt(a)));
        }

        /// <summary>
        /// Splits a shift into stops (stayed within ~150 m for 8+ minutes), travel between them, and gaps
        /// (30+ minutes with no GPS). A check-in that overlaps a stop names it; otherwise the nearest panchayat is used.
        /// </summary>
        private static List<Seg> BuildSegments(List<Pt> pts, List<(DateTime From, DateTime To)> windows, List<(DateTime In, DateTime? Out, string Pid)> visits)
        {
            var result = new List<Seg>();
            foreach (var w in windows.OrderBy(w => w.From))
            {
                var ps = pts.Where(p => p.At >= w.From && p.At <= w.To).OrderBy(p => p.At).ToList();
                if (ps.Count == 0) { if ((w.To - w.From) >= GapMin) result.Add(new Seg("gap", w.From, w.To, null, null, 0, null)); continue; }

                // Stay points: from point i, extend while every point stays near point i.
                var stays = new List<(int I, int J)>();
                int i = 0;
                while (i < ps.Count)
                {
                    int j = i;
                    while (j + 1 < ps.Count && HaversineM(ps[i].Lat, ps[i].Lng, ps[j + 1].Lat, ps[j + 1].Lng) <= StopRadiusM && ps[j + 1].At - ps[j].At < GapMin) j++;
                    if (ps[j].At - ps[i].At >= StopMin) { stays.Add((i, j)); i = j + 1; }
                    else i++;
                }

                DateTime cursor = w.From;
                int lastIdx = -1;
                void Travel(int fromIdx, int toIdx, DateTime from, DateTime to)
                {
                    if (to <= from) return;
                    // Split travel at long silences.
                    var leg = ps.Skip(Math.Max(0, fromIdx)).Take(Math.Max(0, toIdx - Math.Max(0, fromIdx) + 1)).Where(p => p.At >= from && p.At <= to).ToList();
                    DateTime segStart = from;
                    var run = new List<Pt>();
                    DateTime prev = from;
                    foreach (var p in leg)
                    {
                        if (p.At - prev >= GapMin)
                        {
                            if (prev > segStart) result.Add(new Seg("move", segStart, prev, null, null, Math.Round(DistanceKm(run), 1), null));
                            result.Add(new Seg("gap", prev, p.At, null, null, 0, null));
                            segStart = p.At;
                            run = new List<Pt>();
                        }
                        run.Add(p);
                        prev = p.At;
                    }
                    if (to - prev >= GapMin)
                    {
                        if (prev > segStart) result.Add(new Seg("move", segStart, prev, null, null, Math.Round(DistanceKm(run), 1), null));
                        result.Add(new Seg("gap", prev, to, null, null, 0, null));
                    }
                    else if (to > segStart)
                        result.Add(new Seg("move", segStart, to, null, null, Math.Round(DistanceKm(run), 1), null));
                }

                foreach (var (si, sj) in stays)
                {
                    Travel(lastIdx < 0 ? 0 : lastIdx, si, cursor, ps[si].At);
                    var group = ps.Skip(si).Take(sj - si + 1).ToList();
                    var from = ps[si].At; var to = ps[sj].At;
                    var visit = visits.Where(v => v.In < to.AddMinutes(5) && (v.Out ?? to) > from.AddMinutes(-5))
                        .OrderByDescending(v => ((v.Out ?? to) < to ? (v.Out ?? to) : to) - (v.In > from ? v.In : from)).Select(v => v.Pid).FirstOrDefault();
                    result.Add(new Seg("stop", from, to, Math.Round(group.Average(p => p.Lat), 6), Math.Round(group.Average(p => p.Lng), 6), 0, visit));
                    cursor = to; lastIdx = sj;
                }
                Travel(lastIdx < 0 ? 0 : lastIdx, ps.Count - 1, cursor, w.To);
            }
            // Drop slivers under a minute so the grid stays readable.
            return result.Where(g => (g.To - g.From).TotalMinutes >= 1 || g.Kind == "stop").ToList();
        }

        private sealed record NearPlace(string Id, string Name, double Lat, double Lng);

        /// <summary>Panchayats with a location inside the box around the day's route (plus ~3 km).</summary>
        private async Task<List<NearPlace>> NearbyPanchayatsAsync(List<Pt> pts, CancellationToken ct)
        {
            if (pts.Count == 0) return new();
            double minLat = pts.Min(p => p.Lat) - 0.03, maxLat = pts.Max(p => p.Lat) + 0.03, minLng = pts.Min(p => p.Lng) - 0.03, maxLng = pts.Max(p => p.Lng) + 0.03;
            return (await _db.Panchayats.AsNoTracking()
                    .Where(p => (p.ManualLat ?? p.CentroidLat) != null && (p.ManualLng ?? p.CentroidLng) != null)
                    .Where(p => (p.ManualLat ?? p.CentroidLat) >= minLat && (p.ManualLat ?? p.CentroidLat) <= maxLat && (p.ManualLng ?? p.CentroidLng) >= minLng && (p.ManualLng ?? p.CentroidLng) <= maxLng)
                    .Select(p => new { p.PanchayatId, p.Name, Lat = (p.ManualLat ?? p.CentroidLat)!.Value, Lng = (p.ManualLng ?? p.CentroidLng)!.Value })
                    .ToListAsync(ct))
                .Select(p => new NearPlace(p.PanchayatId, p.Name, p.Lat, p.Lng)).ToList();
        }

        private record TimelineEvent(
            string Kind, DateTime At, string Title, string? Detail, double? Lat, double? Lng,
            string? PanchayatId = null, string? RefId = null, string? Url = null);
    }
}
