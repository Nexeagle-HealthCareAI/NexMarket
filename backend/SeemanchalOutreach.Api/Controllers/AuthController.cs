using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class LoginRequestDto
    {
        public string UserId { get; set; } = string.Empty;   // FieldAgent.AgentId (e.g. "MKT-1001") or phone
        public string Password { get; set; } = string.Empty;
        public string? DeviceId { get; set; }                // client-generated, stable per install; echoed back
    }

    [ApiController]
    [Route("api/v1/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IConfiguration _config;

        public AuthController(IMarketingDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        [HttpPost("login")]
        public async Task<ActionResult<object>> Login([FromBody] LoginRequestDto request, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(request.UserId) || string.IsNullOrWhiteSpace(request.Password))
            {
                return BadRequest("User ID and password are required.");
            }

            var agent = await _db.Agents.FirstOrDefaultAsync(
                a => a.AgentId == request.UserId || a.Phone == request.UserId,
                cancellationToken);

            if (agent == null
                || string.IsNullOrEmpty(agent.PasswordHash)
                || !BCrypt.Net.BCrypt.Verify(request.Password, agent.PasswordHash))
            {
                return Unauthorized("Invalid User ID or password.");
            }

            if (!agent.IsActive)
            {
                return Unauthorized("This account has been deactivated.");
            }

            string token = GenerateJwt(agent);
            string deviceId = string.IsNullOrWhiteSpace(request.DeviceId)
                ? Guid.NewGuid().ToString()
                : request.DeviceId;

            return Ok(new
            {
                token,
                // No refresh-token flow implemented yet — placeholder kept only so the
                // existing AuthResponse shape on the client doesn't break.
                refreshToken = Guid.NewGuid().ToString("N"),
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                deviceId,
            });
        }

        private string GenerateJwt(FieldAgent agent)
        {
            var signingKey = _config["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key is not configured.");
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey));
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            double.TryParse(_config["Jwt:ExpiryHours"], out var expiryHours);
            if (expiryHours <= 0) expiryHours = 12;

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, agent.Id.ToString()),
                new Claim("agentId", agent.AgentId),
                new Claim(ClaimTypes.Name, agent.Name),
                new Claim(ClaimTypes.Role, agent.Role),
            };

            var token = new JwtSecurityToken(
                issuer: _config["Jwt:Issuer"],
                audience: _config["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(expiryHours),
                signingCredentials: credentials);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
