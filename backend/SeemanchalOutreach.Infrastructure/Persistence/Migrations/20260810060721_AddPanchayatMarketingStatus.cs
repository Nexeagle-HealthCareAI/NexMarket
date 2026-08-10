using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddPanchayatMarketingStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // EF doesn't infer a SQL default from the C# property initializer
            // (= true) — left as its own defaultValue: false, this would flip
            // every already-seeded/assigned panchayat to inactive-for-marketing
            // the moment this migration ran, instantly emptying every agent's
            // task list app-wide.
            migrationBuilder.AddColumn<bool>(
                name: "IsActiveForMarketing",
                schema: "marketing",
                table: "panchayats",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsActiveForMarketing",
                schema: "marketing",
                table: "panchayats");
        }
    }
}
