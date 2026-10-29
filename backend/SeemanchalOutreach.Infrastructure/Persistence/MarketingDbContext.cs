using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Infrastructure.Persistence
{
    public class MarketingDbContext : DbContext, IMarketingDbContext
    {
        public MarketingDbContext(DbContextOptions<MarketingDbContext> options)
            : base(options)
        {
        }

        public DbSet<FieldAgent> Agents => Set<FieldAgent>();
        public DbSet<Panchayat> Panchayats => Set<Panchayat>();
        public DbSet<FieldShift> Shifts => Set<FieldShift>();
        public DbSet<FieldVisit> Visits => Set<FieldVisit>();
        public DbSet<OutreachContact> Contacts => Set<OutreachContact>();
        public DbSet<ContactHistoryEntry> ContactHistory => Set<ContactHistoryEntry>();
        public DbSet<PatientReferral> Referrals => Set<PatientReferral>();
        public DbSet<TrajectoryPoint> TrajectoryPoints => Set<TrajectoryPoint>();
        public DbSet<SurveyResponse> SurveyResponses => Set<SurveyResponse>();
        public DbSet<BlockAssignment> BlockAssignments => Set<BlockAssignment>();
        public DbSet<AgentRefreshToken> AgentRefreshTokens => Set<AgentRefreshToken>();
        public DbSet<SurveyQuestion> SurveyQuestions => Set<SurveyQuestion>();
        public DbSet<ContactDocument> ContactDocuments { get; set; } = null!;
        public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
        public DbSet<CallCycle> CallCycles => Set<CallCycle>();
        public DbSet<CallLog> CallLogs => Set<CallLog>();
        public DbSet<PartnerPayment> PartnerPayments => Set<PartnerPayment>();
        public DbSet<Department> Departments => Set<Department>();
        public DbSet<Doctor> Doctors => Set<Doctor>();
        public DbSet<ReferralStatusEntry> ReferralStatusEntries => Set<ReferralStatusEntry>();
        public DbSet<Broadcast> Broadcasts => Set<Broadcast>();
        public DbSet<BroadcastRecipient> BroadcastRecipients => Set<BroadcastRecipient>();
        public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
        public DbSet<ContactNote> ContactNotes => Set<ContactNote>();
        public DbSet<AiBriefing> AiBriefings => Set<AiBriefing>();
        public DbSet<AiItem> AiItems => Set<AiItem>();
        public DbSet<SurveyEdit> SurveyEdits => Set<SurveyEdit>();
        public DbSet<AgentTask> AgentTasks => Set<AgentTask>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Enable PostGIS extension
            modelBuilder.HasPostgresExtension("postgis");

            // Set default schema to 'marketing' as specified in system architecture spec
            modelBuilder.HasDefaultSchema("marketing");

            // ─── FieldAgent ──────────────────────────────────────────
            modelBuilder.Entity<FieldAgent>(entity =>
            {
                entity.ToTable("agents");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId).IsUnique();
                entity.HasIndex(e => e.Phone).IsUnique();
            });

            // ─── Panchayat ───────────────────────────────────────────
            modelBuilder.Entity<Panchayat>(entity =>
            {
                entity.ToTable("panchayats");
                entity.HasKey(e => e.PanchayatId);
                entity.HasIndex(e => new { e.District, e.Block });
                entity.HasIndex(e => e.LgdCode).IsUnique();
            });

            // ─── FieldShift ──────────────────────────────────────────
            // ClientId alone is the idempotency key — it's a client-generated UUID
            // meant to identify one specific record forever, regardless of which
            // device eventually syncs it. Keying uniqueness on (ClientId, DeviceId)
            // instead let a reinstall/new-phone/storage-eviction (which resets the
            // locally-persisted DeviceId) silently fork a second row under the same
            // ClientId the moment that device tried to update a record it already
            // owned. DeviceId is still recorded (which device created it) but no
            // longer part of the uniqueness constraint.
            modelBuilder.Entity<FieldShift>(entity =>
            {
                entity.ToTable("shifts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.AgentId);
            });

            // ─── FieldVisit ──────────────────────────────────────────
            modelBuilder.Entity<FieldVisit>(entity =>
            {
                entity.ToTable("visits");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.AgentId, e.PanchayatId });
            });

            // ─── OutreachContact ─────────────────────────────────────
            modelBuilder.Entity<OutreachContact>(entity =>
            {
                entity.ToTable("contacts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.PanchayatId, e.Phone });
                entity.HasIndex(e => new { e.PanchayatId, e.Name });
                entity.HasIndex(e => e.NextCallAt);
            });

            // ─── ContactHistoryEntry ─────────────────────────────────
            modelBuilder.Entity<ContactHistoryEntry>(entity =>
            {
                entity.ToTable("contact_history");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ContactClientId, e.Timestamp });
            });

            // ─── PatientReferral ─────────────────────────────────────
            modelBuilder.Entity<PatientReferral>(entity =>
            {
                entity.ToTable("referrals");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.ContactId);
            });

            // ─── TrajectoryPoint ─────────────────────────────────────
            modelBuilder.Entity<TrajectoryPoint>(entity =>
            {
                entity.ToTable("trajectory_points");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.AgentId, e.RecordedAt });
            });

            // ─── SurveyResponse ──────────────────────────────────────
            modelBuilder.Entity<SurveyResponse>(entity =>
            {
                entity.ToTable("survey_responses");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.PanchayatId);
            });

            // ─── BlockAssignment ─────────────────────────────────────
            modelBuilder.Entity<BlockAssignment>(entity =>
            {
                entity.ToTable("block_assignments");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Status });
            });

            // ─── AgentRefreshToken (one row per agent+device session) ──
            modelBuilder.Entity<AgentRefreshToken>(entity =>
            {
                entity.ToTable("agent_refresh_tokens");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.DeviceId }).IsUnique();
            });

            // ─── CRM: roles, calls, payments, departments, broadcasts ─
            modelBuilder.Entity<RolePermission>(entity =>
            {
                entity.ToTable("role_permissions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Role, e.PageKey }).IsUnique();
            });

            modelBuilder.Entity<CallCycle>(entity =>
            {
                entity.ToTable("call_cycles");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Number).IsUnique();
            });

            modelBuilder.Entity<CallLog>(entity =>
            {
                entity.ToTable("call_logs");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ContactClientId, e.CreatedAt });
                entity.HasIndex(e => new { e.CycleNumber, e.ContactClientId });
                entity.HasIndex(e => e.CreatedAt);
            });

            modelBuilder.Entity<PartnerPayment>(entity =>
            {
                entity.ToTable("partner_payments");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
                entity.HasIndex(e => e.ContactClientId);
                entity.HasIndex(e => e.Status);
            });

            modelBuilder.Entity<Department>(entity =>
            {
                entity.ToTable("departments");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Name).IsUnique();
            });

            modelBuilder.Entity<Doctor>(entity =>
            {
                entity.ToTable("doctors");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.DepartmentId);
            });

            modelBuilder.Entity<ReferralStatusEntry>(entity =>
            {
                entity.ToTable("referral_status_history");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ReferralClientId, e.ChangedAt });
            });

            modelBuilder.Entity<Broadcast>(entity =>
            {
                entity.ToTable("broadcasts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Status, e.ScheduledAt });
            });

            modelBuilder.Entity<BroadcastRecipient>(entity =>
            {
                entity.ToTable("broadcast_recipients");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.BroadcastId);
                entity.HasIndex(e => e.ProviderMessageId);
                entity.HasIndex(e => e.Phone);
            });

            modelBuilder.Entity<LeaveRequest>(entity =>
            {
                entity.ToTable("leave_requests");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Days).HasPrecision(4, 1);
                entity.HasIndex(e => new { e.AgentId, e.FromDate });
                entity.HasIndex(e => e.Status);
            });

            modelBuilder.Entity<ContactNote>(entity =>
            {
                entity.ToTable("contact_notes");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.ContactClientId, e.CreatedAt });
            });

            // ─── AI analyst ──────────────────────────────────────────
            modelBuilder.Entity<AiBriefing>(entity =>
            {
                entity.ToTable("ai_briefings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.CreatedAt);
            });
            modelBuilder.Entity<AiItem>(entity =>
            {
                entity.ToTable("ai_items");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Key).IsUnique();
                entity.HasIndex(e => new { e.Status, e.Kind });
            });
            modelBuilder.Entity<SurveyEdit>(entity =>
            {
                entity.ToTable("survey_edits");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ResponseId);
            });

            modelBuilder.Entity<AuditLog>(entity =>
            {
                entity.ToTable("audit_logs");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.At);
                entity.HasIndex(e => new { e.ActorId, e.At });
                entity.HasIndex(e => new { e.Entity, e.EntityId });
            });

            modelBuilder.Entity<AgentTask>(entity =>
            {
                entity.ToTable("agent_tasks");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Status });
                entity.HasIndex(e => new { e.District, e.Block });
                entity.HasIndex(e => e.GroupId);
            });

            // ─── SurveyQuestion ──────────────────────────────────────
            modelBuilder.Entity<SurveyQuestion>(entity =>
            {
                entity.ToTable("survey_questions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.QuestionId).IsUnique();
                entity.HasIndex(e => e.Order);
            });
        }
    }
}
