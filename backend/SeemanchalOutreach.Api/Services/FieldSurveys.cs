using System.Text.Json;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>A question in an occasional field survey. Types: text | number | yesno | choice | multi.</summary>
    public sealed class FieldQuestion
    {
        public string Id { get; set; } = "";
        public string Text { get; set; } = "";
        public string Type { get; set; } = "text";
        public List<string>? Options { get; set; }
        public bool Required { get; set; }
    }

    /// <summary>Shared rules for occasional field surveys: defaults, reading the JSON columns, and route distance.</summary>
    public static class FieldSurveys
    {
        public static readonly string[] DefaultSpotTypes =
        {
            "Chowk", "Crossroad / tiraha", "Banner / hoarding place", "Wall painting place", "Market / haat", "Bus / auto stand",
            "School", "Health centre (PHC / APHC)", "Chemist / medical shop", "Clinic / RMP", "Temple / mosque", "Panchayat bhawan",
            "Bank / CSP", "Other",
        };

        public static readonly string[] DefaultRoadTypes =
        {
            "Highway (NH / SH)", "District road", "Village main road", "Village inner road", "Kacha (mud) road", "Footpath / field track",
        };

        public static readonly string[] QuestionTypes = { "text", "number", "yesno", "choice", "multi" };

        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        public static List<string> Strings(string? json)
        {
            try { return JsonSerializer.Deserialize<List<string>>(json ?? "[]", Json) ?? new(); } catch (JsonException) { return new(); }
        }

        public static List<FieldQuestion> Questions(string? json)
        {
            try { return JsonSerializer.Deserialize<List<FieldQuestion>>(json ?? "[]", Json) ?? new(); } catch (JsonException) { return new(); }
        }

        /// <summary>[[lng,lat], …]</summary>
        public static List<double[]> Area(string? json)
        {
            try { return JsonSerializer.Deserialize<List<double[]>>(json ?? "[]", Json)?.Where(p => p.Length >= 2).ToList() ?? new(); } catch (JsonException) { return new(); }
        }

        /// <summary>[[lat,lng,accuracy,unixMs], …]</summary>
        public static List<double[]> Points(string? json)
        {
            try { return JsonSerializer.Deserialize<List<double[]>>(json ?? "[]", Json)?.Where(p => p.Length >= 4).ToList() ?? new(); } catch (JsonException) { return new(); }
        }

        public static Dictionary<string, JsonElement> Answers(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new();
            try { return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json, Json) ?? new(); } catch (JsonException) { return new(); }
        }

        public static string ToJson(object o) => JsonSerializer.Serialize(o, Json);

        public static double MetersBetween(double lat1, double lng1, double lat2, double lng2)
        {
            const double R = 6371000;
            double rad(double d) => d * Math.PI / 180;
            var dLat = rad(lat2 - lat1);
            var dLng = rad(lng2 - lng1);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(rad(lat1)) * Math.Cos(rad(lat2)) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
            return 2 * R * Math.Asin(Math.Min(1, Math.Sqrt(a)));
        }

        /// <summary>Length of a traced route, skipping GPS jumps (faster than 40 m/s, i.e. 144 km/h).</summary>
        public static double Distance(List<double[]> pts)
        {
            double total = 0;
            for (int i = 1; i < pts.Count; i++)
            {
                var d = MetersBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
                var secs = Math.Max(1, (pts[i][3] - pts[i - 1][3]) / 1000);
                if (d / secs <= 40) total += d;
            }
            return total;
        }

        /// <summary>Every n-th point so a map of many routes stays light; the first and last are always kept.</summary>
        public static List<double[]> Thin(List<double[]> pts, int max = 400)
        {
            if (pts.Count <= max) return pts.Select(p => new[] { Math.Round(p[0], 6), Math.Round(p[1], 6) }).ToList();
            var step = (double)(pts.Count - 1) / (max - 1);
            var outp = new List<double[]>();
            for (int i = 0; i < max; i++) { var p = pts[(int)Math.Round(i * step)]; outp.Add(new[] { Math.Round(p[0], 6), Math.Round(p[1], 6) }); }
            return outp;
        }

        /// <summary>Whether a point is inside the drawn area (ray casting; area is [[lng,lat], …]).</summary>
        public static bool Inside(List<double[]> ring, double lat, double lng)
        {
            if (ring.Count < 3) return true;
            bool inside = false;
            for (int i = 0, j = ring.Count - 1; i < ring.Count; j = i++)
            {
                double xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
                if (((yi > lat) != (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
            }
            return inside;
        }

        public static object Config(FieldSurvey s) => new
        {
            id = s.Id, title = s.Title, instructions = s.Instructions, status = s.Status, dueDate = s.DueDate,
            area = Area(s.AreaJson), spotTypes = Strings(s.SpotTypesJson), roadTypes = Strings(s.RoadTypesJson), questions = Questions(s.QuestionsJson),
        };
    }
}
