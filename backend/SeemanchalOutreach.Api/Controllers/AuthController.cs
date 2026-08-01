using System;
using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class LoginRequestDto
    {
        [Required]
        public string UserId { get; set; } = string.Empty;   // FieldAgent.AgentId (e.g. "MKT-1001") or phone

        [Required]
        public string Password { get; set; } = string.Empty;

        public string? DeviceId { get; set; }                // client-generated, stable per install; echoed back
    }

    public class RefreshRequestDto
    {
        [Required]
        public string AgentId { get; set; } = string.Empty;

        [Required]
        public string DeviceId { get; set; } = string.Empty;

        [Required]
        public string RefreshToken { get; set; } = string.Empty;
    }

    public class ChangePasswordRequestDto
    {
        [Required]
        public string CurrentPassword { get; set; } = string.Empty;

        [Required, MinLength(8)]
        public string NewPassword { get; set; } = string.Empty;
    }

    [ApiController]
    [Route("api/v1/[controller]")]
    [EnableRateLimiting("auth")]
    public class AuthController : ControllerBase
    {
        private const int RefreshTokenDays = 30;

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
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var agent = await _db.Agents.FirstOrDefaultAsync(
                a => a.AgentId == request.UserId || a.Phone == request.UserId || (a.Email != null && a.Email == request.UserId),
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

            string deviceId = string.IsNullOrWhiteSpace(request.DeviceId)
                ? Guid.NewGuid().ToString()
                : request.DeviceId;

            string refreshToken = await IssueRefreshTokenAsync(agent.AgentId, deviceId, cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                token = GenerateJwt(agent),
                refreshToken,
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                deviceId,
                profileCompleted = agent.ProfileCompleted,
                mustChangePassword = agent.MustChangePassword,
            });
        }

        [HttpPost("refresh")]
        public async Task<ActionResult<object>> Refresh([FromBody] RefreshRequestDto request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == request.AgentId, cancellationToken);
            if (agent == null || !agent.IsActive)
            {
                return Unauthorized("Refresh token is invalid or expired — sign in again.");
            }

            // Scoped to (AgentId, DeviceId) — a session on one device can't be
            // refreshed using a token issued to a different device.
            var session = await _db.AgentRefreshTokens.FirstOrDefaultAsync(
                t => t.AgentId == request.AgentId && t.DeviceId == request.DeviceId, cancellationToken);

            if (session == null
                || session.ExpiresAt < DateTime.UtcNow
                || session.TokenHash != HashToken(request.RefreshToken))
            {
                return Unauthorized("Refresh token is invalid or expired — sign in again.");
            }

            string refreshToken = await IssueRefreshTokenAsync(agent.AgentId, request.DeviceId, cancellationToken); // rotate — the old token can't be reused
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                token = GenerateJwt(agent),
                refreshToken,
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                profileCompleted = agent.ProfileCompleted,
                mustChangePassword = agent.MustChangePassword,
            });
        }

        [HttpPost("change-password")]
        [Authorize]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequestDto request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            string? agentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId, cancellationToken);
            if (agent == null) return Unauthorized();

            if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, agent.PasswordHash))
            {
                return BadRequest("Current password is incorrect.");
            }
            if (BCrypt.Net.BCrypt.Verify(request.NewPassword, agent.PasswordHash))
            {
                return BadRequest("New password must be different from the current password.");
            }

            agent.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            agent.MustChangePassword = false;

            // A password change is often prompted by a suspected leak — revoke every
            // device's session so whoever already holds a refresh token can't keep
            // using it for up to 30 more days regardless of the password change. The
            // device making this request will simply get a new one on its next login.
            var existingSessions = await _db.AgentRefreshTokens
                .Where(t => t.AgentId == agentId)
                .ToListAsync(cancellationToken);
            _db.AgentRefreshTokens.RemoveRange(existingSessions);

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new { message = "Password updated." });
        }

        private async Task<string> IssueRefreshTokenAsync(string agentId, string deviceId, CancellationToken cancellationToken)
        {
            string token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .Replace('+', '-').Replace('/', '_').TrimEnd('=');

            var session = await _db.AgentRefreshTokens.FirstOrDefaultAsync(
                t => t.AgentId == agentId && t.DeviceId == deviceId, cancellationToken);
            if (session == null)
            {
                session = new AgentRefreshToken { AgentId = agentId, DeviceId = deviceId };
                _db.AgentRefreshTokens.Add(session);
            }

            session.TokenHash = HashToken(token);
            session.ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenDays);
            return token;
        }

        private static string HashToken(string token)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
            return Convert.ToHexString(bytes);
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
