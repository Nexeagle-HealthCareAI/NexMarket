using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Infrastructure.Persistence;

namespace SeemanchalOutreach.Api.SeedData
{
    /// <summary>
    /// Creates and updates one organisation's database: the one in charge when this is asked for (OrgScope).
    /// The Bihar panchayat list is not loaded here: it belongs to the first organisation only.
    /// </summary>
    public class OrgDatabaseSetup : IOrgDatabase
    {
        private readonly MarketingDbContext _db;
        public OrgDatabaseSetup(MarketingDbContext db) { _db = db; }

        public async Task SetUpAsync(CancellationToken ct = default)
        {
            await _db.Database.MigrateAsync(ct);
            await SurveyQuestionSeeder.SeedIfEmptyAsync(_db);
        }
    }
}
