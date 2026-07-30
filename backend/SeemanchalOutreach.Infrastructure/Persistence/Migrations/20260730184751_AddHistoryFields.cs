using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddHistoryFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Complaints",
                schema: "marketing",
                table: "contact_history",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Conflicts",
                schema: "marketing",
                table: "contact_history",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FollowUpDate",
                schema: "marketing",
                table: "contact_history",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Complaints",
                schema: "marketing",
                table: "contact_history");

            migrationBuilder.DropColumn(
                name: "Conflicts",
                schema: "marketing",
                table: "contact_history");

            migrationBuilder.DropColumn(
                name: "FollowUpDate",
                schema: "marketing",
                table: "contact_history");
        }
    }
}
