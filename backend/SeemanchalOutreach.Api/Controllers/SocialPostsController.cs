using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SocialPostDto
    {
        public string? Channel { get; set; }
        public DateTime? PostedAt { get; set; }
        public string? Text { get; set; }
        public string? MediaType { get; set; }
        public string? Permalink { get; set; }
        public int? Reach { get; set; }
        public int? Views { get; set; }
        public int? Likes { get; set; }
        public int? Comments { get; set; }
        public int? Shares { get; set; }
        public string? Topic { get; set; }
        public string? Note { get; set; }
    }

    /// <summary>
    /// Every post the hospital put out, in one list: Facebook and Instagram (fetched with reach and engagement), WhatsApp
    /// Status / Channel / group posts logged by hand, and WhatsApp broadcasts sent from the CRM (with delivered and read).
    /// </summary>
    [ApiController]
    [Route("api/v1/social/posts")]
    [Authorize]
    [PageAccess(Pages.Social)]
    public class SocialPostsController : ControllerBase
    {
        private static readonly string[] ManualChannels = { "whatsapp_status", "whatsapp_channel", "whatsapp_group", "facebook", "instagram", "other" };
        public static readonly Dictionary<string, string> ChannelLabels = new()
        {
            ["facebook"] = "Facebook", ["instagram"] = "Instagram", ["whatsapp_status"] = "WhatsApp Status", ["whatsapp_channel"] = "WhatsApp Channel",
            ["whatsapp_group"] = "WhatsApp group", ["whatsapp_broadcast"] = "WhatsApp broadcast", ["other"] = "Other",
        };

        private readonly IMarketingDbContext _db;
        private readonly SocialPostsService _posts;
        private readonly IAppSettings _settings;
        public SocialPostsController(IMarketingDbContext db, SocialPostsService posts, IAppSettings settings) { _db = db; _posts = posts; _settings = settings; }

        private sealed record Row(string Id, string Channel, string Source, DateTime PostedAt, string? Text, string? MediaType, string? Permalink, string? Thumb,
            int? Reach, int? Views, int? Likes, int? Comments, int? Shares, int? Saves, int? Clicks, string? Topic, string? Note, DateTime? MetricsAt,
            int? Sent = null, int? Delivered = null, int? Read = null, int? Replies = null)
        {
            public int Engagement => (Likes ?? 0) + (Comments ?? 0) + (Shares ?? 0) + (Saves ?? 0) + (Replies ?? 0);
            /// <summary>The audience number for this kind of post: reach, or views, or (broadcast) people who read it.</summary>
            public int Audience => Reach ?? Views ?? Read ?? 0;
        }

        private async Task<List<Row>> RowsAsync(string? from, string? to, string? channel, string? topic, string? q, CancellationToken ct)
        {
            var f = DateOnly.TryParse(from, out var fd) ? IstClock.StartOfIstDayUtc(fd) : (DateTime?)null;
            var t = DateOnly.TryParse(to, out var td) ? IstClock.StartOfIstDayUtc(td.AddDays(1)) : (DateTime?)null;
            var posts = _db.SocialPosts.AsNoTracking().Where(p => p.Status == "active");
            if (f != null) posts = posts.Where(p => p.PostedAt >= f);
            if (t != null) posts = posts.Where(p => p.PostedAt < t);
            var rows = (await posts.ToListAsync(ct)).Select(p => new Row(p.Id.ToString(), p.Channel, p.Source, p.PostedAt, p.Text, p.MediaType, p.Permalink, p.ThumbnailUrl,
                p.Reach, p.Views, p.Likes, p.Comments, p.Shares, p.Saves, p.Clicks, p.Topic, p.Note, p.MetricsAt)).ToList();

            // WhatsApp broadcasts sent from the CRM are posts too: they show with sent, delivered, read and replies.
            var bq = _db.Broadcasts.AsNoTracking().Where(b => b.Status == "sent" && b.SentAt != null);
            if (f != null) bq = bq.Where(b => b.SentAt >= f);
            if (t != null) bq = bq.Where(b => b.SentAt < t);
            rows.AddRange((await bq.ToListAsync(ct)).Select(b => new Row("b:" + b.Id, "whatsapp_broadcast", "broadcast", b.SentAt!.Value, $"{b.Title}\n{b.PreviewText}".Trim(), "message", null, null,
                null, null, null, null, null, null, null, BroadcastTopic(b.Kind), null, null, b.SentCount, b.DeliveredCount, b.ReadCount, b.ReplyCount)));

            IEnumerable<Row> list = rows;
            if (!string.IsNullOrWhiteSpace(channel))
                list = channel == "whatsapp" ? list.Where(r => r.Channel.StartsWith("whatsapp")) : list.Where(r => r.Channel == channel);
            if (!string.IsNullOrWhiteSpace(topic)) list = topic == "-" ? list.Where(r => r.Topic == null) : list.Where(r => r.Topic == topic);
            if (!string.IsNullOrWhiteSpace(q)) { var s = q.Trim().ToLowerInvariant(); list = list.Where(r => (r.Text ?? "").ToLowerInvariant().Contains(s) || (r.Note ?? "").ToLowerInvariant().Contains(s)); }
            return list.OrderByDescending(r => r.PostedAt).ToList();
        }

        private sealed record Totals(int Posts, int Audience, int Engagement, double AvgEngagement);

        private static string BroadcastTopic(string kind) => kind switch
        {
            "camp_invite" => "Health camp", "doctor_availability" => "Doctor introduction", _ => "Other",
        };

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? channel, [FromQuery] string? topic, [FromQuery] string? q,
            [FromQuery] string? sort, [FromQuery] int page = 1, [FromQuery] int pageSize = 30, CancellationToken ct = default)
        {
            page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 10, 100);
            var rows = await RowsAsync(from, to, channel, topic, q, ct);
            var all = await RowsAsync(from, to, null, null, null, ct); // for the per-channel and per-topic totals
            var sorted = sort switch
            {
                "reach" => rows.OrderByDescending(r => r.Audience).ToList(),
                "engagement" => rows.OrderByDescending(r => r.Engagement).ToList(),
                _ => rows,
            };
            static Totals Totals(IEnumerable<Row> g)
            {
                var l = g.ToList();
                return new Totals(l.Count, l.Sum(r => r.Audience), l.Sum(r => r.Engagement), l.Count == 0 ? 0 : Math.Round(l.Average(r => r.Engagement), 1));
            }
            var departments = await _db.Departments.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Order).Select(d => d.Name).ToListAsync(ct);
            var best = rows.OrderByDescending(r => r.Engagement).FirstOrDefault();
            var synced = _settings.Get(SocialPostsService.SyncedAtKey);
            return Ok(new
            {
                summary = Totals(rows),
                byChannel = all.GroupBy(r => r.Channel.StartsWith("whatsapp") ? "whatsapp" : r.Channel).Select(g => new { channel = g.Key, totals = Totals(g) }),
                byTopic = all.GroupBy(r => r.Topic ?? "-").Select(g => new { topic = g.Key, totals = Totals(g) }).OrderByDescending(x => x.totals.Engagement),
                best = best == null || best.Engagement == 0 ? null : new { id = best.Id, channel = best.Channel, text = best.Text, engagement = best.Engagement, postedAt = best.PostedAt },
                topics = departments.Concat(SocialPostsService.Themes).Distinct(),
                lastSync = DateTime.TryParse(synced, null, System.Globalization.DateTimeStyles.RoundtripKind, out var ls) ? ls : (DateTime?)null,
                total = sorted.Count, page, pageSize,
                items = sorted.Skip((page - 1) * pageSize).Take(pageSize).Select(r => new
                {
                    id = r.Id, channel = r.Channel, channelLabel = ChannelLabels.GetValueOrDefault(r.Channel, r.Channel), source = r.Source, postedAt = r.PostedAt,
                    text = r.Text, mediaType = r.MediaType, permalink = r.Permalink, thumb = r.Thumb,
                    reach = r.Reach, views = r.Views, likes = r.Likes, comments = r.Comments, shares = r.Shares, saves = r.Saves, clicks = r.Clicks,
                    sent = r.Sent, delivered = r.Delivered, read = r.Read, replies = r.Replies, engagement = r.Engagement, topic = r.Topic, note = r.Note, metricsAt = r.MetricsAt,
                }),
            });
        }

        /// <summary>Fetches new Facebook and Instagram posts and fresh numbers for recent ones.</summary>
        [HttpPost("sync")]
        public async Task<IActionResult> Sync(CancellationToken ct)
        {
            var r = await _posts.SyncAsync(ct);
            return Ok(new { added = r.Added, updated = r.Updated, problems = r.Problems });
        }

        private static string? Clean(string? s, int max) { var t = (s ?? "").Trim(); return t.Length == 0 ? null : t.Length > max ? t[..max] : t; }
        private static int? Num(int? n) => n is null ? null : Math.Clamp(n.Value, 0, 100_000_000);

        /// <summary>A post Meta doesn't let software read (WhatsApp Status, Channel or group), or anything else, logged by hand.</summary>
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SocialPostDto dto, CancellationToken ct)
        {
            if (dto.Channel == null || !ManualChannels.Contains(dto.Channel)) return BadRequest(new { message = "Pick where it was posted." });
            var at = dto.PostedAt?.ToUniversalTime() ?? DateTime.UtcNow;
            if (at > DateTime.UtcNow.AddHours(1)) return BadRequest(new { message = "The date can't be in the future." });
            if (string.IsNullOrWhiteSpace(dto.Text) && string.IsNullOrWhiteSpace(dto.Permalink)) return BadRequest(new { message = "Add what the post said, or its link." });
            var p = new SocialPost
            {
                Channel = dto.Channel, Source = "manual", PostedAt = at, Text = Clean(dto.Text, 4000), MediaType = Clean(dto.MediaType, 20), Permalink = Clean(dto.Permalink, 500),
                Views = Num(dto.Views), Reach = Num(dto.Reach), Likes = Num(dto.Likes), Comments = Num(dto.Comments), Shares = Num(dto.Shares),
                Topic = Clean(dto.Topic, 80), Note = Clean(dto.Note, 500), CreatedBy = User.AgentIdOf(), MetricsAt = DateTime.UtcNow,
            };
            _db.SocialPosts.Add(p);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = p.Id });
        }

        /// <summary>Posts logged by hand can be fully edited (e.g. views a day later); fetched posts only take a topic and a note.</summary>
        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] SocialPostDto dto, CancellationToken ct)
        {
            var p = await _db.SocialPosts.FirstOrDefaultAsync(x => x.Id == id && x.Status == "active", ct);
            if (p == null) return NotFound();
            p.Topic = Clean(dto.Topic, 80);
            p.Note = Clean(dto.Note, 500);
            if (p.Source == "manual")
            {
                if (dto.Channel != null && ManualChannels.Contains(dto.Channel)) p.Channel = dto.Channel;
                if (dto.PostedAt != null && dto.PostedAt.Value.ToUniversalTime() <= DateTime.UtcNow.AddHours(1)) p.PostedAt = dto.PostedAt.Value.ToUniversalTime();
                p.Text = Clean(dto.Text, 4000) ?? p.Text; p.Permalink = Clean(dto.Permalink, 500); p.MediaType = Clean(dto.MediaType, 20);
                p.Views = Num(dto.Views); p.Reach = Num(dto.Reach); p.Likes = Num(dto.Likes); p.Comments = Num(dto.Comments); p.Shares = Num(dto.Shares);
                p.MetricsAt = DateTime.UtcNow;
            }
            p.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Takes a post logged by mistake out of the list (kept, marked removed).</summary>
        [HttpPost("{id:guid}/remove")]
        public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
        {
            var p = await _db.SocialPosts.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound();
            if (p.Source != "manual") return BadRequest(new { message = "Posts fetched from Facebook or Instagram come back on the next fetch. Delete them on Facebook or Instagram instead." });
            p.Status = "removed"; p.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpGet("export.csv")]
        public async Task<IActionResult> Export([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? channel, [FromQuery] string? topic, [FromQuery] string? q, CancellationToken ct)
        {
            var rows = await RowsAsync(from, to, channel, topic, q, ct);
            static string c(string? v) => "\"" + (v ?? "").Replace("\"", "\"\"").Replace("\r", " ").Replace("\n", " ") + "\"";
            static string n(int? v) => v?.ToString() ?? "";
            var sb = new StringBuilder("Date,Where,Topic,Text,Reach,Views,Likes,Comments,Shares,Saves,Clicks,Sent,Delivered,Read,Replies,Engagement,Link\n");
            foreach (var r in rows)
                sb.Append(string.Join(",", c((r.PostedAt + IstClock.Offset).ToString("yyyy-MM-dd HH:mm")), c(ChannelLabels.GetValueOrDefault(r.Channel, r.Channel)), c(r.Topic), c(r.Text),
                    n(r.Reach), n(r.Views), n(r.Likes), n(r.Comments), n(r.Shares), n(r.Saves), n(r.Clicks), n(r.Sent), n(r.Delivered), n(r.Read), n(r.Replies), r.Engagement.ToString(), c(r.Permalink))).Append('\n');
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", "posts.csv");
        }
    }
}
