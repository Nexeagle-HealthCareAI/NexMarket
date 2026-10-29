using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Security
{
    /// <summary>Dashboard pages that access can be granted on, in menu order.</summary>
    public static class Pages
    {
        public const string Dashboard = "dashboard";
        public const string Calls = "calls";
        public const string Desk = "desk";
        public const string Pipeline = "pipeline";
        public const string Partners = "partners";
        public const string WhatsApp = "whatsapp";
        public const string Field = "field";
        public const string Payments = "payments";
        public const string Targets = "targets";
        public const string Analytics = "analytics";
        public const string Camps = "camps";
        public const string Departments = "departments";
        public const string Users = "users";

        public static readonly string[] All =
        {
            Dashboard, Calls, Desk, Pipeline, Partners, WhatsApp, Field,
            Payments, Targets, Analytics, Camps, Departments, Users,
        };

        public const int None = 0, View = 1, Edit = 2;

        /// <summary>Starting access for each role the first time the app runs. Admin can change all of it.</summary>
        public static readonly Dictionary<string, Dictionary<string, int>> Defaults = new()
        {
            [RoleChecks.MarketingManager] = new()
            {
                [Dashboard] = Edit, [Calls] = Edit, [Desk] = View, [Pipeline] = Edit, [Partners] = Edit,
                [WhatsApp] = Edit, [Field] = View, [Payments] = View, [Targets] = Edit, [Analytics] = View,
                [Camps] = Edit, [Departments] = View, [Users] = None,
            },
            [RoleChecks.HospitalRep] = new()
            {
                [Dashboard] = View, [Calls] = None, [Desk] = Edit, [Pipeline] = View, [Partners] = None,
                [WhatsApp] = None, [Field] = None, [Payments] = None, [Targets] = None, [Analytics] = View,
                [Camps] = View, [Departments] = Edit, [Users] = None,
            },
        };
    }

    public interface IPermissionService
    {
        Task<Dictionary<string, int>> GetLevelsAsync(string? role);
        Task<int> GetLevelAsync(ClaimsPrincipal user, params string[] pages);
        void Invalidate();
    }

    public class PermissionService : IPermissionService
    {
        private const string CacheKey = "role-permissions";
        private readonly IMarketingDbContext _db;
        private readonly IMemoryCache _cache;

        public PermissionService(IMarketingDbContext db, IMemoryCache cache)
        {
            _db = db;
            _cache = cache;
        }

        private async Task<List<RolePermission>> LoadAsync()
        {
            if (_cache.TryGetValue(CacheKey, out List<RolePermission>? cached) && cached != null) return cached;
            var rows = await _db.RolePermissions.AsNoTracking().ToListAsync();
            _cache.Set(CacheKey, rows, TimeSpan.FromMinutes(5));
            return rows;
        }

        public async Task<Dictionary<string, int>> GetLevelsAsync(string? role)
        {
            var result = Pages.All.ToDictionary(p => p, _ => Pages.None);
            var canonical = RoleChecks.CanonicalDashboardRole(role);
            if (canonical == null) return result;
            if (canonical == RoleChecks.Admin)
            {
                foreach (var p in Pages.All) result[p] = Pages.Edit;
                return result;
            }

            var rows = await LoadAsync();
            var mine = rows.Where(r => r.Role == canonical).ToList();
            if (mine.Count == 0 && Pages.Defaults.TryGetValue(canonical, out var defaults))
            {
                foreach (var kv in defaults) result[kv.Key] = kv.Value;
                return result;
            }
            foreach (var r in mine)
            {
                if (result.ContainsKey(r.PageKey)) result[r.PageKey] = Math.Clamp(r.Level, 0, 2);
            }
            return result;
        }

        public async Task<int> GetLevelAsync(ClaimsPrincipal user, params string[] pages)
        {
            var levels = await GetLevelsAsync(user.RoleOf());
            int best = 0;
            foreach (var p in pages)
            {
                if (levels.TryGetValue(p, out var l) && l > best) best = l;
            }
            return best;
        }

        public void Invalidate() => _cache.Remove(CacheKey);
    }

    /// <summary>
    /// Allows Admin always, and other dashboard roles when Users &amp; roles grants them
    /// one of the listed pages: "Can view" is enough for GET requests, anything that
    /// changes data needs "Can edit" (or set <see cref="Level"/> explicitly).
    ///
    /// Put it on a controller and/or an action; when both are present the action's
    /// attribute decides (so one action can open up to an extra page).
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
    public sealed class PageAccessAttribute : Attribute, IAsyncAuthorizationFilter
    {
        public string[] PageKeys { get; }

        /// <summary>0 = infer from the HTTP method (GET/HEAD → view, others → edit).</summary>
        public int Level { get; set; }

        /// <summary>Comma-separated dashboard roles that may always use this, whatever Users &amp; roles says
        /// (e.g. marketing managers run block assignments even when they can only view the field pages).</summary>
        public string? AlsoRoles { get; set; }

        public PageAccessAttribute(params string[] pages)
        {
            PageKeys = pages;
        }

        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var effective = context.ActionDescriptor.EndpointMetadata.OfType<PageAccessAttribute>().LastOrDefault();
            if (effective != null && !ReferenceEquals(effective, this)) return; // the action-level attribute decides

            var user = context.HttpContext.User;
            if (user?.Identity?.IsAuthenticated != true)
            {
                context.Result = new ChallengeResult();
                return;
            }
            if (user.IsAdmin()) return;
            if (!string.IsNullOrWhiteSpace(AlsoRoles))
            {
                var role = RoleChecks.CanonicalDashboardRole(user.RoleOf());
                if (role != null && AlsoRoles.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Contains(role)) return;
            }

            int needed = Level > 0
                ? Level
                : (HttpMethods.IsGet(context.HttpContext.Request.Method) || HttpMethods.IsHead(context.HttpContext.Request.Method) ? Pages.View : Pages.Edit);

            var perms = context.HttpContext.RequestServices.GetRequiredService<IPermissionService>();
            int have = await perms.GetLevelAsync(user, PageKeys);
            if (have < needed)
            {
                context.Result = new ForbidResult();
            }
        }
    }
}
