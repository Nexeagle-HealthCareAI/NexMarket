using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Panchayat map: where each panchayat's location came from (census villages, the
    /// panchayat's own village, or only the block) and a pin an admin can place by hand;
    /// patient-flow champions marked on partners.
    /// </summary>
    public partial class AddPanchayatGeoAndChampions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LocationSource",
                schema: "marketing",
                table: "panchayats",
                type: "text",
                nullable: false,
                defaultValue: "block");

            migrationBuilder.AddColumn<double?>(
                name: "ManualLat",
                schema: "marketing",
                table: "panchayats",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double?>(
                name: "ManualLng",
                schema: "marketing",
                table: "panchayats",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<DateTime?>(
                name: "ManualSetAt",
                schema: "marketing",
                table: "panchayats",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManualSetBy",
                schema: "marketing",
                table: "panchayats",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChampionNote",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime?>(
                name: "ChampionSetAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ChampionSetBy",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsChampion",
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
                name: "LocationSource",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "ManualLat",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "ManualLng",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "ManualSetAt",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "ManualSetBy",
                schema: "marketing",
                table: "panchayats");

            migrationBuilder.DropColumn(
                name: "ChampionNote",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "ChampionSetAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "ChampionSetBy",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "IsChampion",
                schema: "marketing",
                table: "contacts");
        }
    }
}
