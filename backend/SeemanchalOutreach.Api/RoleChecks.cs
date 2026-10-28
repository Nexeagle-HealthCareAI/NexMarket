using System;
using System.Security.Claims;

namespace SeemanchalOutreach.Api
{
    /// <summary>
    /// Role names and checks shared by controllers, filters and hubs.
    ///
    /// Dashboard roles: Admin (full control), MarketingManager and HospitalRep (pages
    /// granted by Admin in Users &amp; roles). Every other role (Field Officer, Marketing
    /// Executive, Regional Representative, field_rep …) is a field agent who works only
    /// in the Android / agent app and never gets dashboard access.
    /// </summary>
    public static class RoleChecks
    {
        public const string AdminsGroup = "admins";
        public const string DashboardGroup = "dashboard";

        public const string Admin = "Admin";
        public const string MarketingManager = "MarketingManager";
        public const string HospitalRep = "HospitalRep";

        public static string Normalize(string? role) =>
            (role ?? string.Empty).Replace(" ", string.Empty).Replace("_", string.Empty).ToLowerInvariant();

        public static bool IsAdminRole(string? role) => Normalize(role) == "admin";

        /// <summary>Maps any spelling ("Marketing manager", "marketing_manager") to the stored role name, or null for field roles.</summary>
        public static string? CanonicalDashboardRole(string? role)
        {
            switch (Normalize(role))
            {
                case "admin": return Admin;
                case "marketingmanager": return MarketingManager;
                case "hospitalrep":
                case "hospitalrepresentative": return HospitalRep;
                default: return null;
            }
        }

        public static bool IsDashboardRole(string? role) => CanonicalDashboardRole(role) != null;

        public static string? RoleOf(this ClaimsPrincipal? user) => user?.FindFirst(ClaimTypes.Role)?.Value;

        public static bool IsAdmin(this ClaimsPrincipal? user) =>
            user != null && (user.IsInRole("Admin") || user.IsInRole("admin"));

        public static bool IsDashboardUser(this ClaimsPrincipal? user) => IsDashboardRole(user.RoleOf());

        public static string AgentIdOf(this ClaimsPrincipal? user) => user?.FindFirst("agentId")?.Value ?? string.Empty;
    }

    /// <summary>
    /// Glisan Akbari and the field team work in India time. "Today" on the dashboard
    /// always means the IST calendar day; values sent to Postgres are UTC.
    /// </summary>
    public static class IstClock
    {
        public static readonly TimeSpan Offset = TimeSpan.FromHours(5.5);

        public static DateTime NowIst => DateTime.UtcNow + Offset;

        /// <summary>UTC instant of IST midnight for the IST day containing <paramref name="utc"/>.</summary>
        public static DateTime StartOfDayUtc(DateTime utc)
        {
            var ist = utc + Offset;
            return DateTime.SpecifyKind(ist.Date - Offset, DateTimeKind.Utc);
        }

        public static DateTime TodayStartUtc => StartOfDayUtc(DateTime.UtcNow);

        public static DateTime MonthStartUtc
        {
            get
            {
                var ist = NowIst;
                return DateTime.SpecifyKind(new DateTime(ist.Year, ist.Month, 1) - Offset, DateTimeKind.Utc);
            }
        }

        /// <summary>UTC instant for a given IST hour on the IST day <paramref name="daysFromToday"/> away.</summary>
        public static DateTime AtIstHour(int daysFromToday, int hour) =>
            TodayStartUtc.AddDays(daysFromToday).AddHours(hour);
    }
}
