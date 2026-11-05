using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Road routes for in-app navigation, from an OSRM server (by default the free OpenStreetMap one run by FOSSGIS,
    /// https://routing.openstreetmap.de). Set Routing:BaseUrl to use another OSRM server (e.g. your own) with the same API.
    /// Routes are cached for a few minutes so a team asking for the same trip doesn't hit the server again.
    /// </summary>
    public class RoutingService
    {
        public sealed record Step(string Type, string? Modifier, string? Name, int? Exit, double DistanceM, double DurationS, double Lat, double Lng);
        public sealed record Route(string Profile, double DistanceM, double DurationS, List<double[]> Coords, List<Step> Steps);

        private readonly IHttpClientFactory _http;
        private readonly IMemoryCache _cache;
        private readonly IConfiguration _config;
        private readonly ILogger<RoutingService> _log;

        public RoutingService(IHttpClientFactory http, IMemoryCache cache, IConfiguration config, ILogger<RoutingService> log)
        {
            _http = http; _cache = cache; _config = config; _log = log;
        }

        /// <summary>car (also motorbike), bike or foot.</summary>
        public static string Profile(string? p) => p is "bike" or "foot" ? p : "car";

        private string BaseFor(string profile)
        {
            var custom = _config[$"Routing:BaseUrl:{profile}"] ?? (profile == "car" ? _config["Routing:BaseUrl"] : null);
            if (!string.IsNullOrWhiteSpace(custom)) return custom.TrimEnd('/');
            return $"https://routing.openstreetmap.de/routed-{profile}";
        }

        public async Task<Route?> GetAsync(double fromLat, double fromLng, double toLat, double toLng, string profile, CancellationToken ct)
        {
            profile = Profile(profile);
            // About 20 m of rounding: a moving phone asking again a few seconds later reuses the same route.
            string r(double v) => Math.Round(v, 4).ToString(CultureInfo.InvariantCulture);
            var key = $"route|{profile}|{r(fromLat)},{r(fromLng)}|{r(toLat)},{r(toLng)}";
            if (_cache.TryGetValue(key, out Route? hit)) return hit;

            var c = CultureInfo.InvariantCulture;
            var url = $"{BaseFor(profile)}/route/v1/driving/{fromLng.ToString(c)},{fromLat.ToString(c)};{toLng.ToString(c)},{toLat.ToString(c)}" +
                      "?overview=full&geometries=geojson&steps=true&alternatives=false";
            try
            {
                var client = _http.CreateClient("routing");
                using var res = await client.GetAsync(url, ct);
                if (!res.IsSuccessStatusCode) { _log.LogWarning("Routing server answered {Status}", (int)res.StatusCode); return null; }
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct));
                var root = doc.RootElement;
                if (root.GetProperty("code").GetString() != "Ok" || root.GetProperty("routes").GetArrayLength() == 0) return null;
                var rt = root.GetProperty("routes")[0];
                var coords = rt.GetProperty("geometry").GetProperty("coordinates").EnumerateArray()
                    .Select(p => new[] { Math.Round(p[1].GetDouble(), 6), Math.Round(p[0].GetDouble(), 6) }).ToList();
                var steps = new List<Step>();
                foreach (var leg in rt.GetProperty("legs").EnumerateArray())
                    foreach (var s in leg.GetProperty("steps").EnumerateArray())
                    {
                        var m = s.GetProperty("maneuver");
                        var loc = m.GetProperty("location");
                        steps.Add(new Step(
                            m.GetProperty("type").GetString() ?? "continue",
                            m.TryGetProperty("modifier", out var mod) ? mod.GetString() : null,
                            s.TryGetProperty("name", out var nm) && nm.GetString() is { Length: > 0 } n ? n : null,
                            m.TryGetProperty("exit", out var ex) && ex.ValueKind == JsonValueKind.Number ? ex.GetInt32() : null,
                            Math.Round(s.GetProperty("distance").GetDouble()), Math.Round(s.GetProperty("duration").GetDouble()),
                            loc[1].GetDouble(), loc[0].GetDouble()));
                    }
                var route = new Route(profile, Math.Round(rt.GetProperty("distance").GetDouble()), Math.Round(rt.GetProperty("duration").GetDouble()), coords, steps);
                _cache.Set(key, route, TimeSpan.FromMinutes(10));
                return route;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
            {
                _log.LogWarning(e, "Routing failed");
                return null;
            }
        }
    }
}
