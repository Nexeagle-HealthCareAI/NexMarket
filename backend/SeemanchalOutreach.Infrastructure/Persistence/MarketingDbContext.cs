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
