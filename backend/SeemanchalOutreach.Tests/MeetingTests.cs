using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class MeetingTests
    {
        private static readonly DateTime Now = new(2026, 11, 13, 6, 0, 0, DateTimeKind.Utc);
        private static Meeting At(int minutesFromNow, string status = "scheduled", int length = 30) =>
            new() { Title = "Weekly review", StartsAt = Now.AddMinutes(minutesFromNow), Minutes = length, Status = status };

        [Fact]
        public void A_meeting_needs_a_name_a_sensible_length_and_a_time_to_come()
        {
            Assert.Null(MeetingRules.Problem("Weekly review", Now.AddHours(2), 30, Now));
            Assert.NotNull(MeetingRules.Problem("Hi", Now.AddHours(2), 30, Now));
            Assert.NotNull(MeetingRules.Problem(new string('a', 121), Now.AddHours(2), 30, Now));
            Assert.NotNull(MeetingRules.Problem("Weekly review", Now.AddHours(2), 5, Now));
            Assert.NotNull(MeetingRules.Problem("Weekly review", Now.AddHours(2), 300, Now));
            Assert.NotNull(MeetingRules.Problem("Weekly review", Now.AddMinutes(-30), 30, Now));
            Assert.NotNull(MeetingRules.Problem("Weekly review", Now.AddDays(200), 30, Now));
            Assert.Null(MeetingRules.Problem("Starting now", Now.AddMinutes(-2), 30, Now));
        }

        [Fact]
        public void The_room_opens_fifteen_minutes_early_and_stays_open_while_live()
        {
            Assert.False(MeetingRules.CanJoin(At(40), Now));
            Assert.True(MeetingRules.CanJoin(At(15), Now));
            Assert.True(MeetingRules.CanJoin(At(-20), Now));
            Assert.False(MeetingRules.CanJoin(At(-200), Now));
            Assert.True(MeetingRules.CanJoin(At(-200, "live"), Now));
            Assert.False(MeetingRules.CanJoin(At(5, "cancelled"), Now));
            Assert.False(MeetingRules.CanJoin(At(-5, "done"), Now));
        }

        [Fact]
        public void People_are_reminded_once_ten_minutes_before()
        {
            Assert.False(MeetingRules.NeedsReminder(At(30), Now));
            Assert.True(MeetingRules.NeedsReminder(At(10), Now));
            Assert.True(MeetingRules.NeedsReminder(At(-5), Now));
            var reminded = At(5); reminded.RemindedAt = Now;
            Assert.False(MeetingRules.NeedsReminder(reminded, Now));
            Assert.False(MeetingRules.NeedsReminder(At(5, "live"), Now));
            Assert.False(MeetingRules.NeedsReminder(At(-45), Now));
        }

        [Fact]
        public void A_meeting_nobody_joined_is_missed_an_hour_after_its_planned_end()
        {
            Assert.False(MeetingRules.IsMissed(At(-60), Now));
            Assert.True(MeetingRules.IsMissed(At(-91), Now));
            Assert.False(MeetingRules.IsMissed(At(-300, "live"), Now));
        }

        [Fact]
        public void Ending_a_meeting_asks_for_notes_only_when_something_was_heard()
        {
            var heard = At(-30, "live"); heard.AiNotes = true; heard.NotesStatus = "listening"; heard.Transcript = "[00:00] hello";
            MeetingRules.Close(heard, Now);
            Assert.Equal("done", heard.Status);
            Assert.Equal("writing", heard.NotesStatus);
            Assert.False(heard.AiNotes);
            Assert.Equal(Now, heard.EndedAt);

            var silent = At(-30, "live"); silent.AiNotes = true; silent.NotesStatus = "listening";
            MeetingRules.Close(silent, Now);
            Assert.Equal("none", silent.NotesStatus);

            var plain = At(-30, "live");
            MeetingRules.Close(plain, Now);
            Assert.Equal("none", plain.NotesStatus);
        }

        [Fact]
        public void The_transcript_grows_line_by_line_with_the_time_and_never_past_its_limit()
        {
            var t = MeetingRules.Append(null, 0, "  Good morning everyone ");
            Assert.Equal("[00:00] Good morning everyone", t);
            t = MeetingRules.Append(t, 125, "Camp is on Saturday");
            Assert.EndsWith("\n[02:05] Camp is on Saturday", t);
            Assert.Equal(t, MeetingRules.Append(t, 180, "   "));
            Assert.StartsWith("[75:10]", MeetingRules.Append("", 4510, "late"));
            Assert.Equal(MeetingRules.MaxTranscript, MeetingRules.Append(new string('x', MeetingRules.MaxTranscript), 1, "more").Length);
        }

        [Fact]
        public void An_action_goes_to_its_owner_only_when_one_person_matches()
        {
            var people = new List<(string, string)> { ("MKT-1", "Imran Alam"), ("MKT-2", "Shabnam Begum"), ("ADM-1", "Imran Khan") };
            Assert.Equal("MKT-2", MeetingRules.Owner("Shabnam", people));
            Assert.Equal("MKT-2", MeetingRules.Owner("shabnam begum", people));
            Assert.Null(MeetingRules.Owner("Imran", people));
            Assert.Equal("ADM-1", MeetingRules.Owner("Imran Khan", people));
            Assert.Null(MeetingRules.Owner("Rahul", people));
            Assert.Null(MeetingRules.Owner("", people));
            Assert.Null(MeetingRules.Owner(null, people));
        }

        [Fact]
        public void The_time_is_written_in_India_time()
        {
            Assert.Equal("Fri 13 Nov, 4:30 pm", MeetingRules.When(new DateTime(2026, 11, 13, 11, 0, 0, DateTimeKind.Utc)));
            Assert.Equal("Sat 14 Nov, 12:05 am", MeetingRules.When(new DateTime(2026, 11, 13, 18, 35, 0, DateTimeKind.Utc)));
        }

        [Fact]
        public void The_minutes_become_a_document_and_a_chat_summary()
        {
            var m = At(-40, "done"); m.Agenda = "Eye camp"; m.StartedAt = Now.AddMinutes(-40); m.EndedAt = Now.AddMinutes(-5);
            var min = new ChatAiService.Minutes("We planned the eye camp.", new List<string> { "Posters are late" }, new List<string> { "Camp stays on Saturday" },
                new List<ChatAiService.ActionItem> { new("Print 200 posters", "Imran", "Thursday"), new("Call the school", null, null) });
            var (json, plain) = MeetingRules.Document(m, min, new List<string> { "Imran Alam", "Shabnam Begum" });
            Assert.Contains("\"type\":\"doc\"", json);
            Assert.Contains("bulletList", json);
            Assert.Contains("35 min", plain);
            Assert.Contains("Imran Alam, Shabnam Begum", plain);
            Assert.Contains("- Print 200 posters (Imran), by Thursday", plain);
            Assert.Contains("- Call the school", plain);
            Assert.Contains("Written by AI", plain);

            var chat = MeetingRules.ChatSummary(m, min);
            Assert.StartsWith("📝 Notes from “Weekly review”", chat);
            Assert.Contains("• Camp stays on Saturday", chat);
            Assert.Contains("• Print 200 posters (Imran), by Thursday", chat);
            Assert.Contains("please check", chat);

            var empty = new ChatAiService.Minutes("", new List<string>(), new List<string>(), new List<ChatAiService.ActionItem>());
            Assert.DoesNotContain("bulletList", MeetingRules.Document(m, empty, new List<string>()).Json);
        }

        [Fact]
        public void A_long_transcript_is_cut_into_pieces_without_losing_words()
        {
            var lines = string.Join("\n", Enumerable.Range(0, 400).Select(i => $"[{i:00}:00] line number {i} of the meeting"));
            var pieces = ChatAiService.Pieces(lines, 2000);
            Assert.True(pieces.Count > 1);
            Assert.All(pieces, p => Assert.True(p.Length <= 2000));
            Assert.Equal(lines.Replace("\n", " "), string.Join(" ", pieces).Replace("\n", " "));
            Assert.Single(ChatAiService.Pieces("short", 2000));
            Assert.Empty(ChatAiService.Pieces("   ", 2000));
            Assert.All(ChatAiService.Pieces(new string('x', 5000), 2000), p => Assert.True(p.Length <= 2000));
        }

        [Fact]
        public void A_meeting_is_a_room_people_walk_into_like_a_huddle()
        {
            Assert.True(CallKinds.IsRoom("meeting"));
            Assert.True(CallKinds.IsRoom("huddle"));
            Assert.False(CallKinds.IsRoom("call"));
        }
    }
}
