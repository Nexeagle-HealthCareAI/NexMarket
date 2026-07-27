using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAgentsAdminSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Population",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.AddColumn<double>(
                name: "CentroidLat",
                schema: "marketing",
                table: "panchayats",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "CentroidLng",
                schema: "marketing",
                table: "panchayats",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LgdCode",
                schema: "marketing",
                table: "panchayats",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "State",
                schema: "marketing",
                table: "panchayats",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "DuplicateReviewedAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RefreshTokenExpiresAt",
                schema: "marketing",
                table: "agents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RefreshTokenHash",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_panchayats_LgdCode",
                schema: "marketing",
                table: "panchayats",
                column: "LgdCode",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_panchayats_LgdCode",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "CentroidLat",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "CentroidLng",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "LgdCode",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "State",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "DuplicateReviewedAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "RefreshTokenExpiresAt",
                schema: "marketing",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "RefreshTokenHash",
                schema: "marketing",
                table: "agents");

            migrationBuilder.AddColumn<int>(
                name: "Population",
                schema: "marketing",
                table: "panchayats",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }
    }
}
