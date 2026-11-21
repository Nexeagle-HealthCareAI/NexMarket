using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class WebsiteGrowthTests
    {
        [Fact]
        public void Page_addresses_become_plain_paths()
        {
            Assert.Equal("/blogs/kidney-stones", SiteInsights.PathOf("https://glisanhospitalpurnia.in/blogs/Kidney-Stones/?utm=x#top"));
            Assert.Equal("/", SiteInsights.PathOf("https://glisanhospitalpurnia.in/"));
            Assert.Equal("/faqs", SiteInsights.PathOf("/faqs/"));
        }

        [Fact]
        public void The_fix_list_finds_losing_almost_and_competing_pages()
        {
            var pages = new[]
            {
                new PageStat("/blogs/a", 20, 900, 4, 60, 1000, 3),      // lost two thirds of its visits
                new PageStat("/blogs/b", 5, 400, 12.4, 4, 300, 13),    // place 12, 400 searches
                new PageStat("/blogs/c", 30, 500, 3, 32, 500, 3),      // steady
            };
            var queries = new[]
            {
                new QueryStat("kidney stone pain", "/blogs/a", 5, 60, 5), new QueryStat("kidney stone pain", "/blogs/b", 1, 40, 14),
                new QueryStat("urologist purnia", "/blogs/b", 3, 200, 11),
            };
            var fixes = SiteFixes.Find(pages, queries);
            Assert.True(fixes.Any(f => f.Kind == "losing" && f.Path == "/blogs/a"));
            Assert.True(fixes.Any(f => f.Kind == "almost" && f.Path == "/blogs/b" && f.Query == "urologist purnia"));
            Assert.True(fixes.Any(f => f.Kind == "competing" && f.Query == "kidney stone pain" && f.Paths!.Count == 2));
            Assert.False(fixes.Any(f => f.Path == "/blogs/c"));
        }

        [Fact]
        public void Questions_are_recognised_in_english_and_hinglish()
        {
            Assert.True(SiteFixes.IsQuestion("how to remove kidney stone"));
            Assert.True(SiteFixes.IsQuestion("pathri kaise nikale?"));
            Assert.True(SiteFixes.IsQuestion("kya pathri dawa se nikal sakti hai"));
            Assert.False(SiteFixes.IsQuestion("urologist in purnia"));
        }

        [Fact]
        public void Reading_checks_flag_hard_long_and_repeated_text()
        {
            var hard = string.Join(" ", Enumerable.Repeat("Nephrolithiasis necessitates comprehensive multidisciplinary evaluation incorporating radiological characterisation, metabolic investigation, and individualised therapeutic optimisation considering comorbidities and anatomical considerations.", 3));
            Assert.True(SiteWriting.ReadingEase(hard) < 30);
            Assert.True(SiteWriting.ReadingEase("Drink water. Walk a little. See a doctor if it hurts. Stones can pass. Most get better. We can help you. Call us. Come early. Bring your reports. Ask us anything you want to know today.") > 60);
            var d = new JsonObject
            {
                ["title"] = "Kidney stones",
                ["sections"] = new JsonArray(
                    new JsonObject { ["heading"] = "Kidney stones", ["paragraphs"] = new JsonArray(hard) },
                    new JsonObject { ["heading"] = "Signs", ["paragraphs"] = new JsonArray("Pain.") },
                    new JsonObject { ["heading"] = "signs", ["paragraphs"] = new JsonArray("Blood.") }),
            };
            var w = SiteWriting.Check(d);
            Assert.True(w.Any(x => x.StartsWith("Two sections have the same heading")));
            Assert.True(w.Any(x => x.StartsWith("A section heading repeats the title")));
            Assert.True(w.Any(x => x.Contains("reads as hard")));
            d["language"] = "hi";
            Assert.False(SiteWriting.Check(d).Any(x => x.Contains("reads as hard")));
        }

        [Fact]
        public void Related_pages_share_their_words()
        {
            var r = SiteRelated.Suggest("kidney stones cause pain in the side; laser treatment removes stones from the kidney and ureter",
                new[] { ("Laser for stones", "/blogs/laser", "laser treatment for kidney stones and ureter stones, pain relief"), ("Ear care", "/blogs/ear", "ear wax cleaning and hearing loss in children"), ("Self", "/blogs/self", "kidney stones") },
                "/blogs/self");
            Assert.Equal("/blogs/laser", r.First().Path);
            Assert.False(r.Any(x => x.Path == "/blogs/ear" || x.Path == "/blogs/self"));
        }

        private static string Words(string town, string seed, int n) => town + " " + string.Join(" ", Enumerable.Range(0, n).Select(i => seed + i));

        [Fact]
        public void A_location_page_must_be_its_own()
        {
            var a = new SiteContent { Id = Guid.NewGuid(), Type = "location", Key = "kasba", Title = "Kasba" };
            var other = new SiteContent { Id = Guid.NewGuid(), Type = "location", Key = "banmankhi", Title = "Banmankhi",
                Data = new JsonObject { ["town"] = "Banmankhi", ["intro"] = Words("Banmankhi", "w", 130), ["howToReach"] = "" }.ToJsonString() };
            var thin = new JsonObject { ["town"] = "Kasba", ["intro"] = "Patients come here.", ["howToReach"] = "By road." };
            var p = SiteRules.ExtraProblems(a, thin, new[] { a, other });
            Assert.True(p.Any(x => x.Contains("words of its own")));
            Assert.True(p.Any(x => x.StartsWith("Name Kasba")));
            var copy = new JsonObject { ["town"] = "Kasba", ["intro"] = Words("Kasba", "w", 130), ["howToReach"] = "" };
            Assert.True(SiteRules.ExtraProblems(a, copy, new[] { a, other }).Any(x => x.Contains("the same as \"Banmankhi\"")));
            var own = new JsonObject { ["town"] = "Kasba", ["intro"] = Words("Kasba", "k", 130), ["howToReach"] = "" };
            Assert.Equal(0, SiteRules.ExtraProblems(a, own, new[] { a, other }).Count);
            Assert.Equal(0, SiteRules.Similarity("one two three four", "five six seven eight"));
        }

        [Fact]
        public void A_branch_keeps_its_own_changes_when_taking_a_head_office_update()
        {
            var b = new JsonObject { ["title"] = "Camp", ["place"] = "Head office hall", ["description"] = "Old text", ["free"] = true };
            var mine = new JsonObject { ["title"] = "Camp", ["place"] = "Kasba hall", ["description"] = "Old text", ["free"] = true };
            var theirs = new JsonObject { ["title"] = "Camp 2027", ["place"] = "New HQ hall", ["description"] = "New text", ["free"] = true, ["doctors"] = new JsonArray("Dr A") };
            var (r, kept) = SiteChain.Merge(b, mine, theirs);
            Assert.Equal("Camp 2027", r["title"]!.ToString());
            Assert.Equal("Kasba hall", r["place"]!.ToString());
            Assert.Equal("New text", r["description"]!.ToString());
            Assert.Equal(1, ((JsonArray)r["doctors"]!).Count);
            Assert.True(kept.SequenceEqual(new[] { "place" }));
        }

        [Fact]
        public void Webhooks_are_signed_and_keys_are_only_stored_hashed()
        {
            Assert.Equal("sha256=" + "b42d2e64a1b2ec9f3b1aab7b8aea8f6dc3b3d6b54b6f7d9c2bd02d4efda0d5d0".Length.ToString(), "sha256=" + SiteHooks.Sign("s", "{}")[7..].Length.ToString());
            Assert.Equal(SiteHooks.Sign("secret", "{\"a\":1}"), SiteHooks.Sign("secret", "{\"a\":1}"));
            Assert.NotEqual(SiteHooks.Sign("secret", "{\"a\":1}"), SiteHooks.Sign("other", "{\"a\":1}"));
            var k = SiteKeys.NewKey();
            Assert.True(k.StartsWith("nxs_") && k.Length > 40);
            Assert.Equal(64, SiteKeys.Hash(k).Length);
            Assert.NotEqual(SiteKeys.Hash(k), SiteKeys.Hash(SiteKeys.NewKey()));
            Assert.True(SiteHooks.NewSecret().StartsWith("whsec_"));
        }

        [Fact]
        public void Medical_pages_are_due_for_review_after_the_set_months_and_show_the_date()
        {
            var cfg = new SiteConfig { ReReviewMonths = 12 };
            var today = new DateOnly(2026, 11, 21);
            var c = new SiteContent { Type = "article", Status = "published", Published = "{}", ReviewedOn = new DateOnly(2025, 11, 20), ReviewedByName = "Dr Noori", Key = "a",
                Data = new JsonObject { ["slug"] = "a", ["title"] = "T", ["excerpt"] = "E", ["departmentId"] = "urology", ["author"] = "X", ["language"] = "hi", ["translationOf"] = "b", ["sections"] = new JsonArray() }.ToJsonString() };
            Assert.True(SiteRules.DueForReview(c, cfg, today));
            c.ReviewedOn = new DateOnly(2026, 6, 1);
            Assert.False(SiteRules.DueForReview(c, cfg, today));
            Assert.False(SiteRules.DueForReview(new SiteContent { Type = "faq", Status = "published", Published = "{}" }, cfg, today));
            Assert.Null(SiteRules.CantSubmit(new SiteContent { Status = "published" }, new List<string>(), dueForReview: true));
            var live = SiteRules.LiveCopy(c, today, null);
            Assert.Equal("2026-06-01", live["reviewedOn"]!.ToString());
            Assert.Equal("hi", live["language"]!.ToString());
            Assert.Equal("b", live["translationOf"]!.ToString());
        }
    }
}
