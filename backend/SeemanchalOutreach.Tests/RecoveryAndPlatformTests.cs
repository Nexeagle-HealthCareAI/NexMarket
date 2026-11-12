using System.Security.Claims;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Forgot-password codes, and who may run the platform.</summary>
    public class RecoveryAndPlatformTests
    {
        private static readonly DateTime Now = new(2026, 11, 12, 6, 0, 0, DateTimeKind.Utc);
        private static Recovery.Pending For(string agent, string code, int tries = 0, int minutesLeft = 5) =>
            new(Recovery.Hash(agent, code), Now.AddMinutes(minutesLeft), tries);

        [Fact]
        public void A_code_is_six_digits()
        {
            for (var i = 0; i < 200; i++)
            {
                var c = Recovery.NewCode();
                Assert.Equal(6, c.Length);
                Assert.True(c.All(char.IsDigit));
            }
        }

        [Fact]
        public void The_right_code_works_and_spaces_do_not_matter()
        {
            Assert.Equal(Recovery.Result.Ok, Recovery.Check(For("MKT-1001", "048213"), "MKT-1001", "048213", Now));
            Assert.Equal(Recovery.Result.Ok, Recovery.Check(For("MKT-1001", "048213"), "mkt-1001", " 048 213 ", Now));
        }

        [Theory]
        [InlineData("048214")]
        [InlineData("48213")]
        [InlineData("")]
        [InlineData(null)]
        [InlineData("abcdef")]
        public void A_wrong_code_does_not(string? code) => Assert.Equal(Recovery.Result.Wrong, Recovery.Check(For("MKT-1001", "048213"), "MKT-1001", code, Now));

        [Fact]
        public void A_code_cannot_be_used_for_another_account() =>
            Assert.Equal(Recovery.Result.Wrong, Recovery.Check(For("MKT-1001", "048213"), "MKT-1002", "048213", Now));

        [Fact]
        public void A_code_ends_after_ten_minutes_or_five_wrong_tries()
        {
            Assert.Equal(Recovery.Result.Expired, Recovery.Check(For("MKT-1001", "048213", minutesLeft: 0), "MKT-1001", "048213", Now));
            Assert.Equal(Recovery.Result.TooManyTries, Recovery.Check(For("MKT-1001", "048213", tries: Recovery.MaxTries), "MKT-1001", "048213", Now));
            Assert.Equal(Recovery.Result.None, Recovery.Check(null, "MKT-1001", "048213", Now));
        }

        [Fact]
        public void The_email_carries_the_code_and_a_warning()
        {
            var text = Recovery.EmailText("048213", "City Lab");
            Assert.Contains("048213", text);
            Assert.Contains("City Lab", text);
            Assert.Contains("Never share this code", text);
        }

        private static ClaimsPrincipal Person(string role) => new(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role) }, "test"));

        [Fact]
        public void Only_an_admin_of_the_first_organisation_runs_the_platform()
        {
            var first = new OrgInfo("main", "Main", null);
            var other = new OrgInfo("citylab", "City Lab", "nm_citylab");
            Assert.True(Platform.IsOwner(Person("Admin"), first));
            Assert.False(Platform.IsOwner(Person("Admin"), other));               // another organisation's admin
            Assert.False(Platform.IsOwner(Person("MarketingManager"), first));    // not an admin
            Assert.False(Platform.IsOwner(Person("Admin"), null));
        }

        [Fact]
        public void The_platform_sees_only_the_end_of_a_phone_number()
        {
            Assert.Equal("…3210", Platform.PhoneEnd("98765 43210"));
            Assert.Equal("", Platform.PhoneEnd("12"));
            Assert.Equal("", Platform.PhoneEnd(null));
        }

        [Fact]
        public void A_one_time_password_is_long_and_passes_the_password_rules()
        {
            var p = Platform.OneTimePassword();
            Assert.True(p.Length >= 12);
            Assert.True(p.Any(char.IsLetter) && p.Any(char.IsDigit));
            Assert.NotEqual(p, Platform.OneTimePassword());
        }
    }
}
