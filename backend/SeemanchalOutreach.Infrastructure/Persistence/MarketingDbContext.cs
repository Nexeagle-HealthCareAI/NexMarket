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
        public DbSet<PatientReading> PatientReadings => Set<PatientReading>();
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
        public DbSet<ReferralBill> ReferralBills => Set<ReferralBill>();
        public DbSet<DiseaseRecord> DiseaseRecords => Set<DiseaseRecord>();
        public DbSet<SocialPost> SocialPosts => Set<SocialPost>();
        public DbSet<ChannelMetric> ChannelMetrics => Set<ChannelMetric>();
        public DbSet<GoogleReview> GoogleReviews => Set<GoogleReview>();
        public DbSet<FieldSurvey> FieldSurveys => Set<FieldSurvey>();
        public DbSet<FieldSurveyAssignee> FieldSurveyAssignees => Set<FieldSurveyAssignee>();
        public DbSet<FieldSurveyTrack> FieldSurveyTracks => Set<FieldSurveyTrack>();
        public DbSet<FieldSurveySpot> FieldSurveySpots => Set<FieldSurveySpot>();
        public DbSet<WorkCard> WorkCards => Set<WorkCard>();
        public DbSet<WorkNote> WorkNotes => Set<WorkNote>();
        public DbSet<WorkSprint> WorkSprints => Set<WorkSprint>();
        public DbSet<WorkCardLink> WorkCardLinks => Set<WorkCardLink>();
        public DbSet<WorkCardDoc> WorkCardDocs => Set<WorkCardDoc>();
        public DbSet<WorkLog> WorkLogs => Set<WorkLog>();
        public DbSet<WorkDoc> WorkDocs => Set<WorkDoc>();
        public DbSet<WorkDocRevision> WorkDocRevisions => Set<WorkDocRevision>();
        public DbSet<WorkDocFolder> WorkDocFolders => Set<WorkDocFolder>();
        public DbSet<WorkDocShare> WorkDocShares => Set<WorkDocShare>();
        public DbSet<WorkDocComment> WorkDocComments => Set<WorkDocComment>();
        public DbSet<WorkDocStar> WorkDocStars => Set<WorkDocStar>();
        public DbSet<AgentIncentive> AgentIncentives => Set<AgentIncentive>();
        public DbSet<Department> Departments => Set<Department>();
        public DbSet<Doctor> Doctors => Set<Doctor>();
        public DbSet<ReferralStatusEntry> ReferralStatusEntries => Set<ReferralStatusEntry>();
        public DbSet<Broadcast> Broadcasts => Set<Broadcast>();
        public DbSet<BroadcastRecipient> BroadcastRecipients => Set<BroadcastRecipient>();
        public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
        public DbSet<AttendanceMark> AttendanceMarks => Set<AttendanceMark>();
        public DbSet<ActivityDay> ActivityDays => Set<ActivityDay>();
        public DbSet<ContactNote> ContactNotes => Set<ContactNote>();
        public DbSet<AiBriefing> AiBriefings => Set<AiBriefing>();
        public DbSet<AiItem> AiItems => Set<AiItem>();
        public DbSet<SurveyEdit> SurveyEdits => Set<SurveyEdit>();
        public DbSet<AgentTask> AgentTasks => Set<AgentTask>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
        public DbSet<ChatThread> ChatThreads => Set<ChatThread>();
        public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
        public DbSet<ChatRead> ChatReads => Set<ChatRead>();
        public DbSet<CallSession> CallSessions => Set<CallSession>();
        public DbSet<Meeting> Meetings => Set<Meeting>();
        public DbSet<CallParticipant> CallParticipants => Set<CallParticipant>();
        public DbSet<Hoarding> Hoardings => Set<Hoarding>();
        public DbSet<HoardingOwner> HoardingOwners => Set<HoardingOwner>();
        public DbSet<HoardingPhoto> HoardingPhotos => Set<HoardingPhoto>();
        public DbSet<MarketingExpense> MarketingExpenses => Set<MarketingExpense>();
        public DbSet<MarketingMoneyMove> MarketingMoneyMoves => Set<MarketingMoneyMove>();
        public DbSet<SpendCategory> SpendCategories => Set<SpendCategory>();
        public DbSet<SpendProject> SpendProjects => Set<SpendProject>();
        public DbSet<SpendFund> SpendFunds => Set<SpendFund>();
        public DbSet<SpendRecurring> SpendRecurrings => Set<SpendRecurring>();
        public DbSet<SpendManager> SpendManagers => Set<SpendManager>();
        public DbSet<MarketingStaff> MarketingStaff => Set<MarketingStaff>();
        public DbSet<MarketingSalaryRate> MarketingSalaryRates => Set<MarketingSalaryRate>();
        public DbSet<SalaryIncentive> SalaryIncentives => Set<SalaryIncentive>();
        public DbSet<SalarySlip> SalarySlips => Set<SalarySlip>();
        public DbSet<HealthCardPlan> HealthCardPlans => Set<HealthCardPlan>();
        public DbSet<HealthCard> HealthCards => Set<HealthCard>();
        public DbSet<HealthCardPayment> HealthCardPayments => Set<HealthCardPayment>();
        public DbSet<HealthCardUse> HealthCardUses => Set<HealthCardUse>();
        public DbSet<SiteContent> SiteContents => Set<SiteContent>();
        public DbSet<SiteContentVersion> SiteContentVersions => Set<SiteContentVersion>();
        public DbSet<SitePublish> SitePublishes => Set<SitePublish>();
        public DbSet<SiteMedia> SiteMedia => Set<SiteMedia>();
        public DbSet<SiteEvent> SiteEvents => Set<SiteEvent>();
        public DbSet<SiteApiKey> SiteApiKeys => Set<SiteApiKey>();
        public DbSet<SiteWebhookDelivery> SiteWebhookDeliveries => Set<SiteWebhookDelivery>();
        public DbSet<Organisation> Organisations => Set<Organisation>();
        public DbSet<ChatReaction> ChatReactions => Set<ChatReaction>();
        public DbSet<ChatPin> ChatPins => Set<ChatPin>();
        public DbSet<FieldRole> FieldRoles => Set<FieldRole>();
        public DbSet<Notification> Notifications => Set<Notification>();
        public DbSet<PushDevice> PushDevices => Set<PushDevice>();
        public DbSet<NotificationSetting> NotificationSettings => Set<NotificationSetting>();
        public DbSet<Lead> Leads => Set<Lead>();
        public DbSet<LeadActivity> LeadActivities => Set<LeadActivity>();
        public DbSet<WaMessage> WaMessages => Set<WaMessage>();
        public DbSet<AppSetting> AppSettings => Set<AppSetting>();
        public DbSet<WaConversation> WaConversations => Set<WaConversation>();
        public DbSet<HealthCamp> HealthCamps => Set<HealthCamp>();
        public DbSet<CampPatient> CampPatients => Set<CampPatient>();
        public DbSet<SocialConversation> SocialConversations => Set<SocialConversation>();
        public DbSet<SocialMessage> SocialMessages => Set<SocialMessage>();
        public DbSet<AdLead> AdLeads => Set<AdLead>();
        public DbSet<TrackedLink> TrackedLinks => Set<TrackedLink>();
        public DbSet<LeadTouch> LeadTouches => Set<LeadTouch>();
        public DbSet<KwTopic> KwTopics => Set<KwTopic>();
        public DbSet<KwKeyword> KwKeywords => Set<KwKeyword>();
        public DbSet<KwAreaVolume> KwAreaVolumes => Set<KwAreaVolume>();
        public DbSet<KwAction> KwActions => Set<KwAction>();

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
                entity.HasIndex(e => e.ReferralCode);
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
                entity.HasIndex(e => e.CampId);
                entity.HasIndex(e => e.HealthCardId);
                entity.HasIndex(e => e.PanchayatId);
            });
            modelBuilder.Entity<PatientReading>(entity =>
            {
                entity.ToTable("patient_readings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.ReferralClientId);
                entity.HasIndex(e => new { e.AgentId, e.TakenAt });
                entity.Property(e => e.TempF).HasPrecision(5, 1);
                entity.Property(e => e.WeightKg).HasPrecision(6, 2);
                entity.Property(e => e.HeightCm).HasPrecision(6, 1);
                entity.Property(e => e.Hba1c).HasPrecision(4, 1);
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
                entity.HasIndex(e => e.ReferralClientId);
                entity.HasIndex(e => e.CashAgentId);
            });
            modelBuilder.Entity<SocialPost>(entity =>
            {
                entity.ToTable("social_posts");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Channel, e.ExternalId }).IsUnique();
                entity.HasIndex(e => e.PostedAt);
            });
            modelBuilder.Entity<ChannelMetric>(entity =>
            {
                entity.ToTable("channel_metrics");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Value).HasPrecision(18, 4);
                entity.HasIndex(e => new { e.Source, e.Account, e.Date, e.Dimension, e.Metric }).IsUnique();
                entity.HasIndex(e => e.Date);
            });
            modelBuilder.Entity<GoogleReview>(entity =>
            {
                entity.ToTable("google_reviews");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ReviewName).IsUnique();
                entity.HasIndex(e => e.PostedAt);
            });
            modelBuilder.Entity<FieldSurvey>(entity =>
            {
                entity.ToTable("field_surveys");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Status);
            });
            modelBuilder.Entity<FieldSurveyAssignee>(entity =>
            {
                entity.ToTable("field_survey_assignees");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.SurveyId, e.AgentId }).IsUnique();
                entity.HasIndex(e => e.AgentId);
            });
            modelBuilder.Entity<FieldSurveyTrack>(entity =>
            {
                entity.ToTable("field_survey_tracks");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.SurveyId, e.AgentId });
            });
            modelBuilder.Entity<FieldSurveySpot>(entity =>
            {
                entity.ToTable("field_survey_spots");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.SurveyId, e.AgentId });
            });
            modelBuilder.Entity<WorkCard>(entity =>
            {
                entity.ToTable("work_cards");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Number).IsUnique();
                entity.HasIndex(e => new { e.Archived, e.Status });
                entity.HasIndex(e => e.ParentId);
                entity.HasIndex(e => e.SprintId);
            });
            modelBuilder.Entity<WorkSprint>(entity =>
            {
                entity.ToTable("work_sprints");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Status);
            });
            modelBuilder.Entity<WorkCardLink>(entity =>
            {
                entity.ToTable("work_card_links");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.FromId);
                entity.HasIndex(e => e.ToId);
            });
            modelBuilder.Entity<WorkCardDoc>(entity =>
            {
                entity.ToTable("work_card_docs");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.CardId, e.DocId }).IsUnique();
                entity.HasIndex(e => e.DocId);
            });
            modelBuilder.Entity<WorkLog>(entity =>
            {
                entity.ToTable("work_logs");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.CardId, e.Day });
            });
            modelBuilder.Entity<WorkNote>(entity =>
            {
                entity.ToTable("work_notes");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.CardId, e.CreatedAt });
            });
            modelBuilder.Entity<WorkDoc>(entity =>
            {
                entity.ToTable("work_docs");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Archived, e.UpdatedAt });
                entity.HasIndex(e => e.CardId);
                entity.HasIndex(e => e.FolderId);
                entity.Property(e => e.Version).IsConcurrencyToken();
            });
            modelBuilder.Entity<WorkDocFolder>(entity =>
            {
                entity.ToTable("work_doc_folders");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ParentId);
            });
            modelBuilder.Entity<WorkDocShare>(entity =>
            {
                entity.ToTable("work_doc_shares");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.DocId);
                entity.HasIndex(e => e.FolderId);
                entity.HasIndex(e => e.AgentId);
            });
            modelBuilder.Entity<WorkDocComment>(entity =>
            {
                entity.ToTable("work_doc_comments");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.DocId, e.CreatedAt });
            });
            modelBuilder.Entity<WorkDocStar>(entity =>
            {
                entity.ToTable("work_doc_stars");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.DocId }).IsUnique();
            });
            modelBuilder.Entity<WorkDocRevision>(entity =>
            {
                entity.ToTable("work_doc_revisions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.DocId, e.Version });
            });
            modelBuilder.Entity<DiseaseRecord>(entity =>
            {
                entity.ToTable("disease_records");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.WeightKg).HasPrecision(5, 1);
                entity.Property(e => e.HeightCm).HasPrecision(5, 1);
                entity.Property(e => e.TempF).HasPrecision(4, 1);
                entity.HasIndex(e => e.Date);
                entity.HasIndex(e => new { e.District, e.Block });
                entity.HasIndex(e => e.ConditionCode);
                entity.HasIndex(e => e.Status);
                entity.HasIndex(e => e.BatchId);
            });
            modelBuilder.Entity<ReferralBill>(entity =>
            {
                entity.ToTable("referral_bills");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
                entity.Property(e => e.Collected).HasPrecision(12, 2);
                entity.HasIndex(e => e.ReferralClientId);
                entity.HasIndex(e => e.BilledOn);
            });
            modelBuilder.Entity<AgentIncentive>(entity =>
            {
                entity.ToTable("agent_incentives");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.ReferralClientId);
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

            modelBuilder.Entity<AttendanceMark>(entity =>
            {
                entity.ToTable("attendance_marks");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Date }).IsUnique();
                entity.HasIndex(e => e.Date);
            });

            modelBuilder.Entity<ActivityDay>(entity =>
            {
                entity.ToTable("activity_days");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Date }).IsUnique();
                entity.HasIndex(e => e.Date);
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

            modelBuilder.Entity<FieldRole>(entity =>
            {
                entity.ToTable("field_roles");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Name).IsUnique();
            });
            modelBuilder.Entity<Notification>(entity =>
            {
                entity.ToTable("notifications");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.UserId, e.CreatedAt });
                entity.HasIndex(e => new { e.UserId, e.ReadAt });
            });
            modelBuilder.Entity<PushDevice>(entity =>
            {
                entity.ToTable("push_devices");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Token).IsUnique();
                entity.HasIndex(e => e.UserId);
            });
            modelBuilder.Entity<AppSetting>(entity =>
            {
                entity.ToTable("app_settings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Key).IsUnique();
            });
            modelBuilder.Entity<Lead>(entity =>
            {
                entity.ToTable("leads");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Phone).IsUnique();
                entity.HasIndex(e => new { e.Status, e.LastActivityAt });
                entity.HasIndex(e => e.OwnerId);
                entity.HasIndex(e => e.PartnerClientId);
            });
            modelBuilder.Entity<LeadActivity>(entity =>
            {
                entity.ToTable("lead_activities");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.LeadId, e.CreatedAt });
            });
            modelBuilder.Entity<WaMessage>(entity =>
            {
                entity.ToTable("wa_messages");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Phone, e.CreatedAt });
                entity.HasIndex(e => e.WaMessageId);
                entity.HasIndex(e => e.LeadId);
                entity.HasIndex(e => new { e.Direction, e.CreatedAt });
                entity.HasIndex(e => e.BroadcastId);
            });
            modelBuilder.Entity<HealthCamp>(entity =>
            {
                entity.ToTable("health_camps");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Code).IsUnique();
                entity.HasIndex(e => e.Date);
                entity.HasIndex(e => e.SpendProjectId);
                entity.Property(e => e.Budget).HasPrecision(12, 2);
                entity.Property(e => e.Spent).HasPrecision(12, 2);
            });
            modelBuilder.Entity<CampPatient>(entity =>
            {
                entity.ToTable("camp_patients");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.CampId, e.Token });
                entity.HasIndex(e => e.Phone);
                entity.HasIndex(e => e.LeadId);
                entity.Property(e => e.WeightKg).HasPrecision(5, 1);
                entity.Property(e => e.TempF).HasPrecision(5, 1);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.CreatedBy);
            });
            modelBuilder.Entity<SocialConversation>(entity =>
            {
                entity.ToTable("social_conversations");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Channel, e.ExternalId }).IsUnique();
                entity.HasIndex(e => e.LastMessageAt);
                entity.HasIndex(e => e.LeadId);
            });
            modelBuilder.Entity<SocialMessage>(entity =>
            {
                entity.ToTable("social_messages");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ConversationId, e.CreatedAt });
                entity.HasIndex(e => e.ExternalId);
            });
            modelBuilder.Entity<AdLead>(entity =>
            {
                entity.ToTable("ad_leads");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.LeadgenId).IsUnique();
                entity.HasIndex(e => e.CampaignId);
                entity.HasIndex(e => e.ReceivedAt);
                entity.HasIndex(e => e.LeadId);
            });

            modelBuilder.Entity<TrackedLink>(entity =>
            {
                entity.ToTable("tracked_links");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Code).IsUnique();
                entity.HasIndex(e => e.AdId);
                entity.HasIndex(e => e.MediaId);
            });
            modelBuilder.Entity<LeadTouch>(entity =>
            {
                entity.ToTable("lead_touches");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.LeadId);
                entity.HasIndex(e => e.LinkId);
                entity.HasIndex(e => e.BroadcastId);
                entity.HasIndex(e => e.At);
            });
            modelBuilder.Entity<KwTopic>(entity =>
            {
                entity.ToTable("kw_topics");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Name).IsUnique();
                entity.HasIndex(e => e.Score);
            });
            modelBuilder.Entity<KwKeyword>(entity =>
            {
                entity.ToTable("kw_keywords");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Text).IsUnique();
                entity.HasIndex(e => e.TopicId);
            });
            modelBuilder.Entity<KwAreaVolume>(entity =>
            {
                entity.ToTable("kw_area_volumes");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.KeywordId, e.District }).IsUnique();
            });
            modelBuilder.Entity<KwAction>(entity =>
            {
                entity.ToTable("kw_actions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.TopicId);
                entity.HasIndex(e => e.LinkCode);
            });
            modelBuilder.Entity<WaConversation>(entity =>
            {
                entity.ToTable("wa_conversations");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Phone).IsUnique();
                entity.HasIndex(e => e.LastMessageAt);
                entity.HasIndex(e => e.AssignedTo);
            });
            modelBuilder.Entity<NotificationSetting>(entity =>
            {
                entity.ToTable("notification_settings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.UserId).IsUnique();
            });
            modelBuilder.Entity<ChatThread>(entity =>
            {
                entity.ToTable("chat_threads");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.PeerId);
                entity.HasIndex(e => e.LastMessageAt);
                // One chat per agent, one Team chat, one chat per pair of people.
                entity.HasIndex(e => e.AgentId, "UX_chat_threads_agent").IsUnique().HasFilter("\"Kind\" = 'agent'");
                entity.HasIndex(e => new { e.AgentId, e.PeerId }, "UX_chat_threads_direct").IsUnique().HasFilter("\"Kind\" = 'direct'");
                entity.HasIndex(e => e.Kind, "UX_chat_threads_team").IsUnique().HasFilter("\"Kind\" = 'team'");
            });
            modelBuilder.Entity<ChatMessage>(entity =>
            {
                entity.ToTable("chat_messages");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => new { e.ThreadId, e.CreatedAt });
                entity.HasIndex(e => e.ContactClientId);
            });
            modelBuilder.Entity<ChatRead>(entity =>
            {
                entity.ToTable("chat_reads");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ThreadId, e.UserId }).IsUnique();
            });
            modelBuilder.Entity<ChatReaction>(entity =>
            {
                entity.ToTable("chat_reactions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.MessageId, e.UserId, e.Emoji }).IsUnique();
                entity.HasIndex(e => e.ThreadId);
            });
            modelBuilder.Entity<Hoarding>(entity =>
            {
                entity.ToTable("hoardings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.Status);
                entity.HasIndex(e => e.SuggestedBy);
                entity.HasIndex(e => e.OwnerId);
                entity.Property(e => e.MonthlyRent).HasPrecision(12, 2);
            });
            modelBuilder.Entity<Organisation>(entity =>
            {
                entity.ToTable("organisations");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Key).IsUnique();
            });
            modelBuilder.Entity<HoardingOwner>(entity =>
            {
                entity.ToTable("hoarding_owners");
                entity.HasKey(e => e.Id);
            });
            modelBuilder.Entity<HoardingPhoto>(entity =>
            {
                entity.ToTable("hoarding_photos");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.HoardingId);
            });
            modelBuilder.Entity<MarketingExpense>(entity =>
            {
                entity.ToTable("marketing_expenses");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ClientId).IsUnique();
                entity.HasIndex(e => e.SpentOn);
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.Status);
                entity.HasIndex(e => e.ForAgentId);
                entity.HasIndex(e => e.ProjectId);
                entity.HasIndex(e => new { e.RecurringId, e.Period });
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SpendCategory>(entity =>
            {
                entity.ToTable("spend_categories");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Key).IsUnique();
            });
            modelBuilder.Entity<SpendProject>(entity =>
            {
                entity.ToTable("spend_projects");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Status);
                entity.Property(e => e.Budget).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SpendFund>(entity =>
            {
                entity.ToTable("spend_funds");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ProjectId);
                entity.HasIndex(e => e.On);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SpendRecurring>(entity =>
            {
                entity.ToTable("spend_recurrings");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SpendManager>(entity =>
            {
                entity.ToTable("spend_managers");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId).IsUnique();
            });
            modelBuilder.Entity<SiteContent>(entity =>
            {
                entity.ToTable("site_contents");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Type, e.Key }).IsUnique();
                entity.HasIndex(e => e.Status);
            });
            modelBuilder.Entity<SiteContentVersion>(entity =>
            {
                entity.ToTable("site_content_versions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ContentId);
            });
            modelBuilder.Entity<SiteEvent>(entity =>
            {
                entity.ToTable("site_events");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Day, e.Path, e.Kind }).IsUnique();
            });
            modelBuilder.Entity<SiteApiKey>(entity =>
            {
                entity.ToTable("site_api_keys");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Hash).IsUnique();
            });
            modelBuilder.Entity<SiteWebhookDelivery>(entity =>
            {
                entity.ToTable("site_webhook_deliveries");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.Status, e.NextAt });
            });
            modelBuilder.Entity<SiteMedia>(entity =>
            {
                entity.ToTable("site_media");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Name).IsUnique();
            });
            modelBuilder.Entity<SitePublish>(entity =>
            {
                entity.ToTable("site_publishes");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Status);
            });
            modelBuilder.Entity<MarketingStaff>(entity =>
            {
                entity.ToTable("marketing_staff");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId).IsUnique();
            });
            modelBuilder.Entity<MarketingSalaryRate>(entity =>
            {
                entity.ToTable("marketing_salary_rates");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<HealthCardPlan>(entity =>
            {
                entity.ToTable("health_card_plans");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Price).HasPrecision(12, 2);
                entity.Property(e => e.OpdDiscountPct).HasPrecision(5, 2);
                entity.Property(e => e.IpdDiscountPct).HasPrecision(5, 2);
                entity.Property(e => e.LabDiscountPct).HasPrecision(5, 2);
                entity.Property(e => e.PharmacyDiscountPct).HasPrecision(5, 2);
            });
            modelBuilder.Entity<HealthCard>(entity =>
            {
                entity.ToTable("health_cards");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.Number).IsUnique();
                entity.HasIndex(e => e.Phone);
                entity.HasIndex(e => e.CampId);
                entity.HasIndex(e => e.CampPatientId);
                entity.HasIndex(e => e.IssuedOn);
            });
            modelBuilder.Entity<HealthCardPayment>(entity =>
            {
                entity.ToTable("health_card_payments");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.CardId);
                entity.HasIndex(e => e.On);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<HealthCardUse>(entity =>
            {
                entity.ToTable("health_card_uses");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.CardId);
                entity.HasIndex(e => e.On);
                entity.HasIndex(e => e.ReferralClientId);
                entity.Property(e => e.BillAmount).HasPrecision(12, 2);
                entity.Property(e => e.Discount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SalaryIncentive>(entity =>
            {
                entity.ToTable("salary_incentives");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Month });
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<SalarySlip>(entity =>
            {
                entity.ToTable("salary_slips");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.AgentId, e.Month }).IsUnique();
                entity.Property(e => e.Rate).HasPrecision(12, 2);
                entity.Property(e => e.PresentDays).HasPrecision(5, 1);
                entity.Property(e => e.PayableDays).HasPrecision(5, 1);
                entity.Property(e => e.Earned).HasPrecision(12, 2);
                entity.Property(e => e.Incentives).HasPrecision(12, 2);
                entity.Property(e => e.Net).HasPrecision(12, 2);
            });
            modelBuilder.Entity<MarketingMoneyMove>(entity =>
            {
                entity.ToTable("marketing_money_moves");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.AgentId);
                entity.HasIndex(e => e.FromAgentId);
                entity.Property(e => e.Amount).HasPrecision(12, 2);
            });
            modelBuilder.Entity<Meeting>(entity =>
            {
                entity.ToTable("meetings");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ThreadId, e.StartsAt });
                entity.HasIndex(e => new { e.Status, e.StartsAt });
                entity.HasIndex(e => e.CallId);
            });
            modelBuilder.Entity<CallSession>(entity =>
            {
                entity.ToTable("call_sessions");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.ThreadId, e.StartedAt });
                entity.HasIndex(e => e.Status);
            });
            modelBuilder.Entity<CallParticipant>(entity =>
            {
                entity.ToTable("call_participants");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => new { e.CallId, e.UserId }).IsUnique();
                entity.HasIndex(e => e.UserId);
            });
            modelBuilder.Entity<ChatPin>(entity =>
            {
                entity.ToTable("chat_pins");
                entity.HasKey(e => e.Id);
                entity.HasIndex(e => e.ThreadId).IsUnique();
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
