using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSurveySkipFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSkipped",
                schema: "marketing",
                table: "survey_responses",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SkipReason",
                schema: "marketing",
                table: "survey_responses",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSkipped",
                schema: "marketing",
                table: "survey_responses");

            migrationBuilder.DropColumn(
                name: "SkipReason",
                schema: "marketing",
                table: "survey_responses");
        }
    }
}
