using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

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
    }
}
