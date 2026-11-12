using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Banner and hoarding places. The steps: an agent suggests a place (photo + GPS) → the office approves it with the rent →
    /// the agent marks it rented → the banner goes up (photo) → the rental ends. "Ending soon" is not stored: it is a rented
    /// or live place whose end date is near.
    /// </summary>
    public static class Hoardings
    {
        public static readonly string[] Statuses = { "suggested", "approved", "rented", "live", "ended", "rejected" };
        public static readonly string[] Kinds = { "hoarding", "wall", "shop", "pole", "gate", "other" };
        /// <summary>A rental shows as "ending soon" this many days before its end date.</summary>
        public const int EndingDays = 14;
        /// <summary>The office is reminded once, this many days before the end date.</summary>
        public const int RemindDays = 7;

        public static bool Running(Hoarding h) => h.Status == "rented" || h.Status == "live";

        /// <summary>Days until the rental ends (negative once it is over); null when it isn't running or has no end date.</summary>
        public static int? DaysLeft(Hoarding h, DateOnly today) => Running(h) && h.RentEnd != null ? h.RentEnd.Value.DayNumber - today.DayNumber : null;

        /// <summary>The board column: the status, or "ending" for a running rental near (or past) its end date.</summary>
        public static string Stage(Hoarding h, DateOnly today)
        {
            var left = DaysLeft(h, today);
            return left != null && left <= EndingDays ? "ending" : h.Status;
        }

        public static string KindOf(string? kind) => Kinds.Contains((kind ?? "").Trim().ToLowerInvariant()) ? kind!.Trim().ToLowerInvariant() : "hoarding";

        public static string? Clean(string? s, int max)
        {
            s = (s ?? "").Trim();
            if (s.Length == 0) return null;
            return s.Length > max ? s[..max] : s;
        }

        /// <summary>Ten digits of an Indian mobile number, or null.</summary>
        public static string? Phone(string? raw)
        {
            var d = new string((raw ?? "").Where(char.IsDigit).ToArray());
            if (d.Length > 10) d = d[^10..];
            return d.Length == 10 ? d : null;
        }

        public static bool InIndia(double lat, double lng) => lat is > 6 and < 38 && lng is > 68 and < 98;

        public static DateOnly? Date(string? s) => DateOnly.TryParseExact((s ?? "").Trim(), "yyyy-MM-dd", out var d) ? d : null;

        /// <summary>Finds the owner by phone (or by name when no phone is given), or makes a new one.</summary>
        public static async Task<HoardingOwner?> OwnerAsync(IMarketingDbContext db, string? name, string? phone, CancellationToken ct)
        {
            name = Clean(name, 120);
            var ph = Phone(phone);
            if (name == null && ph == null) return null;
            HoardingOwner? o = null;
            if (ph != null) o = await db.HoardingOwners.FirstOrDefaultAsync(x => x.Phone == ph, ct);
            else if (name != null) { var lower = name.ToLower(); o = await db.HoardingOwners.FirstOrDefaultAsync(x => x.Phone == null && x.Name.ToLower() == lower, ct); }
            if (o != null) return o;
            o = new HoardingOwner { Name = name ?? ph!, Phone = ph };
            db.HoardingOwners.Add(o);
            return o;
        }
    }

    /// <summary>Reminds the office once when a rented hoarding is about to end, so it can be renewed or the banner taken down.</summary>
    public class HoardingSweeper : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<HoardingSweeper> _logger;
        private readonly OrgDirectory _orgs;
        public HoardingSweeper(IServiceScopeFactory scopes, ILogger<HoardingSweeper> logger, OrgDirectory orgs) { _scopes = scopes; _logger = logger; _orgs = orgs; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } catch (OperationCanceledException) { return; }
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // Reminders go out in the working day, not at night.
                    var hour = IstClock.NowIst.Hour;
                    if (hour >= 9 && hour < 19)
                    {
                        await _orgs.ForEachAsync(async _ =>
                        {
                            using var scope = _scopes.CreateScope();
                            var sp = scope.ServiceProvider;
                            await SweepAsync(sp.GetRequiredService<IMarketingDbContext>(), sp.GetRequiredService<INotifier>(), AttendanceService.TodayIst, stoppingToken);
                        });
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogDebug(ex, "Hoarding sweep failed"); }
                try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); } catch (OperationCanceledException) { return; }
            }
        }

        public static async Task<int> SweepAsync(IMarketingDbContext db, INotifier notifier, DateOnly today, CancellationToken ct)
        {
            var until = today.AddDays(Hoardings.RemindDays);
            var due = await db.Hoardings
                .Where(h => (h.Status == "rented" || h.Status == "live") && h.RentEnd != null && h.RentEnd <= until && (h.RemindedFor == null || h.RemindedFor != h.RentEnd))
                .OrderBy(h => h.RentEnd).Take(50).ToListAsync(ct);
            foreach (var h in due)
            {
                var left = h.RentEnd!.Value.DayNumber - today.DayNumber;
                var when = left < 0 ? $"ended on {h.RentEnd:d MMM}" : left == 0 ? "ends today" : left == 1 ? "ends tomorrow" : $"ends in {left} days ({h.RentEnd:d MMM})";
                notifier.Notify(new NotifyJob
                {
                    ToOffice = true, Kind = "hoarding",
                    Title = $"Hoarding rent {when}: {h.Place}",
                    Body = "Renew it with a new end date, or mark it ended when the banner comes down.",
                    Link = $"hoarding:{h.Id}", RefId = h.Id.ToString(),
                });
                h.RemindedFor = h.RentEnd;
            }
            if (due.Count > 0) await db.SaveChangesAsync(ct);
            return due.Count;
        }
    }
}
