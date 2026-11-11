using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class HoardingSaveDto
    {
        public string? ClientId { get; set; }
        public string? Place { get; set; }
        public string? Landmark { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public double? Lat { get; set; }
        public double? Lng { get; set; }
        public double? Accuracy { get; set; }
        public string? Kind { get; set; }
        public string? Size { get; set; }
        public string? Note { get; set; }
        /// <summary>From the app: the agent has already agreed the place with its owner.</summary>
        public bool AlreadyRented { get; set; }
        public Guid? OwnerId { get; set; }
        public string? OwnerName { get; set; }
        public string? OwnerPhone { get; set; }
        // Office only.
        public decimal? MonthlyRent { get; set; }
        public string? RentStart { get; set; }
        public string? RentEnd { get; set; }
        /// <summary>Which of the office-only fields were sent (so an empty value can clear one).</summary>
        public bool SetRent { get; set; }
        public bool SetOwner { get; set; }
    }

    public class HoardingMoveDto { public string? To { get; set; } public string? Reason { get; set; } }
    public class HoardingOwnerDto { public string? Name { get; set; } public string? Phone { get; set; } public string? Address { get; set; } public string? Notes { get; set; } }

    internal static class HoardingFiles
    {
        public static readonly Dictionary<string, string> Images = new(StringComparer.OrdinalIgnoreCase) { ["image/jpeg"] = ".jpg", ["image/png"] = ".png", ["image/webp"] = ".webp" };

        public static async Task<(HoardingPhoto? Photo, string? Error)> SaveAsync(IMarketingDbContext db, IFileStore files, Hoarding h, string? kind, IFormFile? file, string by, CancellationToken ct)
        {
            if (file == null || file.Length == 0) return (null, "No photo.");
            if (file.Length > 10 * 1024 * 1024) return (null, "The photo can be up to 10 MB.");
            var mime = Images.ContainsKey(file.ContentType ?? "") ? file.ContentType! : "image/jpeg";
            var p = new HoardingPhoto { HoardingId = h.Id, Kind = kind == "banner" ? "banner" : "site", Mime = mime, By = by };
            await using var stream = file.OpenReadStream();
            p.FileKey = await files.SaveAsync("hoardings", $"{p.Kind}-{p.Id:N}{Images[mime]}", stream, mime, ct);
            db.HoardingPhotos.Add(p);
            return (p, null);
        }

        public static async Task<IActionResult> ServeAsync(ControllerBase c, IFileStore files, HoardingPhoto p, CancellationToken ct)
        {
            var f = await files.OpenAsync(p.FileKey, ct);
            if (f == null) return c.NotFound(new { message = "The photo is no longer in storage." });
            c.Response.Headers["X-Content-Type-Options"] = "nosniff";
            c.Response.Headers["Cache-Control"] = "private, max-age=86400";
            c.Response.Headers["Content-Disposition"] = $"inline; filename=\"hoarding-{p.Id:N}\"";
            return c.File(f.Value.Content, p.Mime ?? f.Value.ContentType);
        }
    }

    /// <summary>
    /// The CRM's Hoardings page: every banner place on a map and a board, with its owner and rent.
    /// Viewing needs the Hoardings page; anything that changes data needs "Can edit".
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Hoardings)]
    [Route("api/v1/hoardings")]
    public class HoardingsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public HoardingsController(IMarketingDbContext db, IFileStore files, INotifier notifier) { _db = db; _files = files; _notifier = notifier; }

        private async Task<string> MyNameAsync(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            return await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
        }

        private static object Shape(Hoarding h, DateOnly today, List<HoardingPhoto> photos, bool fromAgent) => new
        {
            id = h.Id,
            place = h.Place,
            landmark = h.Landmark,
            district = h.District,
            block = h.Block,
            lat = h.Lat,
            lng = h.Lng,
            accuracy = h.Accuracy,
            kind = h.Kind,
            size = h.Size,
            status = h.Status,
            stage = Hoardings.Stage(h, today),
            daysLeft = Hoardings.DaysLeft(h, today),
            suggestedBy = h.SuggestedBy,
            suggestedByName = h.SuggestedByName,
            fromAgent,
            agentNote = h.AgentNote,
            officeNote = h.OfficeNote,
            ownerId = h.OwnerId,
            monthlyRent = h.MonthlyRent,
            rentStart = h.RentStart?.ToString("yyyy-MM-dd"),
            rentEnd = h.RentEnd?.ToString("yyyy-MM-dd"),
            rentMissing = (h.Status == "approved" || Hoardings.Running(h)) && h.MonthlyRent == null,
            rejectReason = h.RejectReason,
            decidedAt = h.DecidedAt,
            rentedAt = h.RentedAt,
            liveAt = h.LiveAt,
            endedAt = h.EndedAt,
            createdAt = h.CreatedAt,
            updatedAt = h.UpdatedAt,
            photos = photos.Where(p => p.HoardingId == h.Id).OrderBy(p => p.At).Select(p => new { id = p.Id, kind = p.Kind, at = p.At }),
        };

        private async Task<object> OneAsync(Hoarding h, CancellationToken ct)
        {
            var photos = await _db.HoardingPhotos.AsNoTracking().Where(p => p.HoardingId == h.Id).ToListAsync(ct);
            var role = await _db.Agents.AsNoTracking().Where(a => a.AgentId == h.SuggestedBy).Select(a => a.Role).FirstOrDefaultAsync(ct);
            return Shape(h, AttendanceService.TodayIst, photos, !RoleChecks.IsDashboardRole(role));
        }

        /// <summary>Everything the page shows: the places, their owners, and the money summary.</summary>
        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var rows = await _db.Hoardings.AsNoTracking().OrderByDescending(h => h.UpdatedAt).Take(2000).ToListAsync(ct);
            var ids = rows.Select(r => r.Id).ToList();
            var photos = await _db.HoardingPhotos.AsNoTracking().Where(p => ids.Contains(p.HoardingId)).ToListAsync(ct);
            var owners = await _db.HoardingOwners.AsNoTracking().OrderBy(o => o.Name).ToListAsync(ct);
            var people = rows.Select(r => r.SuggestedBy).Distinct().ToList();
            var office = (await _db.Agents.AsNoTracking().Where(a => people.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct))
                .Where(a => RoleChecks.IsDashboardRole(a.Role)).Select(a => a.AgentId).ToHashSet();
            var running = rows.Where(Hoardings.Running).ToList();
            return Ok(new
            {
                today = today.ToString("yyyy-MM-dd"),
                endingDays = Hoardings.EndingDays,
                kinds = Hoardings.Kinds,
                items = rows.Select(h => Shape(h, today, photos, !office.Contains(h.SuggestedBy))),
                owners = owners.Select(o => new
                {
                    id = o.Id, name = o.Name, phone = o.Phone, address = o.Address, notes = o.Notes,
                    places = rows.Count(h => h.OwnerId == o.Id && h.Status != "rejected"),
                    running = running.Count(h => h.OwnerId == o.Id),
                    monthlyRent = running.Where(h => h.OwnerId == o.Id).Sum(h => h.MonthlyRent ?? 0),
                }),
                summary = new
                {
                    monthlySpend = running.Sum(h => h.MonthlyRent ?? 0),
                    running = running.Count,
                    approvedRent = rows.Where(h => h.Status == "approved").Sum(h => h.MonthlyRent ?? 0),
                    waiting = rows.Count(h => h.Status == "suggested"),
                    endingSoon = running.Count(h => Hoardings.Stage(h, today) == "ending"),
                    rentMissing = rows.Count(h => (h.Status == "approved" || Hoardings.Running(h)) && h.MonthlyRent == null),
                },
            });
        }

        private async Task<string?> ApplyAsync(Hoarding h, HoardingSaveDto dto, bool creating, CancellationToken ct)
        {
            if (creating || dto.Place != null)
            {
                var place = Hoardings.Clean(dto.Place, 160);
                if (place == null) return "Write the name of the place.";
                h.Place = place;
            }
            if (creating || dto.Lat != null || dto.Lng != null)
            {
                if (dto.Lat == null || dto.Lng == null || !Hoardings.InIndia(dto.Lat.Value, dto.Lng.Value)) return "Mark the place on the map.";
                h.Lat = Math.Round(dto.Lat.Value, 6); h.Lng = Math.Round(dto.Lng.Value, 6);
            }
            if (creating || dto.Landmark != null) h.Landmark = Hoardings.Clean(dto.Landmark, 200);
            if (creating || dto.District != null) h.District = Hoardings.Clean(dto.District, 80);
            if (creating || dto.Block != null) h.Block = Hoardings.Clean(dto.Block, 80);
            if (creating || dto.Kind != null) h.Kind = Hoardings.KindOf(dto.Kind);
            if (creating || dto.Size != null) h.Size = Hoardings.Clean(dto.Size, 60);
            if (creating || dto.Note != null) h.OfficeNote = Hoardings.Clean(dto.Note, 1000);
            if (creating || dto.SetRent)
            {
                if (dto.MonthlyRent is < 0 or > 10_000_000) return "The rent doesn't look right.";
                var start = Hoardings.Date(dto.RentStart); var end = Hoardings.Date(dto.RentEnd);
                if (!string.IsNullOrWhiteSpace(dto.RentStart) && start == null) return "The start date doesn't look right.";
                if (!string.IsNullOrWhiteSpace(dto.RentEnd) && end == null) return "The end date doesn't look right.";
                if (start != null && end != null && end < start) return "The end date is before the start date.";
                h.MonthlyRent = dto.MonthlyRent == null ? null : Math.Round(dto.MonthlyRent.Value, 2);
                h.RentStart = start; h.RentEnd = end;
            }
            if (creating || dto.SetOwner)
            {
                if (dto.OwnerId != null)
                {
                    if (!await _db.HoardingOwners.AnyAsync(o => o.Id == dto.OwnerId, ct)) return "That owner isn't here any more.";
                    h.OwnerId = dto.OwnerId;
                }
                else
                {
                    var o = await Hoardings.OwnerAsync(_db, dto.OwnerName, dto.OwnerPhone, ct);
                    h.OwnerId = o?.Id;
                }
            }
            h.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        /// <summary>The office adds a place itself (already approved; it moves on from there).</summary>
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] HoardingSaveDto dto, CancellationToken ct)
        {
            var h = new Hoarding { Status = "approved", SuggestedBy = User.AgentIdOf(), SuggestedByName = await MyNameAsync(ct), DecidedBy = User.AgentIdOf(), DecidedAt = DateTime.UtcNow };
            var err = await ApplyAsync(h, dto, true, ct);
            if (err != null) return BadRequest(new { message = err });
            _db.Hoardings.Add(h);
            await _db.SaveChangesAsync(ct);
            return Ok(await OneAsync(h, ct));
        }

        /// <summary>Change the details, the owner, or the rent and dates (renewing is a new end date).</summary>
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] HoardingSaveDto dto, CancellationToken ct)
        {
            var h = await _db.Hoardings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (h == null) return NotFound(new { message = "That place isn't here any more." });
            var err = await ApplyAsync(h, dto, false, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(await OneAsync(h, ct));
        }

        /// <summary>
        /// Move a place along the board: approved (tells the agent to go ahead), rejected (with a reason), rented, live,
        /// ended, or back to suggested. Nothing is ever deleted: a place that isn't wanted is rejected or ended.
        /// </summary>
        [HttpPost("{id:guid}/move")]
        public async Task<IActionResult> Move(Guid id, [FromBody] HoardingMoveDto dto, CancellationToken ct)
        {
            var h = await _db.Hoardings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (h == null) return NotFound(new { message = "That place isn't here any more." });
            var to = (dto.To ?? "").Trim().ToLowerInvariant();
            if (!Hoardings.Statuses.Contains(to)) return BadRequest(new { message = "Unknown step." });
            if (to == h.Status) return Ok(await OneAsync(h, ct));
            var now = DateTime.UtcNow;
            var from = h.Status;
            if (to == "rejected")
            {
                var why = Hoardings.Clean(dto.Reason, 300);
                if (why == null) return BadRequest(new { message = "Write why, so the agent knows." });
                h.RejectReason = why;
            }
            if (to is "approved" or "rejected") { h.DecidedBy = User.AgentIdOf(); h.DecidedAt = now; }
            if (to == "approved") h.RejectReason = null;
            if (to == "rented") h.RentedAt = now;
            if (to == "live") { h.RentedAt ??= now; h.LiveAt = now; }
            if (to == "ended") h.EndedAt = now;
            if (to is "suggested" or "approved" or "rented" or "live") h.EndedAt = null;
            h.Status = to;
            h.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);

            // The agent who suggested it hears about the decision (never the rent).
            if (from == "suggested" && to is "approved" or "rejected")
            {
                _notifier.Notify(new NotifyJob
                {
                    To = new() { h.SuggestedBy }, Except = User.AgentIdOf(), Kind = "hoarding",
                    Title = to == "approved" ? $"Hoarding place approved: {h.Place}" : $"Hoarding place not taken: {h.Place}",
                    Body = to == "approved" ? "Fix it with the owner and mark it rented in the app. Add a photo when the banner is up." : h.RejectReason ?? "",
                    Link = "hoardings", RefId = h.Id.ToString(),
                });
            }
            return Ok(await OneAsync(h, ct));
        }

        [HttpPost("{id:guid}/photos")]
        [RequestSizeLimit(12_000_000)]
        public async Task<IActionResult> AddPhoto(Guid id, [FromQuery] string? kind, IFormFile? file, CancellationToken ct)
        {
            var h = await _db.Hoardings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (h == null) return NotFound(new { message = "That place isn't here any more." });
            var (p, err) = await HoardingFiles.SaveAsync(_db, _files, h, kind, file, User.AgentIdOf(), ct);
            if (p == null) return BadRequest(new { message = err });
            h.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(await OneAsync(h, ct));
        }

        [HttpGet("photos/{photoId:guid}")]
        public async Task<IActionResult> Photo(Guid photoId, CancellationToken ct)
        {
            var p = await _db.HoardingPhotos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == photoId, ct);
            return p == null ? NotFound() : await HoardingFiles.ServeAsync(this, _files, p, ct);
        }

        [HttpPost("owners")]
        public async Task<IActionResult> AddOwner([FromBody] HoardingOwnerDto dto, CancellationToken ct)
        {
            var name = Hoardings.Clean(dto.Name, 120);
            if (name == null) return BadRequest(new { message = "Write the owner's name." });
            var phone = Hoardings.Phone(dto.Phone);
            if (!string.IsNullOrWhiteSpace(dto.Phone) && phone == null) return BadRequest(new { message = "The phone number needs 10 digits." });
            if (phone != null && await _db.HoardingOwners.AnyAsync(o => o.Phone == phone, ct)) return BadRequest(new { message = "An owner with this phone number is already here." });
            var o = new HoardingOwner { Name = name, Phone = phone, Address = Hoardings.Clean(dto.Address, 300), Notes = Hoardings.Clean(dto.Notes, 1000) };
            _db.HoardingOwners.Add(o);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = o.Id, name = o.Name, phone = o.Phone, address = o.Address, notes = o.Notes, places = 0, running = 0, monthlyRent = 0 });
        }

        [HttpPut("owners/{ownerId:guid}")]
        public async Task<IActionResult> UpdateOwner(Guid ownerId, [FromBody] HoardingOwnerDto dto, CancellationToken ct)
        {
            var o = await _db.HoardingOwners.FirstOrDefaultAsync(x => x.Id == ownerId, ct);
            if (o == null) return NotFound(new { message = "That owner isn't here any more." });
            var name = Hoardings.Clean(dto.Name, 120);
            if (name == null) return BadRequest(new { message = "Write the owner's name." });
            var phone = Hoardings.Phone(dto.Phone);
            if (!string.IsNullOrWhiteSpace(dto.Phone) && phone == null) return BadRequest(new { message = "The phone number needs 10 digits." });
            if (phone != null && await _db.HoardingOwners.AnyAsync(x => x.Phone == phone && x.Id != ownerId, ct)) return BadRequest(new { message = "Another owner already has this phone number." });
            o.Name = name; o.Phone = phone; o.Address = Hoardings.Clean(dto.Address, 300); o.Notes = Hoardings.Clean(dto.Notes, 1000); o.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }

    /// <summary>
    /// The agent app's side: suggest a place (photo + GPS), mark it rented, and add the banner photo. An agent sees only
    /// the places they suggested, and never the rent.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/hoardings")]
    public class MyHoardingsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public MyHoardingsController(IMarketingDbContext db, IFileStore files, INotifier notifier) { _db = db; _files = files; _notifier = notifier; }

        /// <summary>What the app is given about a place. No rent, and of the owner only the name.</summary>
        private static object Shape(Hoarding h, DateOnly today, List<HoardingPhoto> photos, Dictionary<Guid, string> owners) => new
        {
            id = h.Id,
            clientId = h.ClientId,
            place = h.Place,
            landmark = h.Landmark,
            lat = h.Lat,
            lng = h.Lng,
            kind = h.Kind,
            size = h.Size,
            status = h.Status,
            stage = Hoardings.Stage(h, today),
            daysLeft = Hoardings.DaysLeft(h, today),
            rentEnd = h.RentEnd?.ToString("yyyy-MM-dd"),
            note = h.AgentNote,
            ownerName = h.OwnerId != null ? owners.GetValueOrDefault(h.OwnerId.Value) : null,
            rejectReason = h.RejectReason,
            createdAt = h.CreatedAt,
            photos = photos.Where(p => p.HoardingId == h.Id).OrderBy(p => p.At).Select(p => new { id = p.Id, kind = p.Kind }),
        };

        private async Task<object> OneAsync(Hoarding h, CancellationToken ct)
        {
            var photos = await _db.HoardingPhotos.AsNoTracking().Where(p => p.HoardingId == h.Id).ToListAsync(ct);
            var owners = h.OwnerId == null ? new() : await _db.HoardingOwners.AsNoTracking().Where(o => o.Id == h.OwnerId).ToDictionaryAsync(o => o.Id, o => o.Name, ct);
            return Shape(h, AttendanceService.TodayIst, photos, owners);
        }

        [HttpGet]
        public async Task<IActionResult> Mine(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var rows = await _db.Hoardings.AsNoTracking().Where(h => h.SuggestedBy == me).OrderByDescending(h => h.CreatedAt).Take(300).ToListAsync(ct);
            var ids = rows.Select(r => r.Id).ToList();
            var photos = await _db.HoardingPhotos.AsNoTracking().Where(p => ids.Contains(p.HoardingId)).ToListAsync(ct);
            var oids = rows.Where(r => r.OwnerId != null).Select(r => r.OwnerId!.Value).Distinct().ToList();
            var owners = await _db.HoardingOwners.AsNoTracking().Where(o => oids.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Name, ct);
            var today = AttendanceService.TodayIst;
            return Ok(new { items = rows.Select(h => Shape(h, today, photos, owners)), kinds = Hoardings.Kinds });
        }

        /// <summary>Suggest a place. The phone's own id makes sending it twice harmless.</summary>
        [HttpPost]
        public async Task<IActionResult> Suggest([FromBody] HoardingSaveDto dto, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var cid = Hoardings.Clean(dto.ClientId, 64);
            if (cid != null)
            {
                var had = await _db.Hoardings.FirstOrDefaultAsync(x => x.ClientId == cid, ct);
                if (had != null) return had.SuggestedBy == me ? Ok(await OneAsync(had, ct)) : Conflict(new { message = "That place was already sent." });
            }
            var place = Hoardings.Clean(dto.Place, 160);
            if (place == null) return BadRequest(new { message = "Write the name of the place." });
            if (dto.Lat == null || dto.Lng == null || !Hoardings.InIndia(dto.Lat.Value, dto.Lng.Value)) return BadRequest(new { message = "The place needs its location. Turn on GPS and try again." });
            var agent = await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => new { a.Name, a.District, a.Block }).FirstOrDefaultAsync(ct);
            var now = DateTime.UtcNow;
            var h = new Hoarding
            {
                Place = place, Landmark = Hoardings.Clean(dto.Landmark, 200),
                District = Hoardings.Clean(agent?.District, 80), Block = Hoardings.Clean(agent?.Block, 80),
                Lat = Math.Round(dto.Lat.Value, 6), Lng = Math.Round(dto.Lng.Value, 6), Accuracy = dto.Accuracy,
                Kind = Hoardings.KindOf(dto.Kind), Size = Hoardings.Clean(dto.Size, 60),
                SuggestedBy = me, SuggestedByName = agent?.Name ?? me, AgentNote = Hoardings.Clean(dto.Note, 1000),
                // Already agreed with the owner: it goes straight to Rented, and the office adds the rent.
                Status = dto.AlreadyRented ? "rented" : "suggested", RentedAt = dto.AlreadyRented ? now : null,
            };
            if (cid != null) h.ClientId = cid;
            h.OwnerId = (await Hoardings.OwnerAsync(_db, dto.OwnerName, dto.OwnerPhone, ct))?.Id;
            _db.Hoardings.Add(h);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                ToOffice = true, Except = me, Kind = "hoarding",
                Title = dto.AlreadyRented ? $"Hoarding rented by {h.SuggestedByName}: {h.Place}" : $"New hoarding place from {h.SuggestedByName}: {h.Place}",
                Body = dto.AlreadyRented ? "Add the monthly rent and the dates." : "Approve it with the rent, or say why not.",
                Link = $"hoarding:{h.Id}", RefId = h.Id.ToString(),
            });
            return Ok(await OneAsync(h, ct));
        }

        /// <summary>A photo of the empty place, or of the banner once it is up (which makes the place "live").</summary>
        [HttpPost("{id:guid}/photo")]
        [RequestSizeLimit(12_000_000)]
        public async Task<IActionResult> AddPhoto(Guid id, [FromQuery] string? kind, IFormFile? file, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var h = await _db.Hoardings.FirstOrDefaultAsync(x => x.Id == id && x.SuggestedBy == me, ct);
            if (h == null) return NotFound(new { message = "That place isn't yours." });
            var banner = kind == "banner";
            if (banner && h.Status is not ("approved" or "rented" or "live")) return BadRequest(new { message = "The office has to approve this place first." });
            var (p, err) = await HoardingFiles.SaveAsync(_db, _files, h, kind, file, me, ct);
            if (p == null) return BadRequest(new { message = err });
            var now = DateTime.UtcNow;
            var wentLive = banner && h.Status != "live";
            if (wentLive) { h.Status = "live"; h.RentedAt ??= now; h.LiveAt = now; }
            h.UpdatedAt = now;
            await _db.SaveChangesAsync(ct);
            if (wentLive)
                _notifier.Notify(new NotifyJob { ToOffice = true, Except = me, Kind = "hoarding", Title = $"Banner is up: {h.Place}", Body = $"{h.SuggestedByName} added the photo.", Link = $"hoarding:{h.Id}", RefId = h.Id.ToString() });
            return Ok(await OneAsync(h, ct));
        }

        /// <summary>The agent has fixed an approved place with its owner.</summary>
        [HttpPost("{id:guid}/rented")]
        public async Task<IActionResult> Rented(Guid id, [FromBody] HoardingSaveDto? dto, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var h = await _db.Hoardings.FirstOrDefaultAsync(x => x.Id == id && x.SuggestedBy == me, ct);
            if (h == null) return NotFound(new { message = "That place isn't yours." });
            if (h.Status is "rented" or "live") return Ok(await OneAsync(h, ct));
            if (h.Status != "approved") return BadRequest(new { message = "The office has to approve this place first." });
            if (h.OwnerId == null && dto != null) h.OwnerId = (await Hoardings.OwnerAsync(_db, dto.OwnerName, dto.OwnerPhone, ct))?.Id;
            h.Status = "rented"; h.RentedAt = DateTime.UtcNow; h.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                ToOffice = true, Except = me, Kind = "hoarding", Title = $"Hoarding rented: {h.Place}",
                Body = h.MonthlyRent == null ? $"{h.SuggestedByName} fixed it with the owner. Add the monthly rent and the dates." : $"{h.SuggestedByName} fixed it with the owner.",
                Link = $"hoarding:{h.Id}", RefId = h.Id.ToString(),
            });
            return Ok(await OneAsync(h, ct));
        }

        [HttpGet("photos/{photoId:guid}")]
        public async Task<IActionResult> Photo(Guid photoId, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var p = await _db.HoardingPhotos.AsNoTracking().FirstOrDefaultAsync(x => x.Id == photoId, ct);
            if (p == null || !await _db.Hoardings.AnyAsync(h => h.Id == p.HoardingId && h.SuggestedBy == me, ct)) return NotFound();
            return await HoardingFiles.ServeAsync(this, _files, p, ct);
        }
    }
}
