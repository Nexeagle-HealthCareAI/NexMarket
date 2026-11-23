using SeemanchalOutreach.Api.Services;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>The Team board as an issue tracker: how issues nest, time written as "2h 30m", and the burndown.</summary>
    public class WorkIssuesTests
    {
        [Theory]
        [InlineData("story", "epic")]
        [InlineData("feature", "epic")]
        [InlineData("story", "feature")]
        [InlineData("bug", "feature")]
        [InlineData("subtask", "story")]
        [InlineData("subtask", "bug")]
        [InlineData("task", null)]
        [InlineData("epic", null)]
        public void Issues_nest_epic_feature_story_subtask(string child, string? parent) => Assert.Null(WorkIssues.ParentProblem(child, parent));

        [Theory]
        [InlineData("epic", "epic")]
        [InlineData("epic", "story")]
        [InlineData("feature", "story")]
        [InlineData("story", "story")]
        [InlineData("subtask", "epic")]
        [InlineData("subtask", "feature")]
        [InlineData("subtask", "subtask")]
        [InlineData("subtask", null)]
        [InlineData("task", "subtask")]
        public void Issues_cannot_nest_the_wrong_way(string child, string? parent) => Assert.NotNull(WorkIssues.ParentProblem(child, parent));

        [Fact]
        public void A_type_change_must_still_fit_parent_and_children()
        {
            Assert.Null(WorkIssues.TypeProblem("bug", "epic", new[] { "subtask" }));
            Assert.NotNull(WorkIssues.TypeProblem("subtask", "epic", Array.Empty<string>()));
            Assert.NotNull(WorkIssues.TypeProblem("story", null, new[] { "story" }));      // a story can't hold stories
            Assert.NotNull(WorkIssues.TypeProblem("task", null, new[] { "feature" }));
            Assert.NotNull(WorkIssues.TypeProblem("chore", null, Array.Empty<string>()));
        }

        [Theory]
        [InlineData("2h 30m", 150)]
        [InlineData("1d", 480)]
        [InlineData("1w", 2400)]
        [InlineData("45m", 45)]
        [InlineData("1.5h", 90)]
        [InlineData("90", 90)]
        [InlineData("1d 4h", 720)]
        public void Time_is_read_like_jira(string text, int minutes) => Assert.Equal(minutes, WorkIssues.Minutes(text));

        [Theory]
        [InlineData("")]
        [InlineData("soon")]
        [InlineData("2 hours")]
        [InlineData("-5")]
        [InlineData("0")]
        [InlineData("2h banana")]
        public void Nonsense_time_is_refused(string text) => Assert.Null(WorkIssues.Minutes(text));

        [Fact]
        public void Time_is_shown_in_days_hours_and_minutes()
        {
            Assert.Equal("1d 2h 30m", WorkIssues.Duration(480 + 150));
            Assert.Equal("45m", WorkIssues.Duration(45));
            Assert.Equal("0m", WorkIssues.Duration(0));
        }

        [Fact]
        public void The_burndown_counts_points_left_each_day_against_the_ideal_line()
        {
            var start = new DateOnly(2026, 11, 2);
            var issues = new[]
            {
                new WorkIssues.BurnIssue(5, new DateOnly(2026, 11, 3)),
                new WorkIssues.BurnIssue(3, new DateOnly(2026, 11, 5)),
                new WorkIssues.BurnIssue(2, null),
            };
            var b = WorkIssues.Burndown(start, start.AddDays(4), new DateOnly(2026, 11, 4), issues);
            Assert.Equal(5, b.Count);
            Assert.Equal(10, b[0].Remaining);
            Assert.Equal(5, b[1].Remaining);
            Assert.Equal(5, b[2].Remaining);
            Assert.Null(b[3].Remaining);          // a day still to come
            Assert.Equal(10, b[0].Ideal);
            Assert.Equal(0, b[4].Ideal);
            Assert.Equal(5, b[2].Ideal);
        }
    }
}
