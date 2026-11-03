using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Leads inbox and two-way WhatsApp: three new tables, and a referral code column on partners. Nothing existing changes.</summary>
    public partial class AddLeads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "ReferralCode", schema: "marketing", table: "contacts", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_contacts_ReferralCode", schema: "marketing", table: "contacts", column: "ReferralCode");
            migrationBuilder.CreateTable(
                name: "leads",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: true),
                    Department = table.Column<string>(type: "text", nullable: true),
                    FirstResponseAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastActivityAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastInboundAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastMessage = table.Column<string>(type: "text", nullable: true),
                    LostReason = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    OptOut = table.Column<bool>(type: "boolean", nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: true),
                    PartnerClientId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    SourceRef = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Unread = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_leads", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_leads_OwnerId", schema: "marketing", table: "leads", column: "OwnerId");
            migrationBuilder.CreateIndex(name: "IX_leads_PartnerClientId", schema: "marketing", table: "leads", column: "PartnerClientId");
            migrationBuilder.CreateIndex(name: "IX_leads_Phone", schema: "marketing", table: "leads", column: "Phone", unique: true);
            migrationBuilder.CreateIndex(name: "IX_leads_Status_LastActivityAt", schema: "marketing", table: "leads", columns: new[] { "Status", "LastActivityAt" });
            migrationBuilder.CreateTable(
                name: "lead_activities",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    By = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_lead_activities", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_lead_activities_LeadId_CreatedAt", schema: "marketing", table: "lead_activities", columns: new[] { "LeadId", "CreatedAt" });
            migrationBuilder.CreateTable(
                name: "wa_messages",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Direction = table.Column<string>(type: "text", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    SentBy = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false),
                    Type = table.Column<string>(type: "text", nullable: false),
                    WaMessageId = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wa_messages", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_wa_messages_LeadId", schema: "marketing", table: "wa_messages", column: "LeadId");
            migrationBuilder.CreateIndex(name: "IX_wa_messages_Phone_CreatedAt", schema: "marketing", table: "wa_messages", columns: new[] { "Phone", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_wa_messages_WaMessageId", schema: "marketing", table: "wa_messages", column: "WaMessageId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "leads", schema: "marketing");
            migrationBuilder.DropTable(name: "lead_activities", schema: "marketing");
            migrationBuilder.DropTable(name: "wa_messages", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_contacts_ReferralCode", schema: "marketing", table: "contacts");
            migrationBuilder.DropColumn(name: "ReferralCode", schema: "marketing", table: "contacts");
        }
    }
}
