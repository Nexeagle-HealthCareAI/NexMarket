using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class DirectionsDto
    {
        public double DistanceMeters { get; set; }
        public double DurationSeconds { get; set; }
        // [lng, lat] pairs, GeoJSON-order — matches what a MapLibre GeoJSON
        // LineString source expects with no reshaping on the client.
        public double[][] Geometry { get; set; } = System.Array.Empty<double[]>();
    }

    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class RoutingController : ControllerBase
    {
        private readonly IDirectionsService _directionsService;

        public RoutingController(IDirectionsService directionsService)
        {
            _directionsService = directionsService;
        }

        // Any authenticated agent (not admin-only) — this drives the "route to
        // this panchayat" feature on My Task, which every field agent uses.
        [HttpGet("directions")]
        public async Task<ActionResult<DirectionsDto>> GetDirections(
            [FromQuery] double fromLat, [FromQuery] double fromLng,
            [FromQuery] double toLat, [FromQuery] double toLng,
            CancellationToken cancellationToken)
        {
            if (fromLat is < -90 or > 90 || toLat is < -90 or > 90 || fromLng is < -180 or > 180 || toLng is < -180 or > 180)
            {
                return BadRequest("Coordinates out of range.");
            }

            var route = await _directionsService.GetRouteAsync(fromLat, fromLng, toLat, toLng, cancellationToken);
            if (route == null)
            {
                // Not a 500 — "no route available right now" is an expected,
                // fairly common outcome (offline, provider hiccup, no
                // driveable path), and the client already knows to fall back
                // to a straight-line estimate for it.
                return NotFound("No route available.");
            }

            return Ok(new DirectionsDto
            {
                DistanceMeters = route.DistanceMeters,
                DurationSeconds = route.DurationSeconds,
                Geometry = route.Geometry.Select(p => new[] { p.Lng, p.Lat }).ToArray(),
            });
        }
    }
}
