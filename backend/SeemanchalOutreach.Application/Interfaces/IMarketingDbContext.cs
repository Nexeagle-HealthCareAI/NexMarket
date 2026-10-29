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

        ChangeTracker ChangeTracker { get; }

        Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
    }
}
