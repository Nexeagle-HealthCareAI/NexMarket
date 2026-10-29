using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Agent leave requests, dated partner notes, and a priority on each partner.</summary>
    public partial class AddLeaveAndContactNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "contact_notes",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    ContactClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ServerReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_contact_notes", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_contact_notes_ClientId",
                schema: "marketing",
                table: "contact_notes",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contact_notes_ContactClientId_CreatedAt",
                schema: "marketing",
                table: "contact_notes",
                columns: new[] { "ContactClientId", "CreatedAt" });

            migrationBuilder.CreateTable(
                name: "leave_requests",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedBy = table.Column<string>(type: "text", nullable: true),
                    DecisionNote = table.Column<string>(type: "text", nullable: true),
                    Days = table.Column<decimal>(type: "numeric(4,1)", precision: 4, scale: 1, nullable: false),
                    FollowUpsMoved = table.Column<int>(type: "integer", nullable: false),
                    FromDate = table.Column<DateOnly>(type: "date", nullable: false),
                    HalfDay = table.Column<bool>(type: "boolean", nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ToDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Type = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_leave_requests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_leave_requests_AgentId_FromDate",
                schema: "marketing",
                table: "leave_requests",
                columns: new[] { "AgentId", "FromDate" });

            migrationBuilder.CreateIndex(
                name: "IX_leave_requests_Status",
                schema: "marketing",
                table: "leave_requests",
                column: "Status");

            migrationBuilder.AddColumn<string>(
                name: "Priority",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "leave_requests",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "contact_notes",
                schema: "marketing");

            migrationBuilder.DropColumn(
                name: "Priority",
                schema: "marketing",
                table: "contacts");
        }
    }
}
