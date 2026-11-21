using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Website phases 3 and 4: the page an enquiry came from, click counts per page, re-review dates, chains, API keys and webhook deliveries.</summary>
    public partial class AddWebsitePhase34 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "LandingPage", schema: "marketing", table: "leads", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateOnly>(name: "ReviewedOn", schema: "marketing", table: "site_contents", type: "date", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "ReReviewAskedAt", schema: "marketing", table: "site_contents", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<bool>(name: "Shared", schema: "marketing", table: "site_contents", type: "boolean", nullable: false, defaultValue: false);
            migrationBuilder.AddColumn<string>(name: "ChainOrg", schema: "marketing", table: "site_contents", type: "text", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ChainId", schema: "marketing", table: "site_contents", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<int>(name: "ChainVersion", schema: "marketing", table: "site_contents", type: "integer", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ChainBase", schema: "marketing", table: "site_contents", type: "text", nullable: true);
            migrationBuilder.CreateTable(
                name: "site_events",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Day = table.Column<DateOnly>(type: "date", nullable: false),
                    Path = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_site_events", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_site_events_Day_Path_Kind", schema: "marketing", table: "site_events", columns: new[] { "Day", "Path", "Kind" }, unique: true);
            migrationBuilder.CreateTable(
                name: "site_api_keys",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Hash = table.Column<string>(type: "text", nullable: false),
                    Last4 = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastUsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_site_api_keys", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_site_api_keys_Hash", schema: "marketing", table: "site_api_keys", column: "Hash", unique: true);
            migrationBuilder.CreateTable(
                name: "site_webhook_deliveries",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Hook = table.Column<int>(type: "integer", nullable: false),
                    Url = table.Column<string>(type: "text", nullable: false),
                    Event = table.Column<string>(type: "text", nullable: false),
                    Payload = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Tries = table.Column<int>(type: "integer", nullable: false),
                    NextAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastError = table.Column<string>(type: "text", nullable: true),
                    LastStatus = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_site_webhook_deliveries", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_site_webhook_deliveries_Status_NextAt", schema: "marketing", table: "site_webhook_deliveries", columns: new[] { "Status", "NextAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "site_events", schema: "marketing");
            migrationBuilder.DropTable(name: "site_api_keys", schema: "marketing");
            migrationBuilder.DropTable(name: "site_webhook_deliveries", schema: "marketing");
            migrationBuilder.DropColumn(name: "LandingPage", schema: "marketing", table: "leads");
            migrationBuilder.DropColumn(name: "ReviewedOn", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ReReviewAskedAt", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "Shared", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ChainOrg", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ChainId", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ChainVersion", schema: "marketing", table: "site_contents");
            migrationBuilder.DropColumn(name: "ChainBase", schema: "marketing", table: "site_contents");
        }
    }
}
