using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// WhatsApp hub: one conversation per phone number (new table, filled from the messages already received), and
    /// on each message what sent it and the template values (new columns). Nothing is removed.
    /// </summary>
    public partial class AddWhatsAppHub : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "BroadcastId", schema: "marketing", table: "wa_messages", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ParamsJson", schema: "marketing", table: "wa_messages", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Source", schema: "marketing", table: "wa_messages", type: "text", nullable: false, defaultValue: "in");
            migrationBuilder.AddColumn<string>(name: "TemplateLanguage", schema: "marketing", table: "wa_messages", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "TemplateName", schema: "marketing", table: "wa_messages", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_wa_messages_BroadcastId", schema: "marketing", table: "wa_messages", column: "BroadcastId");
            migrationBuilder.CreateIndex(name: "IX_wa_messages_Direction_CreatedAt", schema: "marketing", table: "wa_messages", columns: new[] { "Direction", "CreatedAt" });
            migrationBuilder.Sql(@"UPDATE marketing.wa_messages SET ""Source"" = CASE WHEN ""Direction"" = 'in' THEN 'in' WHEN ""SentBy"" IS NULL THEN 'auto' ELSE 'lead' END;");

            migrationBuilder.CreateTable(
                name: "wa_conversations",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignedTo = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastDirection = table.Column<string>(type: "text", nullable: true),
                    LastInboundAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastMessage = table.Column<string>(type: "text", nullable: true),
                    LastMessageAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    OptOut = table.Column<bool>(type: "boolean", nullable: false),
                    PartnerClientId = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Unread = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wa_conversations", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_wa_conversations_AssignedTo", schema: "marketing", table: "wa_conversations", column: "AssignedTo");
            migrationBuilder.CreateIndex(name: "IX_wa_conversations_LastMessageAt", schema: "marketing", table: "wa_conversations", column: "LastMessageAt");
            migrationBuilder.CreateIndex(name: "IX_wa_conversations_Phone", schema: "marketing", table: "wa_conversations", column: "Phone", unique: true);

            // One conversation for each number that already has messages, linked to its lead.
            migrationBuilder.Sql(@"
INSERT INTO marketing.wa_conversations (""Id"", ""Phone"", ""Name"", ""LeadId"", ""AssignedTo"", ""Status"", ""Unread"", ""OptOut"", ""LastMessage"", ""LastDirection"", ""LastMessageAt"", ""LastInboundAt"", ""CreatedAt"")
SELECT gen_random_uuid(), m.""Phone"", COALESCE(MAX(l.""Name""), '+' || m.""Phone""), MAX(l.""Id""::text)::uuid, MAX(l.""OwnerId""), 'open',
       COALESCE(MAX(l.""Unread""), 0), COALESCE(BOOL_OR(l.""OptOut""), false), MAX(l.""LastMessage""), NULL,
       MAX(m.""CreatedAt""), MAX(CASE WHEN m.""Direction"" = 'in' THEN m.""CreatedAt"" END), MIN(m.""CreatedAt"")
FROM marketing.wa_messages m
LEFT JOIN marketing.leads l ON l.""Phone"" = m.""Phone""
GROUP BY m.""Phone"";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "wa_conversations", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_wa_messages_BroadcastId", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropIndex(name: "IX_wa_messages_Direction_CreatedAt", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropColumn(name: "BroadcastId", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropColumn(name: "ParamsJson", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropColumn(name: "Source", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropColumn(name: "TemplateLanguage", schema: "marketing", table: "wa_messages");
            migrationBuilder.DropColumn(name: "TemplateName", schema: "marketing", table: "wa_messages");
        }
    }
}
