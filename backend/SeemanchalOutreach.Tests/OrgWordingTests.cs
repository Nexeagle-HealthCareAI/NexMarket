using System;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class OrgWordingTests
    {
        [Fact]
        public void The_first_organisation_keeps_its_own_wording()
        {
            using (OrgScope.Enter(null))
            {
                Assert.True(OrgText.IsFirst);
                Assert.Equal(OrgText.FirstName, OrgText.Name);
                Assert.Equal("Glisan Akbari Hospital", OrgText.For("Glisan Akbari Hospital"));
                Assert.Equal(" in Seemanchal, Bihar", OrgText.OnlyFirst(" in Seemanchal, Bihar"));
            }
            using (OrgScope.Enter(new OrgInfo("main", "Glisan Akbari SuperSpeciality Hospital", null)))
                Assert.Equal("ग्लिसन अकबरी हॉस्पिटल", OrgText.For("ग्लिसन अकबरी हॉस्पिटल"));
        }

        [Fact]
        public void Every_other_organisation_is_named_by_its_own_name()
        {
            using (OrgScope.Enter(new OrgInfo("citylab", "City Lab", "nm_citylab")))
            {
                Assert.False(OrgText.IsFirst);
                Assert.Equal("City Lab", OrgText.Name);
                Assert.Equal("City Lab", OrgText.For("Glisan Akbari Hospital"));
                Assert.Equal("", OrgText.OnlyFirst(" in Seemanchal, Bihar"));
            }
        }

        [Theory]
        [InlineData(null, "hospital")]
        [InlineData("", "hospital")]
        [InlineData("hospital,lab,pharmacy", "hospital")]
        [InlineData("clinic", "clinic")]
        [InlineData("LAB", "lab")]
        [InlineData("diagnostic", "diagnostic centre")]
        [InlineData("pharmacy", "pharmacy")]
        [InlineData("dialysis", "dialysis centre")]
        [InlineData("other", "centre")]
        [InlineData("lab, diagnostic", "centre")]
        public void Each_kind_of_organisation_has_its_everyday_word(string? kinds, string word)
        {
            Assert.Equal(word, OrgText.PlaceOf(kinds));
        }

        [Fact]
        public void The_AI_helpers_are_told_the_word_only_when_it_is_not_a_hospital()
        {
            using (OrgScope.Enter(null)) Assert.Equal("", OrgText.KindNote);
            using (OrgScope.Enter(new OrgInfo("care", "Care Hospital", "nm_care", "hospital,lab"))) Assert.Equal("", OrgText.KindNote);
            using (OrgScope.Enter(new OrgInfo("citylab", "City Lab", "nm_citylab", "lab")))
            {
                Assert.Equal("lab", OrgText.Place);
                Assert.Contains("read \"the lab\"", OrgText.KindNote);
            }
        }

        [Fact]
        public void A_sign_up_code_fits_only_the_phone_and_email_it_was_sent_to()
        {
            var now = DateTime.UtcNow;
            var owner = Signup.CodeOwner("9876543210", " Asha@Example.com ");
            Assert.Equal(owner, Signup.CodeOwner("9876543210", "asha@example.com"));
            var waiting = new Recovery.Pending(Recovery.Hash(owner, "123456"), now.AddMinutes(10), 0);

            Assert.Equal(Recovery.Result.Ok, Recovery.Check(waiting, owner, "123 456", now));
            Assert.Equal(Recovery.Result.Wrong, Recovery.Check(waiting, Signup.CodeOwner("9876543211", "asha@example.com"), "123456", now));
            Assert.Equal(Recovery.Result.Wrong, Recovery.Check(waiting, Signup.CodeOwner("9876543210", "other@example.com"), "123456", now));
            Assert.Equal(Recovery.Result.Wrong, Recovery.Check(waiting, Signup.CodeOwner("9876543210", null), "123456", now));
            Assert.Equal(Recovery.Result.None, Recovery.Check(null, owner, "123456", now));
            Assert.Equal(Recovery.Result.Expired, Recovery.Check(waiting, owner, "123456", now.AddMinutes(11)));
            Assert.NotEqual(Signup.CodeKey("9876543210"), Signup.CodeSendsKey("9876543210"));
        }
    }
}
