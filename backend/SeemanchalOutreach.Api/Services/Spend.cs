using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Marketing spend: what was spent each day and on what, and who holds the organisation's money.
    ///
    /// A person's balance = money given to them − money they returned − their approved expenses.
    ///   above zero: they still hold that much of the organisation's money (to spend or return);
    ///   below zero: the organisation owes them that much (they spent their own money) until it is settled by giving it.
    /// Expenses the organisation paid directly ("office") count in the daily spend but in nobody's balance.
    /// </summary>
    public static class Spend
    {
        public static readonly string[] Categories = { "agents", "food", "petrol", "stay", "banner", "digital", "rent", "other" };
        /// <summary>What an agent can add from the phone: everything except pay, which only the office records.</summary>
        public static readonly string[] AgentCategories = { "food", "petrol", "stay", "banner", "digital", "rent", "other" };
        public static readonly Dictionary<string, string> Labels = new()
        {
            ["agents"] = "Salaries", ["food"] = "Food", ["petrol"] = "Petrol", ["stay"] = "Stay", ["banner"] = "Banners",
            ["digital"] = "Digital marketing", ["rent"] = "Room rent", ["other"] = "Other",
        };
        public static readonly string[] Modes = { "cash", "upi", "bank" };

        public const decimal MaxAmount = 1_000_000m;
        /// <summary>An agent can add an expense for today or up to this many days back.</summary>
        public const int AgentDaysBack = 31;
        /// <summary>The office can enter older spending, up to this far back.</summary>
        public const int OfficeDaysBack = 730;

        public static string CategoryOf(string? c)
        {
            c = (c ?? "").Trim().ToLowerInvariant();
            return Categories.Contains(c) ? c : "other";
        }

        public static string? ModeOf(string? m)
        {
            m = (m ?? "").Trim().ToLowerInvariant();
            return Modes.Contains(m) ? m : null;
        }

        public static string Label(string c) => Labels.GetValueOrDefault(c, c);

        public static string Rupees(decimal a) => "₹" + Math.Round(a, 2).ToString(a == Math.Truncate(a) ? "#,##0" : "#,##0.00", System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>What is wrong with an amount and a day, or null.</summary>
        public static string? Problem(decimal? amount, DateOnly? on, DateOnly today, int daysBack)
        {
            if (amount == null || amount <= 0) return "Write the amount.";
            if (amount > MaxAmount) return $"One entry can be up to {Rupees(MaxAmount)}.";
            if (Math.Round(amount.Value, 2) != amount.Value) return "The amount can have two digits after the point at most.";
            if (on == null) return "Pick the day.";
            if (on > today) return "The day can't be in the future.";
            if (on < today.AddDays(-daysBack)) return daysBack == AgentDaysBack ? $"You can add an expense up to {AgentDaysBack} days back. Ask the office for an older one." : "That day is too far back.";
            return null;
        }

        public static bool Counts(MarketingExpense e) => !e.Removed && e.Status == "approved";

        public record Balance(decimal Given, decimal Returned, decimal Spent, decimal Pending)
        {
            /// <summary>Above zero: the person holds it. Below zero: the organisation owes it to them.</summary>
            public decimal Net => Given - Returned - Spent;
            public decimal Holds => Math.Max(0, Net);
            public decimal Owed => Math.Max(0, -Net);
        }

        /// <summary>One person's balance from their own rows (others' rows and removed rows are ignored).</summary>
        public static Balance BalanceOf(string agentId, IEnumerable<MarketingMoneyMove> moves, IEnumerable<MarketingExpense> expenses)
        {
            var mine = moves.Where(m => !m.Removed && m.AgentId == agentId).ToList();
            var spent = expenses.Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId == agentId).ToList();
            return new Balance(
                mine.Where(m => m.Kind == "given").Sum(m => m.Amount),
                mine.Where(m => m.Kind == "returned").Sum(m => m.Amount),
                spent.Where(e => e.Status == "approved").Sum(e => e.Amount),
                spent.Where(e => e.Status == "pending").Sum(e => e.Amount));
        }

        /// <summary>The single entry that clears a balance: give what is owed, or take back what is held. Null when it is zero.</summary>
        public static (string Kind, decimal Amount)? Settling(Balance b) =>
            b.Net < 0 ? ("given", -b.Net) : b.Net > 0 ? ("returned", b.Net) : null;

        public record Day(DateOnly Date, decimal Total, Dictionary<string, decimal> ByCategory);

        /// <summary>Approved spend for each day that has any, newest first, split by category.</summary>
        public static List<Day> Days(IEnumerable<MarketingExpense> expenses) =>
            expenses.Where(Counts).GroupBy(e => e.SpentOn).OrderByDescending(g => g.Key)
                .Select(g => new Day(g.Key, g.Sum(e => e.Amount), g.GroupBy(e => e.Category).ToDictionary(c => c.Key, c => c.Sum(e => e.Amount)))).ToList();

        public static Dictionary<string, decimal> ByCategory(IEnumerable<MarketingExpense> expenses) =>
            expenses.Where(Counts).GroupBy(e => e.Category).ToDictionary(c => c.Key, c => c.Sum(e => e.Amount));

        // ── Per person ──────────────────────────────────────────────────────────

        /// <summary>The person an expense was spent on: the one named, else the person who paid it.</summary>
        public static string? ForOf(MarketingExpense e) => e.ForAgentId ?? (e.PaidBy == "person" ? e.AgentId : null);

        public record PersonCost(string AgentId, decimal Total, Dictionary<string, decimal> ByCategory);

        /// <summary>Approved spend on each person, split by kind, biggest first.</summary>
        public static List<PersonCost> ByPerson(IEnumerable<MarketingExpense> expenses) =>
            expenses.Where(e => Counts(e) && ForOf(e) != null).GroupBy(e => ForOf(e)!)
                .Select(g => new PersonCost(g.Key, g.Sum(e => e.Amount), g.GroupBy(e => e.Category).ToDictionary(c => c.Key, c => c.Sum(e => e.Amount))))
                .OrderByDescending(p => p.Total).ThenBy(p => p.AgentId).ToList();

        // ── Salaries ────────────────────────────────────────────────────────────

        public static string Month(DateOnly d) => d.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>"yyyy-MM" as the first day of that month, or null.</summary>
        public static DateOnly? MonthStart(string? m) =>
            DateOnly.TryParseExact((m ?? "").Trim() + "-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var d) ? d : null;

        public static string? MonthOf(string? m) => MonthStart(m) is { } d ? Month(d) : null;

        /// <summary>What is wrong with a salary and its first month, or null. A month can be up to two years back or three months ahead.</summary>
        public static string? SalaryProblem(decimal? amount, string? fromMonth, DateOnly today)
        {
            if (amount == null || amount <= 0) return "Write the monthly salary.";
            if (amount > MaxAmount) return $"A salary can be up to {Rupees(MaxAmount)} a month.";
            if (Math.Round(amount.Value, 2) != amount.Value) return "The amount can have two digits after the point at most.";
            var m = MonthStart(fromMonth);
            if (m == null) return "Pick the month it starts from.";
            if (m < today.AddMonths(-24) || m > today.AddMonths(3)) return "That month is too far away.";
            return null;
        }

        /// <summary>The salary due for a month: the newest rate that had started by then; nothing outside the months they were on the payroll.</summary>
        public static decimal Due(MarketingStaff s, IEnumerable<MarketingSalaryRate> rates, string month)
        {
            if (string.CompareOrdinal(month, s.FromMonth) < 0) return 0;
            if (s.ToMonth != null && string.CompareOrdinal(month, s.ToMonth) > 0) return 0;
            return rates.Where(r => r.AgentId == s.AgentId && string.CompareOrdinal(r.FromMonth, month) <= 0)
                .OrderByDescending(r => r.FromMonth).ThenByDescending(r => r.CreatedAt).Select(r => r.Amount).FirstOrDefault();
        }

        public static bool IsSalary(MarketingExpense e) => Counts(e) && e.Category == "agents" && e.SalaryMonth != null && e.ForAgentId != null;

        public static decimal PaidFor(string agentId, string month, IEnumerable<MarketingExpense> expenses) =>
            expenses.Where(e => IsSalary(e) && e.ForAgentId == agentId && e.SalaryMonth == month).Sum(e => e.Amount);

        /// <summary>none (nothing due) | unpaid | part | full | over</summary>
        public static string PayStatus(decimal due, decimal paid) =>
            due <= 0 && paid <= 0 ? "none" : paid <= 0 ? "unpaid" : paid < due ? "part" : paid == due ? "full" : "over";

        public record MonthPay(string Month, decimal Due, decimal Paid)
        {
            public decimal Left => Math.Max(0, Due - Paid);
            public string Status => PayStatus(Due, Paid);
        }

        /// <summary>Every month from the person's first month to this one (or their last), newest first, with what was due and paid.</summary>
        public static List<MonthPay> Months(MarketingStaff s, IEnumerable<MarketingSalaryRate> rates, IEnumerable<MarketingExpense> expenses, DateOnly today)
        {
            var list = new List<MonthPay>();
            var first = MonthStart(s.FromMonth);
            if (first == null) return list;
            var last = MonthStart(Month(today))!.Value;
            if (s.ToMonth != null && MonthStart(s.ToMonth) is { } end && end < last) last = end;
            var rateList = rates.ToList(); var exp = expenses.ToList();
            for (var m = last; m >= first && list.Count < 60; m = m.AddMonths(-1))
                list.Add(new MonthPay(Month(m), Due(s, rateList, Month(m)), PaidFor(s.AgentId, Month(m), exp)));
            // A payment recorded for a month outside those (an advance for next month, say) still shows.
            foreach (var extra in exp.Where(e => IsSalary(e) && e.ForAgentId == s.AgentId).Select(e => e.SalaryMonth!).Distinct().Where(x => list.All(l => l.Month != x)))
                list.Add(new MonthPay(extra, Due(s, rateList, extra), PaidFor(s.AgentId, extra, exp)));
            return list.OrderByDescending(l => l.Month).ToList();
        }
    }
}
