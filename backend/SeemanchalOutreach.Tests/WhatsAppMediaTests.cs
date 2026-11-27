using System.Text.Json;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Photos and files people send on WhatsApp: the media id is kept so the inbox can show them.</summary>
    public class WhatsAppMediaTests
    {
        [Fact]
        public void The_media_id_is_read_from_the_webhook()
        {
            var m = JsonDocument.Parse("{\"type\":\"image\",\"image\":{\"mime_type\":\"image/jpeg\",\"id\":\"1234567890123\"}}").RootElement;
            Assert.Equal("1234567890123", WhatsAppWebhookController.MediaPart(m, "id"));
            Assert.Equal("image/jpeg", WhatsAppWebhookController.MediaPart(m, "mime_type"));
            var d = JsonDocument.Parse("{\"type\":\"document\",\"document\":{\"id\":\"../etc\",\"filename\":\"report.pdf\"}}").RootElement;
            Assert.Null(WhatsAppWebhookController.MediaPart(d, "id"));
            Assert.Equal("report.pdf", WhatsAppWebhookController.MediaPart(d, "filename"));
            Assert.Null(WhatsAppWebhookController.MediaPart(JsonDocument.Parse("{\"type\":\"text\",\"text\":{\"body\":\"hi\"}}").RootElement, "id"));
        }

        [Fact]
        public void It_is_kept_on_incoming_messages_only()
        {
            var json = LeadInbox.MediaJson(new LeadInbox.Inbound { MediaId = "1234567890123", MediaMime = "image/jpeg" });
            Assert.Equal("1234567890123", LeadInbox.MediaOf(new WaMessage { Direction = "in", ParamsJson = json })?.Id);
            Assert.Null(LeadInbox.MediaOf(new WaMessage { Direction = "out", ParamsJson = json }));
            Assert.Null(LeadInbox.MediaOf(new WaMessage { Direction = "in", ParamsJson = "{\"a\":\"mediaId\"}" }));
            Assert.Null(LeadInbox.MediaJson(new LeadInbox.Inbound()));
        }
    }
}
