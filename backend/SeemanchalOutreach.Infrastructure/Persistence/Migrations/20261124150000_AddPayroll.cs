using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Salaries by date of joining and days worked: joining and leaving days, pay basis, incentives and approved months.</summary>
    public partial class AddPayroll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(name: "JoinedOn", schema: "marketing", table: "marketing_staff", type: "date", nullable: true);
            migrationBuilder.AddColumn<DateOnly>(name: "LeftOn", schema: "marketing", table: "marketing_staff", type: "date", nullable: true);
            migrationBuilder.AddColumn<string>(name: "PayBasis", schema: "marketing", table: "marketing_staff", type: "text", nullable: false, defaultValue: "fixed");
            migrationBuilder.AddColumn<string>(name: "AttendanceFrom", schema: "marketing", table: "marketing_staff", type: "text", nullable: true);
            migrationBuilder.CreateTable(
                name: "salary_incentives",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AddedBy = table.Column<string>(type: "text", nullable: false),
                    AddedByName = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    Basis = table.Column<string>(type: "text", nullable: true),
                    Details = table.Column<string>(type: "text", nullable: true),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Month = table.Column<string>(type: "text", nullable: false),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    RemovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RemovedBy = table.Column<string>(type: "text", nullable: true),
                    SourceIds = table.Column<string>(type: "text", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_salary_incentives", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_salary_incentives_AgentId_Month", schema: "marketing", table: "salary_incentives", columns: new[] { "AgentId", "Month" });
            migrationBuilder.CreateTable(
                name: "salary_slips",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AbsentDays = table.Column<int>(type: "integer", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ApprovedBy = table.Column<string>(type: "text", nullable: false),
                    ApprovedByName = table.Column<string>(type: "text", nullable: false),
                    Basis = table.Column<string>(type: "text", nullable: false),
                    Earned = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    EmployedDays = table.Column<int>(type: "integer", nullable: false),
                    HalfDays = table.Column<int>(type: "integer", nullable: false),
                    Incentives = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    Month = table.Column<string>(type: "text", nullable: false),
                    MonthDays = table.Column<int>(type: "integer", nullable: false),
                    Net = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    OffDays = table.Column<int>(type: "integer", nullable: false),
                    PaidLeaveDays = table.Column<int>(type: "integer", nullable: false),
                    PayableDays = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    PresentDays = table.Column<decimal>(type: "numeric(5,1)", precision: 5, scale: 1, nullable: false),
                    Rate = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    UnpaidLeaveDays = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_salary_slips", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_salary_slips_AgentId_Month", schema: "marketing", table: "salary_slips", columns: new[] { "AgentId", "Month" }, unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "salary_incentives", schema: "marketing");
            migrationBuilder.DropTable(name: "salary_slips", schema: "marketing");
            migrationBuilder.DropColumn(name: "JoinedOn", schema: "marketing", table: "marketing_staff");
            migrationBuilder.DropColumn(name: "LeftOn", schema: "marketing", table: "marketing_staff");
            migrationBuilder.DropColumn(name: "PayBasis", schema: "marketing", table: "marketing_staff");
            migrationBuilder.DropColumn(name: "AttendanceFrom", schema: "marketing", table: "marketing_staff");
        }
    }
}
