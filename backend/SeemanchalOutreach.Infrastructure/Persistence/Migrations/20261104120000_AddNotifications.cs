using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Notifications: each person's inbox, their phones for push, and the kinds they turned off. Three new tables.</summary>
    public partial class AddNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "notifications",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Link = table.Column<string>(type: "text", nullable: true),
                    ReadAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RefId = table.Column<string>(type: "text", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notifications", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_notifications_UserId_CreatedAt", schema: "marketing", table: "notifications", columns: new[] { "UserId", "CreatedAt" });
            migrationBuilder.CreateIndex(name: "IX_notifications_UserId_ReadAt", schema: "marketing", table: "notifications", columns: new[] { "UserId", "ReadAt" });
            migrationBuilder.CreateTable(
                name: "notification_settings",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MutedKinds = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notification_settings", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_notification_settings_UserId", schema: "marketing", table: "notification_settings", column: "UserId", unique: true);
            migrationBuilder.CreateTable(
                name: "push_devices",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DeviceId = table.Column<string>(type: "text", nullable: true),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Platform = table.Column<string>(type: "text", nullable: false),
                    Token = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_push_devices", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_push_devices_Token", schema: "marketing", table: "push_devices", column: "Token", unique: true);
            migrationBuilder.CreateIndex(name: "IX_push_devices_UserId", schema: "marketing", table: "push_devices", column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "notifications", schema: "marketing");
            migrationBuilder.DropTable(name: "notification_settings", schema: "marketing");
            migrationBuilder.DropTable(name: "push_devices", schema: "marketing");
        }
    }
}
