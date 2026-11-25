using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class AgentCampBookingDto
    {
        /// <summary>The phone's own id for the booking: sending it again (no signal, retry) books once.</summary>
        public string? ClientId { get; set; }
        public string? Name { get; set; }
        public int? Age { get; set; }
        public string? Sex { get; set; }
        public string? Phone { get; set; }
        public string? PanchayatId { get; set; }
        /// <summary>The place written by hand when it isn't in the panchayat list.</summary>
        public string? Village { get; set; }
        public string? Complaint { get; set; }
        public int? BpSystolic { get; set; }
        public int? BpDiastolic { get; set; }
        public int? Pulse { get; set; }
        public decimal? TempF { get; set; }
        public int? Spo2 { get; set; }
        public decimal? WeightKg { get; set; }
        public int? Sugar { get; set; }
        public string? SugarKind { get; set; }
    }

    public class AgentCampMarkDto
    {
        /// <summary>attended (arrived) | no_show (didn't come) | booked (undo a mark).</summary>
        public string? Status { get; set; }
        public string? Complaint { get; set; }
        public int? BpSystolic { get; set; }
        public int? BpDiastolic { get; set; }
        public int? Pulse { get; set; }
        public decimal? TempF { get; set; }
        public int? Spo2 { get; set; }
        public decimal? WeightKg { get; set; }
        public int? Sugar { get; set; }
        public string? SugarKind { get; set; }
    }

    /// <summary>
    /// The field app's side of health camps. Every agent sees every upcoming camp and can book people into it (the token
    /// goes to the person on WhatsApp by itself). On the camp day any agent can find a person by name, mobile, panchayat
    /// or token and mark them arrived or not come; the CRM's camp page shows the same list.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/camps")]
    public class MyCampsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly WhatsAppOutbox _outbox;
        public MyCampsController(IMarketingDbContext db, WhatsAppOutbox outbox) { _db = db; _outbox = outbox; }

        private static DateOnly Today => DateOnly.FromDateTime(IstClock.NowIst);

        /// <summary>Upcoming camps (today on), with how full each is; and the people I booked into camps lately.</summary>
        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var today = Today;
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= today && c.Status != "cancelled")
                .OrderBy(c => c.Date).ThenBy(c => c.StartTime).Take(60).ToListAsync(ct);
            var ids = camps.Select(c => c.Id).ToList();
            var counts = (await _db.CampPatients.AsNoTracking().Where(p => ids.Contains(p.CampId) && p.Status != "cancelled")
                    .Select(p => new { p.CampId, p.Status, Mine = p.CreatedBy == me && p.Source == "agent" }).ToListAsync(ct))
                .GroupBy(p => p.CampId).ToDictionary(g => g.Key, g => new
                {
                    Booked = g.Count(), Arrived = g.Count(p => p.Status == "attended"), NoShow = g.Count(p => p.Status == "no_show"), Mine = g.Count(p => p.Mine),
                });
            var since = today.AddDays(-60);
            var mine = await _db.CampPatients.AsNoTracking().Where(p => p.CreatedBy == me && p.Source == "agent")
                .Join(_db.HealthCamps.AsNoTracking(), p => p.CampId, c => c.Id, (p, c) => new { p, c })
                .Where(x => x.c.Date >= since).OrderByDescending(x => x.p.CreatedAt).Take(300).ToListAsync(ct);
            return Ok(new
            {
                today = today.ToString("yyyy-MM-dd"),
                camps = camps.Select(c =>
                {
                    var n = counts.GetValueOrDefault(c.Id);
                    return new
                    {
                        id = c.Id, title = c.Title, code = c.Code, typeLabel = CampBook.TypeLabel(c.CampType), date = c.Date.ToString("yyyy-MM-dd"),
                        startTime = c.StartTime, endTime = c.EndTime, venue = c.Venue, block = c.Block, district = c.District, panchayatId = c.PanchayatId,
                        status = c.Status, capacity = c.Capacity, booked = n?.Booked ?? 0, arrived = n?.Arrived ?? 0, noShow = n?.NoShow ?? 0, mine = n?.Mine ?? 0,
                        placesLeft = Math.Max(0, c.Capacity - (n?.Booked ?? 0)),
                    };
                }),
                bookings = mine.Select(x => Booking(x.p, x.c)),
            });
        }

        private static object Booking(CampPatient p, HealthCamp c) => new
        {
            id = p.Id, clientId = p.ClientId, campId = c.Id, campTitle = c.Title, campDate = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime,
            place = CampDesk.Place(c), token = p.Token, name = p.Name, age = p.Age, sex = p.Sex, phone = Ten(p.Phone), village = p.Village, panchayatId = p.PanchayatId,
            status = p.Status, arrivedAt = p.ArrivedAt, complaint = p.Complaint, waStatus = p.WaStatus, waError = p.WaError, createdAt = p.CreatedAt,
            vitals = Vitals(p),
        };

        private static string? Ten(string? phone) => phone != null && phone.Length == 12 && phone.StartsWith("91") ? phone[2..] : phone;

        /// <summary>A mobile shown to other agents only by its last four digits; the person who booked them sees it all.</summary>
        private static string? Masked(string? phone) => Ten(phone) is { Length: >= 4 } t ? "••••••" + t[^4..] : null;

        private static object? Vitals(CampPatient p) =>
            p.BpSystolic == null && p.Pulse == null && p.TempF == null && p.Spo2 == null && p.WeightKg == null && p.Sugar == null ? null : new
            {
                bpSystolic = p.BpSystolic, bpDiastolic = p.BpDiastolic, pulse = p.Pulse, tempF = p.TempF, spo2 = p.Spo2, weightKg = p.WeightKg, sugar = p.Sugar, sugarKind = p.SugarKind,
            };

        /// <summary>
        /// The camp-day list: everyone booked or registered, searchable by name, mobile, panchayat or token, with counts
        /// for Waiting / Arrived / Didn't come and the panchayats people come from.
        /// </summary>
        [HttpGet("{id:guid}/people")]
        public async Task<IActionResult> People(Guid id, [FromQuery] string? q, [FromQuery] string? status, [FromQuery] string? place, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var c = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var all = _db.CampPatients.AsNoTracking().Where(p => p.CampId == id && p.Status != "cancelled");
            var places = (await all.Select(p => p.Village).ToListAsync(ct)).Where(v => !string.IsNullOrWhiteSpace(v))
                .GroupBy(v => v!.Trim()).Select(g => new { name = g.Key, n = g.Count() }).OrderByDescending(x => x.n).ThenBy(x => x.name).Take(30).ToList();
            if (!string.IsNullOrWhiteSpace(place)) { var pl = place.Trim().ToLower(); all = all.Where(p => p.Village != null && p.Village.ToLower() == pl); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                all = digits.Length > 0 && digits.Length == s.Length
                    ? all.Where(p => p.Token.ToString() == digits || (digits.Length >= 3 && p.Phone != null && p.Phone.Contains(digits)))
                    : all.Where(p => p.Name.ToLower().Contains(s) || (p.Village != null && p.Village.ToLower().Contains(s)));
            }
            var counts = await all.GroupBy(p => p.Status).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
            var list = all;
            if (!string.IsNullOrWhiteSpace(status)) list = list.Where(p => p.Status == status);
            // Waiting first (in token order), then the ones already marked, latest first.
            var rows = await list.OrderBy(p => p.Status == "booked" ? 0 : 1).ThenBy(p => p.Status == "booked" ? p.Token : 0).ThenByDescending(p => p.StatusAt).Take(600).ToListAsync(ct);
            var names = await CampDesk.NamesAsync(_db, rows.SelectMany(r => new[] { r.CreatedBy, r.StatusBy }), ct);
            return Ok(new
            {
                camp = new { id = c.Id, title = c.Title, date = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime, place = CampDesk.Place(c), capacity = c.Capacity, isToday = c.Date == Today },
                counts = new { waiting = counts.GetValueOrDefault("booked"), arrived = counts.GetValueOrDefault("attended"), noShow = counts.GetValueOrDefault("no_show") },
                places,
                items = rows.Select(p => Person(p, me, names)),
            });
        }

        private static object Person(CampPatient p, string? me, Dictionary<string, string> names)
        {
            var byMe = p.Source == "agent" && p.CreatedBy == me;
            return new
            {
                id = p.Id, token = p.Token, name = p.Name, age = p.Age, sex = p.Sex, phone = byMe ? Ten(p.Phone) : Masked(p.Phone), village = p.Village,
                status = p.Status, arrivedAt = p.ArrivedAt, statusAt = p.StatusAt, statusVia = p.StatusVia,
                statusBy = p.StatusBy == null ? null : p.StatusBy == me ? "me" : names.GetValueOrDefault(p.StatusBy) ?? p.StatusBy,
                source = p.Source, byMe, bookedBy = p.Source == "agent" && p.CreatedBy != null ? names.GetValueOrDefault(p.CreatedBy) : null,
                complaint = p.Complaint, vitals = Vitals(p),
            };
        }

        /// <summary>Book a person into the camp. Their token goes to them on WhatsApp by itself when a mobile is given.</summary>
        [HttpPost("{id:guid}/book")]
        public async Task<IActionResult> Book(Guid id, [FromBody] AgentCampBookingDto d, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            if (!string.IsNullOrWhiteSpace(d.ClientId))
            {
                var again = await _db.CampPatients.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == d.ClientId, ct);
                if (again != null)
                {
                    var c0 = await _db.HealthCamps.AsNoTracking().Where(x => x.Id == again.CampId).FirstAsync(ct);
                    return Ok(new { existed = true, booking = Booking(again, c0) });
                }
            }
            var c = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "This camp is no longer in the list." });
            if (c.Status == "cancelled") return BadRequest(new { message = "This camp was cancelled." });
            if (c.Date < Today) return BadRequest(new { message = "This camp is over." });
            if (string.IsNullOrWhiteSpace(d.Name)) return BadRequest(new { message = "Enter the person's name." });

            var place = d.Village;
            if (!string.IsNullOrWhiteSpace(d.PanchayatId))
                place = await _db.Panchayats.AsNoTracking().Where(x => x.PanchayatId == d.PanchayatId).Select(x => x.Name).FirstOrDefaultAsync(ct) ?? place;
            var p = new CampPatient { CampId = id, ClientId = string.IsNullOrWhiteSpace(d.ClientId) ? null : d.ClientId.Trim(), CreatedBy = me, Source = "agent", Status = "booked" };
            var err = CampsController.ApplyPatient(p, new CampPatientDto
            {
                Name = d.Name, Age = d.Age, Sex = d.Sex, Phone = d.Phone, Village = place ?? "", PanchayatId = d.PanchayatId ?? "", Complaint = d.Complaint,
                BpSystolic = d.BpSystolic, BpDiastolic = d.BpDiastolic, Pulse = d.Pulse, TempF = d.TempF, Spo2 = d.Spo2, WeightKg = d.WeightKg, Sugar = d.Sugar, SugarKind = d.SugarKind,
            });
            if (err != null) return BadRequest(new { message = err });
            // The same person booked twice (by me or someone else): keep the first booking.
            if (p.Phone != null)
            {
                var dup = await _db.CampPatients.AsNoTracking().FirstOrDefaultAsync(x => x.CampId == id && x.Phone == p.Phone && x.Status != "cancelled" && x.Name.ToLower() == p.Name.ToLower(), ct);
                if (dup != null) return Ok(new { existed = true, booking = Booking(dup, c) });
            }
            p.Token = await CampBook.NextTokenAsync(_db, id, ct);
            _db.CampPatients.Add(p);
            await _db.SaveChangesAsync(ct);
            await CampDesk.SendTokenAsync(_outbox, c, p, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { existed = false, booking = Booking(p, c) });
        }

        /// <summary>
        /// The camp day: arrived, didn't come, or undo; and the complaint and vitals, which anyone can add or correct
        /// (all optional). The camp doctor sees them at the check-up.
        /// </summary>
        [HttpPatch("people/{pid:guid}")]
        public async Task<IActionResult> Mark(Guid pid, [FromBody] AgentCampMarkDto d, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var p = await _db.CampPatients.FirstOrDefaultAsync(x => x.Id == pid, ct);
            if (p == null) return NotFound(new { message = "This person is no longer in the camp's list." });
            if (d.Status != null && d.Status is not ("attended" or "no_show" or "booked")) return BadRequest(new { message = "Unknown mark." });
            var before = p.Status;
            var err = CampsController.ApplyPatient(p, new CampPatientDto
            {
                Status = d.Status, Complaint = d.Complaint,
                BpSystolic = d.BpSystolic, BpDiastolic = d.BpDiastolic, Pulse = d.Pulse, TempF = d.TempF, Spo2 = d.Spo2, WeightKg = d.WeightKg, Sugar = d.Sugar, SugarKind = d.SugarKind,
            });
            if (err != null) return BadRequest(new { message = err });
            if (p.Status != before) CampDesk.Marked(p, me, "app");
            await _db.SaveChangesAsync(ct);
            if (p.Status != before) { await DiseaseRegister.SyncCampAsync(_db, p.CampId, ct); await _db.SaveChangesAsync(ct); }
            var names = await CampDesk.NamesAsync(_db, new[] { p.CreatedBy, p.StatusBy }, ct);
            return Ok(Person(p, me, names));
        }
    }
}
