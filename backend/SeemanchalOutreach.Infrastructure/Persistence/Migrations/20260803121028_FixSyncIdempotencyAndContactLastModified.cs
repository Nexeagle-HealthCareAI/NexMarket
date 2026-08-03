using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FixSyncIdempotencyAndContactLastModified : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The old unique index was (ClientId, DeviceId), not ClientId alone, so a
            // reinstall/new-phone/storage-eviction (which resets the locally-persisted
            // DeviceId) could have already forked a duplicate row under an existing
            // ClientId before this fix. Collapsing to a single unique index on ClientId
            // would fail outright if any such duplicates are present — so dedupe first,
            // keeping the most recently server-received row per ClientId (arbitrary but
            // reasonable: it's the version the server saw last, and the app's general
            // last-write-wins-toward-the-server posture for these tables already leans
            // this direction elsewhere).
            string[] dedupTables = { "contacts", "visits", "shifts", "referrals", "survey_responses", "trajectory_points" };
            foreach (var table in dedupTables)
            {
                migrationBuilder.Sql($@"
                    DELETE FROM marketing.""{table}"" t
                    USING (
                        SELECT ""Id"", ROW_NUMBER() OVER (
                            PARTITION BY ""ClientId""
                            ORDER BY ""ServerReceivedAt"" DESC, ""Id"" DESC
                        ) AS rn
                        FROM marketing.""{table}""
                    ) ranked
                    WHERE t.""Id"" = ranked.""Id"" AND ranked.rn > 1;
                ");
            }

            migrationBuilder.DropIndex(
                name: "IX_visits_ClientId_DeviceId",
                schema: "marketing",
                table: "visits");

            migrationBuilder.DropIndex(
                name: "IX_trajectory_points_ClientId_DeviceId",
                schema: "marketing",
                table: "trajectory_points");

            migrationBuilder.DropIndex(
                name: "IX_survey_responses_ClientId_DeviceId",
                schema: "marketing",
                table: "survey_responses");

            migrationBuilder.DropIndex(
                name: "IX_shifts_ClientId_DeviceId",
                schema: "marketing",
                table: "shifts");

            migrationBuilder.DropIndex(
                name: "IX_referrals_ClientId_DeviceId",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropIndex(
                name: "IX_contacts_ClientId_DeviceId",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastModifiedAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // Backfill with something more meaningful than the year-1 column default —
            // ServerReceivedAt is the best available stand-in for "last touched" on
            // rows that predate this column.
            migrationBuilder.Sql(@"UPDATE marketing.""contacts"" SET ""LastModifiedAt"" = ""ServerReceivedAt"";");

            migrationBuilder.CreateIndex(
                name: "IX_visits_ClientId",
                schema: "marketing",
                table: "visits",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_trajectory_points_ClientId",
                schema: "marketing",
                table: "trajectory_points",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_responses_ClientId",
                schema: "marketing",
                table: "survey_responses",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shifts_ClientId",
                schema: "marketing",
                table: "shifts",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_referrals_ClientId",
                schema: "marketing",
                table: "referrals",
                column: "ClientId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contacts_ClientId",
                schema: "marketing",
                table: "contacts",
                column: "ClientId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_visits_ClientId",
                schema: "marketing",
                table: "visits");

            migrationBuilder.DropIndex(
                name: "IX_trajectory_points_ClientId",
                schema: "marketing",
                table: "trajectory_points");

            migrationBuilder.DropIndex(
                name: "IX_survey_responses_ClientId",
                schema: "marketing",
                table: "survey_responses");

            migrationBuilder.DropIndex(
                name: "IX_shifts_ClientId",
                schema: "marketing",
                table: "shifts");

            migrationBuilder.DropIndex(
                name: "IX_referrals_ClientId",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropIndex(
                name: "IX_contacts_ClientId",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "LastModifiedAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.CreateIndex(
                name: "IX_visits_ClientId_DeviceId",
                schema: "marketing",
                table: "visits",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_trajectory_points_ClientId_DeviceId",
                schema: "marketing",
                table: "trajectory_points",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_survey_responses_ClientId_DeviceId",
                schema: "marketing",
                table: "survey_responses",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_shifts_ClientId_DeviceId",
                schema: "marketing",
                table: "shifts",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_referrals_ClientId_DeviceId",
                schema: "marketing",
                table: "referrals",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_contacts_ClientId_DeviceId",
                schema: "marketing",
                table: "contacts",
                columns: new[] { "ClientId", "DeviceId" },
                unique: true);
        }
    }
}
