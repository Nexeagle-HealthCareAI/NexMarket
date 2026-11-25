using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Appointments field agents book from the app (place and complaint on the referral), and the vitals they take.</summary>
    public partial class AddFieldAppointments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "Kind", schema: "marketing", table: "referrals", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "PanchayatId", schema: "marketing", table: "referrals", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Block", schema: "marketing", table: "referrals", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "District", schema: "marketing", table: "referrals", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Complaint", schema: "marketing", table: "referrals", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "ComplaintAt", schema: "marketing", table: "referrals", type: "timestamp with time zone", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_referrals_PanchayatId", schema: "marketing", table: "referrals", column: "PanchayatId");
            migrationBuilder.CreateTable(
                name: "patient_readings",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    BpDiastolic = table.Column<int>(type: "integer", nullable: true),
                    BpSystolic = table.Column<int>(type: "integer", nullable: true),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    Hba1c = table.Column<decimal>(type: "numeric(4,1)", precision: 4, scale: 1, nullable: true),
                    HeightCm = table.Column<decimal>(type: "numeric(6,1)", precision: 6, scale: 1, nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Pulse = table.Column<int>(type: "integer", nullable: true),
                    ReferralClientId = table.Column<string>(type: "text", nullable: false),
                    RespRate = table.Column<int>(type: "integer", nullable: true),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Spo2 = table.Column<int>(type: "integer", nullable: true),
                    Sugar = table.Column<int>(type: "integer", nullable: true),
                    SugarKind = table.Column<string>(type: "text", nullable: true),
                    TakenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    TempF = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: true),
                    WeightKg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_patient_readings", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_patient_readings_ClientId", schema: "marketing", table: "patient_readings", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_patient_readings_ReferralClientId", schema: "marketing", table: "patient_readings", column: "ReferralClientId");
            migrationBuilder.CreateIndex(name: "IX_patient_readings_AgentId_TakenAt", schema: "marketing", table: "patient_readings", columns: new[] { "AgentId", "TakenAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "patient_readings", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_referrals_PanchayatId", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "Kind", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "PanchayatId", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "Block", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "District", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "Complaint", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "ComplaintAt", schema: "marketing", table: "referrals");
        }
    }
}
