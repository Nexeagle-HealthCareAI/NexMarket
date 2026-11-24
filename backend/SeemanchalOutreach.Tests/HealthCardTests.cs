using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class HealthCardTests
    {
        private static readonly DateOnly Today = new(2026, 11, 24);
        private static HealthCardPlan Plan() => new() { Name = "Family card", Price = 299, ValidMonths = 12, MaxMembers = 5, OpdDiscountPct = 20, IpdDiscountPct = 10, LabDiscountPct = 15, PharmacyDiscountPct = 5, FreeOpdVisits = 2 };

        [Fact]
        public void A_card_runs_for_the_plan_months_to_the_day_before()
        {
            Assert.Equal(new DateOnly(2027, 11, 23), HealthCards.ValidTill(Today, 12));
            Assert.Equal(new DateOnly(2026, 12, 23), HealthCards.ValidTill(Today, 1));
        }

        [Fact]
        public void Its_status_follows_the_dates()
        {
            var c = new HealthCard { IssuedOn = Today.AddMonths(-11), ValidTill = Today.AddDays(40) };
            Assert.Equal("active", HealthCards.Status(c, Today));
            c.ValidTill = Today.AddDays(10);
            Assert.Equal("expiring", HealthCards.Status(c, Today));
            c.ValidTill = Today.AddDays(-1);
            Assert.Equal("expired", HealthCards.Status(c, Today));
            Assert.False(HealthCards.Usable(c, Today));
            Assert.True(HealthCards.Usable(c, Today.AddDays(-1)));
            c.Status = "cancelled";
            Assert.Equal("cancelled", HealthCards.Status(c, Today));
        }

        [Fact]
        public void Free_OPD_visits_come_first_then_the_plan_discount()
        {
            var p = Plan();
            Assert.Equal((500m, true), HealthCards.DiscountFor(p, "opd", 500m, 2));
            Assert.Equal((100m, false), HealthCards.DiscountFor(p, "opd", 500m, 0));
            Assert.Equal((4000m, false), HealthCards.DiscountFor(p, "ipd", 40000m, 2));    // free visits are for OPD only
            Assert.Equal((4000m, false), HealthCards.DiscountFor(p, "procedure", 40000m, 0));
            Assert.Equal((150m, false), HealthCards.DiscountFor(p, "lab", 1000m, 0));
            Assert.Equal((13m, false), HealthCards.DiscountFor(p, "pharmacy", 250m, 0));   // 12.5 rounds up
            Assert.Equal((0m, false), HealthCards.DiscountFor(p, "other", 900m, 0));
        }

        [Fact]
        public void Free_visits_left_count_only_the_free_ones_not_taken_out()
        {
            var p = Plan();
            var uses = new List<HealthCardUse> { new() { FreeVisit = true }, new() { FreeVisit = true, Removed = true }, new() { FreeVisit = false } };
            Assert.Equal(1, HealthCards.FreeLeft(p, uses));
            uses.Add(new HealthCardUse { FreeVisit = true });
            Assert.Equal(0, HealthCards.FreeLeft(p, uses));
        }

        [Fact]
        public void Numbers_and_phones()
        {
            Assert.Equal("HC26-00042", HealthCards.Number(2026, 42));
            Assert.Equal("9876543210", HealthCards.Phone("+91 98765 43210"));
            Assert.Equal("9876543210", HealthCards.Phone("09876543210"));
            Assert.Null(HealthCards.Phone("12345"));
            Assert.Null(HealthCards.Phone("1234567890"));
        }

        [Fact]
        public void Family_members_are_kept_tidy()
        {
            var json = HealthCards.MembersJson(new[] { new HealthCards.Member(" Asma ", 34, "Wife"), new HealthCards.Member("", 5, "Son"), new HealthCards.Member("Arif", 200, null) });
            var back = HealthCards.Members(json);
            Assert.Equal(2, back.Count);
            Assert.Equal("Asma", back[0].Name);
            Assert.Null(back[1].Age);
            Assert.Null(HealthCards.MembersJson(Array.Empty<HealthCards.Member>()));
            Assert.Empty(HealthCards.Members("not json"));
        }

        [Fact]
        public void A_plan_needs_sensible_values()
        {
            decimal?[] ok = { 20m, 10m, 0m, 0m };
            Assert.Null(HealthCards.PlanProblem("Family card", 299m, 12, 5, ok, 2));
            Assert.NotNull(HealthCards.PlanProblem(" ", 299m, 12, 5, ok, 2));
            Assert.NotNull(HealthCards.PlanProblem("x", -1m, 12, 5, ok, 2));
            Assert.NotNull(HealthCards.PlanProblem("x", 0m, 0, 5, ok, 2));
            Assert.NotNull(HealthCards.PlanProblem("x", 0m, 12, 0, ok, 2));
            Assert.NotNull(HealthCards.PlanProblem("x", 0m, 12, 1, new decimal?[] { 120m, 0m, 0m, 0m }, 0));
        }
    }
}
