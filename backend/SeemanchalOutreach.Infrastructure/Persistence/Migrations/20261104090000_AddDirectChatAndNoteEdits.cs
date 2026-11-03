using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Direct (one-to-one) chats between any two people, and agents editing their own visit comments
    /// from the app (the first wording is kept). Adds three nullable columns and one index; no data changes.
    /// </summary>
    public partial class AddDirectChatAndNoteEdits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name: "PeerId", schema: "marketing", table: "chat_threads", type: "text", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_chat_threads_PeerId", schema: "marketing", table: "chat_threads", column: "PeerId");
            migrationBuilder.AddColumn<DateTime>(name: "EditedAt", schema: "marketing", table: "contact_notes", type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<string>(name: "OriginalText", schema: "marketing", table: "contact_notes", type: "text", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_chat_threads_PeerId", schema: "marketing", table: "chat_threads");
            migrationBuilder.DropColumn(name: "PeerId", schema: "marketing", table: "chat_threads");
            migrationBuilder.DropColumn(name: "EditedAt", schema: "marketing", table: "contact_notes");
            migrationBuilder.DropColumn(name: "OriginalText", schema: "marketing", table: "contact_notes");
        }
    }
}
