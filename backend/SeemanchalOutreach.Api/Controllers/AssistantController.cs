using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Services;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>The AI helper in the field agent app. Every lookup is limited to the signed-in agent's own work.</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/assistant")]
    public class AssistantController : ControllerBase
    {
        private readonly FieldAssistant _assistant;
        public AssistantController(FieldAssistant assistant) => _assistant = assistant;

        private const string NotOn = "The AI helper isn't switched on yet. Ask your manager.";

        [HttpGet("tips")]
        public async Task<IActionResult> Tips([FromQuery] string? lang, [FromQuery] bool refresh = false, CancellationToken ct = default)
        {
            if (!_assistant.Configured) return StatusCode(503, new { message = NotOn });
            var agentId = User.AgentIdOf();
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();
            try { return Ok(await _assistant.TipsAsync(agentId, lang, refresh, ct)); }
            catch (AnalystUnavailableException ex) { return StatusCode(502, new { message = ex.Message }); }
        }

        public class AskDto
        {
            public string Question { get; set; } = string.Empty;
            public List<FieldAssistant.Turn> History { get; set; } = new();
            public string? Lang { get; set; }
        }

        [HttpPost("ask")]
        public async Task<IActionResult> Ask([FromBody] AskDto dto, CancellationToken ct)
        {
            if (!_assistant.Configured) return StatusCode(503, new { message = NotOn });
            if (string.IsNullOrWhiteSpace(dto.Question)) return BadRequest(new { message = "Type a question first." });
            var agentId = User.AgentIdOf();
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();
            try
            {
                var (answer, used) = await _assistant.AskAsync(agentId, dto.Question.Trim(), dto.History ?? new(), dto.Lang, ct);
                return Ok(new { answer, lookedUp = used });
            }
            catch (AnalystUnavailableException ex) { return StatusCode(502, new { message = ex.Message }); }
        }
    }
}
