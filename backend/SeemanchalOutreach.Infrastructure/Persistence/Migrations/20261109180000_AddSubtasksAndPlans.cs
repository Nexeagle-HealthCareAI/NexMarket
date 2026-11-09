using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Team board: sub-tasks (a card's parent) and plans &amp; documents with their earlier versions. One new column, two new tables.</summary>
    public partial class AddSubtasksAndPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ParentId",
                schema: "marketing",
                table: "work_cards",
                type: "uuid",
                nullable: true);
            migrationBuilder.CreateIndex(name: "IX_work_cards_ParentId", schema: "marketing", table: "work_cards", column: "ParentId");
            migrationBuilder.CreateTable(
                name: "work_docs",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: true),
                    ContentJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Pinned = table.Column<bool>(type: "boolean", nullable: false),
                    PlainText = table.Column<string>(type: "text", nullable: false),
                    Project = table.Column<string>(type: "text", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_docs", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_docs_Archived_UpdatedAt", schema: "marketing", table: "work_docs", columns: new[] { "Archived", "UpdatedAt" });
            migrationBuilder.CreateIndex(name: "IX_work_docs_CardId", schema: "marketing", table: "work_docs", column: "CardId");
            migrationBuilder.CreateTable(
                name: "work_doc_revisions",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContentJson = table.Column<string>(type: "text", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: false),
                    SavedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SavedBy = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_doc_revisions", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_doc_revisions_DocId_Version", schema: "marketing", table: "work_doc_revisions", columns: new[] { "DocId", "Version" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_work_cards_ParentId", schema: "marketing", table: "work_cards");
            migrationBuilder.DropColumn(name: "ParentId", schema: "marketing", table: "work_cards");
            migrationBuilder.DropTable(name: "work_docs", schema: "marketing");
            migrationBuilder.DropTable(name: "work_doc_revisions", schema: "marketing");
        }
    }
}
