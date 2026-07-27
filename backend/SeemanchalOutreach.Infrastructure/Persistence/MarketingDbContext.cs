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
        public DbSet<PatientReferral> Referrals => Set<PatientReferral>();
        public DbSet<TrajectoryPoint> TrajectoryPoints => Set<TrajectoryPoint>();
        public DbSet<SurveyResponse> SurveyResponses => Set<SurveyResponse>();

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

            // ─── FieldShift (composite unique key for offline idempotency) ──
            modelBuilder.Entity<FieldShift>(entity =>
            {
                entity.ToTable("shifts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => e.AgentId);
            });

            // ─── FieldVisit (composite unique key for offline idempotency) ──
            modelBuilder.Entity<FieldVisit>(entity =>
            {
                entity.ToTable("visits");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => new { e.AgentId, e.PanchayatId });
            });

            // ─── OutreachContact (composite unique key for offline idempotency)
            modelBuilder.Entity<OutreachContact>(entity =>
            {
                entity.ToTable("contacts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => new { e.PanchayatId, e.Phone });
                entity.HasIndex(e => new { e.PanchayatId, e.Name });
            });

            // ─── PatientReferral (composite unique key for offline idempotency)
            modelBuilder.Entity<PatientReferral>(entity =>
            {
                entity.ToTable("referrals");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => e.ContactId);
            });

            // ─── TrajectoryPoint (composite unique key for offline idempotency)
            modelBuilder.Entity<TrajectoryPoint>(entity =>
            {
                entity.ToTable("trajectory_points");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => new { e.AgentId, e.RecordedAt });
            });

            // ─── SurveyResponse (composite unique key for offline idempotency)
            modelBuilder.Entity<SurveyResponse>(entity =>
            {
                entity.ToTable("survey_responses");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ClientId, e.DeviceId }).IsUnique();
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.PanchayatId);
            });
        }
    }
}
