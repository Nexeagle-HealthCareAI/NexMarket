using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Meetings planned from a chat, with the transcript and notes of the ones that were listened to.</summary>
    public partial class AddMeetings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "meetings",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Agenda = table.Column<string>(type: "text", nullable: true),
                    AiNotes = table.Column<bool>(type: "boolean", nullable: false),
                    AudioSeconds = table.Column<double>(type: "double precision", nullable: false),
                    CallId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    DocId = table.Column<Guid>(type: "uuid", nullable: true),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Minutes = table.Column<int>(type: "integer", nullable: false),
                    NotesBy = table.Column<string>(type: "text", nullable: true),
                    NotesError = table.Column<string>(type: "text", nullable: true),
                    NotesStatus = table.Column<string>(type: "text", nullable: false),
                    NotesTries = table.Column<int>(type: "integer", nullable: false),
                    RemindedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StartsAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: true),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Transcript = table.Column<string>(type: "text", nullable: true),
                    Video = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_meetings", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_meetings_CallId", schema: "marketing", table: "meetings", column: "CallId");
            migrationBuilder.CreateIndex(name: "IX_meetings_Status_StartsAt", schema: "marketing", table: "meetings", columns: new[] { "Status", "StartsAt" });
            migrationBuilder.CreateIndex(name: "IX_meetings_ThreadId_StartsAt", schema: "marketing", table: "meetings", columns: new[] { "ThreadId", "StartsAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "meetings", schema: "marketing");
        }
    }
}
