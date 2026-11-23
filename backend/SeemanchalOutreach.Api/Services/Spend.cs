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

        // ── Kinds of spend (the team's own list) ────────────────────────────────

        public record Kind(string Key, string Label, string Nature, string Color, int Order, bool AgentCanUse, bool Archived);

        public static readonly string[] Natures = { "constant", "variable" };

        /// <summary>The kinds the page starts with, before the team changes anything (also used when the table is empty).</summary>
        public static readonly Kind[] DefaultKinds =
        {
            new("agents", "Salaries", "constant", "#0a72d6", 1, false, false), new("rent", "Room rent", "constant", "#0e7490", 2, true, false),
            new("food", "Food", "variable", "#d9822b", 3, true, false), new("petrol", "Petrol", "variable", "#7b3fe4", 4, true, false),
            new("stay", "Stay", "variable", "#b45309", 5, true, false), new("banner", "Banners", "variable", "#0f8a5f", 6, true, false),
            new("digital", "Digital marketing", "variable", "#c2185b", 7, true, false), new("other", "Other", "variable", "#6b7280", 99, true, false),
        };

        public static readonly string[] Palette = { "#0a72d6", "#0e7490", "#d9822b", "#7b3fe4", "#b45309", "#0f8a5f", "#c2185b", "#6b7280", "#a16207", "#4338ca", "#be123c", "#15803d" };

        public static List<Kind> KindsOf(IEnumerable<SpendCategory> rows)
        {
            var list = rows.Select(r => new Kind(r.Key, r.Label, r.Nature == "constant" ? "constant" : "variable", r.Color, r.Order, r.AgentCanUse, r.Archived)).ToList();
            // A kind used on old entries but missing from the table still has a name and a nature.
            foreach (var d in DefaultKinds) if (list.All(k => k.Key != d.Key)) list.Add(d);
            return list.OrderBy(k => k.Archived).ThenBy(k => k.Order).ThenBy(k => k.Label, StringComparer.OrdinalIgnoreCase).ToList();
        }

        /// <summary>The kind for a key the user sent: a known, open kind, else "other".</summary>
        public static string KindOf(string? key, IEnumerable<Kind> kinds)
        {
            key = (key ?? "").Trim().ToLowerInvariant();
            return kinds.Any(k => k.Key == key && !k.Archived) ? key : "other";
        }

        public static string NatureOf(string key, IEnumerable<Kind> kinds) => kinds.FirstOrDefault(k => k.Key == key)?.Nature ?? "variable";

        /// <summary>What is wrong with a kind's name, or null.</summary>
        public static string? KindProblem(string? label, string? nature, IEnumerable<Kind> kinds, string? exceptKey = null)
        {
            var l = (label ?? "").Trim();
            if (l.Length == 0) return "Write a name for it.";
            if (l.Length > 40) return "Keep the name under 40 letters.";
            if (nature != null && !Natures.Contains(nature)) return "Choose constant or variable.";
            if (kinds.Any(k => k.Key != exceptKey && string.Equals(k.Label.Trim(), l, StringComparison.OrdinalIgnoreCase))) return $"There is already a kind called “{l}”.";
            return null;
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

        /// <summary>
        /// One person's money. Given/Returned: from and to whoever gave it (the organisation or a manager). Received: funds
        /// they took in for marketing (a manager receiving the budget). HandedOut/HandedBack: what a manager gave on to the
        /// team and what the team gave back to them.
        /// </summary>
        public record Balance(decimal Given, decimal Returned, decimal Spent, decimal Pending, decimal Received = 0, decimal HandedOut = 0, decimal HandedBack = 0)
        {
            /// <summary>Above zero: the person holds it. Below zero: the organisation owes it to them.</summary>
            public decimal Net => Given + Received + HandedBack - Returned - HandedOut - Spent;
            public decimal Holds => Math.Max(0, Net);
            public decimal Owed => Math.Max(0, -Net);
        }

        /// <summary>One person's balance from their own rows (others' rows and removed rows are ignored).</summary>
        public static Balance BalanceOf(string agentId, IEnumerable<MarketingMoneyMove> moves, IEnumerable<MarketingExpense> expenses, IEnumerable<SpendFund>? funds = null)
        {
            var all = moves.Where(m => !m.Removed).ToList();
            var mine = all.Where(m => m.AgentId == agentId).ToList();
            var through = all.Where(m => m.FromAgentId == agentId && m.AgentId != agentId).ToList();
            var spent = expenses.Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId == agentId).ToList();
            return new Balance(
                mine.Where(m => m.Kind == "given").Sum(m => m.Amount),
                mine.Where(m => m.Kind == "returned").Sum(m => m.Amount),
                spent.Where(e => e.Status == "approved").Sum(e => e.Amount),
                spent.Where(e => e.Status == "pending").Sum(e => e.Amount),
                (funds ?? Enumerable.Empty<SpendFund>()).Where(f => !f.Removed && f.ReceivedBy == agentId).Sum(f => f.Amount),
                through.Where(m => m.Kind == "given").Sum(m => m.Amount),
                through.Where(m => m.Kind == "returned").Sum(m => m.Amount));
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
    
        // ── Constant payments ───────────────────────────────────────────────────

        public static readonly string[] Everies = { "month", "quarter", "year" };
        public static int MonthsIn(string every) => every == "year" ? 12 : every == "quarter" ? 3 : 1;

        public record Period(string Month, DateOnly DueOn, decimal Due, decimal Paid)
        {
            public decimal Left => Math.Max(0, Due - Paid);
            public string Status => PayStatus(Due, Paid);
        }

        /// <summary>
        /// Every period of a constant payment from its first to the one running now (or its last), newest first: when it is
        /// due, how much, and how much was paid for it.
        /// </summary>
        public static List<Period> Periods(SpendRecurring r, IEnumerable<MarketingExpense> expenses, DateOnly today, int max = 36)
        {
            var list = new List<Period>();
            var first = MonthStart(r.FromMonth);
            if (first == null) return list;
            var step = MonthsIn(r.Every);
            var last = MonthStart(Month(today))!.Value;
            if (r.ToMonth != null && MonthStart(r.ToMonth) is { } end && end < last) last = end;
            var paid = expenses.Where(e => Counts(e) && e.RecurringId == r.Id && e.Period != null).GroupBy(e => e.Period!).ToDictionary(g => g.Key, g => g.Sum(e => e.Amount));
            var day = Math.Clamp(r.DueDay, 1, 28);
            var periods = new List<DateOnly>();
            for (var m = first.Value; m <= last; m = m.AddMonths(step)) periods.Add(m);
            foreach (var m in Enumerable.Reverse(periods).Take(max))
                list.Add(new Period(Month(m), m.AddDays(day - 1), r.Amount, paid.GetValueOrDefault(Month(m))));
            return list;
        }

        /// <summary>The period of a constant payment that a month falls in ("yyyy-MM" of its first month), or null before it starts or after it stops.</summary>
        public static string? PeriodFor(SpendRecurring r, string month)
        {
            var first = MonthStart(r.FromMonth); var m = MonthStart(month);
            if (first == null || m == null || m < first) return null;
            if (r.ToMonth != null && MonthStart(r.ToMonth) is { } end && m > end) return null;
            var step = MonthsIn(r.Every);
            var months = (m.Value.Year - first.Value.Year) * 12 + m.Value.Month - first.Value.Month;
            return Month(first.Value.AddMonths(months / step * step));
        }

        /// <summary>What is wrong with a constant payment, or null.</summary>
        public static string? RecurringProblem(string? title, decimal? amount, string? every, int? dueDay, string? fromMonth, DateOnly today)
        {
            if (string.IsNullOrWhiteSpace(title)) return "Write what it is, e.g. Room rent, Purnia office.";
            if (amount == null || amount <= 0) return "Write the amount.";
            if (amount > MaxAmount) return $"One payment can be up to {Rupees(MaxAmount)}.";
            if (Math.Round(amount.Value, 2) != amount.Value) return "The amount can have two digits after the point at most.";
            if (every != null && !Everies.Contains(every)) return "Choose every month, quarter or year.";
            if (dueDay is < 1 or > 28) return "The day it is due can be 1 to 28.";
            var m = MonthStart(fromMonth);
            if (m == null) return "Pick the month it starts from.";
            if (m < today.AddMonths(-24) || m > today.AddMonths(12)) return "That month is too far away.";
            return null;
        }

        // ── Projects ────────────────────────────────────────────────────────────

        public record ProjectMoney(Guid Id, decimal? Budget, decimal Received, decimal Spent, decimal Constant, decimal Variable, decimal Pending, int Entries)
        {
            /// <summary>What can still be spent: the budget (or, without one, what was received) less what was spent.</summary>
            public decimal? Left => Budget is decimal b ? b - Spent : Received > 0 ? Received - Spent : null;
            /// <summary>Share of the budget spent, 0–100+; null without a budget.</summary>
            public int? UsedPct => Budget is decimal b && b > 0 ? (int)Math.Round(Spent * 100 / b) : null;
        }

        public static ProjectMoney MoneyOf(SpendProject p, IEnumerable<MarketingExpense> expenses, IEnumerable<SpendFund> funds, IEnumerable<Kind> kinds)
        {
            var mine = expenses.Where(e => !e.Removed && e.ProjectId == p.Id).ToList();
            var counted = mine.Where(Counts).ToList();
            var kindList = kinds.ToList();
            return new ProjectMoney(p.Id, p.Budget,
                funds.Where(f => !f.Removed && f.ProjectId == p.Id).Sum(f => f.Amount),
                counted.Sum(e => e.Amount),
                counted.Where(e => NatureOf(e.Category, kindList) == "constant").Sum(e => e.Amount),
                counted.Where(e => NatureOf(e.Category, kindList) != "constant").Sum(e => e.Amount),
                mine.Where(e => e.Status == "pending").Sum(e => e.Amount),
                counted.Count);
        }

        public static string? ProjectProblem(string? name, decimal? budget, DateOnly? start, DateOnly? end)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Write the project's name.";
            if (name.Trim().Length > 80) return "Keep the name under 80 letters.";
            if (budget is < 0) return "The budget can't be below zero.";
            if (budget > 100_000_000m) return "That budget is too big.";
            if (start != null && end != null && end < start) return "The end date can't be before the start.";
            return null;
        }

        // ── Things to note ──────────────────────────────────────────────────────

        /// <summary>One line at the top of Analytics: what needs attention, most urgent first. Tone: bad | warn | info | ok.</summary>
        public record Note(string Tone, string Title, string Body, string? Go = null);

        public record NoteInput(
            int Waiting, decimal WaitingSum,
            int ConstantOverdue, decimal ConstantOverdueSum, int ConstantSoon, decimal ConstantSoonSum,
            decimal SalaryLeftEarlier, decimal SalaryLeftThisMonth,
            IReadOnlyList<(string Name, int Pct, decimal Over)> ProjectsHot,
            decimal Owed, int OwedPeople, decimal HeldByManagers, decimal HeldByOthers,
            decimal Total, decimal PrevTotal, decimal Constant, decimal Variable, string? TopVariable, decimal TopVariableSum,
            decimal FundsIn, decimal SpentAllTime, decimal FundsAllTime);

        public static List<Note> Notes(NoteInput i)
        {
            var n = new List<Note>();
            if (i.ConstantOverdue > 0) n.Add(new("bad", $"{i.ConstantOverdue} constant payment{(i.ConstantOverdue == 1 ? " is" : "s are")} overdue", $"{Rupees(i.ConstantOverdueSum)} not paid by its due day.", "constant"));
            if (i.SalaryLeftEarlier > 0) n.Add(new("bad", "Salaries unpaid from earlier months", $"{Rupees(i.SalaryLeftEarlier)} still to pay.", "team"));
            foreach (var p in i.ProjectsHot.Where(p => p.Over > 0)) n.Add(new("bad", $"{p.Name} is over budget", $"{Rupees(p.Over)} more than its budget ({p.Pct}% used).", "projects"));
            if (i.Waiting > 0) n.Add(new("warn", $"{i.Waiting} expense{(i.Waiting == 1 ? "" : "s")} waiting for approval", $"{Rupees(i.WaitingSum)} sent from the app; they count once approved.", "work"));
            if (i.ConstantSoon > 0) n.Add(new("warn", $"{i.ConstantSoon} constant payment{(i.ConstantSoon == 1 ? "" : "s")} due in the next 7 days", $"{Rupees(i.ConstantSoonSum)} to keep ready.", "constant"));
            foreach (var p in i.ProjectsHot.Where(p => p.Over <= 0)) n.Add(new("warn", $"{p.Name} has used {p.Pct}% of its budget", "Check what is left before the next big expense.", "projects"));
            if (i.Owed > 0) n.Add(new("warn", $"We owe {Rupees(i.Owed)} to {i.OwedPeople} {(i.OwedPeople == 1 ? "person" : "people")}", "They spent their own money; settle it when funds come.", "work"));
            if (i.SalaryLeftThisMonth > 0) n.Add(new("info", "Salaries left to pay this month", $"{Rupees(i.SalaryLeftThisMonth)}.", "team"));
            if (i.PrevTotal > 0 && i.Total > 0)
            {
                var ch = (int)Math.Round((i.Total - i.PrevTotal) * 100 / i.PrevTotal);
                if (Math.Abs(ch) >= 15) n.Add(new(ch > 0 ? "warn" : "ok", ch > 0 ? $"Spending is up {ch}% on the days before" : $"Spending is down {-ch}% on the days before",
                    $"{Rupees(i.Total)} now against {Rupees(i.PrevTotal)} in the same number of days before."));
            }
            if (i.Total > 0)
            {
                var share = (int)Math.Round(i.Constant * 100 / i.Total);
                n.Add(new("info", $"{share}% of spending was constant costs", $"Constant {Rupees(i.Constant)} · variable {Rupees(i.Variable)}{(i.TopVariable == null ? "" : $" · the biggest variable cost was {i.TopVariable} ({Rupees(i.TopVariableSum)})")}."));
            }
            if (i.HeldByManagers + i.HeldByOthers > 0) n.Add(new("info", $"{Rupees(i.HeldByManagers + i.HeldByOthers)} is in people's hands", $"Money managers hold {Rupees(i.HeldByManagers)}, the rest of the team {Rupees(i.HeldByOthers)}.", "work"));
            if (i.FundsAllTime > 0 && i.SpentAllTime > i.FundsAllTime) n.Add(new("warn", "More spent than received", $"{Rupees(i.SpentAllTime - i.FundsAllTime)} more spent than all the funds recorded. Record funds received to keep this right.", "projects"));
            if (n.Count == 0) n.Add(new("ok", "Nothing needs attention", "No approvals waiting, nothing overdue, no project over budget."));
            return n;
        }
    }
}
