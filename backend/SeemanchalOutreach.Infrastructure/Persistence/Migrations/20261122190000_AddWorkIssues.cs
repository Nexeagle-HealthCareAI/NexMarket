using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Team board as an issue tracker: issue types, dates, points, sprints, issue links, linked documents and a work log.</summary>
    public partial class AddWorkIssues : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Type", schema: "marketing", table: "work_cards", type: "text", nullable: false, defaultValue: "task");
            migrationBuilder.AddColumn<DateOnly>(name: "StartDate", schema: "marketing", table: "work_cards", type: "date", nullable: true);
            migrationBuilder.AddColumn<int>(name: "StoryPoints", schema: "marketing", table: "work_cards", type: "integer", nullable: true);
            migrationBuilder.AddColumn<int>(name: "EstimateMinutes", schema: "marketing", table: "work_cards", type: "integer", nullable: true);
            migrationBuilder.AddColumn<int>(name: "SpentMinutes", schema: "marketing", table: "work_cards", type: "integer", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<Guid>(name: "SprintId", schema: "marketing", table: "work_cards", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<double>(name: "Rank", schema: "marketing", table: "work_cards", type: "double precision", nullable: false, defaultValue: 0.0);
            migrationBuilder.AddColumn<string>(name: "Reporter", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Severity", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Environment", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Steps", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Expected", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Actual", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Acceptance", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "WatchersJson", schema: "marketing", table: "work_cards", type: "text", nullable: false, defaultValue: "[]");
            migrationBuilder.AddColumn<string>(name: "Resolution", schema: "marketing", table: "work_cards", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_work_cards_SprintId", schema: "marketing", table: "work_cards", column: "SprintId");
            // Cards that already sit under another card were sub-tasks; the backlog starts in board order.
            migrationBuilder.Sql("UPDATE marketing.work_cards SET \"Type\" = 'subtask' WHERE \"ParentId\" IS NOT NULL;");
            migrationBuilder.Sql("UPDATE marketing.work_cards SET \"Rank\" = \"Order\";");
            migrationBuilder.CreateTable(
                name: "work_card_docs",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_card_docs", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_card_docs_CardId_DocId", schema: "marketing", table: "work_card_docs", columns: new[] { "CardId", "DocId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_work_card_docs_DocId", schema: "marketing", table: "work_card_docs", column: "DocId");
            migrationBuilder.CreateTable(
                name: "work_card_links",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FromId = table.Column<Guid>(type: "uuid", nullable: false),
                    ToId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_card_links", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_card_links_FromId", schema: "marketing", table: "work_card_links", column: "FromId");
            migrationBuilder.CreateIndex(name: "IX_work_card_links_ToId", schema: "marketing", table: "work_card_links", column: "ToId");
            migrationBuilder.CreateTable(
                name: "work_logs",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Minutes = table.Column<int>(type: "integer", nullable: false),
                    Day = table.Column<DateOnly>(type: "date", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_logs", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_logs_CardId_Day", schema: "marketing", table: "work_logs", columns: new[] { "CardId", "Day" });
            migrationBuilder.CreateTable(
                name: "work_sprints",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Goal = table.Column<string>(type: "text", nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CommittedPoints = table.Column<int>(type: "integer", nullable: true),
                    CompletedPoints = table.Column<int>(type: "integer", nullable: true),
                    CompletedIssues = table.Column<int>(type: "integer", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_sprints", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_sprints_Status", schema: "marketing", table: "work_sprints", column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "work_card_docs", schema: "marketing");
            migrationBuilder.DropTable(name: "work_card_links", schema: "marketing");
            migrationBuilder.DropTable(name: "work_logs", schema: "marketing");
            migrationBuilder.DropTable(name: "work_sprints", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_work_cards_SprintId", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Type", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "StartDate", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "StoryPoints", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "EstimateMinutes", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "SpentMinutes", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "SprintId", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Rank", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Reporter", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Severity", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Environment", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Steps", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Expected", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Actual", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Acceptance", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "WatchersJson", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "Resolution", schema: "marketing", table: "work_cards");
        }
    }
}
