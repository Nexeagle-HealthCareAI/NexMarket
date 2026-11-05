using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Proof of payment for partner payments (UPI/bank screenshot or a cash handover photo with time and place), the agent asked to pay in cash, and the partner's confirmation of receipt. New optional columns only.</summary>
    public partial class AddPaymentProof : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "CashAgentId", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Method", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "ProofAt", schema: "marketing", table: "partner_payments", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ProofBy", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ProofKey", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ProofKind", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<double>(name: "ProofLat", schema: "marketing", table: "partner_payments", type: "double precision", nullable: true);
            migrationBuilder.AddColumn<double>(name: "ProofLng", schema: "marketing", table: "partner_payments", type: "double precision", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ProofMime", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "ReceivedConfirmedAt", schema: "marketing", table: "partner_payments", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ReceivedConfirmedBy", schema: "marketing", table: "partner_payments", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_partner_payments_CashAgentId", schema: "marketing", table: "partner_payments", column: "CashAgentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_partner_payments_CashAgentId", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "CashAgentId", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "Method", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofAt", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofBy", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofKey", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofKind", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofLat", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofLng", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ProofMime", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ReceivedConfirmedAt", schema: "marketing", table: "partner_payments");
            migrationBuilder.DropColumn(name: "ReceivedConfirmedBy", schema: "marketing", table: "partner_payments");
        }
    }
}
