using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The hospital's own health card: plans (price, validity, members, discounts, free OPD visits), cards given at camps,
    /// by agents or at the desk, renewals, and visits made with a card with the discount it gave.
    /// </summary>
    public static class HealthCards
    {
        public static readonly string[] Sources = { "camp", "agent", "desk", "other" };
        public static readonly string[] UseKinds = { "opd", "ipd", "procedure", "lab", "pharmacy", "other" };
        public static readonly string[] Modes = { "cash", "upi", "bank", "free" };
        public const int ExpiringDays = 30;
        public const decimal MaxMoney = 5000000m;

        public sealed record Member(string Name, int? Age, string? Relation);

        public static List<Member> Members(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new();
            try { return JsonSerializer.Deserialize<List<Member>>(json, AttendanceConfig.Json) ?? new(); }
            catch (JsonException) { return new(); }
        }

        public static string? MembersJson(IEnumerable<Member>? members)
        {
            var list = (members ?? Enumerable.Empty<Member>())
                .Where(m => !string.IsNullOrWhiteSpace(m.Name))
                .Select(m => new Member(m.Name.Trim()[..Math.Min(80, m.Name.Trim().Length)], m.Age is >= 0 and <= 120 ? m.Age : null,
                    string.IsNullOrWhiteSpace(m.Relation) ? null : m.Relation.Trim()[..Math.Min(30, m.Relation.Trim().Length)]))
                .ToList();
            return list.Count == 0 ? null : JsonSerializer.Serialize(list, AttendanceConfig.Json);
        }

        /// <summary>active | expiring (within 30 days) | expired | cancelled</summary>
        public static string Status(HealthCard c, DateOnly today) =>
            c.Status == "cancelled" ? "cancelled" : c.ValidTill < today ? "expired" : c.ValidTill <= today.AddDays(ExpiringDays) ? "expiring" : "active";

        public static bool Usable(HealthCard c, DateOnly on) => c.Status != "cancelled" && on >= c.IssuedOn && on <= c.ValidTill;

        public static DateOnly ValidTill(DateOnly from, int months) => from.AddMonths(Math.Max(1, months)).AddDays(-1);

        /// <summary>The plan's discount for a kind of bill, in percent.</summary>
        public static decimal Pct(HealthCardPlan p, string kind) => kind switch
        {
            "opd" => p.OpdDiscountPct,
            "ipd" or "procedure" => p.IpdDiscountPct,
            "lab" => p.LabDiscountPct,
            "pharmacy" => p.PharmacyDiscountPct,
            _ => 0,
        };

        /// <summary>
        /// What the card takes off a bill: an OPD visit is free while free visits are left (the whole OPD bill); otherwise
        /// the plan's percentage for that kind, to the rupee.
        /// </summary>
        public static (decimal Discount, bool Free) DiscountFor(HealthCardPlan p, string kind, decimal bill, int freeVisitsLeft)
        {
            if (bill <= 0) return (0, kind == "opd" && freeVisitsLeft > 0);
            if (kind == "opd" && freeVisitsLeft > 0) return (bill, true);
            return (Math.Round(bill * Pct(p, kind) / 100m, 0, MidpointRounding.AwayFromZero), false);
        }

        public static int FreeLeft(HealthCardPlan p, IEnumerable<HealthCardUse> uses) =>
            Math.Max(0, p.FreeOpdVisits - uses.Count(u => !u.Removed && u.FreeVisit));

        public static string? PlanProblem(string? name, decimal? price, int? months, int? members, decimal?[] pcts, int? freeVisits)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Give the card a name, e.g. “Family health card”.";
            if (price == null || price < 0 || price > MaxMoney) return "Write the card's price (0 if it is free).";
            if (months is null or < 1 or > 120) return "Valid for 1 to 120 months.";
            if (members is null or < 1 or > 20) return "A card covers 1 to 20 people.";
            if (pcts.Any(p => p is < 0 or > 100)) return "Discounts are between 0 and 100%.";
            if (freeVisits is < 0 or > 100) return "Free OPD visits: 0 to 100.";
            return null;
        }

        /// <summary>A 10-digit Indian mobile from what was typed, or null.</summary>
        public static string? Phone(string? s)
        {
            var d = new string((s ?? "").Where(char.IsDigit).ToArray());
            if (d.Length == 12 && d.StartsWith("91")) d = d[2..];
            if (d.Length == 11 && d.StartsWith("0")) d = d[1..];
            return d.Length == 10 && "6789".Contains(d[0]) ? d : null;
        }

        /// <summary>HC26-00042: the year, then a running number for that year.</summary>
        public static string Number(int year, int seq) => $"HC{year % 100:D2}-{seq:D5}";

        public static async Task<string> NextNumberAsync(IMarketingDbContext db, int year, CancellationToken ct)
        {
            var prefix = $"HC{year % 100:D2}-";
            var last = await db.HealthCards.AsNoTracking().Where(c => c.Number.StartsWith(prefix)).Select(c => c.Number).ToListAsync(ct);
            var max = last.Select(n => int.TryParse(n[prefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : 0).DefaultIfEmpty(0).Max();
            return Number(year, max + 1);
        }

        public static string Money(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture);
    }
}
