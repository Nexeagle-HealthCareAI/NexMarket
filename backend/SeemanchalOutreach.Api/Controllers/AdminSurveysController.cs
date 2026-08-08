using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class UpdateSurveyResponseDto
    {
        public string AnswersJson { get; set; } = "{}";
    }

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
                                 join p in _db.Panchayats.AsNoTracking() on s.PanchayatId equals p.PanchayatId into pj
                                 from p in pj.DefaultIfEmpty()
                                 orderby s.CreatedAt descending
                                 select new
                                 {
                                     s.Id,
                                     s.ClientId,
                                     s.AgentId,
                                     AgentName = a != null ? a.Name : "Unknown",
                                     s.ContactId,
                                     ContactName = c != null ? c.Name : "Unknown",
                                     ContactPhone = c != null ? c.Phone : "",
                                     ContactRole = c != null ? c.Role : null,
                                     s.PanchayatId,
                                     LocationName = p != null ? p.Name : "Unknown",
                                     District = p != null ? p.District : null,
                                     Block = p != null ? p.Block : null,
                                     s.AnswersJson,
                                     s.CreatedAt,
                                     s.SyncedAt
                                 }).ToListAsync();

            return Ok(surveys);
        }

        // The "Data Management" tab's Edit/Delete buttons had nothing to call —
        // GetAllSurveys was the only action on this controller.
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> DeleteSurvey(Guid id)
        {
            var survey = await _db.SurveyResponses.FirstOrDefaultAsync(s => s.Id == id);
            if (survey == null) return NotFound();

            _db.SurveyResponses.Remove(survey);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> UpdateSurvey(Guid id, [FromBody] UpdateSurveyResponseDto dto)
        {
            var survey = await _db.SurveyResponses.FirstOrDefaultAsync(s => s.Id == id);
            if (survey == null) return NotFound();

            // A malformed value here would silently corrupt every downstream
            // reader (admin table columns, CSV export) — validate before persisting.
            try
            {
                using var _ = JsonDocument.Parse(dto.AnswersJson);
            }
            catch (JsonException)
            {
                return BadRequest("answersJson must be valid JSON.");
            }

            survey.AnswersJson = dto.AnswersJson;
            await _db.SaveChangesAsync();

            var agent = await _db.Agents.AsNoTracking().FirstOrDefaultAsync(a => a.AgentId == survey.AgentId);
            var contact = await _db.Contacts.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == survey.ContactId);
            var panchayat = await _db.Panchayats.AsNoTracking().FirstOrDefaultAsync(p => p.PanchayatId == survey.PanchayatId);

            return Ok(new
            {
                survey.Id,
                survey.ClientId,
                survey.AgentId,
                AgentName = agent?.Name ?? "Unknown",
                survey.ContactId,
                ContactName = contact?.Name ?? "Unknown",
                ContactPhone = contact?.Phone ?? "",
                ContactRole = contact?.Role,
                survey.PanchayatId,
                LocationName = panchayat?.Name ?? "Unknown",
                District = panchayat?.District,
                Block = panchayat?.Block,
                survey.AnswersJson,
                survey.CreatedAt,
                survey.SyncedAt
            });
        }
    }
}
