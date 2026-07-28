using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
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

        Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
    }
}
