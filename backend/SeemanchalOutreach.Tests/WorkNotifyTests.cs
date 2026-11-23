using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Team board notifications: who a comment @mentions, and the morning due-today reminder.</summary>
    public class WorkNotifyTests
    {
        private static readonly (string Id, string Name)[] People =
        {
            ("MM-1", "Imran Ahmad"), ("DS-1", "Pooja Kumari"), ("FA-1", "Rahul Kumar"), ("FA-2", "Rahul Singh"), ("ADM-1001", "Marketing Head"),
        };

        [Fact]
        public void Mentions_by_first_name_full_name_or_id()
        {
            Assert.Equal("MM-1", string.Join(",", WorkIssues.MentionedIn("@imran can you check this?", People)));
            Assert.Equal("DS-1", string.Join(",", WorkIssues.MentionedIn("Thanks @PoojaKumari.", People)));
            Assert.Equal("FA-2", string.Join(",", WorkIssues.MentionedIn("ask @rahul.singh", People)));
            Assert.Equal("ADM-1001", string.Join(",", WorkIssues.MentionedIn("cc @adm-1001", People)));
            Assert.Equal("MM-1,DS-1", string.Join(",", WorkIssues.MentionedIn("@Imran and @pooja, and @imran again", People)));
        }

        [Fact]
        public void A_shared_first_name_or_an_email_mentions_nobody()
        {
            Assert.Empty(WorkIssues.MentionedIn("@rahul please", People));
            Assert.Empty(WorkIssues.MentionedIn("mail imran@hospital.in", People));
            Assert.Empty(WorkIssues.MentionedIn("no mentions here", People));
            Assert.Empty(WorkIssues.MentionedIn(null, People));
            Assert.Empty(WorkIssues.MentionedIn("@nobody", People));
        }

        [Fact]
        public void Clip_tidies_and_shortens()
        {
            Assert.Equal("one two", WorkIssues.Clip("  one \n\n two  "));
            var long1 = WorkIssues.Clip(new string('a', 300), 20);
            Assert.Equal(21, long1.Length);
            Assert.EndsWith("…", long1);
        }

        [Fact]
        public void Morning_reminder_groups_by_person_late_first()
        {
            var today = new DateOnly(2026, 11, 23);
            var cards = new[]
            {
                new WorkReminders.DueCard(60, "Call Dr Ansari", today, "high", new() { "ADM-1001" }),
                new WorkReminders.DueCard(61, "Fix the sign-up form", today.AddDays(-1), "urgent", new() { "ADM-1001", "MM-1" }),
                new WorkReminders.DueCard(62, "Write the camp post", today.AddDays(3), "normal", new() { "ADM-1001" }),   // not yet due
                new WorkReminders.DueCard(63, "Print leaflets", today.AddDays(-4), "normal", new() { "MM-1" }),
            };
            var d = WorkReminders.Digests(cards, today);
            Assert.Equal("ADM-1001,MM-1", string.Join(",", d.Select(x => x.AgentId)));
            var mine = d[0];
            Assert.Equal(1, mine.DueToday);
            Assert.Equal(1, mine.Late);
            Assert.Equal("#61 Fix the sign-up form", mine.Top[0]);
            Assert.Equal("1 due today and 1 late on the Team board", mine.Title);
            Assert.Equal("2 late on the Team board", d[1].Title);
            Assert.Equal("#61 Fix the sign-up form · #63 Print leaflets", d[1].Body);
        }

        [Fact]
        public void Morning_reminder_says_how_many_more()
        {
            var today = new DateOnly(2026, 11, 23);
            var cards = Enumerable.Range(1, 5).Select(i => new WorkReminders.DueCard(i, $"Job {i}", today, "normal", new() { "DS-1" }));
            var all = WorkReminders.Digests(cards, today);
            Assert.Equal(1, all.Count);
            var d = all[0];
            Assert.Equal("5 due today on the Team board", d.Title);
            Assert.EndsWith("and 2 more", d.Body);
        }
    }
}
