using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Application.Interfaces
{
    public interface IMarketingDbContext
    {
        DbSet<FieldAgent> Agents { get; }
        DbSet<Panchayat> Panchayats { get; }
        DbSet<FieldShift> Shifts { get; }
        DbSet<FieldVisit> Visits { get; }
        DbSet<OutreachContact> Contacts { get; }
        DbSet<ContactHistoryEntry> ContactHistory { get; }
        DbSet<PatientReferral> Referrals { get; }
        DbSet<TrajectoryPoint> TrajectoryPoints { get; }
        DbSet<SurveyResponse> SurveyResponses { get; }
        DbSet<BlockAssignment> BlockAssignments { get; }
        DbSet<AgentRefreshToken> AgentRefreshTokens { get; }
        DbSet<SurveyQuestion> SurveyQuestions { get; }
        DbSet<ContactDocument> ContactDocuments { get; }
        DbSet<RolePermission> RolePermissions { get; }
        DbSet<CallCycle> CallCycles { get; }
        DbSet<CallLog> CallLogs { get; }
        DbSet<PartnerPayment> PartnerPayments { get; }
        DbSet<ReferralBill> ReferralBills { get; }
        DbSet<DiseaseRecord> DiseaseRecords { get; }
        DbSet<SocialPost> SocialPosts { get; }
        DbSet<ChannelMetric> ChannelMetrics { get; }
        DbSet<GoogleReview> GoogleReviews { get; }
        DbSet<FieldSurvey> FieldSurveys { get; }
        DbSet<FieldSurveyAssignee> FieldSurveyAssignees { get; }
        DbSet<FieldSurveyTrack> FieldSurveyTracks { get; }
        DbSet<FieldSurveySpot> FieldSurveySpots { get; }
        DbSet<WorkCard> WorkCards { get; }
        DbSet<WorkNote> WorkNotes { get; }
        DbSet<WorkDoc> WorkDocs { get; }
        DbSet<WorkDocRevision> WorkDocRevisions { get; }
        DbSet<AgentIncentive> AgentIncentives { get; }
        DbSet<Department> Departments { get; }
        DbSet<Doctor> Doctors { get; }
        DbSet<ReferralStatusEntry> ReferralStatusEntries { get; }
        DbSet<Broadcast> Broadcasts { get; }
        DbSet<BroadcastRecipient> BroadcastRecipients { get; }
        DbSet<LeaveRequest> LeaveRequests { get; }
        DbSet<ContactNote> ContactNotes { get; }
        DbSet<AiBriefing> AiBriefings { get; }
        DbSet<AiItem> AiItems { get; }
        DbSet<SurveyEdit> SurveyEdits { get; }
        DbSet<AgentTask> AgentTasks { get; }
        DbSet<AuditLog> AuditLogs { get; }
        DbSet<ChatThread> ChatThreads { get; }
        DbSet<ChatMessage> ChatMessages { get; }
        DbSet<ChatRead> ChatReads { get; }
        DbSet<CallSession> CallSessions { get; }
        DbSet<CallParticipant> CallParticipants { get; }
        DbSet<Hoarding> Hoardings { get; }
        DbSet<HoardingOwner> HoardingOwners { get; }
        DbSet<HoardingPhoto> HoardingPhotos { get; }
        DbSet<ChatReaction> ChatReactions { get; }
        DbSet<ChatPin> ChatPins { get; }
        DbSet<FieldRole> FieldRoles { get; }
        DbSet<Notification> Notifications { get; }
        DbSet<PushDevice> PushDevices { get; }
        DbSet<NotificationSetting> NotificationSettings { get; }
        DbSet<Lead> Leads { get; }
        DbSet<LeadActivity> LeadActivities { get; }
        DbSet<WaMessage> WaMessages { get; }
        DbSet<AppSetting> AppSettings { get; }
        DbSet<WaConversation> WaConversations { get; }
        DbSet<HealthCamp> HealthCamps { get; }
        DbSet<CampPatient> CampPatients { get; }
        DbSet<SocialConversation> SocialConversations { get; }
        DbSet<SocialMessage> SocialMessages { get; }
        DbSet<AdLead> AdLeads { get; }

        ChangeTracker ChangeTracker { get; }

        Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
    }
}
