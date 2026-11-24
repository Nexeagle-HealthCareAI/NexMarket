using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>The hospital's own health cards: plans, cards, payments for them and visits made with them.</summary>
    public partial class AddHealthCards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "HealthCardId", schema: "marketing", table: "referrals", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_referrals_HealthCardId", schema: "marketing", table: "referrals", column: "HealthCardId");
            migrationBuilder.CreateTable(
                name: "health_cards",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Age = table.Column<int>(type: "integer", nullable: true),
                    AgentId = table.Column<string>(type: "text", nullable: true),
                    Block = table.Column<string>(type: "text", nullable: true),
                    CampId = table.Column<Guid>(type: "uuid", nullable: true),
                    CampPatientId = table.Column<Guid>(type: "uuid", nullable: true),
                    CancelReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    District = table.Column<string>(type: "text", nullable: true),
                    HolderName = table.Column<string>(type: "text", nullable: false),
                    IssuedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    MembersJson = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Number = table.Column<string>(type: "text", nullable: false),
                    PartnerClientId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    PlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    Renewals = table.Column<int>(type: "integer", nullable: false),
                    Sex = table.Column<string>(type: "text", nullable: true),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ValidTill = table.Column<DateOnly>(type: "date", nullable: false),
                    Village = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_health_cards", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_health_cards_CampId", schema: "marketing", table: "health_cards", column: "CampId");
            migrationBuilder.CreateIndex(name: "IX_health_cards_CampPatientId", schema: "marketing", table: "health_cards", column: "CampPatientId");
            migrationBuilder.CreateIndex(name: "IX_health_cards_IssuedOn", schema: "marketing", table: "health_cards", column: "IssuedOn");
            migrationBuilder.CreateIndex(name: "IX_health_cards_Number", schema: "marketing", table: "health_cards", column: "Number", unique: true);
            migrationBuilder.CreateIndex(name: "IX_health_cards_Phone", schema: "marketing", table: "health_cards", column: "Phone");
            migrationBuilder.CreateTable(
                name: "health_card_payments",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    By = table.Column<string>(type: "text", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Mode = table.Column<string>(type: "text", nullable: true),
                    On = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_health_card_payments", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_health_card_payments_CardId", schema: "marketing", table: "health_card_payments", column: "CardId");
            migrationBuilder.CreateIndex(name: "IX_health_card_payments_On", schema: "marketing", table: "health_card_payments", column: "On");
            migrationBuilder.CreateTable(
                name: "health_card_plans",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    Color = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Extras = table.Column<string>(type: "text", nullable: true),
                    FreeOpdVisits = table.Column<int>(type: "integer", nullable: false),
                    IpdDiscountPct = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    LabDiscountPct = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    MaxMembers = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    OpdDiscountPct = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    PharmacyDiscountPct = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    Price = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ValidMonths = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_health_card_plans", x => x.Id);
                });
            migrationBuilder.CreateTable(
                name: "health_card_uses",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BillAmount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    By = table.Column<string>(type: "text", nullable: false),
                    ByName = table.Column<string>(type: "text", nullable: false),
                    CardId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Discount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    FreeVisit = table.Column<bool>(type: "boolean", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    MemberName = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    On = table.Column<DateOnly>(type: "date", nullable: false),
                    ReferralClientId = table.Column<string>(type: "text", nullable: true),
                    Removed = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_health_card_uses", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_health_card_uses_CardId", schema: "marketing", table: "health_card_uses", column: "CardId");
            migrationBuilder.CreateIndex(name: "IX_health_card_uses_On", schema: "marketing", table: "health_card_uses", column: "On");
            migrationBuilder.CreateIndex(name: "IX_health_card_uses_ReferralClientId", schema: "marketing", table: "health_card_uses", column: "ReferralClientId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "health_cards", schema: "marketing");
            migrationBuilder.DropTable(name: "health_card_payments", schema: "marketing");
            migrationBuilder.DropTable(name: "health_card_plans", schema: "marketing");
            migrationBuilder.DropTable(name: "health_card_uses", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_referrals_HealthCardId", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "HealthCardId", schema: "marketing", table: "referrals");
        }
    }
}
