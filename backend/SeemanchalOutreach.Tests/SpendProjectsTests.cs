using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Marketing spend, organised: money managers, constant payments, projects, the team's own kinds, and the notes on Analytics.</summary>
    public class SpendProjectsTests
    {
        private static readonly DateOnly Today = new(2026, 11, 23);

        private static MarketingMoneyMove Move(string to, string kind, decimal amt, string? from = null) =>
            new() { AgentId = to, AgentName = to, Kind = kind, Amount = amt, On = Today, FromAgentId = from };

        private static MarketingExpense Spent(string by, decimal amt, string status = "approved") =>
            new() { PaidBy = "person", AgentId = by, Amount = amt, Status = status, SpentOn = Today, Category = "food" };

        [Fact]
        public void Manager_holds_what_they_received_less_what_they_handed_out()
        {
            var funds = new[] { new SpendFund { ReceivedBy = "MGR", Amount = 50000, On = Today, Source = "Hospital" } };
            var moves = new[]
            {
                Move("A1", "given", 8000, "MGR"),       // manager → agent
                Move("A2", "given", 5000, "MGR"),
                Move("A1", "returned", 1000, "MGR"),    // agent → back to the manager
                Move("A3", "given", 2000),              // the organisation directly, not the manager's
            };
            var exp = new[] { Spent("MGR", 1500), Spent("A1", 4000), Spent("A1", 500, "pending") };

            var mgr = Spend.BalanceOf("MGR", moves, exp, funds);
            Assert.Equal(50000m, mgr.Received);
            Assert.Equal(13000m, mgr.HandedOut);
            Assert.Equal(1000m, mgr.HandedBack);
            Assert.Equal(36500m, mgr.Net);          // 50000 + 1000 − 13000 − 1500

            var a1 = Spend.BalanceOf("A1", moves, exp, funds);
            Assert.Equal(3000m, a1.Net);            // 8000 − 1000 − 4000
            Assert.Equal(500m, a1.Pending);
            Assert.Equal(2000m, Spend.BalanceOf("A3", moves, exp, funds).Net);
        }

        [Fact]
        public void Old_balances_are_unchanged_without_managers()
        {
            var b = Spend.BalanceOf("A1", new[] { Move("A1", "given", 1000) }, new[] { Spent("A1", 1500) });
            Assert.Equal(-500m, b.Net);
            Assert.Equal(500m, b.Owed);
        }

        private static SpendRecurring Rent(string every = "month", string from = "2026-08", int day = 5) =>
            new() { Title = "Room rent", Amount = 6000, Every = every, FromMonth = from, DueDay = day, Category = "rent" };

        private static MarketingExpense Pay(SpendRecurring r, string period, decimal amt) =>
            new() { RecurringId = r.Id, Period = period, Amount = amt, Status = "approved", Category = r.Category, SpentOn = Today };

        [Fact]
        public void Monthly_payment_periods_due_and_paid()
        {
            var r = Rent();
            var p = Spend.Periods(r, new[] { Pay(r, "2026-08", 6000), Pay(r, "2026-09", 6000), Pay(r, "2026-11", 2000) }, Today);
            Assert.Equal("2026-11,2026-10,2026-09,2026-08", string.Join(",", p.Select(x => x.Month)));
            Assert.Equal(new DateOnly(2026, 11, 5), p[0].DueOn);
            Assert.Equal("part", p[0].Status);
            Assert.Equal(4000m, p[0].Left);
            Assert.Equal("unpaid", p[1].Status);
            Assert.Equal("full", p[2].Status);
        }

        [Fact]
        public void Quarterly_and_yearly_periods_and_which_period_a_month_is_in()
        {
            var q = Rent("quarter", "2026-01");
            Assert.Equal("2026-10,2026-07,2026-04,2026-01", string.Join(",", Spend.Periods(q, Array.Empty<MarketingExpense>(), Today).Select(x => x.Month)));
            Assert.Equal("2026-10", Spend.PeriodFor(q, "2026-11"));
            Assert.Equal("2026-04", Spend.PeriodFor(q, "2026-06"));
            Assert.Null(Spend.PeriodFor(q, "2025-12"));
            var y = Rent("year", "2025-04");
            Assert.Equal("2026-04,2025-04", string.Join(",", Spend.Periods(y, Array.Empty<MarketingExpense>(), Today).Select(x => x.Month)));
        }

        [Fact]
        public void A_stopped_payment_ends_at_its_last_month()
        {
            var r = Rent(); r.ToMonth = "2026-09"; r.Active = false;
            Assert.Equal("2026-09,2026-08", string.Join(",", Spend.Periods(r, Array.Empty<MarketingExpense>(), Today).Select(x => x.Month)));
            Assert.Null(Spend.PeriodFor(r, "2026-10"));
        }

        [Fact]
        public void Constant_payment_checks()
        {
            Assert.Null(Spend.RecurringProblem("Rent", 6000, "month", 5, "2026-11", Today));
            Assert.Contains("Write what it is", Spend.RecurringProblem(" ", 6000, "month", 5, "2026-11", Today)!);
            Assert.Contains("1 to 28", Spend.RecurringProblem("Rent", 6000, "month", 31, "2026-11", Today)!);
            Assert.Contains("month, quarter or year", Spend.RecurringProblem("Rent", 6000, "week", 5, "2026-11", Today)!);
            Assert.Contains("too far", Spend.RecurringProblem("Rent", 6000, "month", 5, "2020-01", Today)!);
        }

        [Fact]
        public void Project_money_splits_constant_and_variable()
        {
            var kinds = Spend.KindsOf(Array.Empty<SpendCategory>());
            var p = new SpendProject { Name = "Purnia camp", Budget = 20000 };
            var exp = new[]
            {
                new MarketingExpense { ProjectId = p.Id, Amount = 6000, Category = "rent", Status = "approved", SpentOn = Today },
                new MarketingExpense { ProjectId = p.Id, Amount = 9000, Category = "banner", Status = "approved", SpentOn = Today },
                new MarketingExpense { ProjectId = p.Id, Amount = 700, Category = "food", Status = "pending", SpentOn = Today },
                new MarketingExpense { ProjectId = p.Id, Amount = 999, Category = "food", Status = "approved", SpentOn = Today, Removed = true },
                new MarketingExpense { Amount = 5000, Category = "food", Status = "approved", SpentOn = Today },
            };
            var funds = new[] { new SpendFund { ProjectId = p.Id, Amount = 12000 }, new SpendFund { ProjectId = p.Id, Amount = 1, Removed = true } };
            var m = Spend.MoneyOf(p, exp, funds, kinds);
            Assert.Equal(12000m, m.Received);
            Assert.Equal(15000m, m.Spent);
            Assert.Equal(6000m, m.Constant);
            Assert.Equal(9000m, m.Variable);
            Assert.Equal(700m, m.Pending);
            Assert.Equal(5000m, m.Left);
            Assert.Equal(75, m.UsedPct);
            p.Budget = null;
            Assert.Equal(-3000m, Spend.MoneyOf(p, exp, funds, kinds).Left);   // without a budget: received less spent
        }

        [Fact]
        public void Team_kinds_keep_defaults_and_refuse_duplicates()
        {
            var rows = new[]
            {
                new SpendCategory { Key = "food", Label = "Food & tea", Nature = "variable", Order = 3 },
                new SpendCategory { Key = "c-1", Label = "Software", Nature = "constant", Order = 8 },
                new SpendCategory { Key = "c-2", Label = "Old thing", Nature = "variable", Order = 9, Archived = true },
            };
            var kinds = Spend.KindsOf(rows);
            Assert.Equal("Food & tea", kinds.First(k => k.Key == "food").Label);
            Assert.Equal("constant", Spend.NatureOf("c-1", kinds));
            Assert.Equal("constant", Spend.NatureOf("agents", kinds));     // a default kind missing from the table
            Assert.Equal("variable", Spend.NatureOf("unknown", kinds));
            Assert.Equal("c-1", Spend.KindOf("C-1", kinds));
            Assert.Equal("other", Spend.KindOf("c-2", kinds));               // archived: not for new entries
            Assert.Equal("c-2", kinds.Last().Key);                            // archived sorts last
            Assert.Contains("already a kind", Spend.KindProblem("software", "constant", kinds)!);
            Assert.Null(Spend.KindProblem("Software", "constant", kinds, "c-1"));
            Assert.Contains("constant or variable", Spend.KindProblem("Travel", "sometimes", kinds)!);
        }

        private static Spend.NoteInput Quiet() => new(0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<(string, int, decimal)>(), 0, 0, 0, 0, 0, 0, 0, 0, null, 0, 0, 0, 0);

        [Fact]
        public void Notes_put_urgent_things_first()
        {
            var i = Quiet() with
            {
                Waiting = 2, WaitingSum = 900, ConstantOverdue = 1, ConstantOverdueSum = 6000,
                ProjectsHot = new[] { ("Purnia camp", 112, 2400m), ("Katihar camp", 90, 0m) },
                Total = 30000, PrevTotal = 20000, Constant = 18000, Variable = 12000, TopVariable = "Banners", TopVariableSum = 7000,
            };
            var n = Spend.Notes(i);
            Assert.Equal("bad", n[0].Tone);
            Assert.Contains("overdue", n[0].Title);
            Assert.Contains("Purnia camp is over budget", string.Join("|", n.Select(x => x.Title)));
            Assert.Contains("Katihar camp has used 90%", string.Join("|", n.Select(x => x.Title)));
            Assert.Contains("up 50%", string.Join("|", n.Select(x => x.Title)));
            Assert.Contains("60% of spending was constant", string.Join("|", n.Select(x => x.Title)));
            Assert.True(n.FindIndex(x => x.Title.Contains("waiting")) > n.FindIndex(x => x.Title.Contains("over budget")));
        }

        [Fact]
        public void Notes_say_so_when_all_is_well()
        {
            var n = Spend.Notes(Quiet());
            Assert.Equal(1, n.Count);
            Assert.Equal("ok", n[0].Tone);
        }
    }
}
