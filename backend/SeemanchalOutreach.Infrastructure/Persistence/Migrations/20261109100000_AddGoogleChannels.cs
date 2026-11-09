using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Daily numbers from the hospital's own Google accounts (Business Profile, Search Console, GA4, YouTube, Google Ads) and Google reviews. Two new tables.</summary>
    public partial class AddGoogleChannels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "channel_metrics",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Account = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Dimension = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: true),
                    Metric = table.Column<string>(type: "text", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Value = table.Column<decimal>(type: "numeric(18,4)", precision: 18, scale: 4, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_channel_metrics", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_channel_metrics_Date", schema: "marketing", table: "channel_metrics", column: "Date");
            migrationBuilder.CreateIndex(name: "IX_channel_metrics_Source_Account_Date_Dimension_Metric", schema: "marketing", table: "channel_metrics", columns: new[] { "Source", "Account", "Date", "Dimension", "Metric" }, unique: true);
            migrationBuilder.CreateTable(
                name: "google_reviews",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Comment = table.Column<string>(type: "text", nullable: true),
                    Location = table.Column<string>(type: "text", nullable: false),
                    PostedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RepliedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RepliedBy = table.Column<string>(type: "text", nullable: true),
                    ReplyText = table.Column<string>(type: "text", nullable: true),
                    ReviewName = table.Column<string>(type: "text", nullable: false),
                    ReviewUpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReviewerName = table.Column<string>(type: "text", nullable: true),
                    Stars = table.Column<int>(type: "integer", nullable: false),
                    SyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_google_reviews", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_google_reviews_PostedAt", schema: "marketing", table: "google_reviews", column: "PostedAt");
            migrationBuilder.CreateIndex(name: "IX_google_reviews_ReviewName", schema: "marketing", table: "google_reviews", column: "ReviewName", unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "channel_metrics", schema: "marketing");
            migrationBuilder.DropTable(name: "google_reviews", schema: "marketing");
        }
    }
}
