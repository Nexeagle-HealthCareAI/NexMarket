using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Hubs;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>The kinds of notification, how they read in settings, and the Android channel each uses.</summary>
    public static class NotificationKinds
    {
        public static readonly (string Kind, string Label, string Channel)[] All =
        {
            ("chat", "Chat messages to me", "chat"),
            ("team_chat", "Field team group chat", "chat"),
            ("escalation", "Escalations", "alerts"),
            ("assignment", "Block assignments", "updates"),
            ("task", "Tasks", "updates"),
            ("leave", "Leave", "updates"),
            ("referral", "Patients referred", "updates"),
            ("note", "Notes on my partners", "updates"),
            ("lead", "New leads and WhatsApp messages from patients", "chat"),
            ("payment", "Payments to my partners and my incentives", "updates"),
            ("call", "Calls to me (ringing and missed)", "calls"),
            ("huddle", "Field team huddles", "chat"),
            ("hoarding", "Banner and hoarding places", "updates"),
        };
        public static string ChannelOf(string kind) => All.FirstOrDefault(k => k.Kind == kind).Channel ?? "updates";
        public static bool IsKnown(string kind) => All.Any(k => k.Kind == kind);
    }

    /// <summary>Queues notifications for <see cref="NotificationDispatcher"/>.</summary>
    public class Notifier : INotifier
    {
        private readonly Channel<NotifyJob> _queue = Channel.CreateBounded<NotifyJob>(new BoundedChannelOptions(5000) { FullMode = BoundedChannelFullMode.DropOldest });
        public ChannelReader<NotifyJob> Reader => _queue.Reader;

        public void Notify(NotifyJob job)
        {
            if (job == null || string.IsNullOrWhiteSpace(job.Title)) return;
            if (job.Body.Length > 300) job.Body = job.Body[..300] + "…";
            job.Org ??= OrgScope.Current;
            _queue.Writer.TryWrite(job);
        }
    }

    /// <summary>
    /// Delivers queued notifications: one inbox row per person, a live "notify" to their open CRM tabs,
    /// and a push to each of their phones (unless they turned that kind off).
    /// </summary>
    public class NotificationDispatcher : BackgroundService
    {
        private readonly Notifier _notifier;
        private readonly IServiceScopeFactory _scopes;
        private readonly IHubContext<LiveHub> _hub;
        private readonly FcmSender _fcm;
        private readonly ILogger<NotificationDispatcher> _logger;

        public NotificationDispatcher(INotifier notifier, IServiceScopeFactory scopes, IHubContext<LiveHub> hub, FcmSender fcm, ILogger<NotificationDispatcher> logger)
        {
            _notifier = (Notifier)notifier;
            _scopes = scopes;
            _hub = hub;
            _fcm = fcm;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await foreach (var job in _notifier.Reader.ReadAllAsync(stoppingToken))
            {
                try { using (OrgScope.Enter(job.Org)) await DeliverAsync(job, stoppingToken); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogWarning(ex, "Could not deliver notification {Kind}", job.Kind);
                }
            }
        }

        public static async Task<List<string>> OfficeUsersAsync(IMarketingDbContext db, IPermissionService perms, CancellationToken ct)
        {
            var people = await db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct);
            var result = new List<string>();
            var fieldView = new Dictionary<string, bool>();
            foreach (var p in people)
            {
                var role = RoleChecks.CanonicalDashboardRole(p.Role);
                if (role == null) continue;
                if (role == RoleChecks.Admin || role == RoleChecks.MarketingManager) { result.Add(p.AgentId); continue; }
                if (!fieldView.TryGetValue(role, out var ok))
                {
                    var levels = await perms.GetLevelsAsync(role);
                    ok = levels.TryGetValue(Pages.Field, out var lvl) && lvl >= Pages.View;
                    fieldView[role] = ok;
                }
                if (ok) result.Add(p.AgentId);
            }
            return result;
        }

        private async Task DeliverAsync(NotifyJob job, CancellationToken ct)
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var perms = scope.ServiceProvider.GetRequiredService<IPermissionService>();

            var to = new HashSet<string>(job.To.Where(x => !string.IsNullOrWhiteSpace(x)));
            if (job.ToOffice) foreach (var id in await OfficeUsersAsync(db, perms, ct)) to.Add(id);
            if (!string.IsNullOrEmpty(job.Except)) to.Remove(job.Except);
            if (to.Count == 0) return;
            var ids = to.ToList();
            // Only active people.
            ids = await db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId) && a.IsActive).Select(a => a.AgentId).ToListAsync(ct);
            if (ids.Count == 0) return;

            // A phone-only signal (stop ringing): straight to the phones, nothing in the inbox.
            if (job.Quiet)
            {
                if (!_fcm.Configured) return;
                var quietTo = await db.PushDevices.Where(d => ids.Contains(d.UserId) && d.Enabled).ToListAsync(ct);
                foreach (var d in quietTo) await _fcm.SendDataAsync(d.Token, job.Data, job.TtlSeconds ?? 60, ct);
                return;
            }

            var muted = (await db.NotificationSettings.AsNoTracking().Where(s => ids.Contains(s.UserId)).ToListAsync(ct))
                .ToDictionary(s => s.UserId, s => new HashSet<string>(s.MutedKinds.Split(',', StringSplitOptions.RemoveEmptyEntries)));

            var rows = ids.Select(u => new Notification
            {
                UserId = u, Kind = job.Kind, Title = Trim(job.Title, 120), Body = job.Body, Link = job.Link, RefId = job.RefId,
            }).ToList();
            db.Notifications.AddRange(rows);
            await db.SaveChangesAsync(ct);

            foreach (var n in rows)
            {
                var off = muted.TryGetValue(n.UserId, out var m) && m.Contains(n.Kind);
                try
                {
                    await _hub.Clients.Group(OrgKeys.Of(LiveHub.UserGroup(n.UserId))).SendAsync("notify", new
                    {
                        id = n.Id, kind = n.Kind, title = n.Title, body = n.Body, link = n.Link, createdAt = n.CreatedAt, muted = off,
                    }, ct);
                }
                catch (Exception ex) { _logger.LogDebug(ex, "Live notify failed"); }
            }

            if (!_fcm.Configured) return;
            var pushTo = ids.Where(u => !(muted.TryGetValue(u, out var m) && m.Contains(job.Kind))).ToList();
            if (pushTo.Count == 0) return;
            var devices = await db.PushDevices.Where(d => pushTo.Contains(d.UserId) && d.Enabled).ToListAsync(ct);
            var byUser = rows.ToDictionary(r => r.UserId, r => r.Id);
            var unread = await db.Notifications.AsNoTracking().Where(x => pushTo.Contains(x.UserId) && x.ReadAt == null)
                .GroupBy(x => x.UserId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
            var changed = false;
            foreach (var d in devices)
            {
                var data = new Dictionary<string, string>
                {
                    ["id"] = byUser.TryGetValue(d.UserId, out var nid) ? nid.ToString() : "",
                    ["kind"] = job.Kind,
                    ["link"] = job.Link ?? "",
                    ["badge"] = unread.GetValueOrDefault(d.UserId).ToString(),
                };
                foreach (var kv in job.Data) data[kv.Key] = kv.Value;
                // A ringing call: data only, so the app shows its own full-screen ringing (no title or body keys, or
                // Android would show a plain notification of its own as well).
                var r = job.Ring
                    ? await _fcm.SendDataAsync(d.Token, data, job.TtlSeconds ?? 45, ct)
                    : await _fcm.SendAsync(d.Token, Trim(job.Title, 120), job.Body, NotificationKinds.ChannelOf(job.Kind), job.Link ?? job.Kind, data, ct);
                if (r == FcmResult.TokenGone) { d.Enabled = false; changed = true; }
            }
            if (changed) await db.SaveChangesAsync(ct);
        }

        private static string Trim(string s, int n) => s.Length > n ? s[..n] : s;
    }

    public enum FcmResult { Sent, Failed, TokenGone }

    /// <summary>
    /// Firebase Cloud Messaging (HTTP v1). Configure with Push:Fcm:ServiceAccountJson (or …Base64): the Firebase
    /// service-account key, kept as a server secret. Without it, push is off; the inbox and the CRM still work.
    /// </summary>
    public class FcmSender
    {
        private readonly IHttpClientFactory _http;
        private readonly ILogger<FcmSender> _logger;
        private readonly string? _projectId, _email;
        private readonly RSA? _key;
        private string? _token;
        private DateTime _tokenUntil;
        private readonly SemaphoreSlim _lock = new(1, 1);

        public FcmSender(IConfiguration config, IHttpClientFactory http, ILogger<FcmSender> logger)
        {
            _http = http;
            _logger = logger;
            try
            {
                var json = config["Push:Fcm:ServiceAccountJson"];
                var b64 = config["Push:Fcm:ServiceAccountBase64"];
                if (string.IsNullOrWhiteSpace(json) && !string.IsNullOrWhiteSpace(b64)) json = Encoding.UTF8.GetString(Convert.FromBase64String(b64));
                if (string.IsNullOrWhiteSpace(json)) return;
                using var doc = JsonDocument.Parse(json);
                _projectId = doc.RootElement.GetProperty("project_id").GetString();
                _email = doc.RootElement.GetProperty("client_email").GetString();
                var pem = doc.RootElement.GetProperty("private_key").GetString();
                if (string.IsNullOrEmpty(_projectId) || string.IsNullOrEmpty(_email) || string.IsNullOrEmpty(pem)) return;
                _key = RSA.Create();
                _key.ImportFromPem(pem);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Push:Fcm service account could not be read; phone push is off");
                _key = null;
            }
        }

        public bool Configured => _key != null && _projectId != null && _email != null;

        private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private async Task<string?> AccessTokenAsync(CancellationToken ct)
        {
            if (_token != null && DateTime.UtcNow < _tokenUntil) return _token;
            await _lock.WaitAsync(ct);
            try
            {
                if (_token != null && DateTime.UtcNow < _tokenUntil) return _token;
                var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                var header = B64(Encoding.UTF8.GetBytes("{\"alg\":\"RS256\",\"typ\":\"JWT\"}"));
                var claims = B64(JsonSerializer.SerializeToUtf8Bytes(new
                {
                    iss = _email, scope = "https://www.googleapis.com/auth/firebase.messaging",
                    aud = "https://oauth2.googleapis.com/token", iat = now, exp = now + 3600,
                }));
                var sig = B64(_key!.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
                var client = _http.CreateClient("fcm");
                using var res = await client.PostAsync("https://oauth2.googleapis.com/token", new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    ["assertion"] = $"{header}.{claims}.{sig}",
                }), ct);
                var body = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode) { _logger.LogWarning("FCM token request failed: {Status} {Body}", res.StatusCode, body); return null; }
                using var doc = JsonDocument.Parse(body);
                _token = doc.RootElement.GetProperty("access_token").GetString();
                _tokenUntil = DateTime.UtcNow.AddSeconds(doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() - 300 : 3000);
                return _token;
            }
            finally { _lock.Release(); }
        }

        public Task<FcmResult> SendAsync(string deviceToken, string title, string body, string channel, string tag, Dictionary<string, string> data, CancellationToken ct) =>
            PostAsync(new
            {
                message = new
                {
                    token = deviceToken,
                    notification = new { title, body },
                    data,
                    android = new
                    {
                        priority = "HIGH",
                        notification = new { channel_id = channel, tag, color = "#0a72d6", sound = "default", notification_priority = channel == "updates" ? "PRIORITY_DEFAULT" : "PRIORITY_HIGH" },
                    },
                },
            }, ct);

        /// <summary>
        /// A data-only push at high priority: wakes the app (even when it was closed) without showing anything by itself.
        /// Dropped by Firebase if it can't be delivered within <paramref name="ttlSeconds"/>.
        /// </summary>
        public Task<FcmResult> SendDataAsync(string deviceToken, Dictionary<string, string> data, int ttlSeconds, CancellationToken ct) =>
            PostAsync(new
            {
                message = new
                {
                    token = deviceToken,
                    data,
                    android = new { priority = "HIGH", ttl = $"{Math.Max(1, ttlSeconds)}s" },
                },
            }, ct);

        private async Task<FcmResult> PostAsync(object payload, CancellationToken ct)
        {
            if (!Configured) return FcmResult.Failed;
            try
            {
                var token = await AccessTokenAsync(ct);
                if (token == null) return FcmResult.Failed;
                var client = _http.CreateClient("fcm");
                using var req = new HttpRequestMessage(HttpMethod.Post, $"https://fcm.googleapis.com/v1/projects/{_projectId}/messages:send")
                {
                    Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var res = await client.SendAsync(req, ct);
                if (res.IsSuccessStatusCode) return FcmResult.Sent;
                var text = await res.Content.ReadAsStringAsync(ct);
                if (res.StatusCode == HttpStatusCode.NotFound || text.Contains("UNREGISTERED") || (res.StatusCode == HttpStatusCode.BadRequest && text.Contains("registration token")))
                    return FcmResult.TokenGone;
                if (res.StatusCode == HttpStatusCode.Unauthorized) _token = null;
                _logger.LogWarning("FCM send failed: {Status} {Body}", res.StatusCode, text.Length > 300 ? text[..300] : text);
                return FcmResult.Failed;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "FCM send failed");
                return FcmResult.Failed;
            }
        }
    }
}
