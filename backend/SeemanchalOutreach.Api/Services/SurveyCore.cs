using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>Helpers shared by everything that reads survey answers.</summary>
    public static class SurveyCore
    {
        public const int AskedCount = 6;

        /// <summary>The questions the app asks right now, in order.</summary>
        public static Task<List<SurveyQuestion>> ActiveAsync(IMarketingDbContext db, CancellationToken ct) =>
            db.SurveyQuestions.AsNoTracking().Where(q => q.IsActive).OrderBy(q => q.Order).ToListAsync(ct);

        /// <summary>Short title for reports: a known name for the core six, else the English part of the question.</summary>
        public static string Title(SurveyQuestion q)
        {
            var known = Controllers.GeoController.ShortTitle(q.QuestionId);
            if (known != q.QuestionId) return known;
            var m = Regex.Match(q.Text ?? "", @"\(([^()]{6,})\)\s*\??\s*$");
            var t = m.Success ? m.Groups[1].Value.Trim() : (q.Text ?? q.QuestionId);
            t = t.TrimEnd('?', ' ');
            return t.Length > 70 ? t[..67] + "…" : t;
        }

        public static List<string> Options(SurveyQuestion q)
        {
            try { return q.OptionsJson == null ? new() : JsonSerializer.Deserialize<List<string>>(q.OptionsJson) ?? new(); }
            catch (JsonException) { return new(); }
        }

        public static Dictionary<string, JsonElement> Parse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new();
            try { return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json) ?? new(); }
            catch (JsonException) { return new(); }
        }

        /// <summary>An answer as a list of strings (multi-choice answers may be an array or one comma-joined string).</summary>
        public static List<string> Values(JsonElement el, List<string> options)
        {
            if (el.ValueKind == JsonValueKind.Array) return el.EnumerateArray().Select(x => x.ToString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            var text = el.ToString();
            if (string.IsNullOrWhiteSpace(text)) return new();
            // Options can contain commas themselves, so match known options before splitting.
            var hits = options.Where(o => o != "Other" && text.Contains(o, StringComparison.Ordinal)).ToList();
            if (hits.Count > 0)
            {
                var rest = text;
                foreach (var h in hits) rest = rest.Replace(h, "");
                var other = rest.Split(',').Select(x => x.Trim()).FirstOrDefault(x => x.StartsWith("Other", StringComparison.Ordinal));
                if (other != null) hits.Add(other);
                return hits;
            }
            return new List<string> { text.Trim() };
        }

        /// <summary>The bucket an answer counts under: the option it matches, or "Other: …".</summary>
        public static string Bucket(string value, List<string> options)
        {
            var o = options.FirstOrDefault(x => x == value) ?? options.FirstOrDefault(x => x != "Other" && value.StartsWith(x, StringComparison.Ordinal));
            if (o != null) return o;
            return value.StartsWith("Other", StringComparison.Ordinal) ? "Other" : value;
        }

        /// <summary>True when the response answers at least one of the given questions.</summary>
        public static bool Answers(Dictionary<string, JsonElement> a, IEnumerable<string> qids) =>
            qids.Any(id => a.TryGetValue(id, out var el) && !string.IsNullOrWhiteSpace(el.ToString()));
    }
}
