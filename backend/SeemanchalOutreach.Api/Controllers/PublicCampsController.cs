using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class PublicCampBookingDto
    {
        public string? Name { get; set; }
        public int? Age { get; set; }
        public string? Sex { get; set; }
        public string? Phone { get; set; }
        public string? Village { get; set; }
        public string? Complaint { get; set; }
        public bool Consent { get; set; }
        /// <summary>A field people never see; a bot that fills it is turned away quietly.</summary>
        public string? Website { get; set; }
    }

    /// <summary>
    /// The page a person opens by scanning a health camp's QR poster: what the camp is, and a short form to book a place.
    /// They get their token number on the page. No sign-in; only what the page needs is shown (no list of people),
    /// rate-limited per address, with a hidden trap field for bots.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/public/camps")]
    public class PublicCampsController : ControllerBase
    {
        private static readonly Regex Safe = new(@"[\u0000-\u001f<>]");
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;

        public PublicCampsController(IMarketingDbContext db, IAppSettings settings, IConfiguration config)
        {
            _db = db; _settings = settings; _config = config;
        }

        private static string? Clean(string? s, int max)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = Regex.Replace(Safe.Replace(s.Trim(), " "), @"\s+", " ");
            return s.Length > max ? s[..max] : s;
        }

        private Task<HealthCamp?> FindAsync(string code, CancellationToken ct)
        {
            var c = (code ?? "").Trim().ToUpperInvariant();
            return _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Code.ToUpper() == c, ct);
        }

        private static DateOnly Today => DateOnly.FromDateTime(IstClock.NowIst);

        /// <summary>open | full | over | cancelled.</summary>
        private static string State(HealthCamp c, int booked) =>
            c.Status == "cancelled" ? "cancelled" : c.Date < Today || c.Status == "done" ? "over" : booked >= c.Capacity ? "full" : "open";

        /// <summary>The camp, as the poster's page shows it.</summary>
        [HttpGet("{code}")]
        public async Task<IActionResult> Get(string code, CancellationToken ct)
        {
            var c = await FindAsync(code, ct);
            if (c == null) return NotFound(new { message = "This camp was not found. Check the QR code or ask the camp team." });
            var booked = await _db.CampPatients.CountAsync(p => p.CampId == c.Id && p.Status != "cancelled", ct);
            var wa = LeadInbox.Wa(_settings, _config);
            // Panchayat names around the camp, so typing a village is quick (names only).
            var places = await _db.Panchayats.AsNoTracking()
                .Where(p => (c.Block != null && p.Block == c.Block) || (c.District != null && p.District == c.District))
                .OrderBy(p => p.Block == c.Block ? 0 : 1).ThenBy(p => p.Name).Select(p => p.Name).Take(400).ToListAsync(ct);
            return Ok(new
            {
                code = c.Code, title = c.Title, type = c.CampType, typeLabel = CampBook.TypeLabel(c.CampType),
                date = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime,
                venue = c.Venue, block = c.Block, district = c.District, doctors = c.Doctors, departments = c.Departments,
                state = State(c, booked), placesLeft = Math.Max(0, c.Capacity - booked), isToday = c.Date == Today,
                hospital = wa.HospitalName, phone = LeadInbox.DisplayPhone(wa),
                places = places.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            });
        }

        /// <summary>Book one person. The same name and mobile booked again gets the same token back.</summary>
        [HttpPost("{code}/book")]
        [EnableRateLimiting("campbook")]
        public async Task<IActionResult> Book(string code, [FromBody] PublicCampBookingDto d, CancellationToken ct)
        {
            var c = await FindAsync(code, ct);
            if (c == null) return NotFound(new { message = "This camp was not found." });
            if (!string.IsNullOrEmpty(d.Website)) return Ok(new { token = 0, existed = false }); // a bot

            var booked = await _db.CampPatients.CountAsync(p => p.CampId == c.Id && p.Status != "cancelled", ct);
            var state = State(c, booked);
            if (state == "cancelled") return BadRequest(new { message = "This camp was cancelled.", state });
            if (state == "over") return BadRequest(new { message = "This camp is over.", state });

            var name = Clean(d.Name, 80);
            if (name == null || name.Length < 2) return BadRequest(new { message = "Write the name.", field = "name" });
            if (d.Age is null or < 0 or > 120) return BadRequest(new { message = "Write the age.", field = "age" });
            if (d.Sex is not ("M" or "F" or "O")) return BadRequest(new { message = "Choose male, female or other.", field = "sex" });
            string? phone = null;
            if (!string.IsNullOrWhiteSpace(d.Phone))
            {
                phone = LeadInbox.NormalizePhone(d.Phone);
                if (phone == null) return BadRequest(new { message = "The mobile number should have 10 digits.", field = "phone" });
            }
            var village = Clean(d.Village, 80);
            if (village == null) return BadRequest(new { message = "Write the village or panchayat.", field = "village" });

            // Booked already (a second tap, or the page opened again): the same token.
            if (phone != null)
            {
                var lower = name.ToLower();
                var dup = await _db.CampPatients.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.CampId == c.Id && p.Phone == phone && p.Status != "cancelled" && p.Name.ToLower() == lower, ct);
                if (dup != null) return Ok(new { token = dup.Token, existed = true, name = dup.Name });
            }
            if (state == "full") return BadRequest(new { message = "All places for this camp are booked.", state });

            var panchayatId = await _db.Panchayats.AsNoTracking()
                .Where(p => p.Name.ToLower() == village.ToLower() && ((c.Block != null && p.Block == c.Block) || (c.District != null && p.District == c.District)))
                .Select(p => p.PanchayatId).FirstOrDefaultAsync(ct);
            var p = new CampPatient
            {
                CampId = c.Id, Name = name, Age = d.Age, Sex = d.Sex, Phone = phone, Village = village, PanchayatId = panchayatId,
                Complaint = Clean(d.Complaint, 300), Consent = d.Consent && phone != null, Source = "qr", Status = "booked", CreatedBy = "qr",
                Token = await CampBook.NextTokenAsync(_db, c.Id, ct),
            };
            _db.CampPatients.Add(p);
            await _db.SaveChangesAsync(ct);
            return Ok(new { token = p.Token, existed = false, name = p.Name });
        }
    }
}
