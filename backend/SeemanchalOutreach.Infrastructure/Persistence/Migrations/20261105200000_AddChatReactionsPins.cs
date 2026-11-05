using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Chat: emoji reactions on messages and one pinned message per chat. Two new tables; nothing existing changes.</summary>
    public partial class AddChatReactionsPins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "chat_pins",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    PinnedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    PinnedBy = table.Column<string>(type: "text", nullable: false),
                    PinnedByName = table.Column<string>(type: "text", nullable: false),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chat_pins", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_chat_pins_ThreadId", schema: "marketing", table: "chat_pins", column: "ThreadId", unique: true);
            migrationBuilder.CreateTable(
                name: "chat_reactions",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Emoji = table.Column<string>(type: "text", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UserName = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chat_reactions", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_chat_reactions_ThreadId", schema: "marketing", table: "chat_reactions", column: "ThreadId");
            migrationBuilder.CreateIndex(name: "IX_chat_reactions_MessageId_UserId_Emoji", schema: "marketing", table: "chat_reactions", columns: new[] { "MessageId", "UserId", "Emoji" }, unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "chat_reactions", schema: "marketing");
            migrationBuilder.DropTable(name: "chat_pins", schema: "marketing");
        }
    }
}
