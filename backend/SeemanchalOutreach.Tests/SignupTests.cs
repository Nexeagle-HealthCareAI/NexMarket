using SeemanchalOutreach.Api.Controllers;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>What a new organisation may and may not sign up with.</summary>
    public class SignupTests
    {
        private static SignupDto Good() => new()
        {
            OrgName = "City Lab", Kinds = new() { "lab", "diagnostic" }, Name = "Asha Rao", Phone = "+91 98765 43210",
            Email = "asha@citylab.in", Password = "goodpass1", City = "Pune",
        };

        private static string Wrong(Action<SignupDto> change)
        {
            var d = Good();
            change(d);
            return string.Join(",", Signup.Check(d, "main", out _).Keys.OrderBy(x => x));
        }

        [Fact]
        public void A_complete_form_passes_and_gets_a_sign_in_name()
        {
            Assert.Empty(Signup.Check(Good(), "main", out var key));
            Assert.Equal("city-lab", key);
        }

        [Fact]
        public void The_sign_in_name_is_suggested_from_the_organisations_name()
        {
            Assert.Equal("city-lab-scans", Signup.Suggest("City Lab & Scans"));
            Assert.Null(Signup.Suggest("A"));
            Assert.True((Signup.Suggest(new string('a', 50) + " lab") ?? "").Length <= 30);
        }

        [Theory]
        [InlineData("Admin")]
        [InlineData("main")]
        [InlineData("nexeagle")]
        [InlineData("support")]
        [InlineData("a;b")]
        public void Reserved_and_unsafe_sign_in_names_are_refused(string key) => Assert.Equal("orgKey", Wrong(d => d.OrgKey = key));

        [Fact]
        public void Each_field_is_checked()
        {
            Assert.Equal("orgKey,orgName", Wrong(d => d.OrgName = " "));
            Assert.Equal("kinds", Wrong(d => d.Kinds = new()));
            Assert.Equal("kinds", Wrong(d => d.Kinds = new() { "bank" }));
            Assert.Equal("phone", Wrong(d => d.Phone = "12345"));
            Assert.Equal("email", Wrong(d => d.Email = "a@b"));
            Assert.Equal("", Wrong(d => d.Email = ""));                   // email is optional
        }

        [Theory]
        [InlineData("short1")]
        [InlineData("onlyletters")]
        [InlineData("12345678")]
        public void Weak_passwords_are_refused(string password) => Assert.Equal("password", Wrong(d => d.Password = password));
    }
}
