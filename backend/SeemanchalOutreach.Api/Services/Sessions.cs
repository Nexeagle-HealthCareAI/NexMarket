using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>The three kinds of device a person can be signed in on at the same time (one of each).</summary>
    public static class DeviceKinds
    {
        public const string Desktop = "desktop", Tablet = "tablet", Phone = "phone";

        public static string Label(string? kind) => kind switch { Phone => "phone", Tablet => "tablet", _ => "laptop or desktop" };

        /// <summary>The app says what it is (X-Device-Type); otherwise the browser's user agent decides.</summary>
        public static string Detect(HttpRequest req)
        {
            var said = req.Headers["X-Device-Type"].ToString().Trim().ToLowerInvariant();
            if (said is Desktop or Tablet or Phone) return said;
            var ua = req.Headers.UserAgent.ToString();
            if (ua.Contains("iPad", StringComparison.OrdinalIgnoreCase) || ua.Contains("Tablet", StringComparison.OrdinalIgnoreCase)
                || (ua.Contains("Android", StringComparison.OrdinalIgnoreCase) && !ua.Contains("Mobile", StringComparison.OrdinalIgnoreCase)))
                return Tablet;
            if (ua.Contains("Mobi", StringComparison.OrdinalIgnoreCase) || ua.Contains("iPhone", StringComparison.OrdinalIgnoreCase)
                || ua.Contains("Android", StringComparison.OrdinalIgnoreCase) || ua.Contains("okhttp", StringComparison.OrdinalIgnoreCase))
                return Phone;
            return Desktop;
        }

        public static string? Ip(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString();
    }

    /// <summary>The signed-in person behind the current request, for the activity log.</summary>
    public sealed class HttpAuditActor : IAuditActor
    {
        private readonly IHttpContextAccessor _http;
        public HttpAuditActor(IHttpContextAccessor http) => _http = http;

        private HttpContext? Ctx => _http.HttpContext;
        private ClaimsPrincipal? U => Ctx?.User?.Identity?.IsAuthenticated == true ? Ctx.User : null;

        public string ActorId => U?.FindFirst("agentId")?.Value ?? "system";
        public string? ActorName => U?.FindFirst(ClaimTypes.Name)?.Value ?? (Ctx == null ? "System" : null);
        public string? ActorRole => U?.FindFirst(ClaimTypes.Role)?.Value;
        public string Source => Ctx == null ? "system"
            : string.Equals(Ctx.Request.Headers["X-Client"].ToString(), "mobile", StringComparison.OrdinalIgnoreCase) ? "app" : "crm";
        public string? DeviceId => U?.FindFirst("did")?.Value;
        public string? DeviceType => U?.FindFirst("dtype")?.Value ?? (Ctx == null ? null : DeviceKinds.Detect(Ctx.Request));
        public string? Ip => Ctx == null ? null : DeviceKinds.Ip(Ctx);
        public string? Request => Ctx == null ? null : $"{Ctx.Request.Method} {Ctx.Request.Path}";
    }

    /// <summary>Checks on every request that the token's session hasn't been replaced or signed out.</summary>
    public static class SessionGuard
    {
        private static string Key(string sid) => "session-active:" + sid;

        /// <summary>null = still active; otherwise why it ended.</summary>
        public static async Task<string?> EndedReasonAsync(IMarketingDbContext db, IMemoryCache cache, string sid, CancellationToken ct)
        {
            if (cache.TryGetValue(Key(sid), out string? cached)) return cached == "" ? null : cached;
            if (!Guid.TryParse(sid, out var id)) return "Session not recognised. Please sign in again.";
            var now = DateTime.UtcNow;
            var s = await db.AgentRefreshTokens.AsNoTracking().Where(t => t.Id == id)
                .Select(t => new { t.ExpiresAt, t.RevokedAt, t.RevokedReason, t.LastSeenAt }).FirstOrDefaultAsync(ct);
            string? reason = s == null ? "You were signed out. Please sign in again."
                : s.RevokedAt != null ? (s.RevokedReason ?? "You were signed out. Please sign in again.")
                : s.ExpiresAt < now ? "Your session ended. Please sign in again."
                : null;
            if (reason == null && (s!.LastSeenAt == null || s.LastSeenAt < now.AddMinutes(-5)))
            {
                try { await db.AgentRefreshTokens.Where(t => t.Id == id).ExecuteUpdateAsync(u => u.SetProperty(t => t.LastSeenAt, now), ct); }
                catch (InvalidOperationException) { /* provider without bulk updates (tests) */ }
            }
            cache.Set(Key(sid), reason ?? "", TimeSpan.FromSeconds(30));
            return reason;
        }

        /// <summary>Makes an ended session stop working at once on this server, not after the cache runs out.</summary>
        public static void Forget(IMemoryCache cache, Guid sid) => cache.Remove(Key(sid.ToString()));

        /// <summary>Ends a session (keeps the row as history).</summary>
        public static void End(AgentRefreshToken s, string reason, IMemoryCache cache)
        {
            var now = DateTime.UtcNow;
            s.RevokedAt = now;
            s.RevokedReason = reason;
            s.ExpiresAt = now.AddSeconds(-1);
            s.TokenHash = "";
            Forget(cache, s.Id);
        }
    }

    /// <summary>Sign-in events for the activity log (the session table itself isn't logged automatically).</summary>
    public static class AuthAudit
    {
        public static AuditLog Event(HttpContext ctx, FieldAgent who, string action, string summary, string? deviceId, string? deviceType) => new()
        {
            ActorId = who.AgentId,
            ActorName = who.Name,
            ActorRole = who.Role,
            Source = string.Equals(ctx.Request.Headers["X-Client"].ToString(), "mobile", StringComparison.OrdinalIgnoreCase) ? "app" : "crm",
            DeviceId = deviceId,
            DeviceType = deviceType,
            Ip = DeviceKinds.Ip(ctx),
            Request = $"{ctx.Request.Method} {ctx.Request.Path}",
            Action = action,
            Entity = "Sign-in",
            EntityId = who.AgentId,
            Summary = summary,
        };
    }
}
