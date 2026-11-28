using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Where each lead came from, kept as touches: every time a lead reaches the hospital carrying a code, from an ad, by
    /// replying to a broadcast, from a website page, through a partner or a camp, or by telling the desk. The first touch
    /// is marked; the lead's own Source stays as it always was, for the existing reports.
    ///
    /// Content (a reel, post, story, ad, template, page or poster) lives in tracked_links with its code; a touch points
    /// at it, so leads, patients and cost add up per piece of content.
    /// </summary>
    public static class Attribution
    {
        public static readonly string[] Kinds = { "place", "reel", "post", "story", "ad", "template", "page", "poster", "video" };
        public static readonly string[] Channels = { "whatsapp", "instagram", "facebook", "web", "form", "call", "walk_in", "camp", "partner" };

        /// <summary>Code prefix for a kind of content: reel RL, post PS, story ST, ad AD, template TP, page WB, poster PST, video VD.</summary>
        public static string? Prefix(string kind) => kind switch
        {
            "reel" => "RL", "post" => "PS", "story" => "ST", "ad" => "AD", "template" => "TP", "page" => "WB", "poster" => "PST", "video" => "VD", _ => null,
        };

        private static readonly HashSet<string> Filler = new(StringComparer.Ordinal) { "THE", "AND", "OF", "AT", "IN", "FOR", "A", "TO", "KA", "KI", "KE", "SE", "ME", "REEL", "POST", "STORY", "AD", "VIDEO" };

        /// <summary>RL-STONE-03: the kind's prefix, a word from the topic or name, and the next free number.</summary>
        public static string ContentCode(string kind, string? topic, string name, Func<string, bool> taken)
        {
            var prefix = Prefix(kind) ?? "LNK";
            var words = Regex.Replace(((topic ?? "") + " " + name).ToUpperInvariant(), @"[^A-Z0-9 ]", " ")
                .Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !Filler.Contains(w) && w.Length >= 3).ToList();
            var word = words.FirstOrDefault() ?? "GEN";
            if (word.Length > 7) word = word[..7];
            for (int i = 1; i < 1000; i++)
            {
                var c = $"{prefix}-{word}-{i:D2}";
                if (c.Length > 16) c = c[..16];
                if (!taken(c)) return c;
            }
            return $"{prefix}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}";
        }

        /// <summary>
        /// The line to end a caption or post with, so people who message carry the code: Hindi first, then English.
        /// </summary>
        public static string CaptionLine(string code, string? waLink) =>
            $"इलाज या अपॉइंटमेंट के लिए WhatsApp करें और कोड लिखें: {code}" + (waLink != null ? $"\n{waLink}" : "") + $"\nWhatsApp us with code {code} for appointments.";

        /// <summary>Instagram DM link that tells NexMarket the code when the chat opens (ig.me ?ref=).</summary>
        public static string? IgLink(string? igUsername, string code) =>
            string.IsNullOrWhiteSpace(igUsername) ? null : $"https://ig.me/m/{Uri.EscapeDataString(igUsername.TrimStart('@'))}?ref={Uri.EscapeDataString(code)}";

        /// <summary>Messenger link to the Facebook Page that carries the code (m.me ?ref=).</summary>
        public static string? MessengerLink(string? pageId, string code) =>
            string.IsNullOrWhiteSpace(pageId) ? null : $"https://m.me/{Uri.EscapeDataString(pageId)}?ref={Uri.EscapeDataString(code)}";

        /// <summary>A page's path without the site, query or trailing slash: "/blog/pathri-ka-ilaj".</summary>
        public static string? PathOf(string? urlOrPath)
        {
            if (string.IsNullOrWhiteSpace(urlOrPath)) return null;
            var s = urlOrPath.Trim();
            // Only web addresses: on Linux "/blog/x" also parses as an absolute (file) address.
            if ((s.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) && Uri.TryCreate(s, UriKind.Absolute, out var u)) s = u.AbsolutePath;
            var q = s.IndexOfAny(new[] { '?', '#' });
            if (q >= 0) s = s[..q];
            s = s.TrimEnd('/');
            if (!s.StartsWith('/')) s = "/" + s;
            return s.Length > 300 ? s[..300] : s.ToLowerInvariant();
        }

        public static Task<TrackedLink?> ByAdAsync(IMarketingDbContext db, string? adId, CancellationToken ct) =>
            string.IsNullOrWhiteSpace(adId) ? Task.FromResult<TrackedLink?>(null) : db.TrackedLinks.AsNoTracking().FirstOrDefaultAsync(l => l.AdId == adId, ct);

        public static Task<TrackedLink?> ByCodeAsync(IMarketingDbContext db, string? code, CancellationToken ct) =>
            string.IsNullOrWhiteSpace(code) ? Task.FromResult<TrackedLink?>(null) : db.TrackedLinks.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code.ToUpper(), ct);

        public static async Task<TrackedLink?> ByPageAsync(IMarketingDbContext db, string? page, CancellationToken ct)
        {
            var p = PathOf(page);
            if (p == null || p == "/") return null;
            return await db.TrackedLinks.AsNoTracking().FirstOrDefaultAsync(l => l.PagePath == p, ct);
        }

        /// <summary>
        /// Records one touch. The same lead coming the same way again within a day adds nothing. The first touch a lead
        /// ever has is marked IsFirst. Caller saves.
        /// </summary>
        public static async Task<LeadTouch?> TouchAsync(IMarketingDbContext db, Guid leadId, string channel, string kind, CancellationToken ct,
            TrackedLink? link = null, Guid? broadcastId = null, string? adId = null, string? @ref = null, string? detail = null, DateTime? at = null)
        {
            var when = at ?? DateTime.UtcNow;
            var dayAgo = when.AddDays(-1);
            bool same(LeadTouch t) => t.LeadId == leadId && t.Kind == kind && t.At >= dayAgo
                && t.LinkId == link?.Id && t.BroadcastId == broadcastId && t.AdId == adId && (link != null || broadcastId != null || adId != null || t.Ref == @ref);
            if (db.LeadTouches.Local.Any(same)) return null;
            var lid = link?.Id;
            var recent = await db.LeadTouches.AsNoTracking().Where(t => t.LeadId == leadId && t.Kind == kind && t.At >= dayAgo && t.LinkId == lid && t.BroadcastId == broadcastId && t.AdId == adId)
                .Select(t => t.Ref).ToListAsync(ct);
            if (recent.Count > 0 && (link != null || broadcastId != null || adId != null || recent.Contains(@ref))) return null;
            var first = !db.LeadTouches.Local.Any(t => t.LeadId == leadId) && !await db.LeadTouches.AnyAsync(t => t.LeadId == leadId, ct);
            var touch = new LeadTouch
            {
                LeadId = leadId, At = when, Channel = channel, Kind = kind, LinkId = link?.Id, BroadcastId = broadcastId ?? link?.BroadcastId, AdId = adId ?? link?.AdId,
                Ref = Cut(@ref ?? link?.Code, 200), Detail = Cut(detail, 1000), IsFirst = first,
            };
            db.LeadTouches.Add(touch);
            return touch;
        }

        private static string? Cut(string? s, int n) => s == null ? null : s.Length > n ? s[..n] : s;
    }
}
