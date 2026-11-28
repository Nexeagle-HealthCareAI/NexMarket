using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Content library: tracked links become content (a reel, post, ad, page…) with their platform IDs, and every lead keeps where it came from (lead_touches).</summary>
    public partial class AddContentTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Kind", schema: "marketing", table: "tracked_links", type: "text", nullable: false, defaultValue: "place");
            migrationBuilder.AddColumn<Guid>(name: "TopicId", schema: "marketing", table: "tracked_links", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "OwnerId", schema: "marketing", table: "tracked_links", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateOnly>(name: "PublishedOn", schema: "marketing", table: "tracked_links", type: "date", nullable: true);
            migrationBuilder.AddColumn<string>(name: "MediaId", schema: "marketing", table: "tracked_links", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "AdId", schema: "marketing", table: "tracked_links", type: "text", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "BroadcastId", schema: "marketing", table: "tracked_links", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "PagePath", schema: "marketing", table: "tracked_links", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_tracked_links_AdId", schema: "marketing", table: "tracked_links", column: "AdId");
            migrationBuilder.CreateIndex(name: "IX_tracked_links_MediaId", schema: "marketing", table: "tracked_links", column: "MediaId");
            migrationBuilder.CreateTable(
                name: "lead_touches",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Channel = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    LinkId = table.Column<Guid>(type: "uuid", nullable: true),
                    BroadcastId = table.Column<Guid>(type: "uuid", nullable: true),
                    AdId = table.Column<string>(type: "text", nullable: true),
                    Ref = table.Column<string>(type: "text", nullable: true),
                    Detail = table.Column<string>(type: "text", nullable: true),
                    IsFirst = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lead_touches", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_lead_touches_LeadId", schema: "marketing", table: "lead_touches", column: "LeadId");
            migrationBuilder.CreateIndex(name: "IX_lead_touches_LinkId", schema: "marketing", table: "lead_touches", column: "LinkId");
            migrationBuilder.CreateIndex(name: "IX_lead_touches_BroadcastId", schema: "marketing", table: "lead_touches", column: "BroadcastId");
            migrationBuilder.CreateIndex(name: "IX_lead_touches_At", schema: "marketing", table: "lead_touches", column: "At");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "lead_touches", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_tracked_links_MediaId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropIndex(name: "IX_tracked_links_AdId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "Kind", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "TopicId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "OwnerId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "PublishedOn", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "MediaId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "AdId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "BroadcastId", schema: "marketing", table: "tracked_links");
            migrationBuilder.DropColumn(name: "PagePath", schema: "marketing", table: "tracked_links");
        }
    }
}
