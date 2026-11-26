using System;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Booking a camp place by replying to a camp broadcast on WhatsApp.</summary>
    public class CampReplyTests
    {
        [Theory]
        [InlineData("button", "नाम लिखवाएँ", CampReplies.Ask.Book)]
        [InlineData("text", "Mera naam likh lijiye", CampReplies.Ask.Book)]
        [InlineData("text", "book", CampReplies.Ask.Book)]
        [InlineData("text", "मुझे भी शामिल करें, घुटने में दर्द है", CampReplies.Ask.Book)]
        [InlineData("text", "বুক করুন", CampReplies.Ask.Book)]
        [InlineData("text", "हाँ जी", CampReplies.Ask.Yes)]
        [InlineData("text", "Yes 🙏", CampReplies.Ask.Yes)]
        [InlineData("button", "नहीं, बाद में", CampReplies.Ask.None)]
        [InlineData("text", "booking nahi karni", CampReplies.Ask.None)]
        [InlineData("text", "Eye doctor kab baithte hain?", CampReplies.Ask.None)]
        [InlineData("text", "Facebook pe dekha", CampReplies.Ask.None)]
        [InlineData("text", "", CampReplies.Ask.None)]
        public void Reads_what_the_reply_asks(string type, string text, CampReplies.Ask want)
        {
            Assert.Equal(want, CampReplies.Read(type, text));
        }

        [Fact]
        public void The_confirmation_has_the_token_and_where()
        {
            var c = new HealthCamp { Title = "हड्डी और जोड़ जांच", Date = new DateOnly(2026, 12, 7), StartTime = "09:00", EndTime = "14:00", Venue = "पंचायत भवन", Block = "Kasba" };
            var t = CampReplies.Confirmation("Reena", c, 88, false);
            Assert.Contains("बुकिंग पक्की", t);
            Assert.Contains("टोकन नंबर: 88", t);
            Assert.Contains("पंचायत भवन, Kasba", t);
            Assert.Contains("पहले से", CampReplies.Confirmation("Reena", c, 12, true));
        }
    }
}
