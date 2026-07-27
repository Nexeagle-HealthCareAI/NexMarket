using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddContactCrmFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "PanchayatId",
                schema: "marketing",
                table: "survey_responses",
                type: "text",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "ContactId",
                schema: "marketing",
                table: "survey_responses",
                type: "text",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "AgentId",
                schema: "marketing",
                table: "survey_responses",
                type: "text",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "Comments",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FollowUpDate",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Comments",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "FollowUpDate",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "Status",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.AlterColumn<Guid>(
                name: "PanchayatId",
                schema: "marketing",
                table: "survey_responses",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "ContactId",
                schema: "marketing",
                table: "survey_responses",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "AgentId",
                schema: "marketing",
                table: "survey_responses",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");
        }
    }
}
