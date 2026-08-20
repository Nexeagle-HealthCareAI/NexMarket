using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddExifMetadataToDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ExifCapturedAt",
                schema: "marketing",
                table: "ContactDocuments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "ExifLatitude",
                schema: "marketing",
                table: "ContactDocuments",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "ExifLongitude",
                schema: "marketing",
                table: "ContactDocuments",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ExifCapturedAt",
                schema: "marketing",
                table: "ContactDocuments");

            migrationBuilder.DropColumn(
                name: "ExifLatitude",
                schema: "marketing",
                table: "ContactDocuments");

            migrationBuilder.DropColumn(
                name: "ExifLongitude",
                schema: "marketing",
                table: "ContactDocuments");
        }
    }
}
