using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Camp patients sent to the hospital go on the Referral desk (arrived, OPD, admitted, bills) like agents' referrals.
    /// Patients already referred from camps are added, with what their lead says about whether they came.
    /// </summary>
    public partial class AddCampReferrals : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "CampId", schema: "marketing", table: "referrals", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_referrals_CampId", schema: "marketing", table: "referrals", column: "CampId");
            migrationBuilder.Sql(@"
INSERT INTO marketing.referrals (""Id"", ""ClientId"", ""DeviceId"", ""ContactId"", ""AgentId"", ""PatientName"", ""Department"", ""Notes"", ""ClientPhone"",
    ""ReferralDate"", ""Status"", ""PatientAge"", ""PatientSex"", ""Urgent"", ""ArrivedAt"", ""AdmittedAt"", ""CreatedAt"", ""UpdatedAt"", ""ServerReceivedAt"", ""CampId"")
SELECT gen_random_uuid(), 'camp-' || p.""Id"", 'crm-camp', COALESCE(p.""PartnerClientId"", c.""HostPartnerClientId"", ''), '', p.""Name"", COALESCE(p.""Department"", ''),
    'From the health camp ' || c.""Title"" || COALESCE(': ' || p.""Complaint"", ''),
    CASE WHEN length(p.""Phone"") = 12 AND p.""Phone"" LIKE '91%' THEN substr(p.""Phone"", 3) ELSE p.""Phone"" END,
    p.""UpdatedAt"",
    CASE l.""Status"" WHEN 'admitted' THEN 'admitted' WHEN 'arrived' THEN 'arrived' WHEN 'lost' THEN 'lost' ELSE 'pending' END,
    p.""Age"", p.""Sex"", p.""Urgent"",
    CASE WHEN l.""Status"" IN ('arrived', 'admitted') THEN COALESCE(l.""ClosedAt"", l.""LastActivityAt"") END,
    CASE WHEN l.""Status"" = 'admitted' THEN COALESCE(l.""ClosedAt"", l.""LastActivityAt"") END,
    p.""UpdatedAt"", now(), now(), p.""CampId""
FROM marketing.camp_patients p
JOIN marketing.health_camps c ON c.""Id"" = p.""CampId""
LEFT JOIN marketing.leads l ON l.""Id"" = p.""LeadId""
WHERE p.""ReferToHospital"" AND p.""Status"" <> 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM marketing.referrals r WHERE r.""ClientId"" = 'camp-' || p.""Id"")
  AND (p.""LeadId"" IS NULL OR NOT EXISTS (SELECT 1 FROM marketing.referrals r WHERE r.""ClientId"" = 'lead-' || p.""LeadId""));");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DELETE FROM marketing.referrals WHERE ""DeviceId"" = 'crm-camp';");
            migrationBuilder.DropIndex(name: "IX_referrals_CampId", schema: "marketing", table: "referrals");
            migrationBuilder.DropColumn(name: "CampId", schema: "marketing", table: "referrals");
        }
    }
}
