using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Website phase 2: scheduling, staging, roll back with the reviewer kept, and the media library.</summary>
    public partial class AddWebsitePhase2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(name: "PublishAt", schema: "marketing", table: "site_contents", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "UnpublishAt", schema: "marketing", table: "site_contents", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ScheduledBy", schema: "marketing", table: "site_contents", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ScheduledByName", schema: "marketing", table: "site_contents", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "StagedAt", schema: "marketing", table: "site_contents", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ReviewedByName", schema: "marketing", table: "site_content_versions", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Target", schema: "marketing", table: "site_publishes", type: "text", nullable: false, defaultValue: "live");
            migrationBuilder.AddColumn<string>(name: "Media", schema: "marketing", table: "site_publishes", type: "text", nullable: false, defaultValue: "[]");
            migrationBuilder.CreateTable(
                name: "site_media",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Alt = table.Column<string>(type: "text", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    Bytes = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    Key = table.Column<string>(type: "text", nullable: false),
                    Mime = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    OnSite = table.Column<bool>(type: "boolean", nullable: false),
                    Path = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByName = table.Column<string>(type: "text", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_site_media", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_site_media_Name", schema: "marketing", table: "site_media", column: "Name", unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "site_media", schema: "marketing");
            migrationBuilder.DropColumn(name: "PublishAt", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "UnpublishAt", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ScheduledBy", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ScheduledByName", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "StagedAt", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ReviewedByName", schema: "marketing", table: "site_content_versions");
            migrationBuilder.DropColumn(name: "Target", schema: "marketing", table: "site_publishes");
            migrationBuilder.DropColumn(name: "Media", schema: "marketing", table: "site_publishes");
        }
    }
}
