using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The activity log (one new table) and device details on sign-in sessions (new empty columns).
    /// Nothing existing is changed or removed.
    /// </summary>
    public partial class AddAuditLogAndDeviceSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_logs",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    ActorId = table.Column<string>(type: "text", nullable: false),
                    ActorName = table.Column<string>(type: "text", nullable: true),
                    ActorRole = table.Column<string>(type: "text", nullable: true),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangesJson = table.Column<string>(type: "text", nullable: true),
                    DeviceId = table.Column<string>(type: "text", nullable: true),
                    DeviceType = table.Column<string>(type: "text", nullable: true),
                    Entity = table.Column<string>(type: "text", nullable: false),
                    EntityId = table.Column<string>(type: "text", nullable: true),
                    Ip = table.Column<string>(type: "text", nullable: true),
                    Request = table.Column<string>(type: "text", nullable: true),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_logs", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_audit_logs_At", schema: "marketing", table: "audit_logs", column: "At");
            migrationBuilder.CreateIndex(name: "IX_audit_logs_ActorId_At", schema: "marketing", table: "audit_logs", columns: new[] { "ActorId", "At" });
            migrationBuilder.CreateIndex(name: "IX_audit_logs_Entity_EntityId", schema: "marketing", table: "audit_logs", columns: new[] { "Entity", "EntityId" });

            migrationBuilder.AddColumn<string>(name: "DeviceType", schema: "marketing", table: "agent_refresh_tokens", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Ip", schema: "marketing", table: "agent_refresh_tokens", type: "text", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "LastSeenAt", schema: "marketing", table: "agent_refresh_tokens", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<DateTime>(name: "RevokedAt", schema: "marketing", table: "agent_refresh_tokens", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "RevokedReason", schema: "marketing", table: "agent_refresh_tokens", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "UserAgent", schema: "marketing", table: "agent_refresh_tokens", type: "text", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "audit_logs", schema: "marketing");
            migrationBuilder.DropColumn(name: "DeviceType", schema: "marketing", table: "agent_refresh_tokens");
            migrationBuilder.DropColumn(name: "Ip", schema: "marketing", table: "agent_refresh_tokens");
            migrationBuilder.DropColumn(name: "LastSeenAt", schema: "marketing", table: "agent_refresh_tokens");
            migrationBuilder.DropColumn(name: "RevokedAt", schema: "marketing", table: "agent_refresh_tokens");
            migrationBuilder.DropColumn(name: "RevokedReason", schema: "marketing", table: "agent_refresh_tokens");
            migrationBuilder.DropColumn(name: "UserAgent", schema: "marketing", table: "agent_refresh_tokens");
        }
    }
}
