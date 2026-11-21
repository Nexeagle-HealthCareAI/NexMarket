using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
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
    }
}
