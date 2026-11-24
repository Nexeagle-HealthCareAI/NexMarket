using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// A month's salary for one person, worked out from their date of joining (and leaving) and, when paid by attendance,
    /// the days they worked. A day's pay is the monthly salary ÷ the days in that month. Weekly days off, holidays and paid
    /// leave are paid; absent days and unpaid leave are not, and a half day is half paid. Incentives are added on top.
    /// </summary>
    public static class Payroll
    {
        public static readonly string[] Bases = { "fixed", "attendance" };
        public static readonly string[] IncentiveKinds = { "performance", "referrals", "target", "camp", "travel", "festival", "other" };
        public const decimal MaxIncentive = 500000m;

        public record Calc(
            string Month, string Basis, decimal Rate, int MonthDays, int EmployedDays,
            decimal Present, int PaidLeave, int Off, int Absent, int UnpaidLeave, int Half, int NotYet,
            decimal PayableDays, decimal PerDay, decimal Earned, decimal Incentives, DateOnly? From, DateOnly? To)
        {
            /// <summary>Days not paid: absent, unpaid leave and half of each half day.</summary>
            public decimal DeductedDays => Absent + UnpaidLeave + Half * 0.5m;
            public decimal Deduction => Math.Max(0, Math.Round(PerDay * EmployedDays, 0, MidpointRounding.AwayFromZero) - Earned);
            public decimal Net => Earned + Incentives;
        }

        public static decimal R(decimal v) => Math.Round(v, 0, MidpointRounding.AwayFromZero);

        /// <summary>The first and last day they were employed in the month, or null when not at all.</summary>
        public static (DateOnly From, DateOnly To)? Employed(MarketingStaff s, DateOnly monthStart)
        {
            var monthEnd = monthStart.AddMonths(1).AddDays(-1);
            var from = monthStart; var to = monthEnd;
            var firstMonth = Spend.MonthStart(s.FromMonth);
            if (s.JoinedOn is { } j) { if (j > from) from = j; }
            else if (firstMonth is { } fm && fm > from) from = fm;
            if (s.LeftOn is { } l) { if (l < to) to = l; }
            else if (Spend.MonthStart(s.ToMonth) is { } tm && tm.AddMonths(1).AddDays(-1) < to) to = tm.AddMonths(1).AddDays(-1);
            return from > to ? null : (from, to);
        }

        /// <summary>Paid by attendance in this month (it has a start month, and this month is on or after it).</summary>
        public static bool ByAttendance(MarketingStaff s, string month) =>
            s.PayBasis == "attendance" && (s.AttendanceFrom == null || string.CompareOrdinal(month, s.AttendanceFrom) >= 0);

        /// <param name="days">The person's days for the month (from attendance); needed only when paid by attendance.</param>
        public static Calc Compute(MarketingStaff s, decimal rate, string month, IReadOnlyList<DayStatus>? days, decimal incentives)
        {
            var start = Spend.MonthStart(month)!.Value;
            int monthDays = DateTime.DaysInMonth(start.Year, start.Month);
            var basis = ByAttendance(s, month) ? "attendance" : "fixed";
            var span = Employed(s, start);
            decimal perDay = monthDays == 0 ? 0 : rate / monthDays;
            if (span == null || rate <= 0)
                return new Calc(month, basis, rate, monthDays, 0, 0, 0, 0, 0, 0, 0, 0, 0, perDay, 0, incentives, span?.From, span?.To);
            var (from, to) = span.Value;
            int employed = to.DayNumber - from.DayNumber + 1;

            if (basis == "fixed" || days == null)
            {
                var earnedFixed = employed == monthDays ? rate : R(perDay * employed);
                return new Calc(month, "fixed", rate, monthDays, employed, employed, 0, 0, 0, 0, 0, 0, employed, perDay, earnedFixed, incentives, from, to);
            }

            decimal present = 0; int paidLeave = 0, off = 0, absent = 0, unpaid = 0, half = 0, notYet = 0;
            foreach (var d in days.Where(d => d.Date >= from && d.Date <= to))
            {
                switch (d.Status)
                {
                    case "worked": if (d.Half) { half++; present += 0.5m; } else present += 1; break;
                    case "leave": if (d.LeaveType == "unpaid") unpaid++; else paidLeave++; break;
                    case "off": off++; break;
                    case "absent": absent++; break;
                    default: notYet++; break;     // today (not in yet) and days ahead: paid unless marked otherwise later
                }
            }
            decimal payable = employed - absent - unpaid - half * 0.5m;
            if (payable < 0) payable = 0;
            var earned = payable == monthDays ? rate : R(perDay * payable);
            return new Calc(month, "attendance", rate, monthDays, employed, present, paidLeave, off, absent, unpaid, half, notYet, payable, perDay, earned, incentives, from, to);
        }

        /// <summary>What an approved month says, in the same shape.</summary>
        public static Calc FromSlip(SalarySlip x) =>
            new(x.Month, x.Basis, x.Rate, x.MonthDays, x.EmployedDays, x.PresentDays, x.PaidLeaveDays, x.OffDays, x.AbsentDays, x.UnpaidLeaveDays,
                x.HalfDays, 0, x.PayableDays, x.MonthDays == 0 ? 0 : x.Rate / x.MonthDays, x.Earned, x.Incentives, null, null);

        public static string? IncentiveProblem(decimal? amount, string? kind, string? title, string? month, DateOnly today)
        {
            if (amount == null || amount <= 0) return "Write the incentive amount.";
            if (amount > MaxIncentive) return $"An incentive can be up to {Spend.Rupees(MaxIncentive)}.";
            if (Math.Round(amount.Value, 2) != amount.Value) return "The amount can have two digits after the point at most.";
            if (!IncentiveKinds.Contains(kind ?? "")) return "Pick what the incentive is for.";
            if (string.IsNullOrWhiteSpace(title)) return "Write a short title, e.g. “November referrals”.";
            var m = Spend.MonthStart(month);
            if (m == null) return "Pick the salary month it is paid with.";
            if (m < today.AddMonths(-24) || m > today.AddMonths(2)) return "That month is too far away.";
            return null;
        }

        public static string MonthName(string month) =>
            Spend.MonthStart(month) is { } d ? d.ToString("MMMM yyyy", CultureInfo.InvariantCulture) : month;
    }
}
