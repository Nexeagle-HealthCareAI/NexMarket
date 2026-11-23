namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The rules of the Team board as an issue tracker (like Jira): issue types and how they nest, link kinds, time
    /// written as "2h 30m", and the sprint burndown.
    ///
    ///   Epic  ›  Feature  ›  Story / Task / Bug  ›  Sub-task
    ///
    /// An issue can sit under any type above it (a story straight under an epic is fine); a sub-task always sits under a
    /// story, task or bug.
    /// </summary>
    public static class WorkIssues
    {
        public static readonly string[] Types = { "epic", "feature", "story", "task", "bug", "subtask" };
        public static readonly string[] Severities = { "blocker", "critical", "major", "minor", "trivial" };
        public static readonly string[] Resolutions = { "done", "wont_do", "duplicate", "cannot_reproduce" };
        /// <summary>Link kinds, as seen from the issue the link starts at, and from the other end.</summary>
        public static readonly Dictionary<string, (string Out, string In)> LinkKinds = new()
        {
            ["blocks"] = ("blocks", "is blocked by"),
            ["relates"] = ("relates to", "relates to"),
            ["duplicates"] = ("duplicates", "is duplicated by"),
            ["clones"] = ("clones", "is cloned by"),
        };

        public static int Level(string type) => type switch { "epic" => 0, "feature" => 1, "subtask" => 3, _ => 2 };

        /// <summary>Why <paramref name="child"/> can't go under <paramref name="parent"/> (null = it can; parent null = the top).</summary>
        public static string? ParentProblem(string child, string? parent)
        {
            if (parent == null) return child == "subtask" ? "A sub-task belongs under a story, task or bug. Choose one, or make it a task." : null;
            if (child == "epic") return "An epic is the top level: it can't go under another issue.";
            if (child == "subtask" && Level(parent) != 2) return "A sub-task belongs under a story, task or bug.";
            if (Level(parent) >= Level(child)) return $"A {Label(child)} can't go under a {Label(parent)}. Epic › feature › story, task or bug › sub-task.";
            return null;
        }

        /// <summary>Changing an issue's type must still fit its parent and its children.</summary>
        public static string? TypeProblem(string type, string? parentType, IEnumerable<string> childTypes)
        {
            if (!Types.Contains(type)) return "Choose a type: epic, feature, story, task, bug or sub-task.";
            if (ParentProblem(type, parentType) is string p) return p;
            foreach (var c in childTypes.Distinct())
                if (ParentProblem(c, type) is string q) return $"It has {Label(c)} issues under it, which can't sit under a {Label(type)}. Move them first.";
            return null;
        }

        public static string Label(string type) => type switch { "subtask" => "sub-task", _ => type };

        /// <summary>"2h 30m", "1d", "45m", "1.5h", "90" (minutes). A working day is 8 hours. Null if it can't be read.</summary>
        public static int? Minutes(string? text)
        {
            var t = (text ?? "").Trim().ToLowerInvariant().Replace(" ", "");
            if (t.Length == 0) return null;
            if (int.TryParse(t, out var plain)) return plain is > 0 and <= 100_000 ? plain : null;
            var total = 0.0;
            var m = System.Text.RegularExpressions.Regex.Matches(t, @"(\d+(?:\.\d+)?)([wdhm])");
            if (m.Count == 0 || string.Concat(m.Select(x => x.Value)) != t) return null;
            foreach (System.Text.RegularExpressions.Match x in m)
            {
                var n = double.Parse(x.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
                total += x.Groups[2].Value switch { "w" => n * 5 * 8 * 60, "d" => n * 8 * 60, "h" => n * 60, _ => n };
            }
            var r = (int)Math.Round(total);
            return r is > 0 and <= 100_000 ? r : null;
        }

        /// <summary>Minutes as "1d 2h 30m" (8-hour days).</summary>
        public static string Duration(int minutes)
        {
            if (minutes <= 0) return "0m";
            var d = minutes / 480; var h = minutes % 480 / 60; var m = minutes % 60;
            return string.Join(' ', new[] { d > 0 ? $"{d}d" : null, h > 0 ? $"{h}h" : null, m > 0 ? $"{m}m" : null }.Where(x => x != null));
        }

        public record BurnIssue(int Points, DateOnly? DoneOn);
        public record BurnDay(DateOnly Day, int? Remaining, double Ideal);

        /// <summary>
        /// Points still to do at the end of each day of the sprint (Remaining is null for days still to come), and the
        /// ideal straight line from everything committed down to zero on the last day.
        /// </summary>
        public static List<BurnDay> Burndown(DateOnly start, DateOnly end, DateOnly today, IReadOnlyList<BurnIssue> issues)
        {
            var list = new List<BurnDay>();
            if (end < start) return list;
            var total = issues.Sum(i => i.Points);
            var days = end.DayNumber - start.DayNumber;
            for (var d = start; d <= end && list.Count < 120; d = d.AddDays(1))
            {
                int? left = d > today ? null : total - issues.Where(i => i.DoneOn != null && i.DoneOn <= d).Sum(i => i.Points);
                var ideal = days == 0 ? 0 : Math.Round(total * (1 - (d.DayNumber - start.DayNumber) / (double)days), 1);
                list.Add(new BurnDay(d, left, ideal));
            }
            return list;
        }
    }
}
