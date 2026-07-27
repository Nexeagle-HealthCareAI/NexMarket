using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveyResponses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "survey_responses",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AgentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContactId = table.Column<Guid>(type: "uuid", nullable: true),
                    PanchayatId = table.Column<Guid>(type: "uuid", nullable: true),
                    AnswersJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_survey_responses", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_survey_responses_AgentId",
                schema: "marketing",
                table: "survey_responses",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_survey_responses_ClientId_DeviceId",
                schema: "marketing",
                table: "survey_responses",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_responses_PanchayatId",
                schema: "marketing",
                table: "survey_responses",
                column: "PanchayatId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "survey_responses",
                schema: "marketing");
        }
    }
}
