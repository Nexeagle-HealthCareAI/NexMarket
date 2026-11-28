using System;
using System.Linq;
using System.Text.Json;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Content codes and links, and reading where a WhatsApp message came from.</summary>
    public class AttributionTests
    {
        [Fact]
        public void Content_codes_follow_kind_and_topic_and_skip_taken_ones()
        {
            Assert.Equal("RL-KIDNEY-01", Attribution.ContentCode("reel", "Kidney stone treatment", "Pathri reel", _ => false));
            Assert.Equal("RL-KIDNEY-02", Attribution.ContentCode("reel", "Kidney stone treatment", "x", c => c == "RL-KIDNEY-01"));
            Assert.Equal("PS-DENGUE-01", Attribution.ContentCode("post", null, "Dengue warning post", _ => false));
            Assert.Equal("AD-GEN-01", Attribution.ContentCode("ad", null, "A", _ => false));
            Assert.True(Attribution.ContentCode("template", "Fever, dengue and malaria", "Camp invite", _ => false).Length <= 16);
            Assert.Null(Attribution.Prefix("place"));
        }

        [Fact]
        public void Links_carry_the_code()
        {
            Assert.Equal("https://ig.me/m/glisanhospital?ref=RL-STONE-01", Attribution.IgLink("@glisanhospital", "RL-STONE-01"));
            Assert.Equal("https://m.me/12345?ref=RL-STONE-01", Attribution.MessengerLink("12345", "RL-STONE-01"));
            Assert.Null(Attribution.IgLink(null, "X"));
            var c = Attribution.CaptionLine("RL-STONE-01", "https://wa.me/91?text=x");
            Assert.Contains("RL-STONE-01", c);
            Assert.Contains("कोड", c);
            Assert.Contains("https://wa.me/91?text=x", c);
        }

        [Fact]
        public void Page_paths_are_compared_without_site_query_or_slash()
        {
            Assert.Equal("/blog/pathri-ka-ilaj", Attribution.PathOf("https://glisanhospitalpurnia.in/blog/Pathri-ka-ilaj/?utm_campaign=X"));
            Assert.Equal("/blog/pathri-ka-ilaj", Attribution.PathOf("blog/pathri-ka-ilaj#top"));
            Assert.Equal("/blog/pathri-ka-ilaj", Attribution.PathOf("/Blog/pathri-ka-ilaj?x=1"));
            Assert.Equal("/", Attribution.PathOf("https://site.in/"));
            Assert.Null(Attribution.PathOf(" "));
        }

        [Fact]
        public void Click_to_WhatsApp_referral_is_read_whole()
        {
            var m = JsonDocument.Parse("{\"referral\":{\"source_url\":\"https://fb.me/x\",\"source_id\":\"120210000000001\",\"source_type\":\"ad\",\"headline\":\"Stone clinic\",\"ctwa_clid\":\"ARAkLkA\"}}").RootElement;
            Assert.Equal("120210000000001", WhatsAppWebhookController.ReferralPart(m, "source_id"));
            Assert.Equal("ARAkLkA", WhatsAppWebhookController.ReferralPart(m, "ctwa_clid"));
            Assert.Equal("https://fb.me/x", WhatsAppWebhookController.ReferralPart(m, "source_url"));
            var bad = JsonDocument.Parse("{\"referral\":{\"source_id\":\"../x\"}}").RootElement;
            Assert.Null(WhatsAppWebhookController.ReferralPart(bad, "source_id"));
            Assert.Null(WhatsAppWebhookController.ReferralPart(JsonDocument.Parse("{}").RootElement, "source_id"));
        }
    }
}
