using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    public enum FieldKind { Text, LongText, Paras, Lines, Date, Time, Bool, Select, Image, Phone, Url, Path, Pairs, Keep }

    /// <summary>One field of a kind of website content. CrmOnly fields are kept in the CRM and never written to the website.</summary>
    public record SiteField(string Name, string Label, FieldKind Kind, bool Required = false, int Max = 0, string[]? Options = null, string? Help = null,
        bool CrmOnly = false, string A = "", string B = "", string ALabel = "", string BLabel = "", bool BUrl = false);

    /// <summary>
    /// A kind of website content: which file it lives in, its shape there (a list, an object by id, or one object),
    /// which field is its key and title, and its fields. The website's own build checks the same rules (src/data/content.ts).
    /// </summary>
    public record SiteType(string Key, string Label, string Plural, string File, string Shape, string KeyField, string TitleField,
        bool ReviewByDefault, bool CanCreate, bool CanUnpublish, SiteField[] Fields, string Help);

    public static class SiteTypes
    {
        private static SiteField F(string name, string label, FieldKind kind, bool req = false, int max = 0, string? help = null, string[]? options = null, bool crmOnly = false) =>
            new(name, label, kind, req, max, options, help, crmOnly);
        private static SiteField Pairs(string name, string label, string a, string aLabel, string b, string bLabel, bool bUrl = false, string? help = null) =>
            new(name, label, FieldKind.Pairs, false, 0, null, help, false, a, b, aLabel, bLabel, bUrl);

        public static readonly SiteType Article = new("article", "Article", "Articles", "blog.json", "list", "slug", "title", true, true, true, new[]
        {
            F("title", "Title", FieldKind.Text, true, 200), F("excerpt", "Short summary", FieldKind.LongText, true, 400), F("departmentId", "Department", FieldKind.Select, true),
            F("author", "Author", FieldKind.Text, true, 120), F("image", "Picture", FieldKind.Image), F("sections", "Sections (heading, paragraphs, points)", FieldKind.Keep),
            Pairs("references", "References", "label", "Name", "url", "Link", true),
        }, "Patient-education articles at /blogs/<address>. Always reviewed by a named reviewer.");

        public static readonly SiteType Faq = new("faq", "Question", "Questions", "faqs.json", "list", "id", "question", false, true, true, new[]
        {
            F("question", "Question", FieldKind.Text, true, 300), F("answer", "Answer", FieldKind.LongText, true), F("category", "What it is about", FieldKind.Select, true, options: SiteRules.FaqCategories),
        }, "Questions and answers on the FAQ page, in the order set here.");

        public static readonly SiteType Site = new("site", "Hospital details", "Hospital details", "site.json", "single", "", "", false, false, false,
            SiteRules.SiteKeys.Select(k => F(k, SiteRules.SiteLabels[k], k is "description" or "medicalDisclaimer" or "emergencyInfo" ? FieldKind.LongText : FieldKind.Text, true)).ToArray(),
            "Phone, WhatsApp, email, timings and the other details shown across the website.");

        public static readonly SiteType Doctor = new("doctor", "Doctor", "Doctors", "doctors.json", "list", "id", "name", false, true, true, new[]
        {
            F("name", "Name, as shown", FieldKind.Text, true, 120, "e.g. Dr Aziz Ahmed"),
            F("department", "Department", FieldKind.Text, true, 80), F("specialty", "Speciality", FieldKind.Text, true, 80),
            F("qualifications", "Qualifications", FieldKind.Text, true, 160, "e.g. MBBS, MD"),
            F("yearsOfExperience", "Experience", FieldKind.Text, true, 60, "e.g. 10 years experience"),
            F("medicalRegistration", "Registration line", FieldKind.Text, true, 80, "e.g. Verified Profile"),
            F("consultationTimings", "Consultation timings", FieldKind.Text, true, 160), F("languages", "Languages", FieldKind.Text, true, 120),
            F("focusAreas", "Areas of care (one per line)", FieldKind.Lines), F("biography", "Short biography", FieldKind.LongText, false, 800),
            F("profileImage", "Photo", FieldKind.Image), F("bookingUrl", "Booking link", FieldKind.Url),
            F("isClickable", "Has a profile page", FieldKind.Bool, help: "Only for a doctor whose profile page already exists on the website."),
            F("slug", "Profile page address", FieldKind.Text, false, 80, "Only with a profile page, e.g. dr-md-taquedis-noori"),
            F("isVerified", "Verified", FieldKind.Bool),
            F("profileImagePlaceholder", "Name line under the photo", FieldKind.Keep), F("label", "Badge", FieldKind.Keep), F("rating", "Rating", FieldKind.Keep),
            F("reviewCount", "Reviews", FieldKind.Keep), F("practicesAtAddress", "Address", FieldKind.Keep), F("initials", "Initials", FieldKind.Keep), F("avatarGradient", "Colour", FieldKind.Keep),
            F("crmDoctorId", "CRM doctor", FieldKind.Text, crmOnly: true),
        }, "The Our doctors page. A doctor can be created from the CRM's Departments & doctors records and refreshed from them.");

        public static readonly SiteType Camp = new("camp", "Health camp", "Health camps", "camps.json", "list", "slug", "title", false, true, true, new[]
        {
            F("title", "Title", FieldKind.Text, true, 140), F("date", "Day", FieldKind.Date, true), F("startTime", "From", FieldKind.Time, true), F("endTime", "To", FieldKind.Time, true),
            F("place", "Place", FieldKind.Text, true, 140, "e.g. Kasba Panchayat Bhawan"), F("address", "Address or area", FieldKind.Text, false, 200),
            F("description", "What it is about", FieldKind.LongText, true, 600), F("services", "What is checked (one per line)", FieldKind.Lines),
            F("doctors", "Doctors (one per line)", FieldKind.Lines), F("free", "Free", FieldKind.Bool), F("contactPhone", "Phone to call", FieldKind.Phone),
            F("campId", "CRM camp", FieldKind.Text, crmOnly: true),
        }, "Upcoming camps on the Health camps page. A camp leaves the website by itself the day after.");

        public static readonly SiteType Notice = new("notice", "Notice", "Notices", "notices.json", "list", "id", "text", false, true, true, new[]
        {
            F("text", "Notice", FieldKind.LongText, true, 220, "Shown at the top of every page. Up to 220 characters."),
            F("tone", "Kind", FieldKind.Select, true, options: new[] { "info", "urgent" }),
            F("linkLabel", "Link text (optional)", FieldKind.Text, false, 60), F("linkHref", "Link to (a page like /contact, or https://…)", FieldKind.Text, false, 300),
            F("startDate", "Show from", FieldKind.Date), F("endDate", "Show until", FieldKind.Date),
        }, "Short notices at the top of every page between their dates: holidays, closures, new services.");

        public static readonly SiteType Testimonial = new("testimonial", "Patient story", "Patient stories", "testimonials.json", "list", "id", "name", true, true, true, new[]
        {
            F("quote", "What the patient said", FieldKind.LongText, true, 600), F("name", "Name shown", FieldKind.Text, true, 60, "A first name and initial is enough, e.g. Ramesh K."),
            F("place", "Place (optional)", FieldKind.Text, false, 60), F("departmentId", "Department (optional)", FieldKind.Select),
            F("consentRecorded", "The patient gave written consent to show this", FieldKind.Bool, true, crmOnly: true),
            F("consentNote", "How consent was given and where the form is kept", FieldKind.Text, true, 200, "e.g. Signed form, 12 Nov 2026, kept at reception file 4", crmOnly: true),
        }, "Patient stories on the home page. Never shown without written consent on record.");

        public static readonly SiteType Service = new("service", "Service page", "Service pages", "services.json", "map", "id", "title", true, false, false, new[]
        {
            F("title", "Title", FieldKind.Text, true, 160), F("tagline", "Tagline", FieldKind.Text, false, 200), F("description", "Short description", FieldKind.LongText, false, 600),
            F("overview", "Overview (empty line between paragraphs)", FieldKind.Paras), F("symptoms", "Symptoms (one per line)", FieldKind.Lines),
            Pairs("procedures", "Procedures", "name", "Name", "description", "What it is"),
            F("benefits", "Benefits (one per line)", FieldKind.Lines), F("preparation", "Preparing for it (one per line)", FieldKind.Lines),
            Pairs("faqs", "Questions", "question", "Question", "answer", "Answer"), F("risks", "Risks", FieldKind.LongText),
            Pairs("references", "References", "label", "Name", "url", "Link", true),
            F("seoTitle", "Title in Google", FieldKind.Text, false, 120), F("seoDescription", "Description in Google", FieldKind.LongText, false, 300),
        }, "The text of the urology service pages. The page design stays as it is; text not changed here keeps the page's own.");

        public static readonly SiteType Redirect = new("redirect", "Redirect", "Redirects", "redirects.json", "list", "from", "from", false, true, true, new[]
        {
            F("from", "Old address", FieldKind.Path, true, 200, "e.g. /blogs/old-name"), F("to", "New address", FieldKind.Path, true, 200, "e.g. /blogs/new-name"),
        }, "Old addresses sent to new ones. Made by itself when an article's address changes.");

        public static readonly SiteType[] All = { Article, Faq, Site, Doctor, Camp, Notice, Testimonial, Service, Redirect };
        public static readonly string[] Generic = { "doctor", "camp", "notice", "testimonial", "service", "redirect" };
        public static SiteType Of(string type) => All.FirstOrDefault(t => t.Key == type) ?? throw new ArgumentException("Unknown content type " + type);
        public static bool IsGeneric(string type) => Generic.Contains(type);

        private static readonly Regex TimeRx = new(@"^([01]\d|2[0-3]):[0-5]\d$", RegexOptions.Compiled);
        private static readonly Regex PathRx = new(@"^/[a-z0-9\-/]*$", RegexOptions.Compiled);
        private static readonly Regex DateRx = new(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.Compiled);
        public static bool DateOk(string s) => DateRx.IsMatch(s) && DateOnly.TryParseExact(s, "yyyy-MM-dd", out _);
        public static bool PathOk(string s) => PathRx.IsMatch(s) && !s.Contains("//") && s.Length <= 200;

        private static string Digits(string s) { var d = new string(s.Where(char.IsDigit).ToArray()); return d.Length > 10 && d.StartsWith("91") ? d[^10..] : d; }

        /// <summary>The known fields only, trimmed; empty optional fields left out.</summary>
        public static JsonObject Clean(SiteType t, JsonObject d)
        {
            var o = new JsonObject();
            foreach (var f in t.Fields)
            {
                var v = d[f.Name];
                switch (f.Kind)
                {
                    case FieldKind.Keep:
                        if (v != null) o[f.Name] = v.DeepClone();
                        break;
                    case FieldKind.Bool:
                        if (v is JsonValue bv && bv.TryGetValue<bool>(out var b)) o[f.Name] = b; else if (f.Name is "isClickable" or "free" or "consentRecorded") o[f.Name] = false;
                        break;
                    case FieldKind.Lines:
                    case FieldKind.Paras:
                        o[f.Name] = new JsonArray((v as JsonArray ?? new JsonArray()).Select(SiteRules.Text).Where(x => x.Length > 0).Take(60).Select(x => (JsonNode)JsonValue.Create(x)!).ToArray());
                        break;
                    case FieldKind.Pairs:
                        var pairs = (v as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(p => (A: SiteRules.Text(p[f.A]), B: SiteRules.Text(p[f.B])))
                            .Where(p => p.A.Length > 0 || p.B.Length > 0).Take(40).Select(p => (JsonNode)new JsonObject { [f.A] = p.A, [f.B] = p.B }).ToArray();
                        if (pairs.Length > 0) o[f.Name] = new JsonArray(pairs);
                        break;
                    case FieldKind.Phone:
                        var ph = Digits(SiteRules.Text(v));
                        if (ph.Length > 0) o[f.Name] = ph;
                        break;
                    default:
                        var s = SiteRules.Text(v);
                        if (f.Kind == FieldKind.LongText && v is JsonValue lv && lv.TryGetValue<string>(out var raw)) s = raw.Replace("\r\n", "\n").Trim();
                        if (f.Kind is FieldKind.Select or FieldKind.Path) s = s.ToLowerInvariant();
                        if (s.Length > 0 || f.Required) o[f.Name] = s;
                        break;
                }
            }
            var key = SiteRules.Text(d[t.KeyField]);
            if (t.KeyField.Length > 0 && !o.ContainsKey(t.KeyField) && key.Length > 0) o[t.KeyField] = key;
            if (t.Key == "service" && SiteRules.Text(d["slug"]).Length > 0) o["slug"] = SiteRules.Text(d["slug"]);
            return o;
        }

        public static string KeyOf(SiteType t, JsonObject d) => SiteRules.Text(d[t.KeyField]) is var k && t.Key == "redirect" ? k.ToLowerInvariant() : k.ToLowerInvariant();

        public static string TitleOf(SiteType t, JsonObject d)
        {
            if (t.Key == "redirect") return $"{SiteRules.Text(d["from"])} → {SiteRules.Text(d["to"])}";
            if (t.Key == "testimonial") return $"{SiteRules.Text(d["name"])}: {Cut(SiteRules.Text(d["quote"]), 50)}";
            if (t.Key == "notice") return Cut(SiteRules.Text(d["text"]), 80);
            return SiteRules.Text(d[t.TitleField]);
        }

        private static string Cut(string s, int n) => s.Length <= n ? s : s[..n].TrimEnd() + "…";

        /// <summary>What stops it from going to the website, in plain words.</summary>
        public static List<string> Problems(SiteType t, JsonObject d, IReadOnlyCollection<string> departments)
        {
            var p = new List<string>();
            foreach (var f in t.Fields)
            {
                var v = d[f.Name];
                var s = SiteRules.Text(v);
                switch (f.Kind)
                {
                    case FieldKind.Keep: break;
                    case FieldKind.Bool:
                        if (f.Required && !(v is JsonValue bv && bv.TryGetValue<bool>(out var b) && b)) p.Add(t.Key == "testimonial" ? "A patient story can't be published without the patient's written consent." : $"{f.Label}: tick it.");
                        break;
                    case FieldKind.Lines:
                    case FieldKind.Paras:
                        if (f.Required && (v as JsonArray)?.Count is null or 0) p.Add($"{f.Label} is empty.");
                        break;
                    case FieldKind.Pairs:
                        var rows = (v as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
                        for (var i = 0; i < rows.Count; i++)
                        {
                            var a = SiteRules.Text(rows[i][f.A]); var bb = SiteRules.Text(rows[i][f.B]);
                            if (a.Length == 0 || bb.Length == 0) p.Add($"{f.Label} {i + 1} needs both {f.ALabel.ToLowerInvariant()} and {f.BLabel.ToLowerInvariant()}.");
                            else if (f.BUrl && !Regex.IsMatch(bb, @"^https://\S+$")) p.Add($"{f.Label} {i + 1}: the link must start with https://.");
                        }
                        break;
                    default:
                        if (s.Length == 0) { if (f.Required) p.Add($"{f.Label} is empty."); break; }
                        if (f.Max > 0 && s.Length > f.Max) p.Add($"{f.Label} is {s.Length} characters; up to {f.Max}.");
                        if (f.Kind == FieldKind.Date && !DateOk(s)) p.Add($"{f.Label} isn't a real date.");
                        if (f.Kind == FieldKind.Time && !TimeRx.IsMatch(s)) p.Add($"{f.Label} must be a time like 09:30.");
                        if (f.Kind == FieldKind.Phone && !Regex.IsMatch(s, @"^\d{10}$")) p.Add($"{f.Label} must be the 10 digits only.");
                        if (f.Kind == FieldKind.Url && !Regex.IsMatch(s, @"^https://\S+$")) p.Add($"{f.Label} must start with https://.");
                        if (f.Kind == FieldKind.Path && !PathOk(s)) p.Add($"{f.Label} must be an address on this website, like /blogs/kidney-stones.");
                        if (f.Kind == FieldKind.Image && !s.StartsWith('/')) p.Add($"{f.Label} must be a picture from the Media library.");
                        if (f.Kind == FieldKind.Select)
                        {
                            var options = f.Options ?? (f.Name == "departmentId" ? departments.ToArray() : Array.Empty<string>());
                            if (options.Length > 0 && !options.Contains(s)) p.Add($"Pick {f.Label.ToLowerInvariant()}.");
                        }
                        break;
                }
            }
            var key = SiteRules.Text(d[t.KeyField]);
            if (t.Key != "redirect" && !SiteRules.SlugOk(key)) p.Add("It needs a short id in lowercase letters, numbers and hyphens.");
            switch (t.Key)
            {
                case "camp":
                    if (TimeRx.IsMatch(SiteRules.Text(d["startTime"])) && TimeRx.IsMatch(SiteRules.Text(d["endTime"])) && string.CompareOrdinal(SiteRules.Text(d["endTime"]), SiteRules.Text(d["startTime"])) <= 0) p.Add("The camp ends before it starts.");
                    break;
                case "notice":
                    var from = SiteRules.Text(d["startDate"]); var to = SiteRules.Text(d["endDate"]);
                    if (from.Length > 0 && to.Length > 0 && string.CompareOrdinal(to, from) < 0) p.Add("The notice ends before it starts.");
                    var lh = SiteRules.Text(d["linkHref"]); var ll = SiteRules.Text(d["linkLabel"]);
                    if ((lh.Length > 0) != (ll.Length > 0)) p.Add("A link needs both its text and where it goes.");
                    if (lh.Length > 0 && !PathOk(lh) && !Regex.IsMatch(lh, @"^https://\S+$")) p.Add("The link must be a page on this website (like /contact) or start with https://.");
                    break;
                case "doctor":
                    var click = d["isClickable"] is JsonValue cv && cv.TryGetValue<bool>(out var c) && c;
                    if (click && !SiteRules.SlugOk(SiteRules.Text(d["slug"]))) p.Add("A doctor with a profile page needs its address.");
                    break;
                case "redirect":
                    if (SiteRules.Text(d["from"]) == SiteRules.Text(d["to"])) p.Add("The redirect points to itself.");
                    if (SiteRules.Text(d["from"]) == "/") p.Add("The home page can't be redirected.");
                    break;
            }
            return p;
        }

        /// <summary>The copy the website gets: CRM-only fields removed, and shaped the way the website reads it.</summary>
        public static JsonObject LiveCopy(SiteType t, JsonObject data)
        {
            var d = Clean(t, data);
            foreach (var f in t.Fields.Where(f => f.CrmOnly)) d.Remove(f.Name);
            switch (t.Key)
            {
                case "notice":
                    var lh = SiteRules.Text(d["linkHref"]); var ll = SiteRules.Text(d["linkLabel"]);
                    d.Remove("linkHref"); d.Remove("linkLabel");
                    if (lh.Length > 0 && ll.Length > 0) d["link"] = new JsonObject { ["label"] = ll, ["href"] = lh };
                    break;
                case "testimonial":
                    d["consentRecorded"] = true;
                    break;
                case "doctor":
                    if (SiteRules.Text(d["profileImagePlaceholder"]).Length == 0) d["profileImagePlaceholder"] = $"{SiteRules.Text(d["name"])}, {SiteRules.Text(d["qualifications"])}";
                    if (SiteRules.Text(d["initials"]).Length == 0)
                        d["initials"] = string.Concat(SiteRules.Text(d["name"]).Replace("Dr.", "").Replace("Dr ", "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => char.ToUpperInvariant(w[0])));
                    if (!(d["isClickable"] is JsonValue cv && cv.TryGetValue<bool>(out var c) && c)) d.Remove("slug");
                    break;
                case "service":
                    d.Remove("id"); d.Remove("slug");
                    break;
            }
            // The website wants its fields in its own order; keep the id first, as in the files people read.
            var ordered = new JsonObject();
            if (t.KeyField.Length > 0 && d[t.KeyField] != null && t.Key != "service") ordered[t.KeyField] = d[t.KeyField]!.DeepClone();
            foreach (var (k, v) in d) if (!ordered.ContainsKey(k)) ordered[k] = v?.DeepClone();
            return ordered;
        }

        /// <summary>A CRM record shaped from what the website has (on bring-in, or when the website changed it on GitHub).</summary>
        public static JsonObject FromSite(SiteType t, JsonObject live, string? key = null)
        {
            var d = (JsonObject)live.DeepClone();
            if (t.Key == "notice" && d["link"] is JsonObject l) { d["linkLabel"] = SiteRules.Text(l["label"]); d["linkHref"] = SiteRules.Text(l["href"]); d.Remove("link"); }
            if (t.Key == "testimonial") { d["consentRecorded"] = true; d["consentNote"] = "Already on the website when it was connected"; }
            if (t.Key == "service" && key != null) d["id"] = key;
            return Clean(t, d);
        }

        /// <summary>The whole file for one kind, from what will be live, always in the same order so the same content gives the same file.</summary>
        public static string FileFor(SiteType t, IEnumerable<(SiteContent Item, JsonObject Live)> live)
        {
            var rows = live.ToList();
            if (t.Shape == "map")
            {
                var map = new JsonObject();
                foreach (var (item, copy) in rows.OrderBy(r => r.Item.Key, StringComparer.Ordinal)) map[item.Key] = copy.DeepClone();
                return SiteRules.FileText(map);
            }
            IEnumerable<(SiteContent Item, JsonObject Live)> ordered = t.Key == "camp"
                ? rows.OrderBy(r => SiteRules.Text(r.Live["date"]), StringComparer.Ordinal).ThenBy(r => SiteRules.Text(r.Live["startTime"]), StringComparer.Ordinal).ThenBy(r => r.Item.Key, StringComparer.Ordinal)
                : rows.OrderBy(r => r.Item.SortOrder).ThenBy(r => r.Item.Key, StringComparer.Ordinal);
            return SiteRules.FileText(new JsonArray(ordered.Select(r => (JsonNode)r.Live.DeepClone()).ToArray()));
        }

        /// <summary>Every field, for the editor and the Developer tab.</summary>
        public static object Describe(SiteType t, SiteConfig cfg) => new
        {
            key = t.Key, label = t.Label, plural = t.Plural, file = cfg.FilePath(t.File), shape = t.Shape, keyField = t.KeyField, help = t.Help,
            needsReview = SiteRules.NeedsReview(t.Key, cfg), canCreate = t.CanCreate, canUnpublish = t.CanUnpublish,
            fields = t.Fields.Where(f => f.Kind != FieldKind.Keep).Select(f => new
            {
                name = f.Name, label = f.Label, kind = f.Kind.ToString().ToLowerInvariant(), required = f.Required, max = f.Max, help = f.Help, crmOnly = f.CrmOnly,
                options = f.Options ?? (f.Name == "departmentId" ? cfg.Departments.ToArray() : null), a = f.A, b = f.B, aLabel = f.ALabel, bLabel = f.BLabel,
            }),
        };
    }
}
