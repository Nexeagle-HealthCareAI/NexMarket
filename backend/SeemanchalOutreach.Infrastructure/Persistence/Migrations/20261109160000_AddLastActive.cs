using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>"Last seen" for chat: when each person last had the CRM or the app open, and on what. Two new columns on agents.</summary>
    public partial class AddLastActive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastActiveAt",
                schema: "marketing",
                table: "agents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastActiveOn",
                schema: "marketing",
                table: "agents",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "LastActiveAt", schema: "marketing", table: "agents");
            migrationBuilder.DropColumn(name: "LastActiveOn", schema: "marketing", table: "agents");
        }
    }
}
