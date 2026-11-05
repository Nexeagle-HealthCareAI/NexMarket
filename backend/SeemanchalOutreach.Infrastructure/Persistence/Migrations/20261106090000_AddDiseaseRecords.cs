using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>The disease register: counts of people seen with a disease, by date, age group, gender and place. No names. One new table.</summary>
    public partial class AddDiseaseRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "disease_records",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgeBand = table.Column<string>(type: "text", nullable: false),
                    BatchId = table.Column<Guid>(type: "uuid", nullable: true),
                    Block = table.Column<string>(type: "text", nullable: true),
                    CampId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConditionCode = table.Column<string>(type: "text", nullable: true),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Disease = table.Column<string>(type: "text", nullable: false),
                    District = table.Column<string>(type: "text", nullable: true),
                    Panchayat = table.Column<string>(type: "text", nullable: true),
                    PanchayatId = table.Column<string>(type: "text", nullable: true),
                    RemovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RemovedBy = table.Column<string>(type: "text", nullable: true),
                    Sex = table.Column<string>(type: "text", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_disease_records", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_disease_records_BatchId", schema: "marketing", table: "disease_records", column: "BatchId");
            migrationBuilder.CreateIndex(name: "IX_disease_records_ConditionCode", schema: "marketing", table: "disease_records", column: "ConditionCode");
            migrationBuilder.CreateIndex(name: "IX_disease_records_Date", schema: "marketing", table: "disease_records", column: "Date");
            migrationBuilder.CreateIndex(name: "IX_disease_records_District_Block", schema: "marketing", table: "disease_records", columns: new[] { "District", "Block" });
            migrationBuilder.CreateIndex(name: "IX_disease_records_Status", schema: "marketing", table: "disease_records", column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "disease_records", schema: "marketing");
        }
    }
}
