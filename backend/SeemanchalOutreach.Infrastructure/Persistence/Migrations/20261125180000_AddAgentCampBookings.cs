using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Field agents book people into health camps from the app; who marked them arrived; the token sent on WhatsApp.</summary>
    public partial class AddAgentCampBookings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "ClientId", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "PanchayatId", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<int>(name: "Pulse", schema: "marketing", table: "camp_patients", type: "integer", nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "TempF", schema: "marketing", table: "camp_patients", type: "numeric(5,1)", precision: 5, scale: 1, nullable: true);
            migrationBuilder.AddColumn<string>(name: "SugarKind", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "StatusBy", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "StatusVia", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "StatusAt", schema: "marketing", table: "camp_patients", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "WaStatus", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "WaError", schema: "marketing", table: "camp_patients", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_camp_patients_ClientId", schema: "marketing", table: "camp_patients", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_camp_patients_CreatedBy", schema: "marketing", table: "camp_patients", column: "CreatedBy");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_camp_patients_ClientId", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropIndex(name: "IX_camp_patients_CreatedBy", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "ClientId", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "PanchayatId", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "Pulse", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "TempF", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "SugarKind", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "StatusBy", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "StatusVia", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "StatusAt", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "WaStatus", schema: "marketing", table: "camp_patients");
            migrationBuilder.DropColumn(name: "WaError", schema: "marketing", table: "camp_patients");
        }
    }
}
