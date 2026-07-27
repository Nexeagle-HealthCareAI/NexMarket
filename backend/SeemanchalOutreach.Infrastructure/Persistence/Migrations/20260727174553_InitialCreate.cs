using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "marketing");

            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "agents",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    District = table.Column<string>(type: "text", nullable: false),
                    Block = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "contacts",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    PanchayatId = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    WhatsappAdded = table.Column<bool>(type: "boolean", nullable: false),
                    CardGiven = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PotentialDuplicateOf = table.Column<string>(type: "text", nullable: true),
                    IsMerged = table.Column<bool>(type: "boolean", nullable: false),
                    MergedIntoClientId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contacts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "panchayats",
                schema: "marketing",
                columns: table => new
                {
                    PanchayatId = table.Column<string>(type: "text", nullable: false),
                    Block = table.Column<string>(type: "text", nullable: false),
                    District = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Population = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_panchayats", x => x.PanchayatId);
                });

            migrationBuilder.CreateTable(
                name: "referrals",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    ContactId = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    PatientName = table.Column<string>(type: "text", nullable: false),
                    Department = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_referrals", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "shifts",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    StartTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndTime = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StartLat = table.Column<double>(type: "double precision", nullable: false),
                    StartLng = table.Column<double>(type: "double precision", nullable: false),
                    EndLat = table.Column<double>(type: "double precision", nullable: true),
                    EndLng = table.Column<double>(type: "double precision", nullable: true),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_shifts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "trajectory_points",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Lat = table.Column<double>(type: "double precision", nullable: false),
                    Lng = table.Column<double>(type: "double precision", nullable: false),
                    RecordedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AccuracyM = table.Column<double>(type: "double precision", nullable: true),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_trajectory_points", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "visits",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    PanchayatId = table.Column<string>(type: "text", nullable: false),
                    CheckInAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CheckOutAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CheckInLat = table.Column<double>(type: "double precision", nullable: false),
                    CheckInLng = table.Column<double>(type: "double precision", nullable: false),
                    CheckOutLat = table.Column<double>(type: "double precision", nullable: true),
                    CheckOutLng = table.Column<double>(type: "double precision", nullable: true),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_visits", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agents_AgentId",
                schema: "marketing",
                table: "agents",
                column: "AgentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_agents_Phone",
                schema: "marketing",
                table: "agents",
                column: "Phone",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contacts_ClientId_DeviceId",
                schema: "marketing",
                table: "contacts",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contacts_PanchayatId_Name",
                schema: "marketing",
                table: "contacts",
                columns: new[] { "PanchayatId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_contacts_PanchayatId_Phone",
                schema: "marketing",
                table: "contacts",
                columns: new[] { "PanchayatId", "Phone" });

            migrationBuilder.CreateIndex(
                name: "IX_panchayats_District_Block",
                schema: "marketing",
                table: "panchayats",
                columns: new[] { "District", "Block" });

            migrationBuilder.CreateIndex(
                name: "IX_referrals_ClientId_DeviceId",
                schema: "marketing",
                table: "referrals",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_referrals_ContactId",
                schema: "marketing",
                table: "referrals",
                column: "ContactId");

            migrationBuilder.CreateIndex(
                name: "IX_shifts_AgentId",
                schema: "marketing",
                table: "shifts",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_shifts_ClientId_DeviceId",
                schema: "marketing",
                table: "shifts",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_trajectory_points_AgentId_RecordedAt",
                schema: "marketing",
                table: "trajectory_points",
                columns: new[] { "AgentId", "RecordedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_trajectory_points_ClientId_DeviceId",
                schema: "marketing",
                table: "trajectory_points",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_visits_AgentId_PanchayatId",
                schema: "marketing",
                table: "visits",
                columns: new[] { "AgentId", "PanchayatId" });

            migrationBuilder.CreateIndex(
                name: "IX_visits_ClientId_DeviceId",
                schema: "marketing",
                table: "visits",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agents",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "contacts",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "panchayats",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "referrals",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "shifts",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "trajectory_points",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "visits",
                schema: "marketing");
        }
    }
}
