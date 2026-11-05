using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Facebook and Instagram: messages, conversations and Lead Ads form submissions. Three new tables; nothing existing changes.</summary>
    public partial class AddSocial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ad_leads",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AdId = table.Column<string>(type: "text", nullable: true),
                    AdName = table.Column<string>(type: "text", nullable: true),
                    AdsetName = table.Column<string>(type: "text", nullable: true),
                    CampaignId = table.Column<string>(type: "text", nullable: true),
                    CampaignName = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    FieldsJson = table.Column<string>(type: "text", nullable: true),
                    FormId = table.Column<string>(type: "text", nullable: true),
                    FormName = table.Column<string>(type: "text", nullable: true),
                    IsOrganic = table.Column<bool>(type: "boolean", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: true),
                    LeadgenId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: true),
                    PageId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    Platform = table.Column<string>(type: "text", nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ad_leads", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_ad_leads_CampaignId", schema: "marketing", table: "ad_leads", column: "CampaignId");
            migrationBuilder.CreateIndex(name: "IX_ad_leads_LeadId", schema: "marketing", table: "ad_leads", column: "LeadId");
            migrationBuilder.CreateIndex(name: "IX_ad_leads_LeadgenId", schema: "marketing", table: "ad_leads", column: "LeadgenId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_ad_leads_ReceivedAt", schema: "marketing", table: "ad_leads", column: "ReceivedAt");
            migrationBuilder.CreateTable(
                name: "social_conversations",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignedTo = table.Column<string>(type: "text", nullable: true),
                    Channel = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExternalId = table.Column<string>(type: "text", nullable: false),
                    LastDirection = table.Column<string>(type: "text", nullable: true),
                    LastInboundAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastMessage = table.Column<string>(type: "text", nullable: true),
                    LastMessageAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    PageId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Unread = table.Column<int>(type: "integer", nullable: false),
                    Username = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_conversations", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_social_conversations_Channel_ExternalId", schema: "marketing", table: "social_conversations", columns: new[] { "Channel", "ExternalId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_social_conversations_LastMessageAt", schema: "marketing", table: "social_conversations", column: "LastMessageAt");
            migrationBuilder.CreateIndex(name: "IX_social_conversations_LeadId", schema: "marketing", table: "social_conversations", column: "LeadId");
            migrationBuilder.CreateTable(
                name: "social_messages",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Direction = table.Column<string>(type: "text", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    ExternalId = table.Column<string>(type: "text", nullable: true),
                    SentBy = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: true),
                    Type = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_social_messages", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_social_messages_ConversationId_CreatedAt", schema: "marketing", table: "social_messages", columns: new[] { "ConversationId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_social_messages_ExternalId", schema: "marketing", table: "social_messages", column: "ExternalId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "social_messages", schema: "marketing");
            migrationBuilder.DropTable(name: "social_conversations", schema: "marketing");
            migrationBuilder.DropTable(name: "ad_leads", schema: "marketing");
        }
    }
}
