using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentStructuredProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DateOfBirth",
                schema: "marketing",
                table: "agents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactName",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EmergencyContactPhone",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FirstName",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Gender",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastName",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MiddleName",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Pincode",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkExperience",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "DateOfBirth",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "EmergencyContactName",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "EmergencyContactPhone",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "FirstName",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "Gender",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "LastName",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "MiddleName",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "Pincode",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "WorkExperience",
                schema: "marketing",
                table: "agents");
        }
    }
}
