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
        public static readonly string[] Categories = { "agents", "food", "petrol", "banner", "digital", "rent", "other" };
        /// <summary>What an agent can add from the phone: everything except pay, which only the office records.</summary>
        public static readonly string[] AgentCategories = { "food", "petrol", "banner", "digital", "rent", "other" };
        public static readonly Dictionary<string, string> Labels = new()
        {
            ["agents"] = "Marketing agents", ["food"] = "Food", ["petrol"] = "Petrol", ["banner"] = "Banners",
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
    }
}
