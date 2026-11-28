using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Keywords: tagging search phrases, grouping them into topics, scoring, and crediting leads to topics.</summary>
    public class KeywordTests
    {
        private static readonly Dictionary<string, string> Places = new() { ["purnia"] = "Purnia", ["kasba"] = "Purnia", ["katihar"] = "Katihar", ["कटिहार"] = "Katihar" };

        [Fact]
        public void Language_is_told_by_script_and_words()
        {
            Assert.Equal("hi", KeywordService.LangOf(KeywordService.Normalize("पथरी का इलाज")));
            Assert.Equal("bn", KeywordService.LangOf("কিডনি পাথর"));
            Assert.Equal("hinglish", KeywordService.LangOf("pathri ka ilaj"));
            Assert.Equal("en", KeywordService.LangOf("hospital near me"));
            Assert.Equal("en", KeywordService.LangOf("kidney stone treatment purnia"));
        }

        [Fact]
        public void Intent_follows_the_words()
        {
            Assert.Equal("visit", KeywordService.IntentOf("kidney stone treatment purnia", null, Places));
            Assert.Equal("visit", KeywordService.IntentOf("dialysis centre katihar", null, Places));
            Assert.Equal("compare", KeywordService.IntentOf("knee replacement cost bihar"));
            Assert.Equal("compare", KeywordService.IntentOf("pathri ka operation kharcha"));
            Assert.Equal("learn", KeywordService.IntentOf("dengue ke lakshan"));
            Assert.Equal("brand", KeywordService.IntentOf("glisan hospital purnia", new[] { "glisan" }));
        }

        [Fact]
        public void Words_match_whole_words_but_Hindi_anywhere()
        {
            Assert.True(KeywordService.Contains("kidney stone treatment", "kidney stone"));
            Assert.False(KeywordService.Contains("heartburn remedy", "heart"));
            Assert.True(KeywordService.Contains("पथरी का इलाज", "पथरी"));
            Assert.Equal("Katihar", KeywordService.DistrictOf("dialysis centre katihar", Places));
            Assert.Equal("Purnia", KeywordService.DistrictOf("hospital in kasba", Places));
            Assert.Null(KeywordService.DistrictOf("hospital near me", Places));
        }

        [Fact]
        public void A_phrase_joins_the_topic_with_its_longest_word()
        {
            Guid a = Guid.NewGuid(), b = Guid.NewGuid();
            var topics = new[] { (a, new[] { "stone" }), (b, new[] { "kidney stone", "पथरी" }) };
            Assert.Equal(b, KeywordService.TopicFor("kidney stone pain", topics));
            Assert.Equal(b, KeywordService.TopicFor("पथरी का इलाज", topics));
            Assert.Null(KeywordService.TopicFor("knee pain", topics));
            Assert.Equal(new[] { "kidney stone", "pathri", "पथरी" }, KeywordService.TermsOf("Kidney Stone\npathri, पथरी\n\nx"));
        }

        [Fact]
        public void Score_rises_with_demand_value_and_gap()
        {
            Assert.Equal(0, KeywordService.Score(0, 1000, 50, 90));
            var big = KeywordService.Score(1000, 1000, 50, 90);
            Assert.True(big > KeywordService.Score(100, 1000, 50, 90));
            Assert.True(big > KeywordService.Score(1000, 1000, 10, 90));
            Assert.True(big > KeywordService.Score(1000, 1000, 50, 25));
            Assert.InRange(KeywordService.Score(5000, 1000, 100, 100), 0, 100);
            Assert.Equal(95, KeywordService.GapFromPosition(null));
            Assert.Equal(25, KeywordService.GapFromPosition(2.5));
            Assert.Equal(80, KeywordService.GapFromPosition(14));
        }

        [Fact]
        public void Chat_phrases_count_people_and_drop_numbers()
        {
            var p = KeywordService.Phrases(new[] { ("1", "pathri ka operation 98765"), ("2", "Pathri ka operation?"), ("2", "pathri ka operation"), ("3", "sir pathri ka operation kitne") });
            Assert.Equal(3, p["pathri ka operation"]);
            Assert.DoesNotContain(p.Keys, k => k.Any(char.IsDigit));
            Assert.DoesNotContain("pathri ka", p.Keys);
        }

        [Fact]
        public void Peak_months_are_well_above_average()
        {
            var pts = Enumerable.Range(1, 12).Select(m => (m, (long)(m is 8 or 9 ? 300 : 100)));
            Assert.Equal(new[] { 8, 9 }, KeywordService.PeakMonths(pts));
            Assert.Empty(KeywordService.PeakMonths(new[] { (1, 10L) }));
        }

        [Fact]
        public void Leads_are_credited_by_words_links_and_pages()
        {
            var leads = new (string, string?, string?, string)[]
            {
                ("pathri ka operation", null, null, "arrived"),
                ("pet dard", "GGL-STONE", null, "admitted"),
                ("hello", null, "https://site.in/blog/pathri-ka-ilaj?utm=x", "new"),
                ("knee pain", null, null, "arrived"),
            };
            var o = KeywordsController.OutcomeOf(new[] { "pathri" }, new (string?, string?)[] { ("ggl-stone", null), (null, "https://site.in/blog/pathri-ka-ilaj") }, leads);
            Assert.Equal(new KeywordsController.Outcome(3, 2, 1), o);
        }

        [Fact]
        public void Actions_are_checked()
        {
            var a = new KwAction();
            Assert.NotNull(KeywordsController.Apply(a, new KwActionDto { Kind = "tv", Title = "Camp" }, true));
            Assert.NotNull(KeywordsController.Apply(a, new KwActionDto { Kind = "camp", Title = "x" }, true));
            Assert.NotNull(KeywordsController.Apply(a, new KwActionDto { Kind = "ad", Title = "Ad group", LinkCode = "a b" }, true));
            Assert.NotNull(KeywordsController.Apply(a, new KwActionDto { Kind = "page", Title = "Page", Url = "javascript:alert(1)" }, true));
            Assert.Null(KeywordsController.Apply(a, new KwActionDto { Kind = "ad", Title = "Ad group", LinkCode = "ggl-stone", Stage = "live", Spend = 6200 }, true));
            Assert.Equal("GGL-STONE", a.LinkCode);
            Assert.NotNull(a.LiveAt);
        }

        [Fact]
        public void Keyword_Planner_figures_are_read()
        {
            var json = "{\"avgMonthlySearches\":\"880\",\"competition\":\"MEDIUM\",\"competitionIndex\":\"53\",\"lowTopOfPageBidMicros\":\"18000000\",\"highTopOfPageBidMicros\":\"42000000\","
                + "\"monthlySearchVolumes\":[{\"month\":\"APRIL\",\"year\":\"2026\",\"monthlySearches\":\"1300\"},{\"month\":\"MAY\",\"year\":\"2026\",\"monthlySearches\":\"1600\"}]}";
            var k = new KwKeyword();
            KeywordService.ApplyMetrics(k, System.Text.Json.JsonDocument.Parse(json).RootElement);
            Assert.Equal(880, k.Volume);
            Assert.Equal(53, k.Competition);
            Assert.Equal(18000000L, k.BidLowMicros);
            Assert.Equal(new[] { ("2026-04", 1300L), ("2026-05", 1600L) }, KeywordService.MonthsOf(k.VolumeJson).ToArray());
        }

        [Fact]
        public void Brief_uses_the_topic_words()
        {
            var t = new KwTopic { Name = "Kidney stone treatment", Department = "Urology", Intent = "visit", Demand = 2900, BestPosition = 14 };
            var b = KeywordsController.MakeBrief(t, new() { ("पथरी का इलाज", "hi", "visit", 880, null, 0), ("pathri ka operation kharcha", "hinglish", "compare", 390, null, 4) });
            Assert.Contains("पथरी का इलाज", b);
            Assert.Contains("Write in: Hindi", b);
            Assert.Contains("cost range", b);
            Assert.Contains("(4 messages)", b);
        }
    }
}
