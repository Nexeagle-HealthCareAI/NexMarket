using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Plans and documents: a Bin (deleted, can be put back) and uploaded files.</summary>
    public partial class AddDocBinAndFiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                schema: "marketing",
                table: "work_docs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeletedBy",
                schema: "marketing",
                table: "work_docs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FileKey",
                schema: "marketing",
                table: "work_docs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FileMime",
                schema: "marketing",
                table: "work_docs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FileName",
                schema: "marketing",
                table: "work_docs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "FileSize",
                schema: "marketing",
                table: "work_docs",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "DeletedAt", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "DeletedBy", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "FileKey", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "FileMime", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "FileName", schema: "marketing", table: "work_docs");
            migrationBuilder.DropColumn(name: "FileSize", schema: "marketing", table: "work_docs");
        }
    }
}
