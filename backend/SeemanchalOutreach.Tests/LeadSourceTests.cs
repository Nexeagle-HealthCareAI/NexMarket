using System.Collections.Generic;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Tracked links: codes, reading them from a WhatsApp message, and grouping leads by them.</summary>
    public class LeadSourceTests
    {
        [Fact]
        public void Codes_come_from_the_place_and_never_clash()
        {
            var taken = new HashSet<string> { "IG-BIO" };
            Assert.Equal("IG-BIO2", LeadSourcesController.SuggestCode("instagram", "Instagram bio", taken.Contains));
            Assert.Equal("HRD-KASBABUS", LeadSourcesController.SuggestCode("hoarding", "Kasba bus stand", _ => false));
            Assert.Equal("NEWS-DAINIK", LeadSourcesController.SuggestCode("print", "Dainik Jagran Purnia edition", _ => false));
            Assert.Equal("LNK-1", LeadSourcesController.SuggestCode("other", "!!", _ => false));
        }

        [Fact]
        public void The_code_is_read_from_the_message_and_from_the_lead()
        {
            Assert.Equal("IG-BIO", LeadInbox.ParseTags("नमस्ते, मुझे अस्पताल में दिखाना है।\nRef: IG-BIO").Ref);
            Assert.Equal("G7K2QX", LeadInbox.ParseTags("Hello\nRef: g7k2qx").Ref); // partner codes still work
            var l = new TrackedLink { Code = "HRD-KASBA", Name = "Hoarding · Kasba bus stand" };
            Assert.Equal("HRD-KASBA", LeadInbox.LinkCodeOf(LeadInbox.LinkRef(l)));
            Assert.Null(LeadInbox.LinkCodeOf(null));
        }
    }
}
