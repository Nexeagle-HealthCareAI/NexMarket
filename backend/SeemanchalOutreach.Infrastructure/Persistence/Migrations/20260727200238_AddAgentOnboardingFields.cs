using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentOnboardingFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Education",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PersonalDetails",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PhotoUrl",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ProfileCompleted",
                schema: "marketing",
                table: "agents",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Education",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "PersonalDetails",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "PhotoUrl",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "ProfileCompleted",
                schema: "marketing",
                table: "agents");
        }
    }
}
