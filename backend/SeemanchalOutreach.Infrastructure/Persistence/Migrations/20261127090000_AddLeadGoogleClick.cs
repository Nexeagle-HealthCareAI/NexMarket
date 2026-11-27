using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>A lead keeps the Google ad click it came from, so Arrived and Admitted can be sent back to Google Ads.</summary>
    public partial class AddLeadGoogleClick : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Gclid", schema: "marketing", table: "leads", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "GclidAt", schema: "marketing", table: "leads", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "AdsArrivedSentAt", schema: "marketing", table: "leads", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "AdsAdmittedSentAt", schema: "marketing", table: "leads", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "AdsUploadError", schema: "marketing", table: "leads", type: "text", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "Gclid", schema: "marketing", table: "leads");
            migrationBuilder.DropColumn(name: "GclidAt", schema: "marketing", table: "leads");
            migrationBuilder.DropColumn(name: "AdsArrivedSentAt", schema: "marketing", table: "leads");
            migrationBuilder.DropColumn(name: "AdsAdmittedSentAt", schema: "marketing", table: "leads");
            migrationBuilder.DropColumn(name: "AdsUploadError", schema: "marketing", table: "leads");
        }
    }
}
