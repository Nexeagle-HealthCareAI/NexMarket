using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Who a broadcast reaches: groups, places, consent, STOP, one message per number; and any-template messages.</summary>
    public class BroadcastAudienceTests
    {
        private static List<BroadcastRow> Rows() => new()
        {
            new("p:1", "Dr. Ahmad Raza", "9876543210", "partners", "pk1", "Kasba", "Purnia", "rmp_doctor"),
            new("p:2", "Sunita Devi", "9876500001", "partners", "pb1", "Baisi", "Purnia", "asha_worker"),
            new("c:1", "Ahmad", "+91 98765 43210", "camp", "pk1", "Kasba", "Purnia", null, true),    // same number as the partner
            new("c:2", "Reena", "9811111111", "camp", null, "Kasba", "Purnia", null, false),          // no consent
            new("c:3", "Meena", "9822222222", "camp", "pa1", "Amour", "Purnia", null, true),
            new("h:1", "Rafiya", "9833333333", "cards", null, null, "Katihar"),
            new("l:1", "Lead", "9844444444", "enquiries", null, null, null),
            new("l:2", "Stopped", "9855555555", "enquiries", null, null, null),
        };

        private static readonly HashSet<string> Stop = new() { "919855555555" };

        [Fact]
        public void Everyone_once_per_number_without_STOP_or_missing_consent()
        {
            var (people, c) = BroadcastPeople.Pick(new BroadcastAudience(), Rows(), Stop);
            Assert.Equal(new[] { "p:1", "p:2", "c:3", "h:1", "l:1" }, people.Select(p => p.Key));
            Assert.Equal(1, c.Duplicates);
            Assert.Equal(1, c.CampNoConsent);
            Assert.Equal(1, c.OptedOut);
            Assert.Equal("919876543210", people[0].Phone);
        }

        [Fact]
        public void Places_take_any_of_district_block_or_panchayat()
        {
            var (people, c) = BroadcastPeople.Pick(new BroadcastAudience { Blocks = new() { "kasba" }, Panchayats = new() { "pa1" }, IncludeNoConsent = true }, Rows(), Stop);
            Assert.Equal(new[] { "p:1", "c:2", "c:3" }, people.Select(p => p.Key));
            Assert.Equal(2, c.NoPlace); // the two enquiries have no place

            var (katihar, _) = BroadcastPeople.Pick(new BroadcastAudience { Districts = new() { "Katihar" } }, Rows(), Stop);
            Assert.Equal(new[] { "h:1" }, katihar.Select(p => p.Key));
        }

        [Fact]
        public void Old_broadcasts_meant_partners()
        {
            Assert.Equal(new List<string> { "partners" }, BroadcastPeople.GroupsOf(new BroadcastAudience()));
            Assert.Equal(new List<string> { "camp", "cards" }, BroadcastPeople.GroupsOf(new BroadcastAudience { Groups = new() { "camp", "cards", "camp", "nobody" } }));
        }

        [Fact]
        public void First_names_for_the_greeting()
        {
            Assert.Equal("Reena", BroadcastPeople.FirstName("Reena Kumari"));
            Assert.Equal("Dr. Ahmad Raza", BroadcastPeople.FirstName("Dr. Ahmad Raza"));
            Assert.Equal("जी", BroadcastPeople.FirstName("+919876543210"));
            Assert.Equal("जी", BroadcastPeople.FirstName(" "));
        }

        private static Dictionary<string, string> Tpl(string values, string body = "नमस्ते {{1}}, {{2}} को शिविर है।") => new()
        {
            ["template"] = "nx_camp_invite", ["templateLanguage"] = "hi", ["body"] = body, ["values"] = values,
        };

        [Fact]
        public void Any_template_fills_the_name_and_shows_the_attachment()
        {
            var p = Tpl("[\"{name}\",\"29 नवंबर\"]");
            p["headerType"] = "image"; p["headerMediaId"] = "1234567890";
            Assert.Null(BroadcastsController.Check("template", p));
            Assert.Equal(new List<string> { "Reena", "29 नवंबर" }, BroadcastComposer.TemplateParams(p, "Reena Kumari"));
            Assert.Equal("🖼 नमस्ते Reena, 29 नवंबर को शिविर है।", BroadcastComposer.TemplatePreview(p, "Reena Kumari"));
            Assert.Equal("🖼 नमस्ते [Name], 29 नवंबर को शिविर है।", BroadcastComposer.TemplatePreview(p, ""));
            Assert.Equal("image", BroadcastComposer.HeaderOf(p)!.Type);
        }

        [Fact]
        public void Any_template_needs_every_blank_and_its_attachment()
        {
            Assert.NotNull(BroadcastsController.Check("template", Tpl("[\"{name}\"]")));
            Assert.NotNull(BroadcastsController.Check("template", Tpl("[\"{name}\",\" \"]")));
            Assert.NotNull(BroadcastsController.Check("template", Tpl("[\"{name}\",\"line\\nbreak\"]")));
            var p = Tpl("[\"{name}\",\"kal\"]"); p["headerType"] = "document";
            Assert.NotNull(BroadcastsController.Check("template", p));
            Assert.NotNull(BroadcastsController.Check("party_invite", new()));
            Assert.Null(BroadcastsController.Check("general_update", new()));
        }

        [Fact]
        public void Template_payload_puts_the_picture_first()
        {
            var json = System.Text.Json.JsonSerializer.Serialize(WhatsAppOutbox.TemplatePayload("919876543210", "nx_poster", "hi", new List<string> { "Reena" },
                new WaHeader { Type = "document", MediaId = "555", FileName = "camp.pdf" }));
            Assert.Contains("\"type\":\"header\"", json);
            Assert.Contains("\"document\":{\"id\":\"555\",\"filename\":\"camp.pdf\"}", json);
            Assert.True(json.IndexOf("header", StringComparison.Ordinal) < json.IndexOf("body", StringComparison.Ordinal));
        }

        [Fact]
        public void A_picture_template_sends_its_sample_for_review()
        {
            var t = new WaTemplateDto { Name = "nx_poster", Category = "MARKETING", HeaderFormat = "IMAGE", HeaderHandle = "4::aW1hZ2U=", Body = "नमस्ते {{1}}, आपके लिए एक ज़रूरी सूचना।", Examples = new() { "रीना" } };
            var json = System.Text.Json.JsonSerializer.Serialize(WhatsAppTemplatesController.ComponentsOf(t));
            Assert.Contains("\"format\":\"IMAGE\"", json);
            Assert.Contains("\"header_handle\":[\"4::aW1hZ2U=\"]", json);
        }
    }
}
