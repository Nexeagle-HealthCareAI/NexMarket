using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Brings the hospital's Facebook Page posts and Instagram posts into the CRM with their reach and engagement, so every
    /// post is tracked in one place. Uses the Page connection made in Social → Setup. New posts are added; posts from the
    /// last 60 days get fresh numbers on every fetch. Needs the Page token to have pages_read_engagement and read_insights,
    /// and instagram_basic + instagram_manage_insights for Instagram.
    /// </summary>
    public class SocialPostsService
    {
        public const string SyncedAtKey = "social.postsSyncedAt";
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly MetaGraph _graph;
        private readonly ILogger<SocialPostsService> _log;

        public SocialPostsService(IMarketingDbContext db, IAppSettings settings, MetaGraph graph, ILogger<SocialPostsService> log)
        {
            _db = db; _settings = settings; _graph = graph; _log = log;
        }

        public static readonly string[] Themes = { "Health camp", "Doctor introduction", "Awareness", "Patient story", "Offer or package", "Festival or greeting", "Hospital facilities", "Other" };

        public sealed record SyncResult(int Added, int Updated, List<string> Problems);

        public async Task<SyncResult> SyncAsync(CancellationToken ct)
        {
            var cfg = MetaConfig.Load(_settings);
            var problems = new List<string>();
            if (!cfg.PageConnected) return new SyncResult(0, 0, new() { "Facebook isn't connected yet (Social → Setup)." });

            var last = await _db.SocialPosts.Where(p => p.Source == "synced").MaxAsync(p => (DateTime?)p.PostedAt, ct);
            // First time: a year back. After that: a week before the newest post we have, to catch late edits.
            var since = (last ?? DateTime.UtcNow.AddDays(-365)).AddDays(-7);
            var departments = await _db.Departments.AsNoTracking().Where(d => d.IsActive).Select(d => d.Name).ToListAsync(ct);
            int added = 0, updated = 0;

            var existing = await _db.SocialPosts.Where(p => p.Source == "synced" && p.PostedAt >= since.AddDays(-60)).ToListAsync(ct);
            SocialPost Upsert(string channel, string externalId, DateTime postedAt)
            {
                var row = existing.FirstOrDefault(x => x.Channel == channel && x.ExternalId == externalId)
                    ?? _db.SocialPosts.Local.FirstOrDefault(x => x.Channel == channel && x.ExternalId == externalId);
                if (row != null) { updated++; return row; }
                row = new SocialPost { Channel = channel, ExternalId = externalId, Source = "synced", PostedAt = postedAt, CreatedBy = "meta" };
                _db.SocialPosts.Add(row); existing.Add(row); added++;
                return row;
            }

            // ─── Facebook Page ───
            var after = (string?)null;
            for (int page = 0; page < 20; page++)
            {
                var path = $"{cfg.PageId}/published_posts?fields=id,message,created_time,permalink_url,full_picture,status_type,attachments{{media_type}}," +
                           "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" +
                           $"&since={new DateTimeOffset(since).ToUnixTimeSeconds()}&limit=50" + (after != null ? $"&after={Uri.EscapeDataString(after)}" : "");
                var (ok, doc, err) = await _graph.GetAsync(cfg.ApiVersion, path, cfg.PageToken, ct);
                if (!ok || doc == null) { problems.Add($"Facebook posts: {err}"); break; }
                using (doc)
                {
                    foreach (var p in Arr(doc.RootElement, "data"))
                    {
                        var id = MetaService.Str(p, "id"); var at = Date(p, "created_time");
                        if (id == null || at == null) continue;
                        var row = Upsert("facebook", id, at.Value);
                        row.Text = Trim(MetaService.Str(p, "message"));
                        row.Permalink = MetaService.Str(p, "permalink_url");
                        row.ThumbnailUrl = MetaService.Str(p, "full_picture");
                        row.MediaType = FbType(p);
                        row.Likes = Count(p, "reactions"); row.Comments = Count(p, "comments");
                        row.Shares = p.TryGetProperty("shares", out var sh) && sh.TryGetProperty("count", out var sc) ? sc.GetInt32() : 0;
                        row.Topic ??= Guess(row.Text, departments);
                        row.UpdatedAt = DateTime.UtcNow;
                    }
                    after = Next(doc.RootElement);
                }
                if (after == null) break;
            }

            // ─── Instagram ───
            if (!string.IsNullOrWhiteSpace(cfg.IgId))
            {
                after = null;
                for (int page = 0; page < 20; page++)
                {
                    var path = $"{cfg.IgId}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=50"
                               + (after != null ? $"&after={Uri.EscapeDataString(after)}" : "");
                    var (ok, doc, err) = await _graph.GetAsync(cfg.ApiVersion, path, cfg.PageToken, ct);
                    if (!ok || doc == null) { problems.Add($"Instagram posts: {err}"); break; }
                    var older = false;
                    using (doc)
                    {
                        foreach (var m in Arr(doc.RootElement, "data"))
                        {
                            var id = MetaService.Str(m, "id"); var at = Date(m, "timestamp");
                            if (id == null || at == null) continue;
                            if (at < since) { older = true; continue; }
                            var row = Upsert("instagram", id, at.Value);
                            row.Text = Trim(MetaService.Str(m, "caption"));
                            row.Permalink = MetaService.Str(m, "permalink");
                            var type = MetaService.Str(m, "media_type");
                            row.MediaType = MetaService.Str(m, "media_product_type") == "REELS" ? "reel" : type switch { "VIDEO" => "video", "CAROUSEL_ALBUM" => "carousel", _ => "photo" };
                            row.ThumbnailUrl = MetaService.Str(m, "thumbnail_url") ?? (type == "IMAGE" || type == "CAROUSEL_ALBUM" ? MetaService.Str(m, "media_url") : null);
                            row.Likes = m.TryGetProperty("like_count", out var lc) ? lc.GetInt32() : row.Likes;
                            row.Comments = m.TryGetProperty("comments_count", out var cc) ? cc.GetInt32() : row.Comments;
                            row.Topic ??= Guess(row.Text, departments);
                            row.UpdatedAt = DateTime.UtcNow;
                        }
                        after = older ? null : Next(doc.RootElement);
                    }
                    if (after == null) break;
                }
            }

            // ─── Fresh reach and views for recent posts ───
            var fresh = DateTime.UtcNow.AddDays(-60);
            var stale = DateTime.UtcNow.AddHours(-6);
            foreach (var row in existing.Where(r => r.PostedAt >= fresh && (r.MetricsAt == null || r.MetricsAt < stale)).OrderByDescending(r => r.PostedAt).Take(150))
            {
                var m = row.Channel == "facebook"
                    ? await InsightsAsync(cfg, row.ExternalId!, new[] { "post_impressions_unique", "post_clicks", "post_media_view" }, ct)
                    : await InsightsAsync(cfg, row.ExternalId!, row.MediaType is "reel" or "video" ? new[] { "reach", "saved", "shares", "views" } : new[] { "reach", "saved", "shares", "views" }, ct);
                if (m.Count == 0) continue;
                if (row.Channel == "facebook")
                {
                    row.Reach = m.GetValueOrDefault("post_impressions_unique", row.Reach ?? 0);
                    row.Clicks = m.GetValueOrDefault("post_clicks", row.Clicks ?? 0);
                    if (m.TryGetValue("post_media_view", out var v)) row.Views = v;
                }
                else
                {
                    row.Reach = m.GetValueOrDefault("reach", row.Reach ?? 0);
                    if (m.TryGetValue("saved", out var s)) row.Saves = s;
                    if (m.TryGetValue("shares", out var sh)) row.Shares = sh;
                    if (m.TryGetValue("views", out var v)) row.Views = v;
                }
                row.MetricsAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync(ct);
            await _settings.SetAsync(new Dictionary<string, string?> { [SyncedAtKey] = DateTime.UtcNow.ToString("o") }, Array.Empty<string>(), "meta", ct);
            if (problems.Count > 0) _log.LogWarning("Social post sync: {Problems}", string.Join("; ", problems));
            return new SyncResult(added, updated - Math.Min(updated, added), problems);
        }

        /// <summary>Asks for all metrics at once; if Meta refuses (one isn't available for this post), asks one by one.</summary>
        private async Task<Dictionary<string, int>> InsightsAsync(MetaConfig cfg, string id, string[] metrics, CancellationToken ct)
        {
            var got = await OneAsync(string.Join(",", metrics));
            if (got != null) return got;
            var all = new Dictionary<string, int>();
            foreach (var m in metrics) { var one = await OneAsync(m); if (one != null) foreach (var kv in one) all[kv.Key] = kv.Value; }
            return all;

            async Task<Dictionary<string, int>?> OneAsync(string list)
            {
                var (ok, doc, _) = await _graph.GetAsync(cfg.ApiVersion, $"{id}/insights?metric={list}", cfg.PageToken, ct);
                if (!ok || doc == null) return null;
                using (doc)
                {
                    var d = new Dictionary<string, int>();
                    foreach (var x in Arr(doc.RootElement, "data"))
                    {
                        var name = MetaService.Str(x, "name");
                        if (name == null) continue;
                        // Instagram: { values: [{ value }] } or { total_value: { value } }; Facebook: { values: [{ value }] }.
                        if (x.TryGetProperty("values", out var vals) && vals.ValueKind == JsonValueKind.Array && vals.GetArrayLength() > 0
                            && vals[0].TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.Number) d[name] = v.GetInt32();
                        else if (x.TryGetProperty("total_value", out var tv) && tv.TryGetProperty("value", out var v2) && v2.ValueKind == JsonValueKind.Number) d[name] = v2.GetInt32();
                    }
                    return d;
                }
            }
        }

        private static IEnumerable<JsonElement> Arr(JsonElement e, string name) =>
            e.TryGetProperty(name, out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : Enumerable.Empty<JsonElement>();
        private static DateTime? Date(JsonElement e, string name) =>
            MetaService.Str(e, name) is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d.UtcDateTime : null;
        private static int Count(JsonElement e, string name) =>
            e.TryGetProperty(name, out var r) && r.TryGetProperty("summary", out var s) && s.TryGetProperty("total_count", out var n) ? n.GetInt32() : 0;
        private static string? Next(JsonElement root) =>
            root.TryGetProperty("paging", out var p) && p.TryGetProperty("next", out _) && p.TryGetProperty("cursors", out var c) ? MetaService.Str(c, "after") : null;
        private static string? Trim(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Length > 4000 ? s[..4000] : s;
        private static string FbType(JsonElement p)
        {
            var t = p.TryGetProperty("attachments", out var a) && a.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Array && d.GetArrayLength() > 0
                ? MetaService.Str(d[0], "media_type") : null;
            return t switch { "photo" => "photo", "video" => "video", "album" => "carousel", "link" => "link", _ => MetaService.Str(p, "status_type") == "added_video" ? "video" : "text" };
        }

        /// <summary>A first guess at what the post was about, from department names and a few common words. Can be changed by hand.</summary>
        public static string? Guess(string? text, IEnumerable<string> departments)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var t = text.ToLowerInvariant();
            foreach (var d in departments) if (d.Length >= 4 && t.Contains(d.ToLowerInvariant())) return d;
            if (t.Contains("camp") || t.Contains("शिविर") || t.Contains("कैंप")) return "Health camp";
            if (t.Contains("dr.") || t.Contains("doctor") || t.Contains("डॉक्टर") || t.Contains("डॉ")) return "Doctor introduction";
            if (t.Contains("diwali") || t.Contains("eid") || t.Contains("chhath") || t.Contains("holi") || t.Contains("दीपावली") || t.Contains("ईद") || t.Contains("छठ") || t.Contains("होली")) return "Festival or greeting";
            if (t.Contains("ayushman") || t.Contains("package") || t.Contains("free ") || t.Contains("discount") || t.Contains("आयुष्मान")) return "Offer or package";
            return null;
        }
    }
}
