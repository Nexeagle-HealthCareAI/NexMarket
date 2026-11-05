using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Money per referred patient: bills, agent incentives, and partner service payments linked to a patient. Two new tables and one new, optional column.</summary>
    public partial class AddPatientMoney : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "ReferralClientId", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_partner_payments_ReferralClientId", schema: "marketing", table: "partner_payments", column: "ReferralClientId");
            migrationBuilder.CreateTable(
                name: "agent_incentives",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApprovedBy = table.Column<string>(type: "text", nullable: true),
                    Auto = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    PaidAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PaidBy = table.Column<string>(type: "text", nullable: true),
                    PaymentReference = table.Column<string>(type: "text", nullable: true),
                    Reason = table.Column<string>(type: "text", nullable: false),
                    ReferralClientId = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_incentives", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_agent_incentives_AgentId", schema: "marketing", table: "agent_incentives", column: "AgentId");
            migrationBuilder.CreateIndex(name: "IX_agent_incentives_ReferralClientId", schema: "marketing", table: "agent_incentives", column: "ReferralClientId");
            migrationBuilder.CreateIndex(name: "IX_agent_incentives_Status", schema: "marketing", table: "agent_incentives", column: "Status");
            migrationBuilder.CreateTable(
                name: "referral_bills",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    BillNumber = table.Column<string>(type: "text", nullable: true),
                    BilledOn = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Collected = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    ReferralClientId = table.Column<string>(type: "text", nullable: false),
                    Scheme = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VoidReason = table.Column<string>(type: "text", nullable: true),
                    VoidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    VoidedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_referral_bills", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_referral_bills_BilledOn", schema: "marketing", table: "referral_bills", column: "BilledOn");
            migrationBuilder.CreateIndex(name: "IX_referral_bills_ReferralClientId", schema: "marketing", table: "referral_bills", column: "ReferralClientId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "agent_incentives", schema: "marketing");
            migrationBuilder.DropTable(name: "referral_bills", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_partner_payments_ReferralClientId", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ReferralClientId", schema: "marketing", table: "partner_payments");
        }
    }
}
