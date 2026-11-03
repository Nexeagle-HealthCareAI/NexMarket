using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Chat between the office and field agents: three new tables. Nothing existing changes.</summary>
    public partial class AddChat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "chat_threads",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    LastMessageAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastPreview = table.Column<string>(type: "text", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chat_threads", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_chat_threads_AgentId", schema: "marketing", table: "chat_threads", column: "AgentId");

            migrationBuilder.CreateIndex(name: "IX_chat_threads_LastMessageAt", schema: "marketing", table: "chat_threads", column: "LastMessageAt");

            migrationBuilder.CreateTable(
                name: "chat_messages",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    ContactClientId = table.Column<string>(type: "text", nullable: true),
                    ContactName = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FileKey = table.Column<string>(type: "text", nullable: true),
                    FileMime = table.Column<string>(type: "text", nullable: true),
                    FileName = table.Column<string>(type: "text", nullable: true),
                    FileSize = table.Column<long>(type: "bigint", nullable: true),
                    FromOffice = table.Column<bool>(type: "boolean", nullable: false),
                    Lat = table.Column<double>(type: "double precision", nullable: true),
                    Lng = table.Column<double>(type: "double precision", nullable: true),
                    ReplyToId = table.Column<Guid>(type: "uuid", nullable: true),
                    SenderId = table.Column<string>(type: "text", nullable: false),
                    SenderName = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: true),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chat_messages", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_chat_messages_ClientId", schema: "marketing", table: "chat_messages", column: "ClientId", unique: true);

            migrationBuilder.CreateIndex(name: "IX_chat_messages_ContactClientId", schema: "marketing", table: "chat_messages", column: "ContactClientId");

            migrationBuilder.CreateIndex(name: "IX_chat_messages_ThreadId_CreatedAt", schema: "marketing", table: "chat_messages", columns: new[] { "ThreadId", "CreatedAt" });

            migrationBuilder.CreateTable(
                name: "chat_reads",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IsOffice = table.Column<bool>(type: "boolean", nullable: false),
                    LastReadAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chat_reads", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_chat_reads_ThreadId_UserId", schema: "marketing", table: "chat_reads", columns: new[] { "ThreadId", "UserId" }, unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "chat_threads", schema: "marketing");
            migrationBuilder.DropTable(name: "chat_messages", schema: "marketing");
            migrationBuilder.DropTable(name: "chat_reads", schema: "marketing");
        }
    }
}
