using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Attendance marked by hand on the CRM, and the days each person had the CRM or the app open.</summary>
    public partial class AddAttendanceMarks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "activity_days",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    FirstAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    On = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_activity_days", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_activity_days_AgentId_Date", schema: "marketing", table: "activity_days", columns: new[] { "AgentId", "Date" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_activity_days_Date", schema: "marketing", table: "activity_days", column: "Date");
            migrationBuilder.CreateTable(
                name: "attendance_marks",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    LeaveType = table.Column<string>(type: "text", nullable: true),
                    MarkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    MarkedBy = table.Column<string>(type: "text", nullable: false),
                    MarkedByName = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attendance_marks", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_attendance_marks_AgentId_Date", schema: "marketing", table: "attendance_marks", columns: new[] { "AgentId", "Date" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_attendance_marks_Date", schema: "marketing", table: "attendance_marks", column: "Date");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "activity_days", schema: "marketing");
            migrationBuilder.DropTable(name: "attendance_marks", schema: "marketing");
        }
    }
}
