using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Authorize(Roles = "Admin")]
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
            var surveys = await (from s in _db.SurveyResponses.AsNoTracking()
                                 join c in _db.Contacts.AsNoTracking() on s.ContactId equals c.ClientId into cj
                                 from c in cj.DefaultIfEmpty()
                                 join a in _db.Agents.AsNoTracking() on s.AgentId equals a.AgentId into aj
                                 from a in aj.DefaultIfEmpty()
                                 orderby s.CreatedAt descending
                                 select new
                                 {
                                     s.Id,
                                     s.ClientId,
                                     s.AgentId,
                                     AgentName = a != null ? a.Name : "Unknown",
                                     s.ContactId,
                                     ContactName = c != null ? c.Name : "Unknown",
                                     s.PanchayatId,
                                     s.AnswersJson,
                                     s.CreatedAt,
                                     s.SyncedAt
                                 }).ToListAsync();

            return Ok(surveys);
        }
    }
}
