using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBlockAssignments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "block_assignments",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    District = table.Column<string>(type: "text", nullable: false),
                    Block = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AssignedByAgentId = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    AssignedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_block_assignments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_block_assignments_AgentId_Status",
                schema: "marketing",
                table: "block_assignments",
                columns: new[] { "AgentId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "block_assignments",
                schema: "marketing");
        }
    }
}
