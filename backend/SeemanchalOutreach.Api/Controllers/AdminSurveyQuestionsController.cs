using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;
using System.Text.Json;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Route("api/v1/admin/questions")]
    [Authorize(Roles = "Admin")]
    public class AdminSurveyQuestionsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public AdminSurveyQuestionsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetQuestions(CancellationToken cancellationToken)
        {
            var questions = await _db.SurveyQuestions
                .OrderBy(q => q.Order)
                .ThenBy(q => q.CreatedAt)
                .ToListAsync(cancellationToken);
            return Ok(questions);
        }

        public class QuestionDto
        {
            public string QuestionId { get; set; } = string.Empty;
            public string Text { get; set; } = string.Empty;
            public string Type { get; set; } = "single";
            public string Section { get; set; } = string.Empty;
            public List<string>? Options { get; set; }
            public bool IsOptional { get; set; } = false;
            public bool IsActive { get; set; } = true;
            public int Order { get; set; } = 0;
        }

        [HttpPost]
        public async Task<IActionResult> CreateQuestion([FromBody] QuestionDto dto, CancellationToken cancellationToken)
        {
            if (await _db.SurveyQuestions.AnyAsync(q => q.QuestionId == dto.QuestionId, cancellationToken))
            {
                return BadRequest(new { error = "Question ID already exists" });
            }

            var question = new SurveyQuestion
            {
                Id = Guid.NewGuid(),
                QuestionId = dto.QuestionId,
                Text = dto.Text,
                Type = dto.Type,
                Section = dto.Section,
                OptionsJson = dto.Options != null ? JsonSerializer.Serialize(dto.Options) : null,
                IsOptional = dto.IsOptional,
                IsActive = dto.IsActive,
                Order = dto.Order,
                CreatedAt = DateTime.UtcNow
            };

            _db.SurveyQuestions.Add(question);
            await _db.SaveChangesAsync(cancellationToken);

            return CreatedAtAction(nameof(GetQuestions), new { id = question.Id }, question);
        }

        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateQuestion(Guid id, [FromBody] QuestionDto dto, CancellationToken cancellationToken)
        {
            var question = await _db.SurveyQuestions.FindAsync(new object[] { id }, cancellationToken);
            if (question == null) return NotFound();

            if (question.QuestionId != dto.QuestionId && await _db.SurveyQuestions.AnyAsync(q => q.QuestionId == dto.QuestionId && q.Id != id, cancellationToken))
            {
                return BadRequest(new { error = "Question ID already exists" });
            }

            question.QuestionId = dto.QuestionId;
            question.Text = dto.Text;
            question.Type = dto.Type;
            question.Section = dto.Section;
            question.OptionsJson = dto.Options != null ? JsonSerializer.Serialize(dto.Options) : null;
            question.IsOptional = dto.IsOptional;
            question.IsActive = dto.IsActive;
            question.Order = dto.Order;

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(question);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteQuestion(Guid id, CancellationToken cancellationToken)
        {
            var question = await _db.SurveyQuestions.FindAsync(new object[] { id }, cancellationToken);
            if (question == null) return NotFound();

            _db.SurveyQuestions.Remove(question);
            await _db.SaveChangesAsync(cancellationToken);

            return NoContent();
        }
    }
}
