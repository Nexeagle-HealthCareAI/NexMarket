using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>A health camp can belong to a Marketing spend project, so the project shows what its camps brought in.</summary>
    public partial class AddCampSpendProject : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "SpendProjectId", schema: "marketing", table: "health_camps", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_health_camps_SpendProjectId", schema: "marketing", table: "health_camps", column: "SpendProjectId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_health_camps_SpendProjectId", schema: "marketing", table: "health_camps");
            migrationBuilder.DropColumn(name: "SpendProjectId", schema: "marketing", table: "health_camps");
        }
    }
}
