using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContactEngagementFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Complaints",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Conflicts",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Relation",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Complaints",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "Conflicts",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "Relation",
                schema: "marketing",
                table: "contacts");
        }
    }
}
