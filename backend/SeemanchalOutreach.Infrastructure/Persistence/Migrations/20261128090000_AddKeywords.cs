using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Keywords: what people search for, grouped into topics, scored, and the actions taken on each topic.</summary>
    public partial class AddKeywords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "kw_topics",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Department = table.Column<string>(type: "text", nullable: true),
                    Intent = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: true),
                    MatchTerms = table.Column<string>(type: "text", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    Demand = table.Column<int>(type: "integer", nullable: false),
                    ValuePct = table.Column<int>(type: "integer", nullable: false),
                    GapPct = table.Column<int>(type: "integer", nullable: false),
                    BestPosition = table.Column<double>(type: "double precision", nullable: true),
                    PeakMonths = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    IsCustom = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ScoredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_kw_topics", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_kw_topics_Name", schema: "marketing", table: "kw_topics", column: "Name", unique: true);
            migrationBuilder.CreateIndex(name: "IX_kw_topics_Score", schema: "marketing", table: "kw_topics", column: "Score");
            migrationBuilder.CreateTable(
                name: "kw_keywords",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false),
                    Lang = table.Column<string>(type: "text", nullable: false),
                    Intent = table.Column<string>(type: "text", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: true),
                    District = table.Column<string>(type: "text", nullable: true),
                    Sources = table.Column<string>(type: "text", nullable: false),
                    Volume = table.Column<int>(type: "integer", nullable: true),
                    VolumeJson = table.Column<string>(type: "text", nullable: true),
                    Competition = table.Column<int>(type: "integer", nullable: true),
                    BidLowMicros = table.Column<long>(type: "bigint", nullable: true),
                    BidHighMicros = table.Column<long>(type: "bigint", nullable: true),
                    Impressions = table.Column<int>(type: "integer", nullable: false),
                    Clicks = table.Column<int>(type: "integer", nullable: false),
                    Position = table.Column<double>(type: "double precision", nullable: true),
                    GbpViews = table.Column<int>(type: "integer", nullable: false),
                    AdClicks = table.Column<int>(type: "integer", nullable: false),
                    AdCostMicros = table.Column<long>(type: "bigint", nullable: false),
                    ChatCount = table.Column<int>(type: "integer", nullable: false),
                    IsSeed = table.Column<bool>(type: "boolean", nullable: false),
                    Hidden = table.Column<bool>(type: "boolean", nullable: false),
                    VolumeAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_kw_keywords", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_kw_keywords_Text", schema: "marketing", table: "kw_keywords", column: "Text", unique: true);
            migrationBuilder.CreateIndex(name: "IX_kw_keywords_TopicId", schema: "marketing", table: "kw_keywords", column: "TopicId");
            migrationBuilder.CreateTable(
                name: "kw_area_volumes",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    KeywordId = table.Column<Guid>(type: "uuid", nullable: false),
                    District = table.Column<string>(type: "text", nullable: false),
                    Volume = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_kw_area_volumes", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_kw_area_volumes_KeywordId_District", schema: "marketing", table: "kw_area_volumes", columns: new[] { "KeywordId", "District" }, unique: true);
            migrationBuilder.CreateTable(
                name: "kw_actions",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TopicId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Stage = table.Column<string>(type: "text", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: true),
                    DueOn = table.Column<DateOnly>(type: "date", nullable: true),
                    LinkCode = table.Column<string>(type: "text", nullable: true),
                    Url = table.Column<string>(type: "text", nullable: true),
                    Brief = table.Column<string>(type: "text", nullable: true),
                    Spend = table.Column<int>(type: "integer", nullable: true),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_kw_actions", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_kw_actions_TopicId", schema: "marketing", table: "kw_actions", column: "TopicId");
            migrationBuilder.CreateIndex(name: "IX_kw_actions_LinkCode", schema: "marketing", table: "kw_actions", column: "LinkCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "kw_topics", schema: "marketing");
            migrationBuilder.DropTable(name: "kw_keywords", schema: "marketing");
            migrationBuilder.DropTable(name: "kw_area_volumes", schema: "marketing");
            migrationBuilder.DropTable(name: "kw_actions", schema: "marketing");
        }
    }
}
