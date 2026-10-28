using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Settings for cyclic calling (appsettings "Calls" section or env Calls__CycleDays etc.).
    /// </summary>
    public class CallSettings
    {
        public int CycleDays { get; set; } = 15;
        public int ImportantEveryDays { get; set; } = 7;
        public int MaxAttempts { get; set; } = 3;
        public int RetryHourIst { get; set; } = 10;

        public static CallSettings From(IConfiguration config)
        {
            var s = new CallSettings();
            config.GetSection("Calls").Bind(s);
            if (s.CycleDays < 1) s.CycleDays = 15;
            if (s.ImportantEveryDays < 1) s.ImportantEveryDays = 7;
            if (s.MaxAttempts < 1) s.MaxAttempts = 3;
            if (s.RetryHourIst < 0 || s.RetryHourIst > 23) s.RetryHourIst = 10;
            return s;
        }
    }

    /// <summary>
    /// Cycle rules:
    ///  • every callable partner is called once per cycle (CycleDays long);
    ///  • connected → next call in the next cycle (important partners: every ImportantEveryDays);
    ///  • not able to connect → back on tomorrow's list at RetryHourIst; after MaxAttempts
    ///    misses it waits for the next cycle and the field agent is asked to visit;
    ///  • a new cycle starts when the end date passes, or early once nobody is left to call.
    /// </summary>
    public class CallCycleService
    {
        private readonly IMarketingDbContext _db;
        public CallSettings Settings { get; }

        public CallCycleService(IMarketingDbContext db, IConfiguration config)
        {
            _db = db;
            Settings = CallSettings.From(config);
        }

        /// <summary>Partners the team can call: has a phone, not merged, not marked wrong number.</summary>
        public IQueryable<OutreachContact> Callable() =>
            _db.Contacts.Where(c => !c.IsMerged && !c.PhoneInvalid && c.Phone != null && c.Phone != "");

        public static DateTime EndOfTodayUtc => IstClock.TodayStartUtc.AddDays(1);

        public async Task<CallCycle> EnsureCurrentCycleAsync(CancellationToken ct = default)
        {
            var today = IstClock.TodayStartUtc;
            var current = await _db.CallCycles.Where(c => c.ClosedAt == null).OrderByDescending(c => c.Number).FirstOrDefaultAsync(ct);

            if (current == null)
            {
                int lastNumber = await _db.CallCycles.Select(c => (int?)c.Number).MaxAsync(ct) ?? 0;
                current = NewCycle(lastNumber + 1, today);
                _db.CallCycles.Add(current);
                await _db.SaveChangesAsync(ct);
                return current;
            }

            bool expired = today > current.EndDate;
            bool finishedEarly = false;
            if (!expired && today > current.StartDate)
            {
                var nextCycleStart = current.EndDate.AddDays(1);
                // Anyone still due inside this cycle (never called, or due again before it ends)?
                finishedEarly = !await Callable().AnyAsync(c => c.NextCallAt == null || c.NextCallAt < nextCycleStart, ct);
            }

            if (!expired && !finishedEarly) return current;

            var oldNextStart = current.EndDate.AddDays(1);
            current.ClosedAt = DateTime.UtcNow;
            var next = NewCycle(current.Number + 1, today);
            _db.CallCycles.Add(next);
            await _db.SaveChangesAsync(ct);

            if (finishedEarly)
            {
                // Partners parked "until the next cycle" become due now that it has started early.
                await _db.Contacts
                    .Where(c => c.NextCallAt != null && c.NextCallAt > today && c.NextCallAt <= oldNextStart && !c.IsImportant)
                    .ExecuteUpdateAsync(s => s.SetProperty(c => c.NextCallAt, today), ct);
            }
            return next;
        }

        private CallCycle NewCycle(int number, DateTime startUtc) => new CallCycle
        {
            Number = number,
            StartDate = startUtc,
            EndDate = startUtc.AddDays(Settings.CycleDays - 1),
            CreatedAt = DateTime.UtcNow,
        };

        /// <summary>Applies a call outcome to the partner and returns the attempt number recorded.</summary>
        public int ApplyOutcome(OutreachContact c, CallCycle cycle, string outcome, DateTime? callBackAt)
        {
            var now = DateTime.UtcNow;
            c.LastCalledAt = now;
            c.LastCallOutcome = outcome;
            c.LastCallCycleNumber = cycle.Number;
            c.LastModifiedAt = now;

            switch (outcome)
            {
                case "connected":
                    c.LastConnectedAt = now;
                    c.CallAttempts = 0;
                    c.NeedsVisit = false;
                    c.NextCallAt = c.IsImportant
                        ? IstClock.StartOfDayUtc(now).AddDays(Settings.ImportantEveryDays)
                        : cycle.EndDate.AddDays(1);
                    return 1;

                case "no_answer":
                    c.CallAttempts += 1;
                    int attempt = c.CallAttempts;
                    if (c.CallAttempts < Settings.MaxAttempts)
                    {
                        c.NextCallAt = IstClock.AtIstHour(1, Settings.RetryHourIst);
                    }
                    else
                    {
                        c.CallAttempts = 0;
                        c.NeedsVisit = true;
                        c.NextCallAt = cycle.EndDate.AddDays(1);
                    }
                    return attempt;

                case "call_later":
                    c.NextCallAt = callBackAt.HasValue && callBackAt.Value > now
                        ? DateTime.SpecifyKind(callBackAt.Value.ToUniversalTime(), DateTimeKind.Utc)
                        : now.AddHours(2);
                    return Math.Max(1, c.CallAttempts);

                case "wrong_number":
                    c.PhoneInvalid = true;
                    c.NextCallAt = null;
                    return 1;

                default:
                    throw new ArgumentException("Unknown call outcome.");
            }
        }
    }
}
