using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Services;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// Where Meta sends Facebook Page and Instagram events: Lead Ads forms (leadgen) and messages. Each delivery is
    /// checked against the app secret before anything is read.
    /// </summary>
    [ApiController]
    [Route("api/v1/meta/webhook")]
    [AllowAnonymous]
    public class MetaWebhookController : ControllerBase
    {
        private readonly MetaService _meta;

        public MetaWebhookController(MetaService meta)
        {
            _meta = meta;
        }

        [HttpGet]
        public IActionResult Verify([FromQuery(Name = "hub.mode")] string? mode, [FromQuery(Name = "hub.verify_token")] string? token, [FromQuery(Name = "hub.challenge")] string? challenge)
        {
            var expected = _meta.Config.VerifyToken;
            if (mode == "subscribe" && !string.IsNullOrEmpty(expected) && token == expected) return Content(challenge ?? "", "text/plain");
            return Forbid();
        }

        [HttpPost]
        public async Task<IActionResult> Receive(CancellationToken ct)
        {
            string body;
            using (var reader = new StreamReader(Request.Body, Encoding.UTF8)) body = await reader.ReadToEndAsync(ct);
            if (body.Length > 1_000_000) return BadRequest();

            var secret = _meta.Config.AppSecret;
            if (string.IsNullOrEmpty(secret)) return Unauthorized();
            var signature = Request.Headers["X-Hub-Signature-256"].ToString();
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
            {
                var expected = "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
                if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature))) return Unauthorized();
            }

            JsonDocument doc;
            try { doc = JsonDocument.Parse(body); } catch (JsonException) { return BadRequest(); }
            using (doc) await _meta.HandleWebhookAsync(doc.RootElement, ct);
            // Always 200 once the signature is good, so Meta doesn't keep retrying events we chose to skip.
            return Ok();
        }
    }
}
