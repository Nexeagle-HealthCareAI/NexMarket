using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

namespace SeemanchalOutreach.Api.Controllers
{
    public class PushTokenDto
    {
        public string Token { get; set; } = string.Empty;
        public DateTime ExpiresAt { get; set; }
    }

    /// <summary>
    /// Web-push subscriptions are stored by the Next.js app (src/app/api/notifications/
    /// subscribe), which runs on a different origin from this API and so never sees the
    /// httpOnly auth cookies. Instead of trusting a client-supplied agentId, the browser
    /// first asks this (authenticated) endpoint for a short-lived token signed with a
    /// secret shared only between the two servers (Push:TokenSecret here,
    /// PUSH_TOKEN_SECRET in the web app). The web app verifies the signature and takes
    /// the agentId from the token — so an agent can only register a subscription for
    /// themselves.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class NotificationsController : ControllerBase
    {
        private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(10);
        private readonly IConfiguration _config;

        public NotificationsController(IConfiguration config)
        {
            _config = config;
        }

        [HttpGet("push-token")]
        public ActionResult<PushTokenDto> GetPushToken()
        {
            var secret = _config["Push:TokenSecret"];
            if (string.IsNullOrEmpty(secret) || secret.Length < 32)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    "Push notifications are not configured on the server.");
            }

            var agentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();

            var expiresAt = DateTime.UtcNow.Add(TokenLifetime);
            var payloadJson = JsonSerializer.Serialize(new
            {
                agentId,
                exp = new DateTimeOffset(expiresAt).ToUnixTimeSeconds(),
            });
            var payloadPart = Base64Url(Encoding.UTF8.GetBytes(payloadJson));

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var signaturePart = Base64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadPart)));

            return Ok(new PushTokenDto
            {
                Token = $"{payloadPart}.{signaturePart}",
                ExpiresAt = expiresAt,
            });
        }

        private static string Base64Url(byte[] bytes) =>
            Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
