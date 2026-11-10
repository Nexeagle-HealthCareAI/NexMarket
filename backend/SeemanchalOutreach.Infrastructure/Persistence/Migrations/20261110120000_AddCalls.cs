using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Voice and video calls from chat: one row per call, one per person invited. No audio or video is stored.</summary>
    public partial class AddCalls : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "call_sessions",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AnsweredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StartedBy = table.Column<string>(type: "text", nullable: false),
                    StartedByName = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ThreadId = table.Column<Guid>(type: "uuid", nullable: false),
                    Video = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_call_sessions", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_call_sessions_Status", schema: "marketing", table: "call_sessions", column: "Status");
            migrationBuilder.CreateIndex(name: "IX_call_sessions_ThreadId_StartedAt", schema: "marketing", table: "call_sessions", columns: new[] { "ThreadId", "StartedAt" });
            migrationBuilder.CreateTable(
                name: "call_participants",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CallId = table.Column<Guid>(type: "uuid", nullable: false),
                    Declined = table.Column<bool>(type: "boolean", nullable: false),
                    InvitedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LeftAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UserId = table.Column<string>(type: "text", nullable: false),
                    UserName = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_call_participants", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_call_participants_CallId_UserId", schema: "marketing", table: "call_participants", columns: new[] { "CallId", "UserId" }, unique: true);
            migrationBuilder.CreateIndex(name: "IX_call_participants_UserId", schema: "marketing", table: "call_participants", column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "call_participants", schema: "marketing");
            migrationBuilder.DropTable(name: "call_sessions", schema: "marketing");
        }
    }
}
