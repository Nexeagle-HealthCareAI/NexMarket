using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Tasks given to field agents from Block assignments. One new table; nothing existing changes.</summary>
    public partial class AddAgentTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_tasks",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    AiItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Block = table.Column<string>(type: "text", nullable: true),
                    ContactClientId = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Detail = table.Column<string>(type: "text", nullable: true),
                    District = table.Column<string>(type: "text", nullable: true),
                    DoneAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DoneNote = table.Column<string>(type: "text", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    PanchayatIdsJson = table.Column<string>(type: "text", nullable: true),
                    Priority = table.Column<string>(type: "text", nullable: false),
                    SeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_tasks", x => x.Id);
                });

            migrationBuilder.CreateIndex(name: "IX_agent_tasks_AgentId_Status", schema: "marketing", table: "agent_tasks", columns: new[] { "AgentId", "Status" });
            migrationBuilder.CreateIndex(name: "IX_agent_tasks_District_Block", schema: "marketing", table: "agent_tasks", columns: new[] { "District", "Block" });
            migrationBuilder.CreateIndex(name: "IX_agent_tasks_GroupId", schema: "marketing", table: "agent_tasks", column: "GroupId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "agent_tasks", schema: "marketing");
        }
    }
}
