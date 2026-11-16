using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>The marketing team's payroll (who is on it, salary from a month), and who an expense was spent on.</summary>
    public partial class AddMarketingSalaries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "ForAgentId", schema: "marketing", table: "marketing_expenses", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ForAgentName", schema: "marketing", table: "marketing_expenses", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "PayMode", schema: "marketing", table: "marketing_expenses", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "SalaryMonth", schema: "marketing", table: "marketing_expenses", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_ForAgentId", schema: "marketing", table: "marketing_expenses", column: "ForAgentId");
            migrationBuilder.CreateTable(
                name: "marketing_salary_rates",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    FromMonth = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketing_salary_rates", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_marketing_salary_rates_AgentId", schema: "marketing", table: "marketing_salary_rates", column: "AgentId");
            migrationBuilder.CreateTable(
                name: "marketing_staff",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    FromMonth = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    OnPayroll = table.Column<bool>(type: "boolean", nullable: false),
                    ToMonth = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketing_staff", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_marketing_staff_AgentId", schema: "marketing", table: "marketing_staff", column: "AgentId", unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "marketing_salary_rates", schema: "marketing");
            migrationBuilder.DropTable(name: "marketing_staff", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_marketing_expenses_ForAgentId", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "ForAgentId", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "ForAgentName", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "PayMode", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "SalaryMonth", schema: "marketing", table: "marketing_expenses");
        }
    }
}
