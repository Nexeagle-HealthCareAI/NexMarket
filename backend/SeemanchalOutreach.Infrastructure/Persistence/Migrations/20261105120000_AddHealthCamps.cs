using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Health camps and the people screened at them. Two new tables; nothing existing changes.</summary>
    public partial class AddHealthCamps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "health_camps",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Block = table.Column<string>(type: "text", nullable: true),
                    Budget = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    CampType = table.Column<string>(type: "text", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    ChecklistJson = table.Column<string>(type: "text", nullable: true),
                    Code = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Departments = table.Column<string>(type: "text", nullable: true),
                    District = table.Column<string>(type: "text", nullable: true),
                    Doctors = table.Column<string>(type: "text", nullable: true),
                    EndTime = table.Column<string>(type: "text", nullable: false),
                    HostPartnerClientId = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Outcome = table.Column<string>(type: "text", nullable: true),
                    PanchayatId = table.Column<string>(type: "text", nullable: true),
                    Spent = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    StartTime = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    TargetReferrals = table.Column<int>(type: "integer", nullable: false),
                    TargetRegistrations = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Venue = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_health_camps", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_health_camps_Code", schema: "marketing", table: "health_camps", column: "Code", unique: true);
            migrationBuilder.CreateIndex(name: "IX_health_camps_Date", schema: "marketing", table: "health_camps", column: "Date");
            migrationBuilder.CreateTable(
                name: "camp_patients",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Advice = table.Column<string>(type: "text", nullable: true),
                    Age = table.Column<int>(type: "integer", nullable: true),
                    ArrivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    BpDiastolic = table.Column<int>(type: "integer", nullable: true),
                    BpSystolic = table.Column<int>(type: "integer", nullable: true),
                    CampId = table.Column<Guid>(type: "uuid", nullable: false),
                    Complaint = table.Column<string>(type: "text", nullable: true),
                    Conditions = table.Column<string>(type: "text", nullable: true),
                    Consent = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    Department = table.Column<string>(type: "text", nullable: true),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    PartnerClientId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    ReferToHospital = table.Column<bool>(type: "boolean", nullable: false),
                    Sex = table.Column<string>(type: "text", nullable: true),
                    Slot = table.Column<string>(type: "text", nullable: true),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Spo2 = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Sugar = table.Column<int>(type: "integer", nullable: true),
                    Symptoms = table.Column<string>(type: "text", nullable: true),
                    Token = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Urgent = table.Column<bool>(type: "boolean", nullable: false),
                    Village = table.Column<string>(type: "text", nullable: true),
                    WeightKg = table.Column<decimal>(type: "numeric(5,1)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_camp_patients", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_camp_patients_LeadId", schema: "marketing", table: "camp_patients", column: "LeadId");
            migrationBuilder.CreateIndex(name: "IX_camp_patients_Phone", schema: "marketing", table: "camp_patients", column: "Phone");
            migrationBuilder.CreateIndex(name: "IX_camp_patients_CampId_Token", schema: "marketing", table: "camp_patients", columns: new[] { "CampId", "Token" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "camp_patients", schema: "marketing");
            migrationBuilder.DropTable(name: "health_camps", schema: "marketing");
        }
    }
}
