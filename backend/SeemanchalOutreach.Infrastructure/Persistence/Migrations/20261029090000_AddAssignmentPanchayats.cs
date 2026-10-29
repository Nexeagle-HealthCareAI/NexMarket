using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Lets a block be split between agents: an assignment can cover only some of the block's panchayats.
    /// Adds one nullable column; existing assignments keep covering their whole block.</summary>
    public partial class AddAssignmentPanchayats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PanchayatIdsJson",
                schema: "marketing",
                table: "block_assignments",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PanchayatIdsJson",
                schema: "marketing",
                table: "block_assignments");
        }
    }
}
