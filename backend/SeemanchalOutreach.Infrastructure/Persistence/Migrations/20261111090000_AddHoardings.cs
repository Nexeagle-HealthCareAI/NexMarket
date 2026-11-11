using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Banner and hoarding places: suggested by agents, approved and rented by the office, with their owners and photos.</summary>
    public partial class AddHoardings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "hoardings",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Accuracy = table.Column<double>(type: "double precision", nullable: true),
                    AgentNote = table.Column<string>(type: "text", nullable: true),
                    Block = table.Column<string>(type: "text", nullable: true),
                    ClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecidedBy = table.Column<string>(type: "text", nullable: true),
                    District = table.Column<string>(type: "text", nullable: true),
                    EndedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Landmark = table.Column<string>(type: "text", nullable: true),
                    Lat = table.Column<double>(type: "double precision", nullable: false),
                    LiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Lng = table.Column<double>(type: "double precision", nullable: false),
                    MonthlyRent = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    OfficeNote = table.Column<string>(type: "text", nullable: true),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Place = table.Column<string>(type: "text", nullable: false),
                    RejectReason = table.Column<string>(type: "text", nullable: true),
                    RemindedFor = table.Column<DateOnly>(type: "date", nullable: true),
                    RentEnd = table.Column<DateOnly>(type: "date", nullable: true),
                    RentStart = table.Column<DateOnly>(type: "date", nullable: true),
                    RentedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Size = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    SuggestedBy = table.Column<string>(type: "text", nullable: false),
                    SuggestedByName = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hoardings", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_hoardings_ClientId", schema: "marketing", table: "hoardings", column: "ClientId", unique: true);
            migrationBuilder.CreateIndex(name: "IX_hoardings_OwnerId", schema: "marketing", table: "hoardings", column: "OwnerId");
            migrationBuilder.CreateIndex(name: "IX_hoardings_Status", schema: "marketing", table: "hoardings", column: "Status");
            migrationBuilder.CreateIndex(name: "IX_hoardings_SuggestedBy", schema: "marketing", table: "hoardings", column: "SuggestedBy");
            migrationBuilder.CreateTable(
                name: "hoarding_owners",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Address = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    Phone = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hoarding_owners", x => x.Id);
                });
            migrationBuilder.CreateTable(
                name: "hoarding_photos",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    By = table.Column<string>(type: "text", nullable: false),
                    FileKey = table.Column<string>(type: "text", nullable: false),
                    HoardingId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Mime = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hoarding_photos", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_hoarding_photos_HoardingId", schema: "marketing", table: "hoarding_photos", column: "HoardingId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "hoarding_photos", schema: "marketing");
            migrationBuilder.DropTable(name: "hoarding_owners", schema: "marketing");
            migrationBuilder.DropTable(name: "hoardings", schema: "marketing");
        }
    }
}
