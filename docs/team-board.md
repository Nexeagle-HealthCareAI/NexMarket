# Team board as an issue tracker (Jira-style)

The Team board keeps its quick add, columns, My day and List, and now works like Jira.

## Issue types

**Epic › Feature › Story / Task / Bug › Sub-task.** An issue can sit under any type above it (a story straight under an epic is fine); a sub-task always sits under a story, task or bug. Each type has its own coloured icon on cards, in lists and in the issue view. Cards made before this change are tasks, and cards that were sub-tasks are sub-tasks.

## Creating an issue

**Create** (next to quick add) opens the full form: type, summary, description, what it belongs to, assignee, priority, start and due date, sprint, story points; under **More fields** the reporter, column, original estimate and labels.

- **Stories, features and epics** also have **acceptance criteria** (what "done" means).
- **Bugs** also have **severity** (blocker, critical, major, minor, trivial), **steps to make it happen**, **what should happen**, **what happens instead** and **where it happens**.
- **Create and add another** keeps the form open.

Quick add still works for fast tasks (`Print banners @rahul #camp !high fri`).

## The issue view

Opening an issue shows the work on the left and its details on the right.

- **Path** at the top: the epic and feature above it, each clickable.
- **Description**, then acceptance criteria or the bug details.
- **Child issues**: an epic's or feature's issues (choose the type when adding), or a story's, task's or bug's sub-tasks, with progress.
- **Linked issues**: blocks / is blocked by / relates to / duplicates / is duplicated by / clones. Find the other issue by number (#12) or words.
- **Documents**: link any document or file from Plans & docs (one document can be linked to many issues), or write a plan for it. Private documents only show to people who can open them.
- **Checklist**, then **Comments**, **History** and **Work log**.
- **Details**: type, assignee, reporter, priority, severity (bugs), resolution (when done: done, won't do, duplicate, cannot reproduce), parent, sprint, story points, start and due date, time (estimate, logged, left), labels, project, repeats, link.
- **Watch**: watchers hear about comments and when it is done, like the people on it and the reporter.
- **Log time**: "2h 30m", "1d" (8 hours), "45m"; for today or an earlier day. The person who logged it (or an admin) can take it back.
- Archiving an epic or feature archives everything under it; bringing it back brings them back.

## Backlog and sprints

**Backlog** lists every open sprint (the running one first) and the backlog under them.

- **Create sprint** adds the next two weeks (change the name, goal and dates with the pencil).
- Drag issues between the backlog and sprints, or up and down to order them. Ctrl-click (or tick) to select several and drag or **Move to…** them together.
- **Start sprint**: one runs at a time; the points in it then are what the team committed to.
- **Complete sprint**: done issues stay in it; unfinished ones move to the next sprint or back to the backlog.
- Epics stay out of sprints: their stories and tasks go in.
- On the **Board**, choose **Running sprint** to see only the sprint's issues.

## Timeline

Epics and features as bars from start date to due date, week by week, with today marked and how much is done. Open an epic to see what is under it. Anything without dates says so; open it to set them.

## Reports

For the running sprint or a finished one: the **burndown** (story points left each day against the ideal line), what is in the sprint by column and type, and **velocity** (points committed and completed in each finished sprint).

## Documents ↔ tasks

From a document: **⋯ → Link to a task…**, or **Link to a task** under the path. The linked tasks show on the document and the document shows on each task.

## Developer notes

- Rules: `Services/WorkIssues.cs` (types and nesting, time like "2h 30m", burndown), tested in `WorkIssuesTests.cs`.
- Endpoints: `WorkBoardController.cs` (cards, now with type, dates, points, sprint, bug and story fields) and `WorkBoardController.Issues.cs` (search, links, documents, work log, watch, sprints, plan/backlog order, sprint report; `GET docs-links/{docId}` for a document's tasks).
- Tables: `work_sprints`, `work_card_links`, `work_card_docs`, `work_logs`; new columns on `work_cards` (migration `AddWorkIssues`, which also marks existing sub-tasks as sub-tasks).
