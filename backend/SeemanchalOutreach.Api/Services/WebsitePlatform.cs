using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Webhooks: after every publish, each address set in Website → Setup is told what changed, as JSON signed with its
    /// own secret (header X-NexMarket-Signature: sha256=&lt;hex HMAC of the body&gt;). Only public internet addresses are
    /// called, redirects are not followed, and a failed call is tried again 5 times over about 15 hours.
    /// </summary>
    public static class SiteHooks
    {
        public static readonly TimeSpan[] Backoff = { TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(30), TimeSpan.FromHours(2), TimeSpan.FromHours(12) };

        public static string Sign(string secret, string body) =>
            "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();

        public static string NewSecret() => "whsec_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        /// <summary>The message about one publish. Only what is public on the website.</summary>
        public static string Payload(string evt, SiteConfig cfg, IEnumerable<(string Type, string Key, string Title, string? Url)> items, DateTime at) =>
            new JsonObject
            {
                ["event"] = evt, ["at"] = at.ToString("o"), ["site"] = cfg.SiteUrl,
                ["items"] = new JsonArray(items.Select(i => (JsonNode)new JsonObject { ["type"] = i.Type, ["key"] = i.Key, ["title"] = i.Title, ["url"] = i.Url }).ToArray()),
            }.ToJsonString();

        public static async Task QueueAsync(IMarketingDbContext db, SiteConfig cfg, SitePublish p, List<JsonObject> items, CancellationToken ct)
        {
            if (cfg.Hooks.Count == 0 || items.Count == 0) return;
            var ids = items.Select(i => Guid.TryParse(i["id"]?.ToString(), out var g) ? g : Guid.Empty).ToList();
            var rows = await db.SiteContents.AsNoTracking().Where(c => ids.Contains(c.Id)).ToListAsync(ct);
            foreach (var evt in new[] { "content.published", "content.unpublished" })
            {
                var these = items.Where(i => (i["action"]?.ToString() == "unpublish") == (evt == "content.unpublished"))
                    .Select(i => rows.FirstOrDefault(r => r.Id.ToString() == i["id"]?.ToString())).Where(r => r != null)
                    .Select(r => (r!.Type, r.Key, r.Title, UrlOf(cfg, r))).ToList();
                if (these.Count == 0) continue;
                var body = Payload(evt, cfg, these, DateTime.UtcNow);
                foreach (var h in cfg.Hooks) db.SiteWebhookDeliveries.Add(new SiteWebhookDelivery { Hook = h.N, Url = h.Url, Event = evt, Payload = body });
            }
        }

        public static string? UrlOf(SiteConfig cfg, SiteContent c) => cfg.SiteUrl == null ? null : c.Type switch
        {
            "article" => $"{cfg.SiteUrl}/blogs/{c.Key}", "location" => $"{cfg.SiteUrl}/areas/{c.Key}", "camp" => $"{cfg.SiteUrl}/health-camps#{c.Key}",
            "faq" => $"{cfg.SiteUrl}/faqs", "doctor" => $"{cfg.SiteUrl}/doctors", "redirect" => cfg.SiteUrl + c.Key, _ => cfg.SiteUrl,
        };

        /// <summary>Sends what is due (a few at a time).</summary>
        public static async Task SendDueAsync(IMarketingDbContext db, SiteConfig cfg, HttpClient http, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var due = await db.SiteWebhookDeliveries.Where(d => d.Status == "waiting" && d.NextAt <= now).OrderBy(d => d.NextAt).Take(10).ToListAsync(ct);
            foreach (var d in due)
            {
                var hook = cfg.Hooks.FirstOrDefault(h => h.N == d.Hook);
                if (hook.Url == null || hook.Url != d.Url || string.IsNullOrEmpty(hook.Secret)) { d.Status = "failed"; d.LastError = "This webhook was changed or removed in Setup."; continue; }
                d.Tries++;
                try
                {
                    using var req = new HttpRequestMessage(HttpMethod.Post, d.Url) { Content = new StringContent(d.Payload, Encoding.UTF8, "application/json") };
                    req.Headers.Add("X-NexMarket-Event", d.Event);
                    req.Headers.Add("X-NexMarket-Delivery", d.Id.ToString());
                    req.Headers.Add("X-NexMarket-Signature", Sign(hook.Secret, d.Payload));
                    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct); cts.CancelAfter(TimeSpan.FromSeconds(10));
                    using var res = await http.SendAsync(req, cts.Token);
                    d.LastStatus = (int)res.StatusCode;
                    if (res.IsSuccessStatusCode) { d.Status = "sent"; d.SentAt = DateTime.UtcNow; d.LastError = null; continue; }
                    d.LastError = $"The address answered {(int)res.StatusCode}.";
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested) { d.LastError = "The address took too long to answer."; }
                catch (HttpRequestException ex) { d.LastError = ex.Message.Contains("public internet") ? "Not a public web address." : "The address can't be reached."; }
                if (d.Tries > Backoff.Length) d.Status = "failed";
                else d.NextAt = DateTime.UtcNow + Backoff[d.Tries - 1];
            }
            if (due.Count > 0) await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>Keys other systems use to read the live content. The key is shown once; only its SHA-256 is kept.</summary>
    public static class SiteKeys
    {
        public static string NewKey() => "nxs_" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(30)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        public static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key.Trim()))).ToLowerInvariant();
    }

    /// <summary>
    /// Chains: a head office offers content to its branches; a branch adopts it, may change it locally, and later takes the
    /// head office's new version without losing its own changes (a field the branch changed is kept; every other field
    /// follows the head office). Both sides must agree in Setup: the branch names its head office, the head office lists the branch.
    /// </summary>
    public static class SiteChain
    {
        public static (JsonObject Result, List<string> KeptLocal) Merge(JsonObject baseCopy, JsonObject mine, JsonObject theirs)
        {
            var result = new JsonObject(); var kept = new List<string>();
            foreach (var k in mine.Select(x => x.Key).Union(theirs.Select(x => x.Key)).Union(baseCopy.Select(x => x.Key)).Distinct().ToList())
            {
                var b = baseCopy[k]; var m = mine[k]; var t = theirs[k];
                var changedHere = !JsonNode.DeepEquals(b, m);
                var v = changedHere ? m : t;
                if (changedHere && !JsonNode.DeepEquals(m, t)) kept.Add(k);
                if (v != null) result[k] = v.DeepClone();
            }
            return (result, kept);
        }

        public record Linked(OrgInfo Org, IServiceScope Scope, IMarketingDbContext Db, SiteConfig Cfg) : IDisposable
        {
            public IDisposable? Enter { get; init; }
            public void Dispose() { Scope.Dispose(); Enter?.Dispose(); }
        }

        /// <summary>Opens the head office's data, if this organisation is one of its branches and the head office agrees. Null with the reason otherwise.</summary>
        public static (Linked? Head, string? Problem) OpenHead(OrgDirectory orgs, IServiceScopeFactory scopes, SiteConfig mine)
        {
            var me = OrgScope.Current?.Key ?? orgs.Default.Key;
            if (string.IsNullOrWhiteSpace(mine.HeadOffice)) return (null, "This organisation has no head office set (Website → Setup → Chain).");
            var head = orgs.All().FirstOrDefault(o => string.Equals(o.Key, mine.HeadOffice, StringComparison.OrdinalIgnoreCase));
            if (head == null) return (null, $"There is no organisation \"{mine.HeadOffice}\" on this platform.");
            if (string.Equals(head.Key, me, StringComparison.OrdinalIgnoreCase)) return (null, "An organisation can't be its own head office.");
            var enter = OrgScope.Enter(head);
            var scope = scopes.CreateScope();
            var cfg = SiteConfig.Load(scope.ServiceProvider.GetRequiredService<IAppSettings>());
            var linked = new Linked(head, scope, scope.ServiceProvider.GetRequiredService<IMarketingDbContext>(), cfg) { Enter = enter };
            if (!cfg.Branches.Contains(me.ToLowerInvariant())) { linked.Dispose(); return (null, $"{head.Name} hasn't added this organisation as a branch yet (their Website → Setup → Chain)."); }
            return (linked, null);
        }
    }
}
