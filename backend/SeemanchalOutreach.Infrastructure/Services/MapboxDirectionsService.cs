using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Infrastructure.Services
{
    // The map itself already runs on Mapbox tiles (NEXT_PUBLIC_MAPBOX_TOKEN on the
    // frontend) — this reuses the same Mapbox account for routing rather than
    // introducing a second provider, via a separate server-side config key
    // (Mapbox:AccessToken) so it's never bundled into client JS the way the
    // tile token is.
    //
    // Caching lives here (not in the controller) — it's an infrastructure
    // concern about this specific upstream provider, not a request-handling
    // concern. A field agent's GPS position drifts a few meters between
    // fixes even standing still, and a panchayat is a fixed destination, so
    // rounding the "from" point to a coarse grid turns what would otherwise
    // be near-constant cache misses into real, meaningful reuse.
    public class MapboxDirectionsService : IDirectionsService
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IMemoryCache _cache;
        private readonly string _accessToken;
        private readonly ILogger<MapboxDirectionsService> _logger;
        private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(15);

        public MapboxDirectionsService(IHttpClientFactory httpClientFactory, IMemoryCache cache, IConfiguration configuration, ILogger<MapboxDirectionsService> logger)
        {
            _httpClientFactory = httpClientFactory;
            _cache = cache;
            _accessToken = configuration["Mapbox:AccessToken"] ?? string.Empty;
            _logger = logger;
        }

        public async Task<RouteResult?> GetRouteAsync(double fromLat, double fromLng, double toLat, double toLng, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(_accessToken))
            {
                _logger.LogWarning("Mapbox:AccessToken is not configured — routing is unavailable.");
                return null;
            }

            // ~100-150m grid — coarse enough to absorb GPS jitter and repeated
            // requests as an agent re-opens the panchayat they're routing to,
            // fine enough that the cached route is still a reasonable preview.
            string cacheKey = string.Format(
                CultureInfo.InvariantCulture,
                "directions:{0:F3},{1:F3}->{2:F3},{3:F3}",
                fromLat, fromLng, toLat, toLng);

            if (_cache.TryGetValue(cacheKey, out RouteResult? cached))
            {
                return cached;
            }

            var result = await FetchRouteFromMapboxAsync(fromLat, fromLng, toLat, toLng, cancellationToken);

            // Cache misses (provider down, no route) too, just for a shorter
            // window — otherwise a single Mapbox outage means every request in
            // its wake re-hits the upstream API instead of failing fast.
            _cache.Set(cacheKey, result, result != null ? CacheTtl : TimeSpan.FromMinutes(1));
            return result;
        }

        private async Task<RouteResult?> FetchRouteFromMapboxAsync(double fromLat, double fromLng, double toLat, double toLng, CancellationToken cancellationToken)
        {
            var inv = CultureInfo.InvariantCulture;
            string coords = string.Format(inv, "{0},{1};{2},{3}", fromLng, fromLat, toLng, toLat);
            string url = $"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}" +
                         $"?geometries=geojson&overview=full&access_token={Uri.EscapeDataString(_accessToken)}";

            try
            {
                var client = _httpClientFactory.CreateClient("mapbox");
                using var response = await client.GetAsync(url, cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Mapbox Directions request failed with status {Status}", response.StatusCode);
                    return null;
                }

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                var root = doc.RootElement;

                if (!root.TryGetProperty("routes", out var routes) || routes.ValueKind != JsonValueKind.Array || routes.GetArrayLength() == 0)
                {
                    return null;
                }

                var route = routes[0];
                double distance = route.GetProperty("distance").GetDouble();
                double duration = route.GetProperty("duration").GetDouble();

                var geometry = new List<(double Lng, double Lat)>();
                if (route.TryGetProperty("geometry", out var geom) && geom.TryGetProperty("coordinates", out var coordsArr))
                {
                    foreach (var pt in coordsArr.EnumerateArray())
                    {
                        geometry.Add((pt[0].GetDouble(), pt[1].GetDouble()));
                    }
                }

                return new RouteResult(distance, duration, geometry);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
            {
                // Network blip / Mapbox outage / malformed response — the caller
                // treats a null result as "fall back to a straight-line estimate",
                // so this is never a hard failure for the agent.
                _logger.LogWarning(ex, "Mapbox Directions request errored.");
                return null;
            }
        }
    }
}
