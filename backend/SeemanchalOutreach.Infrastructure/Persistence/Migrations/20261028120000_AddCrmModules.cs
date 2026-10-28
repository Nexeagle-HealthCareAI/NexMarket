using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// CRM modules: role page permissions, call cycles and call logs, partner payments,
    /// departments and doctors, referral stage history, WhatsApp broadcasts; call-tracking
    /// fields on contacts and patient/stage fields on referrals.
    /// </summary>
    public partial class AddCrmModules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "role_permissions",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Level = table.Column<int>(type: "integer", nullable: false),
                    PageKey = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_role_permissions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_role_permissions_Role_PageKey",
                schema: "marketing",
                table: "role_permissions",
                columns: new[] { "Role", "PageKey" },
                unique: true);

            migrationBuilder.CreateTable(
                name: "call_cycles",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EndDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_call_cycles", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_call_cycles_Number",
                schema: "marketing",
                table: "call_cycles",
                column: "Number",
                unique: true);

            migrationBuilder.CreateTable(
                name: "call_logs",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Attempt = table.Column<int>(type: "integer", nullable: false),
                    CallBackAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CalledBy = table.Column<string>(type: "text", nullable: false),
                    ContactClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Outcome = table.Column<string>(type: "text", nullable: false),
                    Responses = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_call_logs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_call_logs_CreatedAt",
                schema: "marketing",
                table: "call_logs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_call_logs_ContactClientId_CreatedAt",
                schema: "marketing",
                table: "call_logs",
                columns: new[] { "ContactClientId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_call_logs_CycleNumber_ContactClientId",
                schema: "marketing",
                table: "call_logs",
                columns: new[] { "CycleNumber", "ContactClientId" });

            migrationBuilder.CreateTable(
                name: "partner_payments",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApprovedBy = table.Column<string>(type: "text", nullable: true),
                    ContactClientId = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    PaidAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    PaidBy = table.Column<string>(type: "text", nullable: true),
                    PaymentReference = table.Column<string>(type: "text", nullable: true),
                    Period = table.Column<string>(type: "text", nullable: true),
                    Purpose = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_partner_payments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_partner_payments_ContactClientId",
                schema: "marketing",
                table: "partner_payments",
                column: "ContactClientId");

            migrationBuilder.CreateIndex(
                name: "IX_partner_payments_Status",
                schema: "marketing",
                table: "partner_payments",
                column: "Status");

            migrationBuilder.CreateTable(
                name: "departments",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_departments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_departments_Name",
                schema: "marketing",
                table: "departments",
                column: "Name",
                unique: true);

            migrationBuilder.CreateTable(
                name: "doctors",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    OpdDays = table.Column<string>(type: "text", nullable: true),
                    OpdTimings = table.Column<string>(type: "text", nullable: true),
                    Qualification = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_doctors", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_doctors_DepartmentId",
                schema: "marketing",
                table: "doctors",
                column: "DepartmentId");

            migrationBuilder.CreateTable(
                name: "referral_status_history",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangedBy = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    ReferralClientId = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_referral_status_history", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_referral_status_history_ReferralClientId_ChangedAt",
                schema: "marketing",
                table: "referral_status_history",
                columns: new[] { "ReferralClientId", "ChangedAt" });

            migrationBuilder.CreateTable(
                name: "broadcasts",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AudienceJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    DeliveredCount = table.Column<int>(type: "integer", nullable: false),
                    Error = table.Column<string>(type: "text", nullable: true),
                    FailedCount = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Language = table.Column<string>(type: "text", nullable: false),
                    ParamsJson = table.Column<string>(type: "text", nullable: false),
                    PreviewText = table.Column<string>(type: "text", nullable: false),
                    ReadCount = table.Column<int>(type: "integer", nullable: false),
                    RecipientCount = table.Column<int>(type: "integer", nullable: false),
                    ReplyCount = table.Column<int>(type: "integer", nullable: false),
                    ScheduledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentCount = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_broadcasts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_broadcasts_Status_ScheduledAt",
                schema: "marketing",
                table: "broadcasts",
                columns: new[] { "Status", "ScheduledAt" });

            migrationBuilder.CreateTable(
                name: "broadcast_recipients",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    BroadcastId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContactClientId = table.Column<string>(type: "text", nullable: false),
                    DeliveredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Error = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Phone = table.Column<string>(type: "text", nullable: false),
                    ProviderMessageId = table.Column<string>(type: "text", nullable: true),
                    ReadAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RepliedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_broadcast_recipients", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_broadcast_recipients_BroadcastId",
                schema: "marketing",
                table: "broadcast_recipients",
                column: "BroadcastId");

            migrationBuilder.CreateIndex(
                name: "IX_broadcast_recipients_Phone",
                schema: "marketing",
                table: "broadcast_recipients",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_broadcast_recipients_ProviderMessageId",
                schema: "marketing",
                table: "broadcast_recipients",
                column: "ProviderMessageId");

            migrationBuilder.AddColumn<int>(
                name: "CallAttempts",
                schema: "marketing",
                table: "contacts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int?>(
                name: "LastCallCycleNumber",
                schema: "marketing",
                table: "contacts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastCallOutcome",
                schema: "marketing",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime?>(
                name: "LastCalledAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime?>(
                name: "LastConnectedAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NeedsVisit",
                schema: "marketing",
                table: "contacts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime?>(
                name: "NextCallAt",
                schema: "marketing",
                table: "contacts",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PhoneInvalid",
                schema: "marketing",
                table: "contacts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "WhatsappOptOut",
                schema: "marketing",
                table: "contacts",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime?>(
                name: "AdmittedAt",
                schema: "marketing",
                table: "referrals",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime?>(
                name: "ArrivedAt",
                schema: "marketing",
                table: "referrals",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int?>(
                name: "PatientAge",
                schema: "marketing",
                table: "referrals",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PatientSex",
                schema: "marketing",
                table: "referrals",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "Urgent",
                schema: "marketing",
                table: "referrals",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Partners due for a call soonest are looked up by this on every queue load.
            migrationBuilder.CreateIndex(
                name: "IX_contacts_NextCallAt",
                schema: "marketing",
                table: "contacts",
                column: "NextCallAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_contacts_NextCallAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropTable(
                name: "broadcast_recipients",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "broadcasts",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "referral_status_history",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "doctors",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "departments",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "partner_payments",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "call_logs",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "call_cycles",
                schema: "marketing");

            migrationBuilder.DropTable(
                name: "role_permissions",
                schema: "marketing");

            migrationBuilder.DropColumn(
                name: "CallAttempts",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "LastCallCycleNumber",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "LastCallOutcome",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "LastCalledAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "LastConnectedAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "NeedsVisit",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "NextCallAt",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "PhoneInvalid",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "WhatsappOptOut",
                schema: "marketing",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "AdmittedAt",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropColumn(
                name: "ArrivedAt",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropColumn(
                name: "PatientAge",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropColumn(
                name: "PatientSex",
                schema: "marketing",
                table: "referrals");

            migrationBuilder.DropColumn(
                name: "Urgent",
                schema: "marketing",
                table: "referrals");
        }
    }
}
