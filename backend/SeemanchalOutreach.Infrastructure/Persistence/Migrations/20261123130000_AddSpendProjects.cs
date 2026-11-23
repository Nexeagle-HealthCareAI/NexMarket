using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SeemanchalOutreach.Infrastructure.Persistence.Migrations
{
    /// <summary>Marketing spend, more organised: the team's own kinds of spend (constant or variable), projects with funds received, constant payments, and money managers.</summary>
    public partial class AddSpendProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "ProjectId", schema: "marketing", table: "marketing_expenses", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "RecurringId", schema: "marketing", table: "marketing_expenses", type: "uuid", nullable: true);
            migrationBuilder.AddColumn<string>(name: "Period", schema: "marketing", table: "marketing_expenses", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "FromAgentId", schema: "marketing", table: "marketing_money_moves", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "FromAgentName", schema: "marketing", table: "marketing_money_moves", type: "text", nullable: true);
            migrationBuilder.AddColumn<Guid>(name: "ProjectId", schema: "marketing", table: "marketing_money_moves", type: "uuid", nullable: true);
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_ProjectId", schema: "marketing", table: "marketing_expenses", column: "ProjectId");
            migrationBuilder.CreateIndex(name: "IX_marketing_expenses_RecurringId_Period", schema: "marketing", table: "marketing_expenses", columns: new[] { "RecurringId", "Period" });
            migrationBuilder.CreateIndex(name: "IX_marketing_money_moves_FromAgentId", schema: "marketing", table: "marketing_money_moves", column: "FromAgentId");
            migrationBuilder.CreateTable(
                name: "spend_categories",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AgentCanUse = table.Column<bool>(type: "boolean", nullable: false),
                    Archived = table.Column<bool>(type: "boolean", nullable: false),
                    Color = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Key = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    Nature = table.Column<string>(type: "text", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spend_categories", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_spend_categories_Key", schema: "marketing", table: "spend_categories", column: "Key", unique: true);
            migrationBuilder.CreateTable(
                name: "spend_funds",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    CreatedByName = table.Column<string>(type: "text", nullable: false),
                    Mode = table.Column<string>(type: "text", nullable: true),
                    Note = table.Column<string>(type: "text", nullable: true),
                    On = table.Column<DateOnly>(type: "date", nullable: false),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReceivedBy = table.Column<string>(type: "text", nullable: true),
                    ReceivedByName = table.Column<string>(type: "text", nullable: true),
                    Removed = table.Column<bool>(type: "boolean", nullable: false),
                    Source = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spend_funds", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_spend_funds_On", schema: "marketing", table: "spend_funds", column: "On");
            migrationBuilder.CreateIndex(name: "IX_spend_funds_ProjectId", schema: "marketing", table: "spend_funds", column: "ProjectId");
            migrationBuilder.CreateTable(
                name: "spend_managers",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AddedBy = table.Column<string>(type: "text", nullable: false),
                    AgentId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spend_managers", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_spend_managers_AgentId", schema: "marketing", table: "spend_managers", column: "AgentId", unique: true);
            migrationBuilder.CreateTable(
                name: "spend_projects",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Budget = table.Column<decimal>(type: "numeric(12,2)", nullable: true),
                    Color = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    LeadId = table.Column<string>(type: "text", nullable: true),
                    LeadName = table.Column<string>(type: "text", nullable: true),
                    Name = table.Column<string>(type: "text", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spend_projects", x => x.Id);
                });
            migrationBuilder.CreateIndex(name: "IX_spend_projects_Status", schema: "marketing", table: "spend_projects", column: "Status");
            migrationBuilder.CreateTable(
                name: "spend_recurrings",
                schema: "marketing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    Category = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "text", nullable: false),
                    DueDay = table.Column<int>(type: "integer", nullable: false),
                    Every = table.Column<string>(type: "text", nullable: false),
                    ForAgentId = table.Column<string>(type: "text", nullable: true),
                    ForAgentName = table.Column<string>(type: "text", nullable: true),
                    FromMonth = table.Column<string>(type: "text", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true),
                    Payee = table.Column<string>(type: "text", nullable: true),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "text", nullable: false),
                    ToMonth = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_spend_recurrings", x => x.Id);
                });
            // The kinds of spend the page always had, now editable by the team. Salaries and room rent are constant costs.
            migrationBuilder.Sql(@"INSERT INTO marketing.spend_categories (""Id"", ""Key"", ""Label"", ""Nature"", ""Color"", ""Order"", ""AgentCanUse"", ""Archived"", ""CreatedBy"", ""CreatedAt"") VALUES
                (gen_random_uuid(), 'agents', 'Salaries', 'constant', '#0a72d6', 1, false, false, 'system', now()),
                (gen_random_uuid(), 'rent', 'Room rent', 'constant', '#0e7490', 2, true, false, 'system', now()),
                (gen_random_uuid(), 'food', 'Food', 'variable', '#d9822b', 3, true, false, 'system', now()),
                (gen_random_uuid(), 'petrol', 'Petrol', 'variable', '#7b3fe4', 4, true, false, 'system', now()),
                (gen_random_uuid(), 'stay', 'Stay', 'variable', '#b45309', 5, true, false, 'system', now()),
                (gen_random_uuid(), 'banner', 'Banners', 'variable', '#0f8a5f', 6, true, false, 'system', now()),
                (gen_random_uuid(), 'digital', 'Digital marketing', 'variable', '#c2185b', 7, true, false, 'system', now()),
                (gen_random_uuid(), 'other', 'Other', 'variable', '#6b7280', 99, true, false, 'system', now())
                ON CONFLICT (""Key"") DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "spend_categories", schema: "marketing");
            migrationBuilder.DropTable(name: "spend_funds", schema: "marketing");
            migrationBuilder.DropTable(name: "spend_managers", schema: "marketing");
            migrationBuilder.DropTable(name: "spend_projects", schema: "marketing");
            migrationBuilder.DropTable(name: "spend_recurrings", schema: "marketing");
            migrationBuilder.DropIndex(name: "IX_marketing_expenses_ProjectId", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropIndex(name: "IX_marketing_expenses_RecurringId_Period", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropIndex(name: "IX_marketing_money_moves_FromAgentId", schema: "marketing", table: "marketing_money_moves");
            migrationBuilder.DropColumn(name: "ProjectId", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "RecurringId", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "Period", schema: "marketing", table: "marketing_expenses");
            migrationBuilder.DropColumn(name: "FromAgentId", schema: "marketing", table: "marketing_money_moves");
            migrationBuilder.DropColumn(name: "FromAgentName", schema: "marketing", table: "marketing_money_moves");
            migrationBuilder.DropColumn(name: "ProjectId", schema: "marketing", table: "marketing_money_moves");
        }
    }
}
