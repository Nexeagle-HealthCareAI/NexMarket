using System.Collections.Generic;
using SeemanchalOutreach.Api.Controllers;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class WhatsAppProfileTests
    {
        [Fact]
        public void Valid_profile_becomes_Meta_body()
        {
            var err = WhatsAppProfileController.Validate(new WhatsAppProfileDto
            {
                About = "  Free camps  ·  OPD ", Description = "Line one\nLine two", Address = "Purnia", Email = "info@glisan.in",
                Websites = new List<string> { "glisanhospitalpurnia.in", "" }, Vertical = "HEALTH",
            }, out var body);
            Assert.Null(err);
            Assert.Equal("whatsapp", body["messaging_product"]);
            Assert.Equal("Free camps · OPD", body["about"]);
            Assert.Equal("Line one\nLine two", body["description"]);
            Assert.Equal(new List<string> { "https://glisanhospitalpurnia.in" }, body["websites"]);
            Assert.Equal("HEALTH", body["vertical"]);
        }

        [Fact]
        public void Bad_values_are_refused()
        {
            Assert.NotNull(WhatsAppProfileController.Validate(new WhatsAppProfileDto { About = new string('a', 140) }, out _));
            Assert.NotNull(WhatsAppProfileController.Validate(new WhatsAppProfileDto { Email = "not-an-email" }, out _));
            Assert.NotNull(WhatsAppProfileController.Validate(new WhatsAppProfileDto { Websites = new List<string> { "a.in", "b.in", "c.in" } }, out _));
            Assert.NotNull(WhatsAppProfileController.Validate(new WhatsAppProfileDto { Websites = new List<string> { "nothing" } }, out _));
            Assert.NotNull(WhatsAppProfileController.Validate(new WhatsAppProfileDto { Vertical = "CASINO" }, out _));
            Assert.Null(WhatsAppProfileController.Validate(new WhatsAppProfileDto { Email = "" }, out var b));
            Assert.Equal("", b["email"]);
        }
    }
}
