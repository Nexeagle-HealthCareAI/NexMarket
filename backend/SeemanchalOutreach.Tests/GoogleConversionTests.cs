using System;
using System.Text.Json;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Sending "came to the hospital" back to Google Ads: the click code, and the request Google's Data Manager expects.</summary>
    public class GoogleConversionTests
    {
        [Fact]
        public void Only_real_click_codes_are_kept()
        {
            Assert.Equal("Cj0KCQiA_abc-123XYZ", GoogleConversions.CleanClickId(" Cj0KCQiA_abc-123XYZ "));
            Assert.Null(GoogleConversions.CleanClickId(null));
            Assert.Null(GoogleConversions.CleanClickId(""));
            Assert.Null(GoogleConversions.CleanClickId("<script>alert(1)</script>"));
            Assert.Null(GoogleConversions.CleanClickId(new string('a', 600)));
            Assert.Equal("1234567890", GoogleConversions.AccountId("123-456-7890"));
        }

        [Fact]
        public void The_request_names_the_account_action_click_and_a_time_after_the_click()
        {
            var cfg = new GoogleConfig { AdsCustomer = "123-456-7890", AdsLoginCustomer = "999-000-1111" };
            var lead = Guid.NewGuid();
            var click = new DateTime(2026, 11, 20, 4, 0, 0, DateTimeKind.Utc);
            var items = new[]
            {
                new GoogleConversions.Pending(lead, "GCLID1", click, "arrived", new DateTime(2026, 11, 21, 6, 30, 0, DateTimeKind.Utc)),
                new GoogleConversions.Pending(Guid.NewGuid(), "GCLID2", click, "arrived", click.AddHours(-3)), // marked before the click: clamped
            };
            var json = JsonSerializer.Serialize(GoogleConversions.Request(cfg, "7012345678", items, true));
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            Assert.True(root.GetProperty("validateOnly").GetBoolean());
            var dest = root.GetProperty("destinations")[0];
            Assert.Equal("GOOGLE_ADS", dest.GetProperty("operatingAccount").GetProperty("accountType").GetString());
            Assert.Equal("1234567890", dest.GetProperty("operatingAccount").GetProperty("accountId").GetString());
            Assert.Equal("9990001111", dest.GetProperty("loginAccount").GetProperty("accountId").GetString());
            Assert.Equal("7012345678", dest.GetProperty("productDestinationId").GetString());
            var e0 = root.GetProperty("events")[0];
            Assert.Equal("GCLID1", e0.GetProperty("adIdentifiers").GetProperty("gclid").GetString());
            Assert.Equal("2026-11-21T12:00:00+05:30", e0.GetProperty("eventTimestamp").GetString());
            Assert.Equal($"{lead:N}-arrived", e0.GetProperty("transactionId").GetString());
            Assert.Equal("2026-11-20T09:31:00+05:30", root.GetProperty("events")[1].GetProperty("eventTimestamp").GetString());
        }

        [Fact]
        public void No_login_account_when_the_account_is_its_own()
        {
            var cfg = new GoogleConfig { AdsCustomer = "1234567890", AdsLoginCustomer = "123-456-7890" };
            var json = JsonSerializer.Serialize(GoogleConversions.Request(cfg, "1", Array.Empty<GoogleConversions.Pending>(), false));
            Assert.DoesNotContain("loginAccount", json);
        }

        [Fact]
        public void Google_is_a_tracked_link_channel()
        {
            Assert.True(System.Linq.Enumerable.Any(LeadSourcesController.Channels, c => c.Code == "google" && c.Prefix == "GGL"));
        }
    }
}
