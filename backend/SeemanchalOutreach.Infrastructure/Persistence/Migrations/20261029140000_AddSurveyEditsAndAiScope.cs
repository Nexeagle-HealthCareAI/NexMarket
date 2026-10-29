using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Keeps a record of admin edits/deletes of survey answers, and lets the AI analyst keep
    /// separate business and survey briefings. One new table and two new columns; nothing existing changes.</summary>
    public partial class AddSurveyEditsAndAiScope : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Scope", schema: "marketing", table: "ai_briefings", type: "text", nullable: false, defaultValue: "business");
            migrationBuilder.AddColumn<string>(name: "Scope", schema: "marketing", table: "ai_items", type: "text", nullable: false, defaultValue: "business");

            migrationBuilder.CreateTable(
                name: "survey_edits",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    AfterJson = table.Column<string>(type: "text", nullable: true),
                    BeforeJson = table.Column<string>(type: "text", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangedBy = table.Column<string>(type: "text", nullable: false),
                    ResponseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_edits", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_survey_edits_ResponseId", schema: "marketing", table: "survey_edits", column: "ResponseId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "survey_edits", schema: "marketing");
            migrationBuilder.DropColumn(name: "Scope", schema: "marketing", table: "ai_briefings");
            migrationBuilder.DropColumn(name: "Scope", schema: "marketing", table: "ai_items");
        }
    }
}
