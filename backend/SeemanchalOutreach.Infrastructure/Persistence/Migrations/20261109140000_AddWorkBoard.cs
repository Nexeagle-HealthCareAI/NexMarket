using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>The team board: work cards (status, order, people, due date, checklist, repeat) and their comments and history. Two new tables.</summary>
    public partial class AddWorkBoard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "work_cards",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    AssigneesJson = table.Column<string>(type: "text", nullable: false),
                    ChecklistJson = table.Column<string>(type: "text", nullable: false),
                    CommentCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    DoneAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DoneBy = table.Column<string>(type: "text", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    LabelsJson = table.Column<string>(type: "text", nullable: false),
                    Link = table.Column<string>(type: "text", nullable: true),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Order = table.Column<double>(type: "double precision", nullable: false),
                    Priority = table.Column<string>(type: "text", nullable: false),
                    Project = table.Column<string>(type: "text", nullable: true),
                    Repeat = table.Column<string>(type: "text", nullable: false),
                    RepeatOf = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_cards", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_cards_Archived_Status", schema: "marketing", table: "work_cards", columns: new[] { "Archived", "Status" });
            migrationBuilder.CreateIndex(name: "IX_work_cards_Number", schema: "marketing", table: "work_cards", column: "Number", unique: true);
            migrationBuilder.CreateTable(
                name: "work_notes",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_notes", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_notes_CardId_CreatedAt", schema: "marketing", table: "work_notes", columns: new[] { "CardId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "work_cards", schema: "marketing");
            migrationBuilder.DropTable(name: "work_notes", schema: "marketing");
        }
    }
}
