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
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;
using SeemanchalOutreach.Api.Services;

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

        // The refresh token itself is read from the httpOnly cookie, not the body
        // — it's never exposed to client JS, so the client has no way to send it
        // here even if it wanted to. AgentId/DeviceId are just identifiers (not
        // secrets), needed to look up which session to refresh.

        /// <summary>Only from the phone app (X-Client: mobile), which keeps it in the device keystore. Browsers leave it empty.</summary>
        public string? RefreshToken { get; set; }
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
        private readonly IMemoryCache _cache;

        public AuthController(IMarketingDbContext db, IConfiguration config, IMemoryCache cache)
        {
            _db = db;
            _config = config;
            _cache = cache;
        }

        /// <summary>The NexEagle Field phone app sends "X-Client: mobile".</summary>
        private bool IsMobileClient =>
            string.Equals(Request.Headers["X-Client"].ToString(), "mobile", StringComparison.OrdinalIgnoreCase);

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

            // One sign-in per kind of device: a new sign-in on a phone ends the earlier phone session
            // (same for tablet, and for laptop/desktop). The other kinds stay signed in.
            string deviceType = DeviceKinds.Detect(Request);
            var replaced = await _db.AgentRefreshTokens
                .Where(t => t.AgentId == agent.AgentId && t.DeviceId != deviceId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow)
                .Where(t => t.DeviceType == deviceType || (t.DeviceType == null && deviceType == DeviceKinds.Desktop && !IsMobileClient))
                .ToListAsync(cancellationToken);
            foreach (var old in replaced)
            {
                SessionGuard.End(old, $"You were signed out because this account signed in on another {DeviceKinds.Label(deviceType)}.", _cache);
                _db.AuditLogs.Add(AuthAudit.Event(HttpContext, agent, "session_replaced",
                    $"Earlier {DeviceKinds.Label(deviceType)} session ended by a new sign-in", old.DeviceId, deviceType));
            }

            var (refreshToken, session) = await IssueRefreshTokenAsync(agent.AgentId, deviceId, cancellationToken);
            session.DeviceType = deviceType;
            _db.AuditLogs.Add(AuthAudit.Event(HttpContext, agent, "sign_in", $"Signed in on a {DeviceKinds.Label(deviceType)}", deviceId, deviceType));
            await _db.SaveChangesAsync(cancellationToken);

            string jwt = GenerateJwt(agent, session);
            SetAuthCookies(jwt, refreshToken);

            return Ok(new
            {
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                deviceId,
                deviceType,
                signedOutElsewhere = replaced.Count,
                profileCompleted = agent.ProfileCompleted,
                mustChangePassword = agent.MustChangePassword,
                // The phone app has no cookie jar it can trust across restarts: it keeps both
                // tokens in the device keystore and sends "Authorization: Bearer". Browsers
                // never get them in the body.
                accessToken = IsMobileClient ? jwt : null,
                refreshToken = IsMobileClient ? refreshToken : null,
            });
        }

        [HttpPost("refresh")]
        public async Task<ActionResult<object>> Refresh([FromBody] RefreshRequestDto request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            string? refreshTokenCookie = IsMobileClient && !string.IsNullOrEmpty(request.RefreshToken)
                ? request.RefreshToken
                : (Request.Cookies.TryGetValue(AuthCookies.RefreshToken, out var cookieValue) ? cookieValue : null);
            if (string.IsNullOrEmpty(refreshTokenCookie))
            {
                return Unauthorized("Refresh token is invalid or expired — sign in again.");
            }

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == request.AgentId, cancellationToken);
            if (agent == null || !agent.IsActive)
            {
                return Unauthorized("Refresh token is invalid or expired — sign in again.");
            }

            // Scoped to (AgentId, DeviceId) — a session on one device can't be
            // refreshed using a token issued to a different device.
            var session = await _db.AgentRefreshTokens.FirstOrDefaultAsync(
                t => t.AgentId == request.AgentId && t.DeviceId == request.DeviceId, cancellationToken);

            if (session != null && session.RevokedAt != null && !string.IsNullOrEmpty(session.RevokedReason))
            {
                // Tell the device why, so it can show it on the sign-in screen.
                Response.Headers["X-Session-Ended"] = "replaced";
                return Unauthorized(session.RevokedReason);
            }

            if (session == null
                || session.ExpiresAt < DateTime.UtcNow
                || session.TokenHash != HashToken(refreshTokenCookie))
            {
                return Unauthorized("Refresh token is invalid or expired — sign in again.");
            }

            session.DeviceType ??= DeviceKinds.Detect(Request);
            var (newRefreshToken, _) = await IssueRefreshTokenAsync(agent.AgentId, request.DeviceId, cancellationToken); // rotate — the old token can't be reused
            await _db.SaveChangesAsync(cancellationToken);

            string newJwt = GenerateJwt(agent, session);
            SetAuthCookies(newJwt, newRefreshToken);

            return Ok(new
            {
                accessToken = IsMobileClient ? newJwt : null,
                refreshToken = IsMobileClient ? newRefreshToken : null,
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                profileCompleted = agent.ProfileCompleted,
                mustChangePassword = agent.MustChangePassword,
            });
        }

        [HttpPost("logout")]
        [Authorize]
        public async Task<IActionResult> Logout(CancellationToken cancellationToken)
        {
            string? agentId = User.FindFirst("agentId")?.Value;
            string? refreshTokenCookie = Request.Cookies.TryGetValue(AuthCookies.RefreshToken, out var fromCookie) ? fromCookie : null;
            if (IsMobileClient)
            {
                // The phone app sends {"refreshToken": "..."} in the body (it has no cookies).
                try
                {
                    using var doc = await System.Text.Json.JsonDocument.ParseAsync(Request.Body, cancellationToken: cancellationToken);
                    if (doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Object
                        && doc.RootElement.TryGetProperty("refreshToken", out var rt) && rt.ValueKind == System.Text.Json.JsonValueKind.String)
                        refreshTokenCookie = rt.GetString();
                }
                catch (System.Text.Json.JsonException) { /* empty or invalid body: nothing to revoke */ }
            }
            if (!string.IsNullOrEmpty(agentId) && !string.IsNullOrEmpty(refreshTokenCookie))
            {
                // Best-effort: revoke this device's session server-side too, not just
                // the client-side cookies, so the (now-cleared) refresh token can't
                // be replayed by anyone who captured it in transit before this call.
                var hash = HashToken(refreshTokenCookie);
                var session = await _db.AgentRefreshTokens
                    .FirstOrDefaultAsync(t => t.AgentId == agentId && t.TokenHash == hash, cancellationToken);
                var me = await _db.Agents.AsNoTracking().FirstOrDefaultAsync(a => a.AgentId == agentId, cancellationToken);
                if (session != null)
                {
                    // Keep the row (as sign-in history); it just can't be used any more.
                    SessionGuard.End(session, "You signed out.", _cache);
                    if (me != null) _db.AuditLogs.Add(AuthAudit.Event(HttpContext, me, "sign_out", $"Signed out on a {DeviceKinds.Label(session.DeviceType)}", session.DeviceId, session.DeviceType));
                    await _db.SaveChangesAsync(cancellationToken);
                }
            }

            ClearAuthCookies();
            return Ok(new { message = "Logged out." });
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
                .Where(t => t.AgentId == agentId && t.RevokedAt == null)
                .ToListAsync(cancellationToken);
            foreach (var s in existingSessions) SessionGuard.End(s, "Your password was changed. Please sign in with the new password.", _cache);

            await _db.SaveChangesAsync(cancellationToken);

            // This device's own cookies are now for a revoked session too — clear
            // them so the client doesn't keep sending a refresh token that will
            // just fail next time, and force a clean re-login.
            ClearAuthCookies();

            return Ok(new { message = "Password updated." });
        }

        private async Task<(string Token, AgentRefreshToken Session)> IssueRefreshTokenAsync(string agentId, string deviceId, CancellationToken cancellationToken)
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
            session.RevokedAt = null;
            session.RevokedReason = null;
            session.LastSeenAt = DateTime.UtcNow;
            session.Ip = DeviceKinds.Ip(HttpContext);
            var ua = Request.Headers.UserAgent.ToString();
            session.UserAgent = ua.Length > 300 ? ua[..300] : ua;
            SessionGuard.Forget(_cache, session.Id);
            return (token, session);
        }

        private static string HashToken(string token)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
            return Convert.ToHexString(bytes);
        }

        // Secure is tied to the request's actual scheme (via UseForwardedHeaders
        // trusting Caddy's X-Forwarded-Proto), not the environment name — so this
        // correctly requires HTTPS in every deployed environment while still
        // working over plain http://localhost for local `dotnet run`.
        private void SetAuthCookies(string jwt, string refreshToken)
        {
            double.TryParse(_config["Jwt:ExpiryHours"], out var expiryHours);
            if (expiryHours <= 0) expiryHours = 12;

            Response.Cookies.Append(AuthCookies.AccessToken, jwt, new CookieOptions
            {
                HttpOnly = true,
                Secure = Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Path = "/",
                Expires = DateTimeOffset.UtcNow.AddHours(expiryHours),
            });

            Response.Cookies.Append(AuthCookies.RefreshToken, refreshToken, new CookieOptions
            {
                HttpOnly = true,
                Secure = Request.IsHttps,
                SameSite = SameSiteMode.Lax,
                Path = "/api/v1/auth",
                Expires = DateTimeOffset.UtcNow.AddDays(RefreshTokenDays),
            });
        }

        private void ClearAuthCookies()
        {
            Response.Cookies.Delete(AuthCookies.AccessToken, new CookieOptions { Path = "/" });
            Response.Cookies.Delete(AuthCookies.RefreshToken, new CookieOptions { Path = "/api/v1/auth" });
        }

        private string GenerateJwt(FieldAgent agent, AgentRefreshToken session)
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
                // Which session this token belongs to: checked on every request, so a session
                // replaced by a newer sign-in stops working straight away.
                new Claim("sid", session.Id.ToString()),
                new Claim("did", session.DeviceId),
                new Claim("dtype", session.DeviceType ?? DeviceKinds.Desktop),
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
