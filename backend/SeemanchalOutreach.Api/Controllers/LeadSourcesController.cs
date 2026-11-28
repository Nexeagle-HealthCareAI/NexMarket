using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class TrackedLinkDto
    {
        public string? Name { get; set; }
        public string? Code { get; set; }
        public string? Channel { get; set; }
        public Guid? HoardingId { get; set; }
        public int? Cost { get; set; }
        public string? Note { get; set; }
        public bool? IsActive { get; set; }
        /// <summary>place | reel | post | story | ad | template | page | poster | video</summary>
        public string? Kind { get; set; }
        public Guid? TopicId { get; set; }
        public bool? ClearTopic { get; set; }
        public string? OwnerId { get; set; }
        public DateOnly? PublishedOn { get; set; }
        public string? MediaId { get; set; }
        public string? AdId { get; set; }
        public Guid? BroadcastId { get; set; }
        public bool? ClearBroadcast { get; set; }
        public string? PagePath { get; set; }
    }

    /// <summary>
    /// Where leads come from. Tracked links: one WhatsApp link, QR code and website address per place the hospital
    /// advertises, each carrying a short code that credits the lead to it. The report: leads by source, link, campaign and
    /// partner, followed through to who came to the hospital, with cost per lead and per patient where a cost is known.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Analytics, Pages.WhatsApp, Pages.Desk)]
    [Route("api/v1/lead-sources")]
    public class LeadSourcesController : ControllerBase
    {
        public static readonly (string Code, string Label, string Prefix)[] Channels =
        {
            ("instagram", "Instagram", "IG"), ("facebook", "Facebook", "FB"), ("youtube", "YouTube", "YT"), ("google", "Google (Business Profile, ads)", "GGL"), ("hoarding", "Hoarding", "HRD"),
            ("print", "Newspaper / magazine", "NEWS"), ("pamphlet", "Pamphlet / leaflet", "PMP"), ("poster", "Poster / auto / wall", "PST"),
            ("radio", "Radio / announcement", "RAD"), ("website", "Website / other site", "WEB"), ("other", "Other", "LNK"),
        };
        /// <summary>Statuses that mean the person came to the hospital.</summary>
        private static readonly string[] Came = { "arrived", "admitted" };
        private static readonly Regex CodeRx = new(@"^[A-Z0-9][A-Z0-9\-]{2,15}$");

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;

        public LeadSourcesController(IMarketingDbContext db, IAppSettings settings, IConfiguration config)
        {
            _db = db; _settings = settings; _config = config;
        }

        /// <summary>A code from the channel and name: "IG-BIO", "HRD-KASBA"; a number is added if it's taken.</summary>
        [NonAction]
        public static string SuggestCode(string channel, string name, Func<string, bool> taken)
        {
            var prefix = Channels.FirstOrDefault(c => c.Code == channel).Prefix ?? "LNK";
            var words = Regex.Replace(name.ToUpperInvariant(), @"[^A-Z0-9 ]", " ").Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Where(w => w != Channels.FirstOrDefault(c => c.Code == channel).Label?.ToUpperInvariant() && w is not ("THE" or "AND" or "OF" or "AT" or "IN" or "INSTAGRAM" or "FACEBOOK" or "YOUTUBE" or "HOARDING"))
                .ToList();
            // Whole words while they fit in 8 letters: "Kasba bus stand" → KASBABUS, "Dainik Jagran" → DAINIK.
            var tail = "";
            foreach (var w in words) { if (tail.Length + w.Length > 8) break; tail += w; }
            if (tail.Length == 0 && words.Count > 0) tail = words[0][..Math.Min(8, words[0].Length)];
            var code = tail.Length == 0 ? prefix + "-1" : $"{prefix}-{tail}";
            if (code.Length > 16) code = code[..16];
            var n = 2;
            var baseCode = code;
            while (taken(code)) code = $"{(baseCode.Length > 13 ? baseCode[..13] : baseCode)}{n++}";
            return code;
        }

        private object Links(TrackedLink l, WhatsAppConfig wa, string? site, MetaConfig? meta = null)
        {
            var msg = LeadInbox.QrMessage(wa, l.Code, null);
            var waLink = LeadInbox.WaLink(wa, msg);
            var path = l.PagePath != null && site != null ? l.PagePath : "/";
            return new
            {
                whatsapp = waLink,
                message = msg,
                website = site == null ? null : $"{site}{path}?utm_source={Uri.EscapeDataString(l.Channel)}&utm_medium={(l.Channel is "hoarding" or "pamphlet" or "poster" or "print" ? "qr" : "link")}&utm_campaign={Uri.EscapeDataString(l.Code)}",
                instagram = Attribution.IgLink(meta?.IgUsername, l.Code),
                messenger = Attribution.MessengerLink(meta?.PageId, l.Code),
                caption = Attribution.CaptionLine(l.Code, waLink),
            };
        }

        /// <summary>Leads credited to each piece of content: any touch pointing at it, plus older leads that only name its code.</summary>
        private async Task<Dictionary<Guid, (HashSet<Guid> Any, HashSet<Guid> First)>> LeadsPerLinkAsync(List<TrackedLink> links, DateTime since, CancellationToken ct)
        {
            var touches = await _db.LeadTouches.AsNoTracking().Where(t => t.LinkId != null && t.At >= since).Select(t => new { t.LinkId, t.LeadId, t.IsFirst }).ToListAsync(ct);
            var legacy = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= since && (l.Source == "link" || l.Source == "ad" || l.Source == "broadcast") && l.SourceRef != null)
                .Select(l => new { l.Id, l.SourceRef }).ToListAsync(ct);
            var byCode = links.ToDictionary(l => l.Code, l => l.Id);
            var map = links.ToDictionary(l => l.Id, _ => (Any: new HashSet<Guid>(), First: new HashSet<Guid>()));
            foreach (var t in touches)
                if (map.TryGetValue(t.LinkId!.Value, out var e)) { e.Any.Add(t.LeadId); if (t.IsFirst) e.First.Add(t.LeadId); }
            foreach (var l in legacy)
                if (LeadInbox.LinkCodeOf(l.SourceRef) is string c && byCode.TryGetValue(c, out var id)) { map[id].Any.Add(l.Id); map[id].First.Add(l.Id); }
            return map;
        }

        [HttpGet("links")]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var wa = LeadInbox.Wa(_settings, _config);
            var site = SiteConfig.Load(_settings).SiteUrl;
            var links = await _db.TrackedLinks.AsNoTracking().OrderByDescending(l => l.IsActive).ThenByDescending(l => l.PublishedOn ?? DateOnly.FromDateTime(l.CreatedAt)).ThenBy(l => l.Name).ToListAsync(ct);
            var per = await LeadsPerLinkAsync(links, DateTime.MinValue, ct);
            var allIds = per.Values.SelectMany(v => v.Any).Distinct().ToList();
            var status = await _db.Leads.AsNoTracking().Where(l => allIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            var meta = MetaConfig.Load(_settings);
            var topicIds = links.Where(l => l.TopicId != null).Select(l => l.TopicId!.Value).Distinct().ToList();
            var topics = await _db.KwTopics.AsNoTracking().Where(t => topicIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, ct);
            var hoardingIds = links.Where(l => l.HoardingId != null).Select(l => l.HoardingId!.Value).ToList();
            var hoardings = await _db.Hoardings.AsNoTracking().Where(h => hoardingIds.Contains(h.Id)).ToDictionaryAsync(h => h.Id, h => h.Place, ct);
            return Ok(new
            {
                connected = LeadInbox.DisplayPhone(wa) != null, siteUrl = site,
                channels = Channels.Select(c => new { code = c.Code, label = c.Label }),
                items = links.Select(l =>
                {
                    var ids = per[l.Id].Any;
                    return new
                    {
                        id = l.Id, code = l.Code, name = l.Name, channel = l.Channel, hoardingId = l.HoardingId,
                        hoarding = l.HoardingId != null ? hoardings.GetValueOrDefault(l.HoardingId.Value) : null,
                        cost = l.Cost, note = l.Note, isActive = l.IsActive, createdAt = l.CreatedAt,
                        kind = l.Kind, topicId = l.TopicId, topic = l.TopicId != null ? topics.GetValueOrDefault(l.TopicId.Value) : null, ownerId = l.OwnerId,
                        publishedOn = l.PublishedOn, mediaId = l.MediaId, adId = l.AdId, broadcastId = l.BroadcastId, pagePath = l.PagePath,
                        leads = ids.Count, came = ids.Count(i => Came.Contains(status.GetValueOrDefault(i) ?? "")),
                        links = Links(l, wa, site, meta),
                    };
                }),
            });
        }

        /// <summary>Hoardings that are up (or being put up), to give each its own QR code.</summary>
        [HttpGet("hoardings")]
        public async Task<IActionResult> Hoardings(CancellationToken ct)
        {
            var list = await _db.Hoardings.AsNoTracking().Where(h => h.Status != "rejected" && h.Status != "ended")
                .OrderBy(h => h.Place).Select(h => new { id = h.Id, place = h.Place, block = h.Block, rent = h.MonthlyRent, status = h.Status }).ToListAsync(ct);
            return Ok(list);
        }

        private async Task<string?> ApplyAsync(TrackedLink l, TrackedLinkDto d, bool isNew, CancellationToken ct)
        {
            if (d.Name != null)
            {
                var n = Regex.Replace(d.Name.Trim(), @"\s+", " ");
                if (n.Length < 2 || n.Length > 80) return "Give it a name, e.g. “Instagram bio” or “Hoarding near Kasba bus stand”.";
                l.Name = n;
            }
            if (d.Channel != null)
            {
                if (!Channels.Any(c => c.Code == d.Channel)) return "Pick where it is.";
                l.Channel = d.Channel;
            }
            if (isNew)
            {
                var code = (d.Code ?? "").Trim().ToUpperInvariant().Replace(' ', '-');
                var all = await _db.TrackedLinks.AsNoTracking().Select(x => x.Code).ToListAsync(ct);
                var partnerCodes = await _db.Contacts.AsNoTracking().Where(c => c.ReferralCode != null).Select(c => c.ReferralCode!).ToListAsync(ct);
                bool taken(string c) => all.Contains(c) || partnerCodes.Contains(c);
                if (code.Length == 0 && Attribution.Prefix(d.Kind ?? l.Kind) != null)
                {
                    var topicName = d.TopicId != null ? await _db.KwTopics.AsNoTracking().Where(t => t.Id == d.TopicId).Select(t => t.Name).FirstOrDefaultAsync(ct) : null;
                    code = Attribution.ContentCode(d.Kind ?? l.Kind, topicName, l.Name, taken);
                }
                if (code.Length == 0) code = SuggestCode(l.Channel, l.Name, taken);
                if (!CodeRx.IsMatch(code)) return "The code is 3–16 letters, numbers or dashes, e.g. IG-BIO.";
                if (taken(code)) return $"The code {code} is already used. Pick another.";
                l.Code = code;
            }
            if (d.HoardingId != null)
            {
                if (d.HoardingId == Guid.Empty) l.HoardingId = null;
                else if (!await _db.Hoardings.AnyAsync(h => h.Id == d.HoardingId, ct)) return "That hoarding wasn't found.";
                else l.HoardingId = d.HoardingId;
            }
            if (d.Cost != null)
            {
                if (d.Cost < 0 || d.Cost > 100_000_000) return "The cost looks wrong.";
                l.Cost = d.Cost == 0 ? null : d.Cost;
            }
            if (d.Note != null) l.Note = d.Note.Trim().Length == 0 ? null : d.Note.Trim()[..Math.Min(d.Note.Trim().Length, 300)];
            if (d.IsActive != null) l.IsActive = d.IsActive.Value;
            if (d.Kind != null)
            {
                if (!Attribution.Kinds.Contains(d.Kind)) return "Pick what it is: a place, reel, post, story, ad, template, page, poster or video.";
                l.Kind = d.Kind;
            }
            if (d.ClearTopic == true) l.TopicId = null;
            else if (d.TopicId != null)
            {
                if (!await _db.KwTopics.AnyAsync(t => t.Id == d.TopicId, ct)) return "That topic wasn't found.";
                l.TopicId = d.TopicId;
            }
            if (d.OwnerId != null) l.OwnerId = d.OwnerId.Length == 0 ? null : d.OwnerId;
            if (d.PublishedOn != null) l.PublishedOn = d.PublishedOn;
            if (d.MediaId != null)
            {
                var v = d.MediaId.Trim();
                if (v.Length > 0 && !Regex.IsMatch(v, @"^[0-9_]{5,60}$")) return "The Instagram or Facebook post ID is a long number (from the post's insights or its link).";
                l.MediaId = v.Length == 0 ? null : v;
            }
            if (d.AdId != null)
            {
                var v = d.AdId.Trim();
                if (v.Length > 0 && !Regex.IsMatch(v, @"^\d{5,30}$")) return "The Meta ad ID is a number (Ads Manager → the ad → its ID).";
                if (v.Length > 0 && await _db.TrackedLinks.AnyAsync(x => x.Id != l.Id && x.AdId == v, ct)) return "Another piece of content already has this ad ID.";
                l.AdId = v.Length == 0 ? null : v;
            }
            if (d.ClearBroadcast == true) l.BroadcastId = null;
            else if (d.BroadcastId != null)
            {
                if (!await _db.Broadcasts.AnyAsync(b => b.Id == d.BroadcastId, ct)) return "That broadcast wasn't found.";
                l.BroadcastId = d.BroadcastId;
            }
            if (d.PagePath != null)
            {
                var p = Attribution.PathOf(d.PagePath);
                if (p == "/") p = null;
                if (p != null && await _db.TrackedLinks.AnyAsync(x => x.Id != l.Id && x.PagePath == p, ct)) return "Another piece of content already has this page.";
                l.PagePath = p;
            }
            l.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        [HttpPost("links")]
        public async Task<IActionResult> Create([FromBody] TrackedLinkDto d, CancellationToken ct)
        {
            var l = new TrackedLink { CreatedBy = User.AgentIdOf() ?? "", Channel = "other" };
            if (string.IsNullOrWhiteSpace(d.Name)) return BadRequest(new { message = "Give it a name, e.g. “Instagram bio”." });
            var err = await ApplyAsync(l, d, true, ct);
            if (err != null) return BadRequest(new { message = err });
            _db.TrackedLinks.Add(l);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = l.Id, code = l.Code });
        }

        [HttpPut("links/{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] TrackedLinkDto d, CancellationToken ct)
        {
            var l = await _db.TrackedLinks.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var err = await ApplyAsync(l, d, false, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>
        /// Content performance: for each reel, post, ad, page, poster or place, and each WhatsApp broadcast, the leads it
        /// brought in the period (any touch, and as first touch), how many came and were admitted, and cost per patient.
        /// With it, the blind spot: leads with no known source, by how they reached the hospital.
        /// </summary>
        [HttpGet("content")]
        public async Task<IActionResult> Content([FromQuery] int days = 90, CancellationToken ct = default)
        {
            days = days is 7 or 30 or 90 or 365 ? days : days <= 0 ? 0 : 90;
            var since = days == 0 ? DateTime.MinValue : DateTime.UtcNow.AddDays(-days);
            var links = await _db.TrackedLinks.AsNoTracking().ToListAsync(ct);
            var per = await LeadsPerLinkAsync(links, since, ct);
            var bTouches = await _db.LeadTouches.AsNoTracking().Where(t => t.BroadcastId != null && t.At >= since).Select(t => new { t.BroadcastId, t.LeadId, t.IsFirst, t.LinkId }).ToListAsync(ct);
            var ids = per.Values.SelectMany(v => v.Any).Concat(bTouches.Select(t => t.LeadId)).Distinct().ToList();
            var status = await _db.Leads.AsNoTracking().Where(l => ids.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            var topicIds = links.Where(l => l.TopicId != null).Select(l => l.TopicId!.Value).Distinct().ToList();
            var topics = await _db.KwTopics.AsNoTracking().Where(t => topicIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, ct);
            int came(IEnumerable<Guid> xs) => xs.Count(i => Came.Contains(status.GetValueOrDefault(i) ?? ""));
            int adm(IEnumerable<Guid> xs) => xs.Count(i => status.GetValueOrDefault(i) == "admitted");

            var rows = links.Select(l =>
            {
                var (any, first) = per[l.Id];
                var c = came(any);
                return new
                {
                    id = l.Id, code = l.Code, name = l.Name, kind = l.Kind, channel = l.Channel, topic = l.TopicId != null ? topics.GetValueOrDefault(l.TopicId.Value) : null,
                    publishedOn = l.PublishedOn, isActive = l.IsActive, broadcast = false,
                    leads = any.Count, firstTouch = first.Count, came = c, admitted = adm(any), cost = l.Cost,
                    perLead = l.Cost is > 0 && any.Count > 0 ? (int?)Math.Round((double)l.Cost.Value / any.Count) : null,
                    perPatient = l.Cost is > 0 && c > 0 ? (int?)Math.Round((double)l.Cost.Value / c) : null,
                };
            }).Where(r => r.leads > 0 || r.isActive).ToList<object>();

            // Broadcasts not already in the library as content.
            var linkedBroadcasts = links.Where(l => l.BroadcastId != null).Select(l => l.BroadcastId!.Value).ToHashSet();
            var bIds = bTouches.Select(t => t.BroadcastId!.Value).Where(b => !linkedBroadcasts.Contains(b)).Distinct().ToList();
            var bcs = await _db.Broadcasts.AsNoTracking().Where(b => bIds.Contains(b.Id)).Select(b => new { b.Id, b.Title, b.CreatedAt }).ToListAsync(ct);
            foreach (var b in bcs)
            {
                var mine = bTouches.Where(t => t.BroadcastId == b.Id).ToList();
                var any = mine.Select(t => t.LeadId).Distinct().ToList();
                rows.Add(new
                {
                    id = b.Id, code = (string?)null, name = b.Title, kind = "broadcast", channel = "whatsapp", topic = (string?)null,
                    publishedOn = (DateOnly?)DateOnly.FromDateTime(b.CreatedAt), isActive = true, broadcast = true,
                    leads = any.Count, firstTouch = mine.Where(t => t.IsFirst).Select(t => t.LeadId).Distinct().Count(), came = came(any), admitted = adm(any),
                    cost = (int?)null, perLead = (int?)null, perPatient = (int?)null,
                });
            }

            // The blind spot: leads that came with nothing to say where from.
            var leads = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= since).Select(l => new { l.Id, l.Source, l.PartnerClientId }).ToListAsync(ct);
            var leadIds = leads.Select(l => l.Id).ToList();
            var touched = (await _db.LeadTouches.AsNoTracking().Where(t => leadIds.Contains(t.LeadId)).Select(t => t.LeadId).Distinct().ToListAsync(ct)).ToHashSet();
            string Way(string src) => src switch
            {
                "whatsapp" or "link" or "partner_qr" or "broadcast" or "ad" => "WhatsApp",
                "instagram" or "ig_form" => "Instagram", "facebook" or "fb_form" => "Facebook",
                "web" or "google_ads" or "google_listing" => "Website and Google",
                "desk" or "missed_call" => "Calls", "walk_in" => "Walk-ins", "camp" => "Camps", "partner" or "agent" => "Partners and field team",
                _ => "Other",
            };
            bool Known(string src, Guid id, string? partner) => touched.Contains(id) || partner != null || src is not ("whatsapp" or "instagram" or "facebook" or "desk" or "missed_call" or "walk_in");
            var blind = leads.GroupBy(l => Way(l.Source)).Select(g => new
            {
                way = g.Key, leads = g.Count(), unknown = g.Count(l => !Known(l.Source, l.Id, l.PartnerClientId)),
            }).OrderByDescending(x => x.leads).ToList();
            return Ok(new
            {
                days, rows,
                blind = new { leads = leads.Count, unknown = blind.Sum(b => b.unknown), byWay = blind },
            });
        }

        public record Row(string Key, string Label, int Leads, int Contacted, int Appointment, int Came, int Admitted, int Lost, int? Cost);

        private static Row Count(string key, string label, IEnumerable<Lead> g, int? cost = null)
        {
            var list = g.ToList();
            return new Row(key, label, list.Count,
                list.Count(l => l.Status != "new" || l.FirstResponseAt != null),
                list.Count(l => l.Status is "appointment" or "arrived" or "admitted"),
                list.Count(l => Came.Contains(l.Status)), list.Count(l => l.Status == "admitted"), list.Count(l => l.Status == "lost"), cost);
        }

        /// <summary>Leads in the period by where they came from, and how far each got: contacted, appointment, came, admitted.</summary>
        [HttpGet("report")]
        public async Task<IActionResult> Report([FromQuery] int days = 90, CancellationToken ct = default)
        {
            days = days is 7 or 30 or 90 or 365 ? days : days <= 0 ? 0 : 90;
            var since = days == 0 ? DateTime.MinValue : DateTime.UtcNow.AddDays(-days);
            var leads = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= since).ToListAsync(ct);

            var bySource = leads.GroupBy(l => l.Source).Select(g => Count(g.Key, LeadInbox.SourceLabel(g.Key), g)).OrderByDescending(r => r.Leads).ToList();

            var links = await _db.TrackedLinks.AsNoTracking().ToListAsync(ct);
            var perLink = await LeadsPerLinkAsync(links, since, ct);
            var leadById = leads.ToDictionary(l => l.Id);
            var byLink = links.Select(k => Count(k.Code, k.Name, perLink[k.Id].Any.Where(leadById.ContainsKey).Select(i => leadById[i]), k.Cost)).Where(r => r.Leads > 0 || links.First(x => x.Code == r.Key).IsActive)
                .OrderByDescending(r => r.Leads).ThenBy(r => r.Label).ToList();

            // Ads, forms and website campaigns: what Meta, Google or the link's UTM tag named them.
            var campaigns = leads.Where(l => l.Source is "ad" or "fb_form" or "ig_form" or "google_ads" or "web" && !string.IsNullOrWhiteSpace(l.SourceRef) && !l.SourceRef!.StartsWith("/"))
                .GroupBy(l => (l.Source, Ref: l.SourceRef!.Trim()))
                .Select(g => Count($"{g.Key.Source}|{g.Key.Ref}", g.Key.Ref, g) with { Key = LeadInbox.SourceLabel(g.Key.Source) })
                .OrderByDescending(r => r.Leads).Take(20).ToList();

            var partnerIds = leads.Where(l => l.PartnerClientId != null).Select(l => l.PartnerClientId!).Distinct().ToList();
            var partners = await _db.Contacts.AsNoTracking().Where(c => partnerIds.Contains(c.ClientId)).Select(c => new { c.ClientId, c.Name, c.Role }).ToListAsync(ct);
            var pName = partners.GroupBy(p => p.ClientId).ToDictionary(g => g.Key, g => g.First());
            var byPartner = leads.Where(l => l.PartnerClientId != null).GroupBy(l => l.PartnerClientId!)
                .Select(g => Count(pName.TryGetValue(g.Key, out var p) ? contactTypeLabel(p.Role) : "", pName.TryGetValue(g.Key, out var q) ? q.Name : g.Key, g))
                .OrderByDescending(r => r.Came).ThenByDescending(r => r.Leads).Take(20).ToList();

            // Leads each week (IST), last 12 weeks, the four biggest sources and the rest.
            var top = bySource.Take(4).Select(r => r.Key).ToList();
            var weekStart = IstClock.TodayStartUtc.AddDays(-(((int)IstClock.NowIst.DayOfWeek + 6) % 7)).AddDays(-7 * 11);
            var weekLeads = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= weekStart).Select(l => new { l.CreatedAt, l.Source, l.Status }).ToListAsync(ct);
            var weeks = Enumerable.Range(0, 12).Select(i =>
            {
                var from = weekStart.AddDays(7 * i); var to = from.AddDays(7);
                var w = weekLeads.Where(l => l.CreatedAt >= from && l.CreatedAt < to).ToList();
                return new
                {
                    week = from.AddHours(5.5).ToString("yyyy-MM-dd"),
                    total = w.Count, came = w.Count(l => Came.Contains(l.Status)),
                    bySource = top.ToDictionary(s => s, s => w.Count(l => l.Source == s)),
                    other = w.Count(l => !top.Contains(l.Source)),
                };
            }).ToList();

            // Google Ads: what was spent in the period (fetched from Google every morning) against the leads its clicks brought.
            object? googleAds = null;
            var adsCfg = GoogleConfig.Load(_settings);
            if (!string.IsNullOrWhiteSpace(adsCfg.AdsCustomer))
            {
                var fromDay = DateOnly.FromDateTime(days == 0 ? new DateTime(2000, 1, 1) : since.AddHours(5.5));
                var spend = (await _db.ChannelMetrics.AsNoTracking()
                    .Where(m => m.Source == "google_ads" && m.Account == adsCfg.AdsCustomer && m.Dimension == "" && m.Metric == "cost" && m.Date >= fromDay)
                    .Select(m => m.Value).ToListAsync(ct)).Sum();
                var g = Count("google_ads", "Google Ads", leads.Where(l => l.Source == "google_ads"));
                googleAds = new
                {
                    spend = Math.Round(spend), currency = adsCfg.AdsCurrency ?? "INR", g.Leads, g.Came, g.Admitted,
                    perLead = g.Leads > 0 ? Math.Round(spend / g.Leads) : (decimal?)null,
                    perPatient = g.Came > 0 ? Math.Round(spend / g.Came) : (decimal?)null,
                    sendsToAds = !string.IsNullOrWhiteSpace(adsCfg.ConvArrived),
                };
            }

            var unknown = leads.Count(l => l.Source == "whatsapp");
            return Ok(new
            {
                days, total = Count("all", "All leads", leads),
                unknown, unknownShare = leads.Count == 0 ? 0 : Math.Round(100.0 * unknown / leads.Count),
                bySource, byLink, campaigns, byPartner, weeks, googleAds, topSources = top.Select(s => new { key = s, label = LeadInbox.SourceLabel(s) }),
            });
        }

        private static string contactTypeLabel(string role) => role switch
        {
            "rmp_doctor" => "RMP", "asha_worker" => "ASHA", "nursing_home" => "Nursing home", "independent_doctor" => "Doctor", "medicine_shop" => "Chemist",
            "lab" => "Lab", "hospital" => "Hospital", "mukhiya" => "Mukhiya", "ward_member" => "Ward member", "prominent_person" => "Prominent person", _ => "Partner",
        };
    }
}
