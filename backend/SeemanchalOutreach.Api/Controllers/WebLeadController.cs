using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// The enquiry form on the hospital's website posts here, so website enquiries land in the Leads inbox by themselves,
    /// with the campaign they came from (utm_campaign) as "Which ad / campaign". A visitor from a Google ad (utm_source=google
    /// with utm_medium=cpc, or a gclid) becomes a "Google ad" lead; anyone else a "Website" lead. A plain HTML form post, so the
    /// website needs no special set-up; rate-limited per address, with a hidden trap field for bots.
    /// </summary>
    [ApiController]
    [Route("api/v1/public/web-lead")]
    [AllowAnonymous]
    public class WebLeadController : ControllerBase
    {
        private static readonly Regex Safe = new(@"[\u0000-\u001f<>]");
        private readonly IMarketingDbContext _db;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        private readonly IPermissionService _perms;

        public WebLeadController(IMarketingDbContext db, INotifier notifier, ILiveEvents live, IPermissionService perms)
        {
            _db = db; _notifier = notifier; _live = live; _perms = perms;
        }

        private static string? Clean(string? s, int max)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            s = Safe.Replace(s.Trim(), " ");
            return s.Length > max ? s[..max] : s;
        }

        [HttpPost]
        [EnableRateLimiting("webform")]
        [Consumes("application/x-www-form-urlencoded", "multipart/form-data")]
        public Task<IActionResult> PostForm([FromForm] Dictionary<string, string> form, CancellationToken ct) => HandleAsync(form, true, ct);

        [HttpPost("json")]
        [EnableRateLimiting("webform")]
        public Task<IActionResult> PostJson([FromBody] Dictionary<string, string> body, CancellationToken ct) => HandleAsync(body, false, ct);

        private async Task<IActionResult> HandleAsync(Dictionary<string, string> f, bool html, CancellationToken ct)
        {
            string? V(string k) => f.TryGetValue(k, out var v) ? v : null;
            var next = V("next");
            IActionResult Reply(bool ok, string message)
            {
                if (!html) return ok ? Ok(new { ok, message }) : BadRequest(new { ok, message });
                if (ok && Uri.TryCreate(next, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http")) return Redirect(u.ToString());
                var back = Request.Headers.Referer.ToString();
                var link = Uri.TryCreate(back, UriKind.Absolute, out var b) && (b.Scheme == "https" || b.Scheme == "http") ? $"<p><a href=\"{WebUtility.HtmlEncode(b.ToString())}\">Back</a></p>" : "";
                var page = $"<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{(ok ? "Thank you" : "Please check")}</title>"
                    + "<body style=\"font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;line-height:1.5;color:#0f172a\">"
                    + $"<h1 style=\"font-size:22px\">{(ok ? "Thank you" : "Please check the form")}</h1><p>{WebUtility.HtmlEncode(message)}</p>{link}</body></html>";
                return new ContentResult { Content = page, ContentType = "text/html; charset=utf-8", StatusCode = ok ? 200 : 400 };
            }

            // Bots fill every field, people never see this one.
            if (!string.IsNullOrEmpty(V("website"))) return Reply(true, "We have your details. Our team will call you soon.");

            var phone = LeadInbox.NormalizePhone(V("phone"));
            if (phone == null) return Reply(false, "Please enter a 10-digit mobile number.");
            var name = Clean(V("name"), 80) ?? "Website visitor";
            var dept = Clean(V("department"), 80);
            var message = Clean(V("message"), 500);
            var utmSource = Clean(V("utm_source"), 60)?.ToLowerInvariant();
            var utmMedium = Clean(V("utm_medium"), 60)?.ToLowerInvariant();
            var campaign = Clean(V("utm_campaign"), 80);
            var page = Clean(V("page"), 200);
            var fromGoogleAd = !string.IsNullOrEmpty(V("gclid")) || (utmSource == "google" && utmMedium is "cpc" or "ppc" or "paid");
            var source = fromGoogleAd ? "google_ads" : "web";
            var sourceRef = campaign ?? (fromGoogleAd ? null : page);
            var now = DateTime.UtcNow;
            var how = LeadInbox.SourceLabel(source) + (campaign != null ? $" · {campaign}" : "") + (utmSource != null && !fromGoogleAd ? $" ({utmSource})" : "");

            var existing = await _db.Leads.FirstOrDefaultAsync(l => l.Phone == phone, ct);
            if (existing != null)
            {
                _db.LeadActivities.Add(new LeadActivity { LeadId = existing.Id, Kind = "note", Text = $"Came in again ({how})" + (message != null ? $": {message}" : ""), CreatedAt = now });
                if (!LeadInbox.Open.Contains(existing.Status))
                {
                    _db.LeadActivities.Add(new LeadActivity { LeadId = existing.Id, Kind = "reopened", Text = "Back to New.", CreatedAt = now.AddMilliseconds(1) });
                    existing.Status = "new";
                    existing.ClosedAt = null;
                }
                existing.Department ??= dept;
                existing.LastActivityAt = now;
                existing.Unread += 1;
                await _db.SaveChangesAsync(ct);
                await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"{existing.Name} enquired again on the website", RefId = existing.Id.ToString() });
                return Reply(true, "We have your details. Our team will call you soon.");
            }

            var lead = new Lead
            {
                Name = name, Phone = phone, Source = source, SourceRef = sourceRef, Department = dept, Note = message,
                CreatedBy = "website", CreatedAt = now, LastActivityAt = now, Status = "new", Unread = 1,
            };
            _db.Leads.Add(lead);
            _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "created", CreatedAt = now, Text = $"Website form ({how})" + (page != null ? $" on {page}" : "") });
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = await LeadInbox.DeskPeopleAsync(_db, _perms, ct), Kind = "lead",
                Title = $"New website enquiry: {lead.Name}", Body = lead.Note ?? how, Link = $"lead:{lead.Id}", RefId = lead.Id.ToString(),
            });
            await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"New lead: {lead.Name} ({LeadInbox.SourceLabel(source)})", RefId = lead.Id.ToString() });
            return Reply(true, "We have your details. Our team will call you soon.");
        }
    }

    /// <summary>Google Ads campaign names seen in the last 120 days, so the desk picks the exact name for "Which ad?" and the lead matches its campaign.</summary>
    [ApiController]
    [Route("api/v1/leads/ad-campaigns")]
    [Authorize]
    [PageAccess(Pages.Desk, Pages.WhatsApp)]
    public class AdCampaignsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        public AdCampaignsController(IMarketingDbContext db) { _db = db; }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var since = DateOnly.FromDateTime(IstClock.NowIst).AddDays(-120);
            var google = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "google_ads" && m.Dimension.StartsWith("campaign:") && m.Metric == "cost" && m.Date >= since && m.Label != null)
                .GroupBy(m => m.Label!).Select(g => new { name = g.Key, last = g.Max(x => x.Date), spend = g.Sum(x => x.Value) })
                .OrderByDescending(x => x.last).ThenByDescending(x => x.spend).Take(40).ToListAsync(ct);
            return Ok(new { google = google.Select(x => x.name) });
        }
    }
}
