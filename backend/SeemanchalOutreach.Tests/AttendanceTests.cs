using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class AttendanceTests
    {
        private sealed class Settings : IAppSettings
        {
            public Dictionary<string, string> Values = new();
            public string? Get(string key) => Values.TryGetValue(key, out var v) ? v : null;
            public bool Unreadable(string key) => false;
            public DateTime? UpdatedAt(string key) => null;
            public Task SetAsync(IDictionary<string, string?> values, ICollection<string> secretKeys, string updatedBy, CancellationToken ct = default) => Task.CompletedTask;
        }

        private static readonly DateOnly Today = new(2026, 11, 24);   // a Tuesday

        private static AttendanceService Service(string? json = null, LeaveSettings? server = null)
        {
            var s = new Settings();
            if (json != null) s.Values[AttendanceConfig.Key] = json;
            return new AttendanceService(null!, Options.Create(server ?? new LeaveSettings()), s);
        }

        [Fact]
        public void Before_settings_are_saved_the_server_holidays_and_allowance_apply()
        {
            var a = Service(server: new LeaveSettings { YearlyAllowance = 18, Holidays = new() { "2026-11-25" } });
            Assert.Equal(18, a.YearlyAllowance);
            Assert.False(a.IsWorkingDay(new DateOnly(2026, 11, 25)));
            Assert.False(a.IsWorkingDay(new DateOnly(2026, 11, 29)));   // Sunday
            Assert.True(a.IsWorkingDay(Today));
            Assert.False(a.Config.Saved);
        }

        [Fact]
        public void Saved_settings_replace_the_server_ones()
        {
            var a = Service("{\"workStart\":\"09:30\",\"graceMinutes\":10,\"weeklyOff\":[0,6],\"yearlyAllowance\":20,\"officeFromCrm\":true,\"holidays\":[{\"date\":\"2026-11-26\",\"name\":\"Chhath\"}]}",
                new LeaveSettings { Holidays = new() { "2026-11-25" } });
            Assert.True(a.Config.Saved);
            Assert.Equal(20, a.YearlyAllowance);
            Assert.True(a.IsWorkingDay(new DateOnly(2026, 11, 25)));     // the server's holiday no longer counts
            Assert.False(a.IsWorkingDay(new DateOnly(2026, 11, 26)));
            Assert.Equal("Chhath", a.HolidayName(new DateOnly(2026, 11, 26)));
            Assert.False(a.IsWorkingDay(new DateOnly(2026, 11, 28)));    // Saturday off now
        }

        [Fact]
        public void Late_is_after_the_start_plus_grace_in_india_time()
        {
            var a = Service("{\"workStart\":\"10:00\",\"graceMinutes\":15,\"weeklyOff\":[0],\"yearlyAllowance\":24}");
            DateTime ist(int h, int m) => DateTime.SpecifyKind(new DateTime(2026, 11, 24, h, m, 0) - TimeSpan.FromHours(5.5), DateTimeKind.Utc);
            Assert.False(a.IsLate(ist(9, 50)));
            Assert.False(a.IsLate(ist(10, 15)));
            Assert.True(a.IsLate(ist(10, 16)));
            Assert.False(a.IsLate(null));
        }

        [Fact]
        public void Bad_settings_are_refused()
        {
            Assert.Null(new AttendanceConfig().Validate());
            Assert.NotNull(new AttendanceConfig { WorkStart = "25:00" }.Validate());
            Assert.NotNull(new AttendanceConfig { GraceMinutes = -1 }.Validate());
            Assert.NotNull(new AttendanceConfig { WeeklyOff = new() { 7 } }.Validate());
            Assert.NotNull(new AttendanceConfig { WeeklyOff = new() { 0, 1, 2, 3 } }.Validate());
            Assert.NotNull(new AttendanceConfig { Holidays = new() { new() { Date = "25 Nov", Name = "x" } } }.Validate());
            var c = new AttendanceConfig { WeeklyOff = new() { 6, 0, 0 }, Holidays = new() { new() { Date = "2026-12-25", Name = "" }, new() { Date = "2026-12-25", Name = "Christmas" } } }.Clean();
            Assert.Equal("0,6", string.Join(",", c.WeeklyOff));
            Assert.Single(c.Holidays);
        }

        [Fact]
        public void A_range_skips_days_off_unless_asked()
        {
            var a = Service();
            var (days, err) = AttendanceController.PlanDays("leave", new DateOnly(2026, 11, 27), new DateOnly(2026, 12, 1), Today, a.IsWorkingDay, false);
            Assert.Null(err);
            Assert.Equal(4, days.Count);    // Fri, Sat, Mon, Tue — Sunday skipped
            (days, err) = AttendanceController.PlanDays("leave", new DateOnly(2026, 11, 27), new DateOnly(2026, 12, 1), Today, a.IsWorkingDay, true);
            Assert.Equal(5, days.Count);
            // One day is marked as asked, even a Sunday (worked on a day off).
            (days, err) = AttendanceController.PlanDays("present", new DateOnly(2026, 11, 22), new DateOnly(2026, 11, 22), Today, a.IsWorkingDay, false);
            Assert.Null(err);
            Assert.Single(days);
        }

        [Fact]
        public void Present_and_absent_cant_be_marked_ahead()
        {
            var a = Service();
            Assert.NotNull(AttendanceController.PlanDays("absent", Today.AddDays(1), Today.AddDays(1), Today, a.IsWorkingDay, false).Error);
            Assert.NotNull(AttendanceController.PlanDays("present", Today, Today.AddDays(2), Today, a.IsWorkingDay, false).Error);
            Assert.Null(AttendanceController.PlanDays("leave", Today.AddDays(5), Today.AddDays(6), Today, a.IsWorkingDay, false).Error);
            Assert.NotNull(AttendanceController.PlanDays("leave", Today, Today.AddDays(70), Today, a.IsWorkingDay, false).Error);
            Assert.NotNull(AttendanceController.PlanDays("leave", Today.AddDays(3), Today, Today, a.IsWorkingDay, false).Error);
        }

        [Fact]
        public void The_export_codes_each_day()
        {
            Assert.Equal("P", AttendanceController.Code(new DayStatus(Today, "worked", null)));
            Assert.Equal("P*", AttendanceController.Code(new DayStatus(Today, "worked", null) { Late = true }));
            Assert.Equal("H", AttendanceController.Code(new DayStatus(Today, "worked", null) { Half = true }));
            Assert.Equal("L", AttendanceController.Code(new DayStatus(Today, "leave", "sick")));
            Assert.Equal("A", AttendanceController.Code(new DayStatus(Today, "absent", null)));
            Assert.Equal("O", AttendanceController.Code(new DayStatus(Today, "off", null)));
            Assert.Equal("", AttendanceController.Code(new DayStatus(Today, "future", null)));
        }
    }
}
