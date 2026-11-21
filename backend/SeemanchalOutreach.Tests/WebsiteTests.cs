using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class WebsiteTests
    {
        private static readonly string[] Depts = SiteRules.DefaultDepartments;

        private static JsonObject Article(string slug = "kidney-stones", string title = "Kidney stones: signs and care") => new()
        {
            ["slug"] = slug, ["title"] = title, ["excerpt"] = "What a kidney stone feels like, when to see a doctor, and how it is treated.",
            ["departmentId"] = "urology", ["author"] = "Glisan Hospital",
            ["sections"] = new JsonArray(new JsonObject { ["heading"] = "What it is", ["paragraphs"] = new JsonArray("A hard lump that forms in the kidney."), ["points"] = new JsonArray("Pain in the side") }),
        };

        private static SiteContent Item(string type, JsonObject d, string status = "draft") =>
            new() { Type = type, Key = SiteRules.KeyOf(type, d), Title = SiteRules.TitleOf(type, d), Data = d.ToJsonString(), Status = status };

        [Fact]
        public void Slug_is_made_from_the_title()
        {
            Assert.Equal("kidney-stones-what-to-do", SiteRules.Slug("  Kidney Stones: What to Do? "));
            Assert.Equal("", SiteRules.Slug("गुर्दे की पथरी"));
            Assert.True(SiteRules.Slug(new string('a', 40) + " " + new string('b', 60)).Length <= 70);
            Assert.True(SiteRules.SlugOk("ent-care-2"));
            Assert.False(SiteRules.SlugOk("Ent Care"));
            Assert.False(SiteRules.SlugOk("-ent"));
        }

        [Fact]
        public void A_complete_article_has_no_problems()
        {
            Assert.Equal(0, SiteRules.Problems("article", SiteRules.Clean("article", Article()), Depts).Count);
        }

        [Fact]
        public void An_article_says_what_is_missing()
        {
            var d = Article(); d["excerpt"] = " "; d["departmentId"] = "cardiology";
            d["sections"] = new JsonArray(new JsonObject { ["heading"] = "Empty one", ["paragraphs"] = new JsonArray() });
            d["references"] = new JsonArray(new JsonObject { ["label"] = "WHO", ["url"] = "http://who.int" });
            var p = SiteRules.Problems("article", SiteRules.Clean("article", d), Depts);
            Assert.True(p.Contains("Write the short summary."));
            Assert.True(p.Contains("Pick the department."));
            Assert.True(p.Any(x => x.StartsWith("Section 1") && x.EndsWith("is empty.")));
            Assert.True(p.Any(x => x.StartsWith("Reference 1")));
        }

        [Fact]
        public void A_picture_needs_a_description()
        {
            var d = SiteRules.Clean("article", Article());
            Assert.True(SiteRules.Problems("article", d, Depts, hasPicture: true).Any(x => x.StartsWith("Describe the picture")));
            d["image"] = new JsonObject { ["src"] = "", ["alt"] = "A doctor showing a kidney model" };
            Assert.Equal(0, SiteRules.Problems("article", d, Depts, hasPicture: true).Count);
        }

        [Fact]
        public void Clean_keeps_known_fields_and_drops_empty_lines()
        {
            var d = Article(); d["hack"] = "x"; d["title"] = "  Two   spaces  ";
            ((JsonArray)d["sections"]!).Add(new JsonObject { ["heading"] = " ", ["paragraphs"] = new JsonArray("", "  ") });
            var c = SiteRules.Clean("article", d);
            Assert.Null(c["hack"]);
            Assert.Equal("Two spaces", c["title"]!.ToString());
            Assert.Equal(1, ((JsonArray)c["sections"]!).Count);
            Assert.Null(c["references"]);
        }

        [Fact]
        public void Questions_and_hospital_details_are_checked()
        {
            var f = new JsonObject { ["id"] = "opd-timing", ["question"] = "When is the OPD open?", ["answer"] = "10 to 4.", ["category"] = "appointment" };
            Assert.Equal(0, SiteRules.Problems("faq", SiteRules.Clean("faq", f), Depts).Count);
            f["category"] = "money";
            Assert.Equal(1, SiteRules.Problems("faq", SiteRules.Clean("faq", f), Depts).Count);

            var s = new JsonObject();
            foreach (var k in SiteRules.SiteKeys) s[k] = "x";
            s["phone"] = "+91 98765 43210";
            var p = SiteRules.Problems("site", SiteRules.Clean("site", s), Depts);
            Assert.Equal(1, p.Count);
            s["phone"] = "9876543210";
            Assert.Equal(0, SiteRules.Problems("site", SiteRules.Clean("site", s), Depts).Count);
        }

        [Fact]
        public void A_medical_article_is_not_published_without_a_named_reviewer()
        {
            var cfg = new SiteConfig();
            var none = new List<string>();
            var c = Item("article", Article());
            Assert.Equal("A reviewer has to approve this first.", SiteRules.CantPublish(c, cfg, none));
            c.Status = "approved";
            Assert.Equal("A named reviewer has to approve this first.", SiteRules.CantPublish(c, cfg, none));
            c.ReviewedByName = "Dr Noori";
            Assert.Null(SiteRules.CantPublish(c, cfg, none));
            Assert.Equal("Write the title.", SiteRules.CantPublish(c, cfg, new List<string> { "Write the title." }));
        }

        [Fact]
        public void A_question_needs_no_reviewer_unless_the_setup_says_so()
        {
            var f = Item("faq", new JsonObject { ["id"] = "a", ["question"] = "Q", ["answer"] = "A", ["category"] = "hospital" }, "approved");
            Assert.Null(SiteRules.CantPublish(f, new SiteConfig(), new List<string>()));
            Assert.NotNull(SiteRules.CantPublish(f, new SiteConfig { ReviewTypes = new() { "article", "faq" } }, new List<string>()));
        }

        [Fact]
        public void Moves_that_are_not_allowed_say_why()
        {
            var c = Item("article", Article(), "publishing");
            Assert.NotNull(SiteRules.CantEdit(c));
            Assert.NotNull(SiteRules.CantUnpublish(c));
            c.Status = "review";
            Assert.Null(SiteRules.CantReview(c));
            Assert.Equal("This is already waiting for review.", SiteRules.CantSubmit(c, new List<string>()));
            c.Status = "published"; c.Published = "{}";
            Assert.Equal("Take it off the website first.", SiteRules.CantArchive(c));
            Assert.Null(SiteRules.CantUnpublish(c));
            c.Published = null; c.Status = "unpublished";
            Assert.Null(SiteRules.CantArchive(c));
            Assert.Equal("This isn't on the website.", SiteRules.CantUnpublish(c));
            Assert.NotNull(SiteRules.CantUnpublish(new SiteContent { Type = "site", Status = "published", Published = "{}" }));
            c.Archived = true;
            Assert.NotNull(SiteRules.CantEdit(c));
        }

        [Fact]
        public void The_live_copy_keeps_its_first_date_and_names_the_reviewer()
        {
            var c = Item("article", Article(), "approved");
            c.ReviewedByName = "Dr Noori";
            var first = SiteRules.LiveCopy(c, new DateOnly(2026, 11, 21), "/media/blogs/kidney-stones.jpg");
            Assert.Equal("2026-11-21", first["publishedAt"]!.ToString());
            Assert.Equal("published", first["status"]!.ToString());
            Assert.Equal("Dr Noori", first["reviewedBy"]!.ToString());
            Assert.Equal("/media/blogs/kidney-stones.jpg", first["image"]!["src"]!.ToString());
            c.FirstPublishedOn = new DateOnly(2026, 11, 21);
            Assert.Equal("2026-11-21", SiteRules.LiveCopy(c, new DateOnly(2027, 1, 5), null)["publishedAt"]!.ToString());
            Assert.Null(SiteRules.LiveCopy(c, new DateOnly(2027, 1, 5), null)["image"]);
        }

        [Fact]
        public void The_same_content_always_gives_the_same_file()
        {
            JsonObject A(string slug, string date) { var a = Article(slug); a["publishedAt"] = date; return a; }
            var one = SiteRules.BlogFile(new[] { A("b", "2026-01-01"), A("a", "2026-01-01"), A("z", "2026-05-01") });
            var two = SiteRules.BlogFile(new[] { A("z", "2026-05-01"), A("a", "2026-01-01"), A("b", "2026-01-01") });
            Assert.Equal(one, two);
            Assert.True(one.IndexOf("\"z\"") < one.IndexOf("\"a\"") && one.IndexOf("\"a\"") < one.IndexOf("\"b\""));
            Assert.True(one.EndsWith("]\n"));
            Assert.Equal("[]\n", SiteRules.BlogFile(Array.Empty<JsonObject>()));
        }

        [Fact]
        public void Files_keep_other_scripts_readable_and_questions_in_their_order()
        {
            var q1 = new JsonObject { ["id"] = "one", ["question"] = "ओपीडी कब खुलती है?", ["answer"] = "₹200 & 10–4", ["category"] = "hospital" };
            var q2 = new JsonObject { ["id"] = "two", ["question"] = "Q2", ["answer"] = "A", ["category"] = "hospital" };
            var text = SiteRules.FaqFile(new[] { (20, q1), (10, q2) });
            Assert.True(text.Contains("ओपीडी कब खुलती है?"));
            Assert.True(text.Contains("₹200 & 10–4"));
            Assert.True(text.IndexOf("\"two\"") < text.IndexOf("\"one\""));
        }

        [Fact]
        public void The_reason_a_build_failed_is_read_from_its_log()
        {
            var log = "2026-11-21T10:00:00Z vite build\n2026-11-21T10:00:02Z Error: content/blog.json: article \"x\" has no \"author\".\n    at fail (content.ts:47)\n";
            Assert.Equal("content/blog.json: article \"x\" has no \"author\".", SiteRules.FailureReason(log));
            Assert.Equal("Process completed with exit code 1.", SiteRules.FailureReason("step\n##[error]Process completed with exit code 1.\n"));
            Assert.Null(SiteRules.FailureReason("all good"));
            Assert.Null(SiteRules.FailureReason(null));
        }

        [Fact]
        public void Warnings_help_search_results_but_do_not_block()
        {
            var d = SiteRules.Clean("article", Article(title: new string('x', 75)));
            var w = SiteRules.Warnings("article", d);
            Assert.True(w.Any(x => x.StartsWith("The title is 75")));
            Assert.True(w.Any(x => x.StartsWith("There is no picture")));
            Assert.Equal(0, SiteRules.Warnings("faq", d).Count);
        }

        [Fact]
        public void Pictures_get_their_website_address_from_the_folder()
        {
            Assert.Equal("/media/blogs/a.jpg", new SiteConfig().MediaUrl("a.jpg"));
            Assert.Equal("/img/a.jpg", new SiteConfig { MediaDir = "/static/img/" }.MediaUrl("a.jpg").Replace("/static", ""));
            Assert.Equal("/a.jpg", new SiteConfig { MediaDir = "public" }.MediaUrl("a.jpg"));
            Assert.Equal("content/blog.json", new SiteConfig { ContentDir = "/content/" }.FilePath("blog.json"));
        }

        [Fact]
        public void The_app_key_signs_a_proof_github_can_check()
        {
            using var rsa = RSA.Create(2048);
            var jwt = GitHubClient.AppJwt("12345", rsa.ExportRSAPrivateKeyPem(), new DateTimeOffset(2026, 11, 21, 10, 0, 0, TimeSpan.Zero));
            var parts = jwt.Split('.');
            Assert.Equal(3, parts.Length);
            static byte[] Un(string s) { s = s.Replace('-', '+').Replace('_', '/'); return Convert.FromBase64String(s + new string('=', (4 - s.Length % 4) % 4)); }
            var body = JsonNode.Parse(Encoding.UTF8.GetString(Un(parts[1])))!;
            Assert.Equal("12345", body["iss"]!.ToString());
            Assert.Equal(600L, body["exp"]!.GetValue<long>() - body["iat"]!.GetValue<long>());
            Assert.True(rsa.VerifyData(Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]), Un(parts[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            var ex = Assert.Throws<GitHubException>(() => GitHubClient.AppJwt("1", "not a key", DateTimeOffset.UtcNow));
            Assert.True(ex.Message.StartsWith("The private key can't be read"));
        }

        // ── Phase 2: more kinds of content ─────────────────────────────────────

        private static JsonObject Camp(string date = "2030-01-12") => new()
        {
            ["slug"] = "kasba-camp", ["title"] = "Free kidney camp", ["date"] = date, ["startTime"] = "09:00", ["endTime"] = "14:00",
            ["place"] = "Kasba Panchayat Bhawan", ["description"] = "Free check-up.", ["services"] = new JsonArray("Urine test", " "), ["doctors"] = new JsonArray(),
            ["free"] = true, ["contactPhone"] = "+91 92346 06330", ["campId"] = "abc",
        };

        [Fact]
        public void A_camp_is_checked_and_its_crm_link_never_reaches_the_website()
        {
            var t = SiteTypes.Camp;
            var d = SiteTypes.Clean(t, Camp());
            Assert.Equal("9234606330", d["contactPhone"]!.ToString());
            Assert.Equal(1, ((JsonArray)d["services"]!).Count);
            Assert.Equal(0, SiteTypes.Problems(t, d, Depts).Count);
            var live = SiteTypes.LiveCopy(t, d);
            Assert.Null(live["campId"]);
            Assert.Equal("kasba-camp", live.First().Key == "slug" ? live["slug"]!.ToString() : "");
            d["endTime"] = "08:00"; d["date"] = "2030-02-30";
            var p = SiteTypes.Problems(t, d, Depts);
            Assert.True(p.Contains("The camp ends before it starts."));
            Assert.True(p.Any(x => x.Contains("isn't a real date")));
        }

        [Fact]
        public void A_patient_story_needs_written_consent_and_the_note_stays_in_the_crm()
        {
            var t = SiteTypes.Testimonial;
            var d = SiteTypes.Clean(t, new JsonObject { ["id"] = "story-ramesh", ["quote"] = "Home the next day.", ["name"] = "Ramesh K." });
            var p = SiteTypes.Problems(t, d, Depts);
            Assert.True(p.Any(x => x.Contains("written consent")));
            Assert.True(p.Any(x => x.StartsWith("How consent was given")));
            d["consentRecorded"] = true; d["consentNote"] = "Signed form, reception file 4";
            Assert.Equal(0, SiteTypes.Problems(t, d, Depts).Count);
            var live = SiteTypes.LiveCopy(t, d);
            Assert.Equal(true, live["consentRecorded"]!.GetValue<bool>());
            Assert.Null(live["consentNote"]);
            Assert.True(SiteRules.NeedsReview("testimonial", new SiteConfig()));
        }

        [Fact]
        public void A_notice_link_is_shaped_for_the_website_and_back()
        {
            var t = SiteTypes.Notice;
            var d = SiteTypes.Clean(t, new JsonObject { ["id"] = "notice-1", ["text"] = "OPD closed on Sunday.", ["tone"] = "info", ["linkLabel"] = "Timings", ["linkHref"] = "/contact", ["startDate"] = "2026-11-20", ["endDate"] = "2026-11-19" });
            Assert.True(SiteTypes.Problems(t, d, Depts).Contains("The notice ends before it starts."));
            d["endDate"] = "2026-11-30";
            Assert.Equal(0, SiteTypes.Problems(t, d, Depts).Count);
            var live = SiteTypes.LiveCopy(t, d);
            Assert.Equal("/contact", live["link"]!["href"]!.ToString());
            Assert.Null(live["linkHref"]);
            var back = SiteTypes.FromSite(t, live);
            Assert.Equal("Timings", back["linkLabel"]!.ToString());
            d["linkHref"] = "javascript:alert(1)";
            Assert.True(SiteTypes.Problems(t, d, Depts).Any(x => x.StartsWith("The link must be")));
        }

        [Fact]
        public void A_doctor_gets_a_name_line_and_initials_and_keeps_fields_it_does_not_edit()
        {
            var t = SiteTypes.Doctor;
            var d = SiteTypes.Clean(t, new JsonObject
            {
                ["id"] = "dr-aziz-ahmed", ["name"] = "Dr Aziz Ahmed", ["department"] = "Anesthesiology", ["specialty"] = "Anesthesiology", ["qualifications"] = "MBBS, MD",
                ["yearsOfExperience"] = "10 years experience", ["medicalRegistration"] = "Verified Profile", ["consultationTimings"] = "Mon - Sat", ["languages"] = "Hindi",
                ["avatarGradient"] = "from-sky-500 to-blue-500", ["slug"] = "dr-aziz", ["crmDoctorId"] = "x",
            });
            Assert.Equal(0, SiteTypes.Problems(t, d, Depts).Count);
            var live = SiteTypes.LiveCopy(t, d);
            Assert.Equal("AA", live["initials"]!.ToString());
            Assert.Equal("Dr Aziz Ahmed, MBBS, MD", live["profileImagePlaceholder"]!.ToString());
            Assert.Equal("from-sky-500 to-blue-500", live["avatarGradient"]!.ToString());
            Assert.Null(live["slug"]);           // no profile page, so no address
            Assert.Null(live["crmDoctorId"]);
            d["isClickable"] = true; d.Remove("slug");
            Assert.True(SiteTypes.Problems(t, d, Depts).Contains("A doctor with a profile page needs its address."));
        }

        [Fact]
        public void Service_text_is_written_by_service_id_and_redirects_are_checked()
        {
            var svc = new SiteContent { Type = "service", Key = "srv-5", Data = new JsonObject { ["id"] = "srv-5", ["slug"] = "lap", ["title"] = "Laparoscopic surgery", ["tagline"] = "Small scars" }.ToJsonString() };
            var copy = SiteRules.LiveCopy(svc, new DateOnly(2026, 11, 21), null);
            Assert.Null(copy["id"]); Assert.Null(copy["slug"]);
            var file = SitePublisher.FileFor("service", new[] { (svc, copy) });
            Assert.True(file.Contains("\"srv-5\": {"));
            Assert.NotNull(SiteRules.CantUnpublish(new SiteContent { Type = "service", Status = "published", Published = "{}" }));
            var r = SiteTypes.Clean(SiteTypes.Redirect, new JsonObject { ["from"] = "/blogs/Old", ["to"] = "/blogs/old" });
            Assert.True(SiteTypes.Problems(SiteTypes.Redirect, r, Depts).Contains("The redirect points to itself."));
            Assert.Equal("/blogs/old", SitePublisher.BlogPath("old"));
        }

        [Fact]
        public void Camps_are_written_in_date_order()
        {
            SiteContent Item(string key) => new() { Type = "camp", Key = key };
            JsonObject C(string slug, string date) { var c = SiteTypes.LiveCopy(SiteTypes.Camp, SiteTypes.Clean(SiteTypes.Camp, Camp(date))); c["slug"] = slug; return c; }
            var file = SitePublisher.FileFor("camp", new[] { (Item("b"), C("b", "2030-03-01")), (Item("a"), C("a", "2030-01-01")) });
            Assert.True(file.IndexOf("2030-01-01") < file.IndexOf("2030-03-01"));
        }

        [Fact]
        public void Every_kind_has_a_file_and_review_defaults_are_safe()
        {
            Assert.Equal(SiteTypes.All.Length, SiteTypes.All.Select(t => t.File).Distinct().Count());
            var cfg = new SiteConfig();
            Assert.True(SiteRules.NeedsReview("article", cfg) && SiteRules.NeedsReview("service", cfg));
            Assert.False(SiteRules.NeedsReview("camp", cfg));
        }

        [Fact]
        public void The_link_checker_only_reaches_public_addresses()
        {
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("127.0.0.1")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("10.2.3.4")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("172.20.0.1")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("192.168.1.1")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("169.254.169.254")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("::1")));
            Assert.False(LinkChecker.IsPublic(IPAddress.Parse("fd00::1")));
            Assert.True(LinkChecker.IsPublic(IPAddress.Parse("8.8.8.8")));
            var (links, paths) = LinkChecker.Find(new JsonObject { ["text"] = "See https://www.nhs.uk/x. and more", ["image"] = new JsonObject { ["src"] = "/media/library/a.webp" }, ["linkHref"] = "/contact" });
            Assert.True(links.Contains("https://www.nhs.uk/x"));
            Assert.True(paths.Contains("/media/library/a.webp") && paths.Contains("/contact"));
        }
    }
}
