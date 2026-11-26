using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Bookings straight from a WhatsApp reply. A broadcast can be linked to a health camp; when someone it went to taps the
    /// booking button or writes "book", "नाम लिखवाएँ"…, they are booked into that camp and get their token in the chat at
    /// once (a free reply: they wrote first). Plain words such as "yes" only count when the camp message was the last thing
    /// the hospital sent them, within 3 days. Nothing is booked for a camp that is over, cancelled or full.
    /// </summary>
    public static class CampReplies
    {
        /// <summary>"I want to book": in English, Hinglish, Hindi and Bangla.</summary>
        private static readonly Regex Book = new(
            @"(?<![\wऀ-৿])(book|booking|register|registration|enrol+|join|naam\s*likh\w*|nam\s*likh\w*|naam\s*de\w*|aaunga|aaungi|aayenge|aaenge|interested|slot)(?![\wऀ-৿])" +
            @"|नाम\s*लिख|बुक|बुकिंग|रजिस्टर|पंजीकरण|शामिल|आऊंगा|आऊँगा|आऊंगी|आऊँगी|आएंगे|आएँगे|জী\s*বুক|বুক|নাম\s*লিখ|আসব",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>A short "yes".</summary>
        private static readonly Regex Yes = new(@"^\s*(yes|yes please|ok|okay|haan|han|ha|ha ji|haan ji|ji|ji haan|हाँ|हां|हाँ जी|हां जी|जी|जी हाँ|ठीक है|হ্যাঁ|জী)\s*[.!🙏👍]*\s*$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>"No", "not now": never a booking, even on a button.</summary>
        private static readonly Regex No = new(@"(?<![\wऀ-৿])(no|nahi|nahin|nhi|not interested|later|baad me)(?![\wऀ-৿])|नहीं|बाद में|না",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public enum Ask { None, Book, Yes }

        /// <summary>What the reply asks for: a booking, a plain yes (counts only right after the camp message), or nothing.</summary>
        public static Ask Read(string type, string? text)
        {
            var t = (text ?? "").Trim();
            if (t.Length == 0 || t.Length > 200 || No.IsMatch(t)) return Ask.None;
            if (Book.IsMatch(t)) return Ask.Book;
            if (Yes.IsMatch(t)) return Ask.Yes;
            return Ask.None;
        }

        public static string Confirmation(string name, HealthCamp c, int token, bool again) =>
            (again ? $"नमस्ते {name}, आपका नाम पहले से लिखा हुआ है।" : $"नमस्ते {name}, आपकी बुकिंग पक्की हो गई है। ✅") +
            $"\nशिविर: {c.Title}\nतारीख और समय: {CampDesk.When(c)}\nजगह: {CampDesk.Place(c)}\nटोकन नंबर: {token}\n" +
            "शिविर में यह टोकन नंबर बताएं और पुरानी रिपोर्ट व दवाइयाँ साथ लाएं।";

        /// <summary>
        /// Books them if this reply answers a camp broadcast. Returns what happened ("booked", "again", "full") or null when the
        /// message isn't a booking. Caller saves.
        /// </summary>
        public static async Task<string?> TryBookAsync(IMarketingDbContext db, WhatsAppOutbox outbox, BroadcastRecipient? r, string phone,
            string type, string text, string? profileName, Guid? leadId, CancellationToken ct)
        {
            if (r == null) return null;
            var ask = Read(type, text);
            if (ask == Ask.None) return null;
            var b = await db.Broadcasts.AsNoTracking().FirstOrDefaultAsync(x => x.Id == r.BroadcastId, ct);
            if (b == null || !Guid.TryParse(BroadcastComposer.ParseParams(b.ParamsJson).GetValueOrDefault("campId"), out var campId)) return null;
            if (ask == Ask.Yes)
            {
                // "Yes" answers the camp message only if it was the last thing sent to them, and recent.
                if (r.SentAt == null || r.SentAt < DateTime.UtcNow.AddDays(-3)) return null;
                var lastOut = await db.WaMessages.AsNoTracking().Where(m => m.Phone == phone && m.Direction == "out" && m.Status != "blocked" && m.Status != "failed")
                    .OrderByDescending(m => m.CreatedAt).Select(m => m.BroadcastId).FirstOrDefaultAsync(ct);
                if (lastOut != b.Id) return null;
            }
            var c = await db.HealthCamps.FirstOrDefaultAsync(x => x.Id == campId, ct);
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            if (c == null || c.Status is "cancelled" or "done" || c.Date < today) return null;

            var mine = db.CampPatients.Local.FirstOrDefault(p => p.CampId == c.Id && p.Phone == phone && p.Status != "cancelled")
                ?? await db.CampPatients.FirstOrDefaultAsync(p => p.CampId == c.Id && p.Phone == phone && p.Status != "cancelled", ct);
            string first(string n) => n.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? n;
            if (mine != null)
            {
                await outbox.SendTextAsync(phone, Confirmation(first(mine.Name), c, mine.Token, true), "camp", "ai:camp_booking", leadId, ct);
                return "again";
            }
            var booked = await db.CampPatients.CountAsync(p => p.CampId == c.Id && p.Status != "cancelled", ct);
            if (booked >= c.Capacity)
            {
                await outbox.SendTextAsync(phone, $"क्षमा करें, “{c.Title}” की सभी जगहें भर गई हैं। अगले शिविर की जानकारी हम आपको भेजेंगे। 🙏", "camp", "ai:camp_booking", leadId, ct);
                return "full";
            }

            // The name and place we already know for this number: the broadcast's own record, an earlier camp, a partner.
            var name = (r.Name ?? "").Trim();
            if (name.Length < 2 || name.StartsWith("+")) name = (profileName ?? "").Trim();
            if (name.Length < 2) name = "WhatsApp " + phone[^4..];
            var last10 = phone.Length >= 10 ? phone[^10..] : phone;
            var earlier = await db.CampPatients.AsNoTracking().Where(p => p.Phone == phone).OrderByDescending(p => p.CreatedAt)
                .Select(p => new { p.Village, p.PanchayatId, p.Age, p.Sex }).FirstOrDefaultAsync(ct);
            var partner = earlier == null
                ? await db.Contacts.AsNoTracking().Where(x => x.Phone != null && x.Phone.EndsWith(last10) && !x.IsMerged).Select(x => new { x.PanchayatId }).FirstOrDefaultAsync(ct)
                : null;
            var pid = earlier?.PanchayatId ?? partner?.PanchayatId;
            var village = earlier?.Village;
            if (village == null && pid != null) village = await db.Panchayats.AsNoTracking().Where(x => x.PanchayatId == pid).Select(x => x.Name).FirstOrDefaultAsync(ct);

            var p = new CampPatient
            {
                CampId = c.Id, Name = name.Length > 80 ? name[..80] : name, Phone = phone, Age = earlier?.Age, Sex = earlier?.Sex, Village = village, PanchayatId = pid,
                Source = "whatsapp", Status = "booked", Consent = true, LeadId = leadId, CreatedBy = "whatsapp",
                Complaint = ask == Ask.Book && text.Length > 12 ? text.Trim()[..Math.Min(text.Trim().Length, 300)] : null,
                Token = await CampBook.NextTokenAsync(db, c.Id, ct),
            };
            db.CampPatients.Add(p);
            var msg = await outbox.SendTextAsync(phone, Confirmation(first(p.Name), c, p.Token, false), "camp", "ai:camp_booking", leadId, ct);
            p.WaStatus = msg.Status;
            p.WaError = msg.Error;
            return "booked";
        }
    }
}
