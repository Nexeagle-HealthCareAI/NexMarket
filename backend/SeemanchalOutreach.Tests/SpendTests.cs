using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class SpendTests
    {
        private static readonly DateOnly Today = new(2026, 11, 16);
        private static MarketingExpense E(decimal amount, string category = "food", string status = "approved", string paidBy = "person", string? agent = "MKT-1001", int daysAgo = 0, bool removed = false) =>
            new() { Amount = amount, Category = category, Status = status, PaidBy = paidBy, AgentId = paidBy == "person" ? agent : null, SpentOn = Today.AddDays(-daysAgo), Removed = removed };
        private static MarketingMoneyMove M(decimal amount, string kind = "given", string agent = "MKT-1001", bool removed = false) =>
            new() { Amount = amount, Kind = kind, AgentId = agent, On = Today, Removed = removed };

        [Fact]
        public void An_entry_needs_an_amount_and_a_day_that_make_sense()
        {
            Assert.Null(Spend.Problem(250m, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(null, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(0m, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(-5m, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(Spend.MaxAmount + 1, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(10.555m, Today, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(250m, null, Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(250m, Today.AddDays(1), Today, Spend.AgentDaysBack));
        }

        [Fact]
        public void An_agent_can_go_a_month_back_and_the_office_much_further()
        {
            Assert.Null(Spend.Problem(250m, Today.AddDays(-31), Today, Spend.AgentDaysBack));
            Assert.NotNull(Spend.Problem(250m, Today.AddDays(-32), Today, Spend.AgentDaysBack));
            Assert.Null(Spend.Problem(250m, Today.AddDays(-32), Today, Spend.OfficeDaysBack));
            Assert.NotNull(Spend.Problem(250m, Today.AddDays(-800), Today, Spend.OfficeDaysBack));
        }

        [Fact]
        public void Unknown_kinds_become_other_and_agents_cannot_add_pay()
        {
            Assert.Equal("petrol", Spend.CategoryOf(" Petrol "));
            Assert.Equal("other", Spend.CategoryOf("lunch"));
            Assert.Equal("other", Spend.CategoryOf(null));
            Assert.True(Spend.Categories.Contains("agents"));
            Assert.False(Spend.AgentCategories.Contains("agents"));
            Assert.Null(Spend.ModeOf("cheque"));
            Assert.Equal("upi", Spend.ModeOf("UPI"));
        }

        [Fact]
        public void An_advance_is_held_until_it_is_spent_or_returned()
        {
            var b = Spend.BalanceOf("MKT-1001", new[] { M(2000m) }, new[] { E(300m), E(450m, "petrol") });
            Assert.Equal(1250m, b.Net);
            Assert.Equal(1250m, b.Holds);
            Assert.Equal(0m, b.Owed);
            Assert.Equal(("returned", 1250m), Spend.Settling(b));
            var after = Spend.BalanceOf("MKT-1001", new[] { M(2000m), M(1250m, "returned") }, new[] { E(300m), E(450m, "petrol") });
            Assert.Equal(0m, after.Net);
            Assert.Null(Spend.Settling(after));
        }

        [Fact]
        public void Spending_your_own_money_is_owed_to_you_until_it_is_given()
        {
            var b = Spend.BalanceOf("MKT-1001", Array.Empty<MarketingMoneyMove>(), new[] { E(600m), E(200m, "petrol") });
            Assert.Equal(-800m, b.Net);
            Assert.Equal(800m, b.Owed);
            Assert.Equal(0m, b.Holds);
            Assert.Equal(("given", 800m), Spend.Settling(b));
            Assert.Equal(0m, Spend.BalanceOf("MKT-1001", new[] { M(800m) }, new[] { E(600m), E(200m, "petrol") }).Net);
        }

        [Fact]
        public void Only_approved_entries_of_that_person_count_in_a_balance()
        {
            var expenses = new[]
            {
                E(100m), E(70m, status: "pending"), E(900m, status: "rejected"), E(500m, removed: true),
                E(40m, agent: "MKT-1002"), E(5000m, "banner", paidBy: "office"),
            };
            var moves = new[] { M(1000m), M(300m, agent: "MKT-1002"), M(999m, removed: true) };
            var b = Spend.BalanceOf("MKT-1001", moves, expenses);
            Assert.Equal(1000m, b.Given);
            Assert.Equal(100m, b.Spent);
            Assert.Equal(70m, b.Pending);
            Assert.Equal(900m, b.Net);
        }

        [Fact]
        public void The_daily_spend_adds_up_approved_entries_by_kind_newest_day_first()
        {
            var days = Spend.Days(new[]
            {
                E(300m, "food"), E(200m, "food"), E(450m, "petrol"), E(5000m, "banner", paidBy: "office"),
                E(800m, "agents", paidBy: "office", daysAgo: 1), E(60m, "food", status: "pending", daysAgo: 1), E(75m, "food", removed: true, daysAgo: 2),
            });
            Assert.Equal(2, days.Count);
            Assert.Equal(Today, days[0].Date);
            Assert.Equal(5950m, days[0].Total);
            Assert.Equal(500m, days[0].ByCategory["food"]);
            Assert.Equal(5000m, days[0].ByCategory["banner"]);
            Assert.Equal(800m, days[1].Total);
            Assert.False(days[1].ByCategory.ContainsKey("food"));
        }

        [Fact]
        public void Every_kind_has_a_name_and_amounts_read_as_rupees()
        {
            Assert.True(Spend.Categories.All(c => Spend.Labels.ContainsKey(c)));
            Assert.Equal("₹1,250", Spend.Rupees(1250m));
            Assert.Equal("₹99.50", Spend.Rupees(99.5m));
        }
    }
}
