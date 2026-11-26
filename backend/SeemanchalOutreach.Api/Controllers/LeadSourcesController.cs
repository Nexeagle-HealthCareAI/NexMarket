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
            ("instagram", "Instagram", "IG"), ("facebook", "Facebook", "FB"), ("youtube", "YouTube", "YT"), ("hoarding", "Hoarding", "HRD"),
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

        private object Links(TrackedLink l, WhatsAppConfig wa, string? site)
        {
            var msg = LeadInbox.QrMessage(wa, l.Code, null);
            return new
            {
                whatsapp = LeadInbox.WaLink(wa, msg),
                message = msg,
                website = site == null ? null : $"{site}/?utm_source={Uri.EscapeDataString(l.Channel)}&utm_medium={(l.Channel is "hoarding" or "pamphlet" or "poster" or "print" ? "qr" : "link")}&utm_campaign={Uri.EscapeDataString(l.Code)}",
            };
        }

        [HttpGet("links")]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var wa = LeadInbox.Wa(_settings, _config);
            var site = SiteConfig.Load(_settings).SiteUrl;
            var links = await _db.TrackedLinks.AsNoTracking().OrderByDescending(l => l.IsActive).ThenBy(l => l.Name).ToListAsync(ct);
            var leads = await _db.Leads.AsNoTracking().Where(l => l.Source == "link").Select(l => new { l.SourceRef, l.Status }).ToListAsync(ct);
            var by = leads.GroupBy(l => LeadInbox.LinkCodeOf(l.SourceRef) ?? "").ToDictionary(g => g.Key, g => (Leads: g.Count(), Came: g.Count(x => Came.Contains(x.Status))));
            var hoardingIds = links.Where(l => l.HoardingId != null).Select(l => l.HoardingId!.Value).ToList();
            var hoardings = await _db.Hoardings.AsNoTracking().Where(h => hoardingIds.Contains(h.Id)).ToDictionaryAsync(h => h.Id, h => h.Place, ct);
            return Ok(new
            {
                connected = LeadInbox.DisplayPhone(wa) != null, siteUrl = site,
                channels = Channels.Select(c => new { code = c.Code, label = c.Label }),
                items = links.Select(l =>
                {
                    var n = by.GetValueOrDefault(l.Code);
                    return new
                    {
                        id = l.Id, code = l.Code, name = l.Name, channel = l.Channel, hoardingId = l.HoardingId,
                        hoarding = l.HoardingId != null ? hoardings.GetValueOrDefault(l.HoardingId.Value) : null,
                        cost = l.Cost, note = l.Note, isActive = l.IsActive, createdAt = l.CreatedAt,
                        leads = n.Leads, came = n.Came,
                        links = Links(l, wa, site),
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
            var linkLeads = leads.Where(l => l.Source == "link").ToLookup(l => LeadInbox.LinkCodeOf(l.SourceRef) ?? "");
            var byLink = links.Select(k => Count(k.Code, k.Name, linkLeads[k.Code], k.Cost)).Where(r => r.Leads > 0 || links.First(x => x.Code == r.Key).IsActive)
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

            var unknown = leads.Count(l => l.Source == "whatsapp");
            return Ok(new
            {
                days, total = Count("all", "All leads", leads),
                unknown, unknownShare = leads.Count == 0 ? 0 : Math.Round(100.0 * unknown / leads.Count),
                bySource, byLink, campaigns, byPartner, weeks, topSources = top.Select(s => new { key = s, label = LeadInbox.SourceLabel(s) }),
            });
        }

        private static string contactTypeLabel(string role) => role switch
        {
            "rmp_doctor" => "RMP", "asha_worker" => "ASHA", "nursing_home" => "Nursing home", "independent_doctor" => "Doctor", "medicine_shop" => "Chemist",
            "lab" => "Lab", "hospital" => "Hospital", "mukhiya" => "Mukhiya", "ward_member" => "Ward member", "prominent_person" => "Prominent person", _ => "Partner",
        };
    }
}
