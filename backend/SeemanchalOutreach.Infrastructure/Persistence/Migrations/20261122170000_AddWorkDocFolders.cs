using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Team board documents: folders, private and shared documents, comments and stars.</summary>
    public partial class AddWorkDocFolders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "FolderId", schema: "marketing", table: "work_docs", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Access", schema: "marketing", table: "work_docs", type: "text", nullable: false, defaultValue: "team");
            migrationBuilder.AddColumn<Guid>(name: "DeletedWith", schema: "marketing", table: "work_docs", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_work_docs_FolderId", schema: "marketing", table: "work_docs", column: "FolderId");
            migrationBuilder.CreateTable(
                name: "work_doc_comments",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Quote = table.Column<string>(type: "text", nullable: true),
                    QuoteNth = table.Column<int>(type: "integer", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false),
                    MentionsJson = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EditedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Resolved = table.Column<bool>(type: "boolean", nullable: false),
                    ResolvedBy = table.Column<string>(type: "text", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_doc_comments", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_doc_comments_DocId_CreatedAt", schema: "marketing", table: "work_doc_comments", columns: new[] { "DocId", "CreatedAt" });
            migrationBuilder.CreateTable(
                name: "work_doc_folders",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    ParentId = table.Column<Guid>(type: "uuid", nullable: true),
                    Color = table.Column<string>(type: "text", nullable: true),
                    Access = table.Column<string>(type: "text", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedBy = table.Column<string>(type: "text", nullable: true),
                    DeletedWith = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_doc_folders", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_doc_folders_ParentId", schema: "marketing", table: "work_doc_folders", column: "ParentId");
            migrationBuilder.CreateTable(
                name: "work_doc_shares",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: true),
                    FolderId = table.Column<Guid>(type: "uuid", nullable: true),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    SharedBy = table.Column<string>(type: "text", nullable: false),
                    SharedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_doc_shares", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_doc_shares_AgentId", schema: "marketing", table: "work_doc_shares", column: "AgentId");
            migrationBuilder.CreateIndex(name: "IX_work_doc_shares_DocId", schema: "marketing", table: "work_doc_shares", column: "DocId");
            migrationBuilder.CreateIndex(name: "IX_work_doc_shares_FolderId", schema: "marketing", table: "work_doc_shares", column: "FolderId");
            migrationBuilder.CreateTable(
                name: "work_doc_stars",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_work_doc_stars", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_work_doc_stars_AgentId_DocId", schema: "marketing", table: "work_doc_stars", columns: new[] { "AgentId", "DocId" }, unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "work_doc_comments", schema: "marketing");
            migrationBuilder.DropTable(name: "work_doc_folders", schema: "marketing");
            migrationBuilder.DropTable(name: "work_doc_shares", schema: "marketing");
            migrationBuilder.DropTable(name: "work_doc_stars", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_work_docs_FolderId", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "FolderId", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "Access", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "DeletedWith", schema: "marketing", table: "work_docs");
        }
    }
}
