using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The organisations on this server. The first one is the server's own database (the platform database), which also
    /// holds the list of the others. The list is re-read every 30 seconds.
    /// </summary>
    public class OrgDirectory
    {
        public const string Header = "X-Org";
        public const string Cookie = "nx_org";
        public const string Claim = "org";

        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<OrgDirectory> _logger;
        private readonly object _gate = new();
        private List<OrgInfo> _others = new();
        private DateTime _loadedAt = DateTime.MinValue;

        /// <summary>The first organisation: the one whose data is in the platform database.</summary>
        public OrgInfo Default { get; }

        public OrgDirectory(IServiceScopeFactory scopes, IConfiguration config, ILogger<OrgDirectory> logger)
        {
            _scopes = scopes;
            _logger = logger;
            Default = new OrgInfo(OrgNames.Key(config["Platform:DefaultOrg"]) ?? "main", config["Platform:DefaultOrgName"] ?? OrgText.FirstName, null,
                string.IsNullOrWhiteSpace(config["Platform:DefaultOrgKinds"]) ? "hospital" : config["Platform:DefaultOrgKinds"]);
        }

        private List<OrgInfo> Others()
        {
            if (_loadedAt > DateTime.UtcNow.AddSeconds(-30)) return _others;
            lock (_gate)
            {
                if (_loadedAt > DateTime.UtcNow.AddSeconds(-30)) return _others;
                try
                {
                    // The list is only in the platform database, whoever is asking.
                    using var platform = OrgScope.Enter(null);
                    using var scope = _scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                    var rows = db.Organisations.AsNoTracking().Where(o => o.Status == "active").ToList();
                    var kinds = rows.GroupBy(o => o.Key).ToDictionary(g => g.Key, g => g.First().Kinds);
                    _others = Pick(rows.Select(o => (o.Key, o.Name, o.Database)), Default.Key)
                        .Select(o => o with { Kinds = kinds.TryGetValue(o.Key, out var k) ? k : null }).ToList();
                }
                catch (Exception ex)
                {
                    // Not reachable, or the table isn't there yet on a first start: keep what we had.
                    _logger.LogWarning(ex, "Could not read the list of organisations");
                }
                _loadedAt = DateTime.UtcNow;
                return _others;
            }
        }

        /// <summary>
        /// Keeps only rows that can be used safely: a proper key, not the first organisation's key, a database of its own,
        /// and no two organisations sharing a key or a database.
        /// </summary>
        public static List<OrgInfo> Pick(IEnumerable<(string Key, string Name, string? Database)> rows, string defaultKey)
        {
            var keys = new HashSet<string> { defaultKey };
            var dbs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var list = new List<OrgInfo>();
            foreach (var (key, name, database) in rows)
            {
                var k = OrgNames.Key(key);
                var d = (database ?? "").Trim();
                if (k == null || k != key || d.Length == 0) continue;
                if (!keys.Add(k) || !dbs.Add(d)) continue;
                list.Add(new OrgInfo(k, string.IsNullOrWhiteSpace(name) ? k : name.Trim(), d));
            }
            return list;
        }

        /// <summary>Forget the cached list (after an organisation is added or paused).</summary>
        public void Refresh() { lock (_gate) { _loadedAt = DateTime.MinValue; } }

        public IReadOnlyList<OrgInfo> All() => new[] { Default }.Concat(Others()).ToList();

        /// <summary>Empty = the first organisation. An unknown key = null.</summary>
        public OrgInfo? Find(string? key)
        {
            var k = (key ?? "").Trim().ToLowerInvariant();
            if (k.Length == 0 || k == Default.Key) return Default;
            return Others().FirstOrDefault(o => o.Key == k);
        }

        /// <summary>
        /// Which organisation a request is for. A signed-in person: always the one in their token, whatever else the
        /// request says. Not signed in (the sign-in page, a public form, a webhook): the X-Org header, else ?org= in the
        /// address, else the cookie left by the last sign-in on this browser.
        /// </summary>
        public static string? KeyFor(bool signedIn, string? claim, string? header, string? query, string? cookie)
        {
            if (signedIn) return claim;
            if (!string.IsNullOrWhiteSpace(header)) return header;
            // Webhooks (Meta) and public forms cannot send a header: their address ends in ?org=<name>.
            return !string.IsNullOrWhiteSpace(query) ? query : cookie;
        }

        /// <summary>Runs a piece of background work once for each organisation, each against its own database.</summary>
        public async Task ForEachAsync(Func<OrgInfo, Task> work)
        {
            foreach (var org in All())
            {
                using var enter = OrgScope.Enter(org);
                try { await work(org); }
                catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogError(ex, "Background work failed for organisation {Org}", org.Key); }
            }
        }
    }

    /// <summary>Points each request at its organisation's database. Runs after sign-in is checked, before anything touches data.</summary>
    public class OrgMiddleware
    {
        private readonly RequestDelegate _next;
        public OrgMiddleware(RequestDelegate next) { _next = next; }

        public async Task InvokeAsync(HttpContext ctx, OrgDirectory orgs)
        {
            var signedIn = ctx.User?.Identity?.IsAuthenticated == true;
            var key = OrgDirectory.KeyFor(signedIn, ctx.User?.FindFirst(OrgDirectory.Claim)?.Value,
                ctx.Request.Headers[OrgDirectory.Header].ToString(), ctx.Request.Query[OrgDirectory.Claim].ToString(), ctx.Request.Cookies.TryGetValue(OrgDirectory.Cookie, out var c) ? c : null);
            var org = orgs.Find(key);
            if (org == null)
            {
                // Never fall back to another organisation's data.
                ctx.Response.StatusCode = signedIn ? StatusCodes.Status401Unauthorized : StatusCodes.Status404NotFound;
                await ctx.Response.WriteAsJsonAsync(new { message = signedIn ? "This organisation is no longer active. Sign in again." : "We don't know this organisation. Check the name and try again." });
                return;
            }
            using (OrgScope.Enter(org)) await _next(ctx);
        }
    }

    /// <summary>
    /// The server's short-lived memory (sign-in locks, cached lists…) kept apart per organisation, so one can never read
    /// what another cached. The first organisation keeps the plain keys it always had.
    /// </summary>
    public sealed class OrgMemoryCache : IMemoryCache
    {
        private readonly IMemoryCache _inner;
        public OrgMemoryCache(IMemoryCache inner) { _inner = inner; }

        public static object KeyFor(OrgInfo? org, object key) => org?.Database == null ? key : (org.Key, key);
        private static object K(object key) => KeyFor(OrgScope.Current, key);

        public ICacheEntry CreateEntry(object key) => _inner.CreateEntry(K(key));
        public void Remove(object key) => _inner.Remove(K(key));
        public bool TryGetValue(object key, out object? value) => _inner.TryGetValue(K(key), out value);
        public void Dispose() => _inner.Dispose();
    }
}
