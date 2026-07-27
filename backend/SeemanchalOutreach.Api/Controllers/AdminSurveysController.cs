using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/v1/admin/[controller]")]
    public class SurveysController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public SurveysController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetAllSurveys()
        {
            var surveys = await _db.SurveyResponses
                .AsNoTracking()
                .OrderByDescending(s => s.CreatedAt)
                .Select(s => new
                {
                    s.Id,
                    s.ClientId,
                    s.AgentId,
                    s.ContactId,
                    s.PanchayatId,
                    s.AnswersJson,
                    s.CreatedAt,
                    s.SyncedAt
                })
                .ToListAsync();

            return Ok(surveys);
        }
    }
}
