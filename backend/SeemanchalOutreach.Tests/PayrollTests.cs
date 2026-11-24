using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class PayrollTests
    {
        private static MarketingStaff S(string from = "2026-11", DateOnly? joined = null, DateOnly? left = null, string basis = "fixed", string? attFrom = null, string? toMonth = null) =>
            new() { AgentId = "MKT-1001", Name = "Ravi", FromMonth = from, JoinedOn = joined, LeftOn = left, PayBasis = basis, AttendanceFrom = attFrom, ToMonth = toMonth };

        /// <summary>November 2026 (30 days): Sundays 1, 8, 15, 22, 29 off; everything else worked unless set.</summary>
        private static List<DayStatus> Nov(Dictionary<int, DayStatus>? set = null, int upTo = 30)
        {
            var list = new List<DayStatus>();
            for (int d = 1; d <= 30; d++)
            {
                var date = new DateOnly(2026, 11, d);
                if (set != null && set.TryGetValue(d, out var x)) { list.Add(x with { Date = date }); continue; }
                if (d > upTo) list.Add(new DayStatus(date, "future", null));
                else if (date.DayOfWeek == DayOfWeek.Sunday) list.Add(new DayStatus(date, "off", null));
                else list.Add(new DayStatus(date, "worked", null));
            }
            return list;
        }
        private static DayStatus D(string status, string? leave = null, bool half = false) => new(default, status, leave) { Half = half };

        [Fact]
        public void A_full_month_on_fixed_pay_is_the_salary()
        {
            var c = Payroll.Compute(S(), 15000m, "2026-11", null, 0);
            Assert.Equal(30, c.EmployedDays);
            Assert.Equal(15000m, c.Earned);
            Assert.Equal(15000m, c.Net);
            Assert.Equal(0m, c.Deduction);
        }

        [Fact]
        public void Joining_mid_month_pays_from_the_day_of_joining()
        {
            // Joined 16 Nov: 15 of 30 days.
            var c = Payroll.Compute(S(joined: new DateOnly(2026, 11, 16)), 15000m, "2026-11", null, 0);
            Assert.Equal(15, c.EmployedDays);
            Assert.Equal(7500m, c.Earned);
            Assert.Equal(new DateOnly(2026, 11, 16), c.From);
            // The month before joining pays nothing.
            Assert.Equal(0m, Payroll.Compute(S(joined: new DateOnly(2026, 11, 16)), 15000m, "2026-10", null, 0).Net);
        }

        [Fact]
        public void Leaving_pays_up_to_the_last_working_day()
        {
            var c = Payroll.Compute(S(from: "2026-10", left: new DateOnly(2026, 11, 10)), 12000m, "2026-11", null, 0);
            Assert.Equal(10, c.EmployedDays);
            Assert.Equal(4000m, c.Earned);
            Assert.Equal(0m, Payroll.Compute(S(from: "2026-10", left: new DateOnly(2026, 11, 10)), 12000m, "2026-12", null, 0).Net);
        }

        [Fact]
        public void By_attendance_absent_days_and_unpaid_leave_are_cut_and_a_half_day_is_half()
        {
            var days = Nov(new() { [3] = D("absent"), [4] = D("absent"), [5] = D("leave", "unpaid"), [6] = D("leave", "sick"), [7] = D("worked", half: true) });
            var c = Payroll.Compute(S(basis: "attendance", attFrom: "2026-11"), 15000m, "2026-11", days, 1000m);
            Assert.Equal("attendance", c.Basis);
            Assert.Equal(2, c.Absent);
            Assert.Equal(1, c.UnpaidLeave);
            Assert.Equal(1, c.PaidLeave);
            Assert.Equal(1, c.Half);
            Assert.Equal(3.5m, c.DeductedDays);
            Assert.Equal(26.5m, c.PayableDays);
            Assert.Equal(13250m, c.Earned);          // 15000 / 30 × 26.5
            Assert.Equal(1750m, c.Deduction);
            Assert.Equal(14250m, c.Net);             // with ₹1,000 incentives
        }

        [Fact]
        public void Days_still_to_come_are_paid_unless_marked_otherwise()
        {
            var c = Payroll.Compute(S(basis: "attendance", attFrom: "2026-11"), 15000m, "2026-11", Nov(upTo: 24), 0);
            Assert.Equal(6, c.NotYet);
            Assert.Equal(15000m, c.Earned);
        }

        [Fact]
        public void Attendance_pay_starts_from_its_month_and_joining_still_counts()
        {
            var s = S(from: "2026-09", basis: "attendance", attFrom: "2026-11");
            Assert.Equal("fixed", Payroll.Compute(s, 10000m, "2026-10", Nov(), 0).Basis);
            var joined = S(joined: new DateOnly(2026, 11, 16), basis: "attendance", attFrom: "2026-11");
            var days = Nov(new() { [17] = D("absent") });
            var c = Payroll.Compute(joined, 15000m, "2026-11", days, 0);
            Assert.Equal(15, c.EmployedDays);
            Assert.Equal(14m, c.PayableDays);       // absences before joining don't count; the one after does
            Assert.Equal(7000m, c.Earned);
        }

        [Fact]
        public void An_approved_month_reads_back_as_approved()
        {
            var slip = new SalarySlip { Month = "2026-11", Basis = "attendance", Rate = 15000m, MonthDays = 30, EmployedDays = 30, PresentDays = 22, PayableDays = 28, Earned = 14000m, Incentives = 500m, Net = 14500m, AbsentDays = 2 };
            var c = Payroll.FromSlip(slip);
            Assert.Equal(14500m, c.Net);
            Assert.Equal(2m, c.DeductedDays);
        }

        [Fact]
        public void An_incentive_needs_an_amount_a_kind_a_title_and_a_month()
        {
            var today = new DateOnly(2026, 11, 24);
            Assert.Null(Payroll.IncentiveProblem(500m, "referrals", "November referrals", "2026-11", today));
            Assert.NotNull(Payroll.IncentiveProblem(0m, "referrals", "x", "2026-11", today));
            Assert.NotNull(Payroll.IncentiveProblem(500m, "bonus", "x", "2026-11", today));
            Assert.NotNull(Payroll.IncentiveProblem(500m, "target", " ", "2026-11", today));
            Assert.NotNull(Payroll.IncentiveProblem(500m, "target", "x", "2027-06", today));
            Assert.NotNull(Payroll.IncentiveProblem(Payroll.MaxIncentive + 1, "target", "x", "2026-11", today));
        }
    }
}
