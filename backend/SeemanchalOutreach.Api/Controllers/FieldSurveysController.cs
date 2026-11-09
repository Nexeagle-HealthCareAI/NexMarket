using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class FieldSurveyDto
    {
        public string? Title { get; set; }
        public string? Instructions { get; set; }
        /// <summary>[[lng,lat], …], at least 3 corners.</summary>
        public List<double[]>? Area { get; set; }
        public List<string>? SpotTypes { get; set; }
        public List<string>? RoadTypes { get; set; }
        public List<FieldQuestion>? Questions { get; set; }
        public DateOnly? DueDate { get; set; }
        /// <summary>draft | active</summary>
        public string? Status { get; set; }
        /// <summary>The people it is given to (agent IDs). Anyone with a NexMarket login: field agents, HR, managers.</summary>
        public List<string>? Assignees { get; set; }
    }

    /// <summary>
    /// Occasional field surveys in the CRM: an admin draws the area, sets the spot and road types and the questions, and gives
    /// it to whoever should do it. The results (routes by road type, marked spots with photos, answers) come back here.
    /// </summary>
    [ApiController]
    [Route("api/v1/field-surveys")]
    [Authorize]
    [PageAccess(Pages.Field)]
    public class FieldSurveysController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public FieldSurveysController(IMarketingDbContext db, IFileStore files, INotifier notifier) { _db = db; _files = files; _notifier = notifier; }

        private async Task<Dictionary<string, (string Name, string Role)>> PeopleAsync(CancellationToken ct) =>
            await _db.Agents.AsNoTracking().ToDictionaryAsync(a => a.AgentId, a => (a.Name, a.Role), ct);

        [HttpGet("defaults")]
        public async Task<IActionResult> Defaults(CancellationToken ct)
        {
            var people = await _db.Agents.AsNoTracking().Where(a => a.IsActive).OrderBy(a => a.Name)
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, block = a.Block }).ToListAsync(ct);
            return Ok(new { spotTypes = FieldSurveys.DefaultSpotTypes, roadTypes = FieldSurveys.DefaultRoadTypes, questionTypes = FieldSurveys.QuestionTypes, people });
        }

        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var surveys = await _db.FieldSurveys.AsNoTracking().OrderByDescending(s => s.CreatedAt).Take(200).ToListAsync(ct);
            var ids = surveys.Select(s => s.Id).ToList();
            var asg = await _db.FieldSurveyAssignees.AsNoTracking().Where(a => ids.Contains(a.SurveyId)).Select(a => new { a.SurveyId, a.Status }).ToListAsync(ct);
            var spots = await _db.FieldSurveySpots.AsNoTracking().Where(s => ids.Contains(s.SurveyId) && !s.Removed).GroupBy(s => s.SurveyId).Select(g => new { g.Key, n = g.Count() }).ToListAsync(ct);
            var km = await _db.FieldSurveyTracks.AsNoTracking().Where(t => ids.Contains(t.SurveyId)).GroupBy(t => t.SurveyId).Select(g => new { g.Key, m = g.Sum(x => x.DistanceM) }).ToListAsync(ct);
            return Ok(new
            {
                items = surveys.Select(s => new
                {
                    id = s.Id, title = s.Title, status = s.Status, dueDate = s.DueDate, createdAt = s.CreatedAt, closedAt = s.ClosedAt,
                    assigned = asg.Count(a => a.SurveyId == s.Id),
                    started = asg.Count(a => a.SurveyId == s.Id && a.Status != "assigned"),
                    submitted = asg.Count(a => a.SurveyId == s.Id && a.Status == "submitted"),
                    spots = spots.FirstOrDefault(x => x.Key == s.Id)?.n ?? 0,
                    km = Math.Round((km.FirstOrDefault(x => x.Key == s.Id)?.m ?? 0) / 1000, 1),
                }),
            });
        }

        private string? Validate(FieldSurveyDto d, out List<string> spotTypes, out List<string> roadTypes, out List<FieldQuestion> questions)
        {
            static List<string> Clean(IEnumerable<string>? xs) => (xs ?? Enumerable.Empty<string>()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0)
                .Select(x => x.Length > 60 ? x[..60] : x).Distinct(StringComparer.OrdinalIgnoreCase).Take(40).ToList();
            spotTypes = Clean(d.SpotTypes ?? FieldSurveys.DefaultSpotTypes.ToList());
            roadTypes = Clean(d.RoadTypes ?? FieldSurveys.DefaultRoadTypes.ToList());
            questions = new();
            if (string.IsNullOrWhiteSpace(d.Title)) return "Give the survey a name.";
            if (d.Area == null || d.Area.Count(p => p.Length >= 2) < 3) return "Draw the area on the map: at least 3 corners.";
            if (d.Area.Any(p => p.Length < 2 || p[1] < -90 || p[1] > 90 || p[0] < -180 || p[0] > 180)) return "The area has a corner outside the map.";
            if (d.Area.Count > 500) return "The area has too many corners (500 at most).";
            if (spotTypes.Count == 0) return "Keep at least one spot type.";
            foreach (var q in d.Questions ?? new())
            {
                var text = (q.Text ?? "").Trim();
                if (text.Length == 0) continue;
                var type = FieldSurveys.QuestionTypes.Contains(q.Type) ? q.Type : "text";
                var opts = Clean(q.Options);
                if ((type is "choice" or "multi") && opts.Count < 2) return $"\"{text}\" needs at least two answers to pick from.";
                questions.Add(new FieldQuestion { Id = string.IsNullOrWhiteSpace(q.Id) ? Guid.NewGuid().ToString("N")[..10] : q.Id.Trim()[..Math.Min(40, q.Id.Trim().Length)], Text = text.Length > 300 ? text[..300] : text, Type = type, Options = type is "choice" or "multi" ? opts : null, Required = q.Required });
            }
            if (questions.Count > 40) return "40 questions at most.";
            return null;
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] FieldSurveyDto d, CancellationToken ct)
        {
            var err = Validate(d, out var spotTypes, out var roadTypes, out var questions);
            if (err != null) return BadRequest(new { message = err });
            var s = new FieldSurvey
            {
                Title = d.Title!.Trim(), Instructions = string.IsNullOrWhiteSpace(d.Instructions) ? null : d.Instructions.Trim(),
                AreaJson = FieldSurveys.ToJson(d.Area!.Select(p => new[] { Math.Round(p[0], 6), Math.Round(p[1], 6) })),
                SpotTypesJson = FieldSurveys.ToJson(spotTypes), RoadTypesJson = FieldSurveys.ToJson(roadTypes), QuestionsJson = FieldSurveys.ToJson(questions),
                DueDate = d.DueDate, Status = d.Status == "draft" ? "draft" : "active", CreatedBy = User.AgentIdOf(),
            };
            _db.FieldSurveys.Add(s);
            var added = await SetAssigneesAsync(s, d.Assignees ?? new(), ct);
            await _db.SaveChangesAsync(ct);
            if (s.Status == "active") Tell(s, added);
            return Ok(new { id = s.Id });
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] FieldSurveyDto d, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That survey isn't here any more." });
            var err = Validate(d, out var spotTypes, out var roadTypes, out var questions);
            if (err != null) return BadRequest(new { message = err });
            var wasActive = s.Status == "active";
            s.Title = d.Title!.Trim();
            s.Instructions = string.IsNullOrWhiteSpace(d.Instructions) ? null : d.Instructions.Trim();
            s.AreaJson = FieldSurveys.ToJson(d.Area!.Select(p => new[] { Math.Round(p[0], 6), Math.Round(p[1], 6) }));
            s.SpotTypesJson = FieldSurveys.ToJson(spotTypes);
            s.RoadTypesJson = FieldSurveys.ToJson(roadTypes);
            // Answers already given keep their question ids, so questions keep theirs when edited.
            s.QuestionsJson = FieldSurveys.ToJson(questions);
            s.DueDate = d.DueDate;
            if (s.Status != "closed") s.Status = d.Status == "draft" ? "draft" : "active";
            s.UpdatedAt = DateTime.UtcNow;
            var added = await SetAssigneesAsync(s, d.Assignees ?? new(), ct);
            await _db.SaveChangesAsync(ct);
            if (s.Status == "active") Tell(s, wasActive ? added : (await _db.FieldSurveyAssignees.Where(a => a.SurveyId == s.Id).Select(a => a.AgentId).ToListAsync(ct)));
            return Ok(new { id = s.Id });
        }

        /// <summary>Adds the new people; removes people who were taken off only if they haven't recorded anything (nothing recorded is ever deleted).</summary>
        private async Task<List<string>> SetAssigneesAsync(FieldSurvey s, List<string> wanted, CancellationToken ct)
        {
            var valid = await _db.Agents.AsNoTracking().Where(a => wanted.Contains(a.AgentId)).Select(a => a.AgentId).ToListAsync(ct);
            var current = await _db.FieldSurveyAssignees.Where(a => a.SurveyId == s.Id).ToListAsync(ct);
            var added = new List<string>();
            foreach (var aid in valid.Distinct())
                if (!current.Any(c => c.AgentId == aid)) { _db.FieldSurveyAssignees.Add(new FieldSurveyAssignee { SurveyId = s.Id, AgentId = aid }); added.Add(aid); }
            foreach (var c in current.Where(c => !valid.Contains(c.AgentId)))
            {
                var hasData = c.Status != "assigned" || c.AnswersJson != null
                    || await _db.FieldSurveySpots.AnyAsync(x => x.SurveyId == s.Id && x.AgentId == c.AgentId, ct)
                    || await _db.FieldSurveyTracks.AnyAsync(x => x.SurveyId == s.Id && x.AgentId == c.AgentId, ct);
                if (!hasData) _db.FieldSurveyAssignees.Remove(c);
            }
            return added;
        }

        private void Tell(FieldSurvey s, List<string> to)
        {
            if (to.Count == 0) return;
            _notifier.Notify(new NotifyJob
            {
                To = to, Except = User.AgentIdOf(), Kind = "field_survey",
                Title = "New field survey: " + s.Title,
                Body = s.DueDate != null ? $"Please finish it by {s.DueDate:d MMM}. Open the app → Field mapping." : "Open the app → Field mapping.",
                Link = $"field-survey:{s.Id}", RefId = s.Id.ToString(),
            });
        }

        [HttpPost("{id:guid}/close")]
        public async Task<IActionResult> Close(Guid id, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That survey isn't here any more." });
            s.Status = "closed"; s.ClosedAt = DateTime.UtcNow; s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { status = s.Status });
        }

        [HttpPost("{id:guid}/reopen")]
        public async Task<IActionResult> Reopen(Guid id, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That survey isn't here any more." });
            s.Status = "active"; s.ClosedAt = null; s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { status = s.Status });
        }

        /// <summary>Everything about one survey for the CRM: settings, each person's progress, the routes, spots, totals and answers.</summary>
        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, [FromQuery] string? agent, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound(new { message = "That survey isn't here any more." });
            var people = await PeopleAsync(ct);
            string Name(string a) => people.TryGetValue(a, out var p) ? p.Name : a;
            var asg = await _db.FieldSurveyAssignees.AsNoTracking().Where(a => a.SurveyId == id).ToListAsync(ct);
            var tracks = await _db.FieldSurveyTracks.AsNoTracking().Where(t => t.SurveyId == id && (agent == null || t.AgentId == agent)).ToListAsync(ct);
            var spots = await _db.FieldSurveySpots.AsNoTracking().Where(x => x.SurveyId == id && !x.Removed && (agent == null || x.AgentId == agent)).OrderBy(x => x.TakenAt).ToListAsync(ct);
            var area = FieldSurveys.Area(s.AreaJson);
            var questions = FieldSurveys.Questions(s.QuestionsJson);
            var allTracks = await _db.FieldSurveyTracks.AsNoTracking().Where(t => t.SurveyId == id).Select(t => new { t.AgentId, t.DistanceM }).ToListAsync(ct);
            var allSpots = agent == null ? spots : await _db.FieldSurveySpots.AsNoTracking().Where(x => x.SurveyId == id && !x.Removed).ToListAsync(ct);

            // Answers: each person's, and a tally per question.
            var answered = asg.Where(a => a.AnswersJson != null).Select(a => (a.AgentId, Ans: FieldSurveys.Answers(a.AnswersJson))).ToList();
            object Tally(FieldQuestion q)
            {
                var vals = answered.Where(x => x.Ans.ContainsKey(q.Id)).Select(x => (x.AgentId, V: x.Ans[q.Id])).ToList();
                if (q.Type is "yesno" or "choice" or "multi")
                {
                    var picks = vals.SelectMany(v => v.V.ValueKind == JsonValueKind.Array ? v.V.EnumerateArray().Select(e => e.ToString()) : new[] { v.V.ToString() })
                        .Where(x => x.Length > 0).GroupBy(x => x).Select(g => new { answer = g.Key, count = g.Count() }).OrderByDescending(x => x.count).ToList();
                    return new { q.Id, q.Text, q.Type, answers = vals.Count, counts = picks, list = (object?)null };
                }
                return new { q.Id, q.Text, q.Type, answers = vals.Count, counts = (object?)null, list = (object?)vals.Select(v => new { person = Name(v.AgentId), answer = v.V.ToString() }).ToList() };
            }

            return Ok(new
            {
                survey = new
                {
                    id = s.Id, title = s.Title, instructions = s.Instructions, status = s.Status, dueDate = s.DueDate, createdAt = s.CreatedAt, closedAt = s.ClosedAt,
                    createdBy = Name(s.CreatedBy), area, spotTypes = FieldSurveys.Strings(s.SpotTypesJson), roadTypes = FieldSurveys.Strings(s.RoadTypesJson), questions,
                },
                totals = new
                {
                    assigned = asg.Count, started = asg.Count(a => a.Status != "assigned"), submitted = asg.Count(a => a.Status == "submitted"),
                    km = Math.Round(allTracks.Sum(t => t.DistanceM) / 1000, 2), spots = allSpots.Count, photos = allSpots.Count(x => x.PhotoKey != null),
                    outsideArea = allSpots.Count(x => !FieldSurveys.Inside(area, x.Lat, x.Lng)),
                },
                people = asg.OrderBy(a => Name(a.AgentId)).Select(a => new
                {
                    agentId = a.AgentId, name = Name(a.AgentId), role = people.TryGetValue(a.AgentId, out var p) ? p.Role : null, status = a.Status,
                    startedAt = a.StartedAt, submittedAt = a.SubmittedAt, lastSyncAt = a.LastSyncAt, answered = a.AnswersJson != null,
                    km = Math.Round(allTracks.Where(t => t.AgentId == a.AgentId).Sum(t => t.DistanceM) / 1000, 2),
                    spots = allSpots.Count(x => x.AgentId == a.AgentId),
                }),
                spotsByType = allSpots.GroupBy(x => x.Type).Select(g => new { type = g.Key, count = g.Count() }).OrderByDescending(x => x.count),
                roadKm = tracks.GroupBy(t => t.RoadType ?? "Not set").Select(g => new { roadType = g.Key, km = Math.Round(g.Sum(x => x.DistanceM) / 1000, 2) }).OrderByDescending(x => x.km),
                tracks = tracks.Select(t => new { id = t.ClientId, agentId = t.AgentId, roadType = t.RoadType, km = Math.Round(t.DistanceM / 1000, 2), points = FieldSurveys.Thin(FieldSurveys.Points(t.PointsJson)) }),
                spots = spots.Select(x => new
                {
                    id = x.Id, agentId = x.AgentId, person = Name(x.AgentId), type = x.Type, name = x.Name, roadType = x.RoadType, lat = x.Lat, lng = x.Lng,
                    accuracy = x.AccuracyM, note = x.Note, hasPhoto = x.PhotoKey != null, takenAt = x.TakenAt, inside = FieldSurveys.Inside(area, x.Lat, x.Lng),
                }),
                answers = questions.Select(Tally),
            });
        }

        [HttpGet("spots/{spotId:guid}/photo")]
        public async Task<IActionResult> Photo(Guid spotId, CancellationToken ct)
        {
            var x = await _db.FieldSurveySpots.AsNoTracking().FirstOrDefaultAsync(s => s.Id == spotId, ct);
            if (x?.PhotoKey == null) return NotFound(new { message = "No photo for this spot." });
            var f = await _files.OpenAsync(x.PhotoKey, ct);
            if (f == null) return NotFound(new { message = "The photo is no longer in storage." });
            return File(f.Value.Content, f.Value.ContentType);
        }

        [HttpGet("{id:guid}/export.csv")]
        public async Task<IActionResult> Export(Guid id, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound();
            var people = await PeopleAsync(ct);
            var spots = await _db.FieldSurveySpots.AsNoTracking().Where(x => x.SurveyId == id && !x.Removed).OrderBy(x => x.TakenAt).ToListAsync(ct);
            static string Csv(string? v)
            {
                v ??= "";
                if (v.Length > 0 && "=+-@".Contains(v[0])) v = "'" + v;
                return v.Contains(',') || v.Contains('"') || v.Contains('\n') ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
            }
            var sb = new StringBuilder("Type,Name,Road type,Latitude,Longitude,Accuracy (m),Note,Marked by,Marked at (IST),Photo,Google Maps\n");
            foreach (var x in spots)
                sb.Append(Csv(x.Type)).Append(',').Append(Csv(x.Name)).Append(',').Append(Csv(x.RoadType)).Append(',')
                  .Append(x.Lat.ToString("0.000000", CultureInfo.InvariantCulture)).Append(',').Append(x.Lng.ToString("0.000000", CultureInfo.InvariantCulture)).Append(',')
                  .Append(x.AccuracyM?.ToString("0", CultureInfo.InvariantCulture) ?? "").Append(',').Append(Csv(x.Note)).Append(',')
                  .Append(Csv(people.TryGetValue(x.AgentId, out var p) ? p.Name : x.AgentId)).Append(',')
                  .Append((x.TakenAt + IstClock.Offset).ToString("yyyy-MM-dd HH:mm")).Append(',').Append(x.PhotoKey != null ? "yes" : "").Append(',')
                  .Append($"https://maps.google.com/?q={x.Lat.ToString(CultureInfo.InvariantCulture)},{x.Lng.ToString(CultureInfo.InvariantCulture)}").Append('\n');
            var name = new string(s.Title.Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray()).Trim('-');
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"field-survey-{name}-spots.csv");
        }

        /// <summary>Routes and spots as GeoJSON, to open in Google Earth, QGIS or geojson.io.</summary>
        [HttpGet("{id:guid}/export.geojson")]
        public async Task<IActionResult> ExportGeo(Guid id, CancellationToken ct)
        {
            var s = await _db.FieldSurveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (s == null) return NotFound();
            var people = await PeopleAsync(ct);
            string Name(string a) => people.TryGetValue(a, out var p) ? p.Name : a;
            var tracks = await _db.FieldSurveyTracks.AsNoTracking().Where(t => t.SurveyId == id).ToListAsync(ct);
            var spots = await _db.FieldSurveySpots.AsNoTracking().Where(x => x.SurveyId == id && !x.Removed).ToListAsync(ct);
            var area = FieldSurveys.Area(s.AreaJson);
            var features = new List<object>();
            if (area.Count >= 3)
                features.Add(new { type = "Feature", properties = new { kind = "area", name = s.Title }, geometry = new { type = "Polygon", coordinates = new[] { area.Append(area[0]).ToList() } } });
            foreach (var t in tracks)
            {
                var pts = FieldSurveys.Points(t.PointsJson);
                if (pts.Count < 2) continue;
                features.Add(new { type = "Feature", properties = new { kind = "route", roadType = t.RoadType, person = Name(t.AgentId), km = Math.Round(t.DistanceM / 1000, 3) },
                    geometry = new { type = "LineString", coordinates = pts.Select(p => new[] { p[1], p[0] }) } });
            }
            foreach (var x in spots)
                features.Add(new { type = "Feature", properties = new { kind = "spot", spotType = x.Type, name = x.Name, roadType = x.RoadType, note = x.Note, person = Name(x.AgentId), at = x.TakenAt },
                    geometry = new { type = "Point", coordinates = new[] { x.Lng, x.Lat } } });
            var json = JsonSerializer.Serialize(new { type = "FeatureCollection", features });
            return File(Encoding.UTF8.GetBytes(json), "application/geo+json", "field-survey.geojson");
        }
    }
}
