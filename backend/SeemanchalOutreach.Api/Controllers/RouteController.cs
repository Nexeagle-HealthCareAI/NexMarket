using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// A road route for the agent app's in-app navigation. The phone sends where it is and where it is going;
    /// nothing is stored. When no road route can be found the app falls back to a straight line and a compass direction.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/route")]
    public class RouteController : ControllerBase
    {
        private readonly RoutingService _routing;
        private readonly IMemoryCache _cache;
        public RouteController(RoutingService routing, IMemoryCache cache) { _routing = routing; _cache = cache; }

        private static bool Valid(double lat, double lng) => lat is > 5 and < 38 && lng is > 65 and < 100; // India and around

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] double fromLat, [FromQuery] double fromLng, [FromQuery] double toLat, [FromQuery] double toLng,
            [FromQuery] string? profile, CancellationToken ct)
        {
            if (!Valid(fromLat, fromLng) || !Valid(toLat, toLng)) return BadRequest(new { message = "Those places aren't in the area we cover." });

            // A fair limit per person, so a phone stuck in a loop can't use up the routing server.
            var me = User.AgentIdOf();
            var rk = $"route-rate|{me}|{DateTime.UtcNow:yyyyMMddHHmm}";
            var n = _cache.GetOrCreate(rk, e => { e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2); return 0; });
            if (n >= 20) return StatusCode(429, new { message = "Too many route requests. Try again in a minute." });
            _cache.Set(rk, n + 1, TimeSpan.FromMinutes(2));

            var route = await _routing.GetAsync(fromLat, fromLng, toLat, toLng, profile ?? "car", ct);
            if (route == null) return Ok(new { ok = false, message = "No road route found right now." });
            return Ok(new
            {
                ok = true,
                profile = route.Profile,
                distanceM = route.DistanceM,
                durationS = route.DurationS,
                coords = route.Coords,
                steps = route.Steps.Select(s => new { type = s.Type, modifier = s.Modifier, name = s.Name, exit = s.Exit, distanceM = s.DistanceM, durationS = s.DurationS, lat = s.Lat, lng = s.Lng }),
                source = "© OpenStreetMap contributors",
            });
        }
    }
}
