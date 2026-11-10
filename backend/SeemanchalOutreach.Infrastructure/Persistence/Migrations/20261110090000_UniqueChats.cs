using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// One chat per agent, one Team chat and one chat per pair of people. Any duplicates created by two people opening
    /// chat at the same moment are merged into the oldest copy first: messages, reactions, read marks, the pin and bell
    /// links move across, and the empty copy is kept with Kind = "merged" (nothing is deleted). Then unique indexes stop
    /// it happening again. Also records who started a one-to-one chat, so an empty one shows only to them.
    /// </summary>
    public partial class UniqueChats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StartedBy",
                schema: "marketing",
                table: "chat_threads",
                type: "text",
                nullable: true);

            migrationBuilder.Sql(@"
CREATE TEMP TABLE chat_merge ON COMMIT DROP AS
SELECT ""Id"" AS dup, keep FROM (
    SELECT ""Id"", first_value(""Id"") OVER (
        PARTITION BY ""Kind"",
                     CASE WHEN ""Kind"" = 'team' THEN '' ELSE coalesce(""AgentId"", '') END,
                     CASE WHEN ""Kind"" = 'direct' THEN coalesce(""PeerId"", '') ELSE '' END
        ORDER BY ""CreatedAt"", ""Id"") AS keep
    FROM marketing.chat_threads
    WHERE ""Kind"" IN ('team', 'agent', 'direct')
) t WHERE ""Id"" <> keep;

UPDATE marketing.chat_messages m SET ""ThreadId"" = x.keep FROM chat_merge x WHERE m.""ThreadId"" = x.dup;
UPDATE marketing.chat_reactions r SET ""ThreadId"" = x.keep FROM chat_merge x WHERE r.""ThreadId"" = x.dup;

INSERT INTO marketing.chat_reads (""Id"", ""ThreadId"", ""UserId"", ""IsOffice"", ""LastReadAt"", ""LastSeenAt"")
SELECT gen_random_uuid(), x.keep, r.""UserId"", bool_or(r.""IsOffice""), max(r.""LastReadAt""), max(r.""LastSeenAt"")
FROM marketing.chat_reads r JOIN chat_merge x ON r.""ThreadId"" = x.dup
GROUP BY x.keep, r.""UserId""
ON CONFLICT (""ThreadId"", ""UserId"") DO UPDATE SET
    ""LastReadAt"" = GREATEST(marketing.chat_reads.""LastReadAt"", EXCLUDED.""LastReadAt""),
    ""LastSeenAt"" = GREATEST(marketing.chat_reads.""LastSeenAt"", EXCLUDED.""LastSeenAt""),
    ""IsOffice"" = marketing.chat_reads.""IsOffice"" OR EXCLUDED.""IsOffice"";

UPDATE marketing.chat_pins p SET ""ThreadId"" = x.keep
FROM chat_merge x
WHERE p.""ThreadId"" = x.dup
  AND NOT EXISTS (SELECT 1 FROM marketing.chat_pins q WHERE q.""ThreadId"" = x.keep)
  AND p.""Id"" = (SELECT p2.""Id"" FROM marketing.chat_pins p2 JOIN chat_merge x2 ON p2.""ThreadId"" = x2.dup
                 WHERE x2.keep = x.keep ORDER BY p2.""PinnedAt"" DESC LIMIT 1);

UPDATE marketing.notifications n SET ""Link"" = 'chat:' || x.keep FROM chat_merge x WHERE n.""Link"" = 'chat:' || x.dup;

UPDATE marketing.chat_threads k SET ""LastMessageAt"" = d.""LastMessageAt"", ""LastPreview"" = d.""LastPreview""
FROM (SELECT DISTINCT ON (x.keep) x.keep, t.""LastMessageAt"", t.""LastPreview""
      FROM chat_merge x JOIN marketing.chat_threads t ON t.""Id"" = x.dup
      WHERE t.""LastPreview"" IS NOT NULL
      ORDER BY x.keep, t.""LastMessageAt"" DESC) d
WHERE k.""Id"" = d.keep AND (k.""LastPreview"" IS NULL OR d.""LastMessageAt"" > k.""LastMessageAt"");

UPDATE marketing.chat_threads t SET ""Kind"" = 'merged', ""Title"" = left('Merged into ' || x.keep::text || ' · ' || t.""Title"", 300)
FROM chat_merge x WHERE t.""Id"" = x.dup;
");

            migrationBuilder.CreateIndex(name: "UX_chat_threads_agent", schema: "marketing", table: "chat_threads", column: "AgentId",
                unique: true, filter: "\"Kind\" = 'agent'");
            migrationBuilder.CreateIndex(name: "UX_chat_threads_direct", schema: "marketing", table: "chat_threads", columns: new[] { "AgentId", "PeerId" },
                unique: true, filter: "\"Kind\" = 'direct'");
            migrationBuilder.CreateIndex(name: "UX_chat_threads_team", schema: "marketing", table: "chat_threads", column: "Kind",
                unique: true, filter: "\"Kind\" = 'team'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "UX_chat_threads_agent", schema: "marketing", table: "chat_threads");
            migrationBuilder.DropIndex(name: "UX_chat_threads_direct", schema: "marketing", table: "chat_threads");
            migrationBuilder.DropIndex(name: "UX_chat_threads_team", schema: "marketing", table: "chat_threads");
            migrationBuilder.DropColumn(name: "StartedBy", schema: "marketing", table: "chat_threads");
        }
    }
}
