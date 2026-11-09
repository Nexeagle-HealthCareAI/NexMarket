using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class FieldSyncSegment
    {
        public string? ClientId { get; set; }
        public string? RoadType { get; set; }
        public DateTime? StartedAt { get; set; }
        public DateTime? EndedAt { get; set; }
        /// <summary>New points since the last sync: [lat, lng, accuracyM, unixMs].</summary>
        public List<double[]>? Points { get; set; }
    }

    public class FieldSyncSpot
    {
        public string? ClientId { get; set; }
        public string? Type { get; set; }
        public string? Name { get; set; }
        public string? RoadType { get; set; }
        public double Lat { get; set; }
        public double Lng { get; set; }
        public double? Accuracy { get; set; }
        public string? Note { get; set; }
        public DateTime? TakenAt { get; set; }
        public bool Removed { get; set; }
    }

    public class FieldSyncDto
    {
        public List<FieldSyncSegment>? Segments { get; set; }
        public List<FieldSyncSpot>? Spots { get; set; }
        public Dictionary<string, JsonElement>? Answers { get; set; }
        public bool Submit { get; set; }
    }

    /// <summary>
    /// The agent app's side of occasional field surveys. The app keeps everything on the phone and sends it here when there is
    /// signal; every route stretch and spot has the phone's own id, so sending the same thing twice changes nothing.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/field-surveys")]
    public class MyFieldSurveysController : ControllerBase
    {
        private static readonly Dictionary<string, string> Images = new(StringComparer.OrdinalIgnoreCase) { ["image/jpeg"] = ".jpg", ["image/png"] = ".png", ["image/webp"] = ".webp" };
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly ILiveEvents _live;
        public MyFieldSurveysController(IMarketingDbContext db, IFileStore files, ILiveEvents live) { _db = db; _files = files; _live = live; }

        /// <summary>The surveys given to me that are open (or that I already submitted, for 14 days), with everything the app needs offline.</summary>
        [HttpGet]
        public async Task<IActionResult> Mine(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var mine = await _db.FieldSurveyAssignees.AsNoTracking().Where(a => a.AgentId == me).ToListAsync(ct);
            var ids = mine.Select(a => a.SurveyId).ToList();
            var since = DateTime.UtcNow.AddDays(-14);
            var surveys = await _db.FieldSurveys.AsNoTracking()
                .Where(s => ids.Contains(s.Id) && (s.Status == "active" || (s.Status == "closed" && s.ClosedAt > since))).OrderByDescending(s => s.CreatedAt).ToListAsync(ct);
            var km = await _db.FieldSurveyTracks.AsNoTracking().Where(t => ids.Contains(t.SurveyId) && t.AgentId == me).GroupBy(t => t.SurveyId).Select(g => new { g.Key, m = g.Sum(x => x.DistanceM) }).ToListAsync(ct);
            var spots = await _db.FieldSurveySpots.AsNoTracking().Where(x => ids.Contains(x.SurveyId) && x.AgentId == me && !x.Removed).GroupBy(x => x.SurveyId).Select(g => new { g.Key, n = g.Count() }).ToListAsync(ct);
            return Ok(new
            {
                items = surveys.Select(s =>
                {
                    var a = mine.First(x => x.SurveyId == s.Id);
                    return new
                    {
                        config = FieldSurveys.Config(s),
                        myStatus = a.Status, startedAt = a.StartedAt, submittedAt = a.SubmittedAt,
                        answers = a.AnswersJson == null ? null : FieldSurveys.Answers(a.AnswersJson),
                        km = Math.Round((km.FirstOrDefault(x => x.Key == s.Id)?.m ?? 0) / 1000, 2),
                        spots = spots.FirstOrDefault(x => x.Key == s.Id)?.n ?? 0,
                    };
                }),
            });
        }

        [HttpPost("{id:guid}/sync")]
        [RequestSizeLimit(8_000_000)]
        public async Task<IActionResult> Sync(Guid id, [FromBody] FieldSyncDto dto, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var a = await _db.FieldSurveyAssignees.FirstOrDefaultAsync(x => x.SurveyId == id && x.AgentId == me, ct);
            if (a == null) return NotFound(new { message = "This survey is no longer given to you." });
            var s = await _db.FieldSurveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "This survey was removed." });
            var now = DateTime.UtcNow;
            static string? Clip(string? v, int n) => string.IsNullOrWhiteSpace(v) ? null : v.Trim().Length > n ? v.Trim()[..n] : v.Trim();

            // Route stretches: add the new points to the stretch with the same phone id.
            var segs = (dto.Segments ?? new()).Where(x => !string.IsNullOrWhiteSpace(x.ClientId) && x.ClientId!.Length <= 64).Take(200).ToList();
            var segIds = segs.Select(x => x.ClientId!).ToList();
            var existingSegs = await _db.FieldSurveyTracks.Where(t => segIds.Contains(t.ClientId)).ToDictionaryAsync(t => t.ClientId, ct);
            var savedSegs = new List<string>();
            foreach (var g in segs)
            {
                if (!existingSegs.TryGetValue(g.ClientId!, out var t))
                {
                    t = new FieldSurveyTrack { ClientId = g.ClientId!, SurveyId = id, AgentId = me, RoadType = Clip(g.RoadType, 60), StartedAt = g.StartedAt?.ToUniversalTime() ?? now };
                    _db.FieldSurveyTracks.Add(t);
                    existingSegs[t.ClientId] = t;
                }
                else if (t.AgentId != me || t.SurveyId != id) continue;
                var pts = FieldSurveys.Points(t.PointsJson);
                var last = pts.Count > 0 ? pts[^1][3] : 0;
                foreach (var p in (g.Points ?? new()).Where(p => p.Length >= 4 && p[0] is >= -90 and <= 90 && p[1] is >= -180 and <= 180).OrderBy(p => p[3]))
                    if (p[3] > last) { pts.Add(new[] { Math.Round(p[0], 6), Math.Round(p[1], 6), Math.Round(p[2]), p[3] }); last = p[3]; }
                if (pts.Count > 20000) pts = pts.TakeLast(20000).ToList();
                t.PointsJson = FieldSurveys.ToJson(pts);
                t.PointCount = pts.Count;
                t.DistanceM = FieldSurveys.Distance(pts);
                t.RoadType = Clip(g.RoadType, 60) ?? t.RoadType;
                if (g.EndedAt != null) t.EndedAt = g.EndedAt.Value.ToUniversalTime();
                t.UpdatedAt = now;
                savedSegs.Add(t.ClientId);
            }

            // Spots: add or update by phone id; a spot deleted on the phone is kept here but hidden (Removed).
            var spots = (dto.Spots ?? new()).Where(x => !string.IsNullOrWhiteSpace(x.ClientId) && x.ClientId!.Length <= 64 && x.Lat is >= -90 and <= 90 && x.Lng is >= -180 and <= 180).Take(500).ToList();
            var spotIds = spots.Select(x => x.ClientId!).ToList();
            var existingSpots = await _db.FieldSurveySpots.Where(x => spotIds.Contains(x.ClientId)).ToDictionaryAsync(x => x.ClientId, ct);
            var types = FieldSurveys.Strings(s.SpotTypesJson);
            var savedSpots = new List<string>();
            foreach (var x in spots)
            {
                if (!existingSpots.TryGetValue(x.ClientId!, out var row))
                {
                    row = new FieldSurveySpot { ClientId = x.ClientId!, SurveyId = id, AgentId = me, CreatedAt = now };
                    _db.FieldSurveySpots.Add(row);
                    existingSpots[row.ClientId] = row;
                }
                else if (row.AgentId != me || row.SurveyId != id) continue;
                var type = Clip(x.Type, 60) ?? "Other";
                row.Type = types.FirstOrDefault(t => string.Equals(t, type, StringComparison.OrdinalIgnoreCase)) ?? type;
                row.Name = Clip(x.Name, 120);
                row.RoadType = Clip(x.RoadType, 60);
                row.Lat = Math.Round(x.Lat, 6); row.Lng = Math.Round(x.Lng, 6);
                row.AccuracyM = x.Accuracy;
                row.Note = Clip(x.Note, 1000);
                row.TakenAt = x.TakenAt?.ToUniversalTime() ?? now;
                row.Removed = x.Removed;
                row.UpdatedAt = now;
                savedSpots.Add(row.ClientId);
            }

            if (dto.Answers != null && dto.Answers.Count > 0)
            {
                var qs = FieldSurveys.Questions(s.QuestionsJson).Select(q => q.Id).ToHashSet();
                var keep = dto.Answers.Where(kv => qs.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
                a.AnswersJson = JsonSerializer.Serialize(keep);
                a.AnswersAt = now;
            }
            if (a.Status == "assigned" && (savedSegs.Count > 0 || savedSpots.Count > 0 || dto.Answers != null)) { a.Status = "started"; a.StartedAt = now; }
            if (dto.Submit)
            {
                var missing = FieldSurveys.Questions(s.QuestionsJson).Where(q => q.Required).Where(q => !FieldSurveys.Answers(a.AnswersJson).ContainsKey(q.Id)).Select(q => q.Text).ToList();
                if (missing.Count > 0) { await _db.SaveChangesAsync(ct); return BadRequest(new { message = "Answer these before submitting: " + string.Join("; ", missing), segments = savedSegs, spots = savedSpots }); }
                a.Status = "submitted"; a.SubmittedAt = now; a.StartedAt ??= now;
            }
            a.LastSyncAt = now;
            await _db.SaveChangesAsync(ct);
            if (dto.Submit) await _live.PublishAsync(new LiveEvent { Kind = "field_survey", Text = $"Field survey submitted: {s.Title}", RefId = s.Id.ToString() });
            return Ok(new { segments = savedSegs, spots = savedSpots, status = a.Status });
        }

        /// <summary>The photo of a marked spot (after the spot itself has been synced).</summary>
        [HttpPost("{id:guid}/spots/{clientId}/photo")]
        [RequestSizeLimit(12_000_000)]
        public async Task<IActionResult> Photo(Guid id, string clientId, IFormFile? file, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var row = await _db.FieldSurveySpots.FirstOrDefaultAsync(x => x.ClientId == clientId && x.SurveyId == id && x.AgentId == me, ct);
            if (row == null) return NotFound(new { message = "Send the spot first." });
            if (file == null || file.Length == 0) return BadRequest(new { message = "No photo." });
            if (file.Length > 10 * 1024 * 1024) return BadRequest(new { message = "The photo can be up to 10 MB." });
            var mime = Images.ContainsKey(file.ContentType ?? "") ? file.ContentType! : "image/jpeg";
            await using var stream = file.OpenReadStream();
            row.PhotoKey = await _files.SaveAsync("field-surveys", $"spot-{row.Id:N}{Images[mime]}", stream, mime, ct);
            row.PhotoMime = mime;
            row.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }
}
