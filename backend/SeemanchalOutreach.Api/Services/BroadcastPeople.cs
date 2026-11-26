using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>One person a broadcast goes to.</summary>
    public record BroadcastPerson(string Key, string Name, string Phone, string Group);

    /// <summary>A person as read from one list, before places, consent, STOP and repeats are applied.</summary>
    public record BroadcastRow(string Key, string Name, string? Phone, string Group, string? Panchayat, string? Block, string? District, string? Type = null, bool Consent = true);

    /// <summary>How many people each group has for the chosen places, before people in two groups are counted once.</summary>
    public class BroadcastCounts
    {
        public int Total { get; set; }
        public Dictionary<string, int> ByGroup { get; set; } = new();
        public Dictionary<string, int> ByType { get; set; } = new();
        /// <summary>Camp people with a number who didn't tick "send me messages" (left out unless asked for).</summary>
        public int CampNoConsent { get; set; }
        /// <summary>People who said STOP, across every group.</summary>
        public int OptedOut { get; set; }
        /// <summary>Enquiries with no place known, left out because places are chosen.</summary>
        public int NoPlace { get; set; }
        /// <summary>The same number in more than one group (sent one message).</summary>
        public int Duplicates { get; set; }
    }

    /// <summary>
    /// Who a broadcast goes to, from every list of people NexMarket has: partners (by type), people booked at health
    /// camps, referred patients, health card holders, and people who enquired (WhatsApp, forms, the website). Narrowed to
    /// districts, blocks and panchayats; each number gets one message; anyone who said STOP is left out.
    /// </summary>
    public static class BroadcastPeople
    {
        public static readonly (string Code, string Label)[] Groups =
        {
            ("partners", "Partners"), ("camp", "Health camp people"), ("referred", "Referred patients"), ("cards", "Health card holders"), ("enquiries", "Enquiries"),
        };

        private static bool AnyPlace(BroadcastAudience a) => a.Districts.Count > 0 || a.Blocks.Count > 0 || a.Panchayats.Count > 0;

        /// <summary>True when the person's panchayat, block or district is one of those chosen (or no place is chosen).</summary>
        public static bool InPlaces(BroadcastAudience a, string? panchayat, string? block, string? district)
        {
            if (!AnyPlace(a)) return true;
            static bool has(List<string> list, string? v) => v != null && list.Any(x => string.Equals(x, v, StringComparison.OrdinalIgnoreCase));
            return has(a.Panchayats, panchayat) || has(a.Blocks, block) || has(a.Districts, district);
        }

        /// <summary>The groups asked for; an older broadcast (from before groups) meant partners.</summary>
        public static List<string> GroupsOf(BroadcastAudience a) => a.Groups.Count == 0 ? new() { "partners" } : a.Groups.Where(g => Groups.Any(x => x.Code == g)).Distinct().ToList();

        private static async Task<List<BroadcastRow>> RowsAsync(IMarketingDbContext db, BroadcastAudience a, CancellationToken ct)
        {
            var groups = GroupsOf(a);
            var places = await db.Panchayats.AsNoTracking().Select(p => new { p.PanchayatId, p.Block, p.District }).ToListAsync(ct);
            var where = places.ToDictionary(p => p.PanchayatId, p => (p.Block, p.District));
            (string? b, string? d) at(string? pid) => pid != null && where.TryGetValue(pid, out var w) ? (w.Block, w.District) : (null, null);
            var rows = new List<BroadcastRow>();

            if (groups.Contains("partners"))
            {
                var q = db.Contacts.AsNoTracking().Where(c => !c.IsMerged && !c.PhoneInvalid);
                if (a.ContactTypes.Count > 0) q = q.Where(c => a.ContactTypes.Contains(c.Role));
                if (a.ImportantOnly) q = q.Where(c => c.IsImportant);
                foreach (var c in await q.Select(c => new { c.ClientId, c.Name, c.Phone, c.PanchayatId, c.Role, c.WhatsappOptOut }).ToListAsync(ct))
                {
                    var (b, d) = at(c.PanchayatId);
                    rows.Add(new BroadcastRow("p:" + c.ClientId, c.Name, c.WhatsappOptOut ? null : c.Phone, "partners", c.PanchayatId, b, d, c.Role));
                }
            }
            if (groups.Contains("camp"))
            {
                var q = from p in db.CampPatients.AsNoTracking()
                        join c in db.HealthCamps.AsNoTracking() on p.CampId equals c.Id
                        where p.Phone != null && p.Status != "cancelled"
                        select new { p.Id, p.Name, p.Phone, p.PanchayatId, p.CampId, p.Status, p.Consent, c.Block, c.District };
                if (a.CampIds.Count > 0) q = q.Where(x => a.CampIds.Contains(x.CampId));
                if (a.CampArrivedOnly) q = q.Where(x => x.Status != "booked" && x.Status != "no_show");
                foreach (var p in await q.ToListAsync(ct))
                {
                    var (b, d) = at(p.PanchayatId);
                    rows.Add(new BroadcastRow("c:" + p.Id, p.Name, p.Phone, "camp", p.PanchayatId, b ?? p.Block, d ?? p.District, null, p.Consent));
                }
            }
            if (groups.Contains("referred"))
            {
                foreach (var r in await db.Referrals.AsNoTracking().Where(r => r.ClientPhone != null && r.ClientPhone != "")
                             .Select(r => new { r.ClientId, r.PatientName, r.ClientPhone, r.PanchayatId, r.Block, r.District }).ToListAsync(ct))
                {
                    var (b, d) = at(r.PanchayatId);
                    rows.Add(new BroadcastRow("r:" + r.ClientId, r.PatientName, r.ClientPhone, "referred", r.PanchayatId, b ?? r.Block, d ?? r.District));
                }
            }
            if (groups.Contains("cards"))
            {
                foreach (var h in await db.HealthCards.AsNoTracking().Where(h => h.Phone != null && h.Status != "cancelled")
                             .Select(h => new { h.Id, h.HolderName, h.Phone, h.Block, h.District }).ToListAsync(ct))
                    rows.Add(new BroadcastRow("h:" + h.Id, h.HolderName, h.Phone, "cards", null, h.Block, h.District));
            }
            if (groups.Contains("enquiries"))
            {
                foreach (var l in await db.Leads.AsNoTracking().Where(l => !l.OptOut).Select(l => new { l.Id, l.Name, l.Phone }).ToListAsync(ct))
                    rows.Add(new BroadcastRow("l:" + l.Id, l.Name, l.Phone, "enquiries", null, null, null));
                foreach (var w in await db.WaConversations.AsNoTracking().Where(w => !w.OptOut && w.LastInboundAt != null).Select(w => new { w.Phone, w.Name }).ToListAsync(ct))
                    rows.Add(new BroadcastRow("w:" + w.Phone, w.Name.StartsWith("+") ? "" : w.Name, w.Phone, "enquiries", null, null, null));
            }
            return rows;
        }

        private static async Task<HashSet<string>> StoppedAsync(IMarketingDbContext db, CancellationToken ct)
        {
            var set = new HashSet<string>();
            foreach (var p in await db.WaConversations.AsNoTracking().Where(w => w.OptOut).Select(w => w.Phone).ToListAsync(ct)) if (LeadInbox.NormalizePhone(p) is string n) set.Add(n);
            foreach (var p in await db.Leads.AsNoTracking().Where(l => l.OptOut).Select(l => l.Phone).ToListAsync(ct)) if (LeadInbox.NormalizePhone(p) is string n) set.Add(n);
            foreach (var p in await db.Contacts.AsNoTracking().Where(c => c.WhatsappOptOut && c.Phone != null).Select(c => c.Phone!).ToListAsync(ct)) if (LeadInbox.NormalizePhone(p) is string n) set.Add(n);
            return set;
        }

        /// <summary>Applies places, consent and STOP to the rows, and keeps one per number (the first group listed wins).</summary>
        public static (List<BroadcastPerson> People, BroadcastCounts Counts) Pick(BroadcastAudience a, List<BroadcastRow> rows, HashSet<string> stopped)
        {
            var counts = new BroadcastCounts();
            var people = new List<BroadcastPerson>();
            var seen = new HashSet<string>();
            var places = AnyPlace(a);
            foreach (var r in rows)
            {
                if (places && r.Panchayat == null && r.Block == null && r.District == null) { counts.NoPlace++; continue; }
                if (!InPlaces(a, r.Panchayat, r.Block, r.District)) continue;
                var phone = LeadInbox.NormalizePhone(r.Phone);
                if (phone == null) continue;
                if (stopped.Contains(phone)) { counts.OptedOut++; continue; }
                if (r.Group == "camp" && !r.Consent && !a.IncludeNoConsent) { counts.CampNoConsent++; continue; }
                counts.ByGroup[r.Group] = counts.ByGroup.GetValueOrDefault(r.Group) + 1;
                if (r.Type != null) counts.ByType[r.Type] = counts.ByType.GetValueOrDefault(r.Type) + 1;
                if (!seen.Add(phone)) { counts.Duplicates++; continue; }
                people.Add(new BroadcastPerson(r.Key, (r.Name ?? "").Trim(), phone, r.Group));
            }
            counts.Total = people.Count;
            return (people, counts);
        }

        public static async Task<(List<BroadcastPerson> People, BroadcastCounts Counts)> ResolveAsync(IMarketingDbContext db, BroadcastAudience a, CancellationToken ct)
        {
            // Partners are listed first, so a partner who is also a camp person is greeted as a partner.
            var order = Groups.Select(g => g.Code).ToList();
            var rows = (await RowsAsync(db, a, ct)).OrderBy(r => order.IndexOf(r.Group)).ToList();
            return Pick(a, rows, await StoppedAsync(db, ct));
        }

        /// <summary>The partner-type counts for the chosen places, whatever types are ticked (so the chips show their numbers).</summary>
        public static async Task<Dictionary<string, int>> TypeCountsAsync(IMarketingDbContext db, BroadcastAudience a, CancellationToken ct)
        {
            var all = new BroadcastAudience { Groups = new() { "partners" }, ImportantOnly = a.ImportantOnly, Districts = a.Districts, Blocks = a.Blocks, Panchayats = a.Panchayats };
            var (_, c) = await ResolveAsync(db, all, ct);
            return c.ByType;
        }

        /// <summary>The first name, for "नमस्ते {{1}}"; "जी" when there's no name.</summary>
        public static string FirstName(string? name)
        {
            var n = (name ?? "").Trim();
            if (n.Length == 0 || n.StartsWith("+") || n.All(ch => char.IsDigit(ch) || ch == ' ')) return "जी";
            foreach (var t in new[] { "dr.", "dr", "mr.", "mrs.", "ms.", "shri", "smt." })
                if (n.StartsWith(t + " ", StringComparison.OrdinalIgnoreCase)) return n; // keep "Dr. Ahmad"
            var first = n.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
            return first.Length < 2 ? n : first;
        }
    }
}
