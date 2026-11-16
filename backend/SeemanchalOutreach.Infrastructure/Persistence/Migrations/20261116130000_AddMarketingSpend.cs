using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Marketing spend: expenses by day and kind, and money given to or returned by each person.</summary>
    public partial class AddMarketingSpend : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "marketing_expenses",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: true),
                    AgentName = table.Column<string>(type: "text", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    BillKey = table.Column<string>(type: "text", nullable: true),
                    BillMime = table.Column<string>(type: "text", nullable: true),
                    Category = table.Column<string>(type: "text", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedBy = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    PaidBy = table.Column<string>(type: "text", nullable: false),
                    RejectReason = table.Column<string>(type: "text", nullable: true),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    SpentOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketing_expenses", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_AgentId", schema: "marketing", table: "marketing_expenses", column: "AgentId");
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_ClientId", schema: "marketing", table: "marketing_expenses", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_SpentOn", schema: "marketing", table: "marketing_expenses", column: "SpentOn");
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_Status", schema: "marketing", table: "marketing_expenses", column: "Status");
            migrationBuilder.CreateTable(
                name: "marketing_money_moves",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    AgentName = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Mode = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    On = table.Column<DateOnly>(type: "date", nullable: false),
                    Removed = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_marketing_money_moves", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_marketing_money_moves_AgentId", schema: "marketing", table: "marketing_money_moves", column: "AgentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "marketing_expenses", schema: "marketing");
            migrationBuilder.DropTable(name: "marketing_money_moves", schema: "marketing");
        }
    }
}
