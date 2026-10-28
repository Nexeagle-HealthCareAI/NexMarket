using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class DepartmentDto
    {
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public int Order { get; set; }
    }

    public class DoctorDto
    {
        public string Name { get; set; } = string.Empty;
        public Guid? DepartmentId { get; set; }
        public string? Qualification { get; set; }
        public string? OpdDays { get; set; }
        public string? OpdTimings { get; set; }
        public bool IsActive { get; set; } = true;
    }

    /// <summary>
    /// The hospital's departments and doctors. Anyone signed in can read them (the agent
    /// app's referral form and the WhatsApp doctor picker use them); changes need the
    /// "Departments &amp; doctors" page.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1")]
    public class DepartmentsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public DepartmentsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet("departments")]
        public async Task<IActionResult> Departments([FromQuery] bool includeInactive = false, CancellationToken ct = default)
        {
            var q = _db.Departments.AsNoTracking().AsQueryable();
            if (!includeInactive) q = q.Where(d => d.IsActive);
            return Ok(await q.OrderBy(d => d.Order).ThenBy(d => d.Name).ToListAsync(ct));
        }

        [HttpPost("departments")]
        [PageAccess(Pages.Departments)]
        public async Task<IActionResult> CreateDepartment([FromBody] DepartmentDto dto, CancellationToken ct)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest("Name is required.");
            if (await _db.Departments.AnyAsync(d => d.Name.ToLower() == name.ToLower(), ct)) return Conflict("That department already exists.");
            var d = new Department { Name = name, IsActive = dto.IsActive, Order = dto.Order };
            _db.Departments.Add(d);
            await _db.SaveChangesAsync(ct);
            return Ok(d);
        }

        [HttpPut("departments/{id:guid}")]
        [PageAccess(Pages.Departments)]
        public async Task<IActionResult> UpdateDepartment(Guid id, [FromBody] DepartmentDto dto, CancellationToken ct)
        {
            var d = await _db.Departments.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound();
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest("Name is required.");
            d.Name = name;
            d.IsActive = dto.IsActive;
            d.Order = dto.Order;
            await _db.SaveChangesAsync(ct);
            return Ok(d);
        }

        [HttpGet("doctors")]
        public async Task<IActionResult> Doctors([FromQuery] bool includeInactive = false, CancellationToken ct = default)
        {
            var q = _db.Doctors.AsNoTracking().AsQueryable();
            if (!includeInactive) q = q.Where(d => d.IsActive);
            var doctors = await q.OrderBy(d => d.Name).ToListAsync(ct);
            var depts = await _db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, d => d.Name, ct);
            return Ok(doctors.Select(d => new
            {
                d.Id, d.Name, d.DepartmentId,
                department = d.DepartmentId.HasValue ? depts.GetValueOrDefault(d.DepartmentId.Value) : null,
                d.Qualification, d.OpdDays, d.OpdTimings, d.IsActive,
            }));
        }

        [HttpPost("doctors")]
        [PageAccess(Pages.Departments)]
        public async Task<IActionResult> CreateDoctor([FromBody] DoctorDto dto, CancellationToken ct)
        {
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest("Name is required.");
            var d = new Doctor
            {
                Name = name, DepartmentId = dto.DepartmentId, Qualification = dto.Qualification,
                OpdDays = dto.OpdDays, OpdTimings = dto.OpdTimings, IsActive = dto.IsActive,
            };
            _db.Doctors.Add(d);
            await _db.SaveChangesAsync(ct);
            return Ok(d);
        }

        [HttpPut("doctors/{id:guid}")]
        [PageAccess(Pages.Departments)]
        public async Task<IActionResult> UpdateDoctor(Guid id, [FromBody] DoctorDto dto, CancellationToken ct)
        {
            var d = await _db.Doctors.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (d == null) return NotFound();
            var name = (dto.Name ?? "").Trim();
            if (name.Length == 0) return BadRequest("Name is required.");
            d.Name = name;
            d.DepartmentId = dto.DepartmentId;
            d.Qualification = dto.Qualification;
            d.OpdDays = dto.OpdDays;
            d.OpdTimings = dto.OpdTimings;
            d.IsActive = dto.IsActive;
            await _db.SaveChangesAsync(ct);
            return Ok(d);
        }
    }
}
