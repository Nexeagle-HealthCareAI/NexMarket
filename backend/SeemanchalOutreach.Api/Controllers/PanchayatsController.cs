using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class PanchayatDto
    {
        public string Id { get; set; } = string.Empty;
        public string LgdCode { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string State { get; set; } = string.Empty;
        public double? CentroidLat { get; set; }
        public double? CentroidLng { get; set; }
    }

    public class CreatePanchayatRequest
    {
        [Required] public string Name { get; set; } = string.Empty;
        [Required] public string District { get; set; } = string.Empty;
        [Required] public string Block { get; set; } = string.Empty;
        public double? CentroidLat { get; set; }
        public double? CentroidLng { get; set; }
    }

    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class PanchayatsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public PanchayatsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<ActionResult<List<PanchayatDto>>> GetPanchayats(CancellationToken cancellationToken)
        {
            var panchayats = await _db.Panchayats.AsNoTracking()
                .OrderBy(p => p.District).ThenBy(p => p.Block).ThenBy(p => p.Name)
                .Select(p => new PanchayatDto
                {
                    Id = p.PanchayatId,
                    LgdCode = p.LgdCode,
                    Name = p.Name,
                    Block = p.Block,
                    District = p.District,
                    State = p.State,
                    CentroidLat = p.CentroidLat,
                    CentroidLng = p.CentroidLng,
                })
                .ToListAsync(cancellationToken);

            return Ok(panchayats);
        }

        // Agents get an offline-capable equivalent of this via the sync outbox
        // (SyncBatchCommandHandler's "panchayat_new" case) — this direct, always-
        // online endpoint is for the admin panel, which has no offline concern.
        [HttpPost]
        [Authorize(Roles = "Admin")]
        public async Task<ActionResult<PanchayatDto>> CreatePanchayat([FromBody] CreatePanchayatRequest request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var name = request.Name.Trim();
            var district = request.District.Trim();
            var block = request.Block.Trim();

            var duplicate = await _db.Panchayats.AsNoTracking().FirstOrDefaultAsync(
                p => p.Name.ToLower() == name.ToLower() && p.Block.ToLower() == block.ToLower() && p.District.ToLower() == district.ToLower(),
                cancellationToken);
            if (duplicate != null)
            {
                return Conflict($"A panchayat named '{name}' already exists in {block}, {district}.");
            }

            var panchayat = new Panchayat
            {
                PanchayatId = Guid.NewGuid().ToString(),
                Name = name,
                District = district,
                Block = block,
                State = "Bihar",
                LgdCode = "",
                CentroidLat = request.CentroidLat,
                CentroidLng = request.CentroidLng,
            };
            _db.Panchayats.Add(panchayat);
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new PanchayatDto
            {
                Id = panchayat.PanchayatId,
                LgdCode = panchayat.LgdCode,
                Name = panchayat.Name,
                Block = panchayat.Block,
                District = panchayat.District,
                State = panchayat.State,
                CentroidLat = panchayat.CentroidLat,
                CentroidLng = panchayat.CentroidLng,
            });
        }
    }
}
