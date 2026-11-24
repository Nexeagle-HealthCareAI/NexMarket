using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Disease data: one person's readings as on the printed camp sheet (BP, sugar, weight, height, SpO2, pulse, temperature).</summary>
    public partial class AddDiseaseReadings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(name: "BpSystolic", schema: "marketing", table: "disease_records", type: "integer", nullable: true);
            migrationBuilder.AddColumn<int>(name: "BpDiastolic", schema: "marketing", table: "disease_records", type: "integer", nullable: true);
            migrationBuilder.AddColumn<int>(name: "Sugar", schema: "marketing", table: "disease_records", type: "integer", nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "WeightKg", schema: "marketing", table: "disease_records", type: "numeric(5,1)", nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "HeightCm", schema: "marketing", table: "disease_records", type: "numeric(5,1)", nullable: true);
            migrationBuilder.AddColumn<int>(name: "Spo2", schema: "marketing", table: "disease_records", type: "integer", nullable: true);
            migrationBuilder.AddColumn<int>(name: "Pulse", schema: "marketing", table: "disease_records", type: "integer", nullable: true);
            migrationBuilder.AddColumn<decimal>(name: "TempF", schema: "marketing", table: "disease_records", type: "numeric(4,1)", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "BpSystolic", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "BpDiastolic", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "Sugar", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "WeightKg", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "HeightCm", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "Spo2", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "Pulse", schema: "marketing", table: "disease_records");
            migrationBuilder.DropColumn(name: "TempF", schema: "marketing", table: "disease_records");
        }
    }
}
