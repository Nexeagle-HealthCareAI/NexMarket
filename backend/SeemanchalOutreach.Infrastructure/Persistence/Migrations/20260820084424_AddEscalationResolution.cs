using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddEscalationResolution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AgentEscalationResolution",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsEscalationResolved",
                schema: "marketing",
                table: "contacts",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgentEscalationResolution",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "IsEscalationResolved",
                schema: "marketing",
                table: "contacts");
        }
    }
}
