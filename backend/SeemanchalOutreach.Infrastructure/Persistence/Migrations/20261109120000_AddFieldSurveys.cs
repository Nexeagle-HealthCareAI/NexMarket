using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Occasional field surveys: the drawn area, who it is given to, the routes traced in the app and the spots marked. Four new tables.</summary>
    public partial class AddFieldSurveys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "field_surveys",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AreaJson = table.Column<string>(type: "text", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Instructions = table.Column<string>(type: "text", nullable: true),
                    QuestionsJson = table.Column<string>(type: "text", nullable: false),
                    RoadTypesJson = table.Column<string>(type: "text", nullable: false),
                    SpotTypesJson = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_surveys", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_field_surveys_Status", schema: "marketing", table: "field_surveys", column: "Status");
            migrationBuilder.CreateTable(
                name: "field_survey_assignees",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    AnswersAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AnswersJson = table.Column<string>(type: "text", nullable: true),
                    AssignedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SurveyId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_survey_assignees", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_field_survey_assignees_AgentId", schema: "marketing", table: "field_survey_assignees", column: "AgentId");
            migrationBuilder.CreateIndex(name: "IX_field_survey_assignees_SurveyId_AgentId", schema: "marketing", table: "field_survey_assignees", columns: new[] { "SurveyId", "AgentId" }, unique: true);
            migrationBuilder.CreateTable(
                name: "field_survey_spots",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AccuracyM = table.Column<double>(type: "double precision", nullable: true),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Lat = table.Column<double>(type: "double precision", nullable: false),
                    Lng = table.Column<double>(type: "double precision", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    PhotoKey = table.Column<string>(type: "text", nullable: true),
                    PhotoMime = table.Column<string>(type: "text", nullable: true),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    RoadType = table.Column<string>(type: "text", nullable: true),
                    SurveyId = table.Column<Guid>(type: "uuid", nullable: false),
                    TakenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Type = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_survey_spots", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_field_survey_spots_ClientId", schema: "marketing", table: "field_survey_spots", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_field_survey_spots_SurveyId_AgentId", schema: "marketing", table: "field_survey_spots", columns: new[] { "SurveyId", "AgentId" });
            migrationBuilder.CreateTable(
                name: "field_survey_tracks",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DistanceM = table.Column<double>(type: "double precision", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PointCount = table.Column<int>(type: "integer", nullable: false),
                    PointsJson = table.Column<string>(type: "text", nullable: false),
                    RoadType = table.Column<string>(type: "text", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SurveyId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_survey_tracks", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_field_survey_tracks_ClientId", schema: "marketing", table: "field_survey_tracks", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_field_survey_tracks_SurveyId_AgentId", schema: "marketing", table: "field_survey_tracks", columns: new[] { "SurveyId", "AgentId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "field_surveys", schema: "marketing");
            migrationBuilder.DropTable(name: "field_survey_assignees", schema: "marketing");
            migrationBuilder.DropTable(name: "field_survey_tracks", schema: "marketing");
            migrationBuilder.DropTable(name: "field_survey_spots", schema: "marketing");
        }
    }
}
