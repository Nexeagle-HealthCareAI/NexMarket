using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Where the agent was when they logged a visit or revisit comment. New empty columns only.</summary>
    public partial class AddNoteLocation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(name: "AccuracyM", schema: "marketing", table: "contact_notes", type: "double precision", nullable: true);
            migrationBuilder.AddColumn<double>(name: "Lat", schema: "marketing", table: "contact_notes", type: "double precision", nullable: true);
            migrationBuilder.AddColumn<double>(name: "Lng", schema: "marketing", table: "contact_notes", type: "double precision", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "AccuracyM", schema: "marketing", table: "contact_notes");
            migrationBuilder.DropColumn(name: "Lat", schema: "marketing", table: "contact_notes");
            migrationBuilder.DropColumn(name: "Lng", schema: "marketing", table: "contact_notes");
        }
    }
}
