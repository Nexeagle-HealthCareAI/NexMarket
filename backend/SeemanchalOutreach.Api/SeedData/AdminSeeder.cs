using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Domain.Entities;
using SeemanchalOutreach.Infrastructure.Persistence;

namespace SeemanchalOutreach.Api.SeedData
{
    public static class AdminSeeder
    {
        public const string DefaultAgentId = "admin";

        /// <summary>
        /// Creates the first Admin account when the Agents table is completely
        /// empty, so there is always a real way to log in on a fresh database —
        /// no hardcoded demo credentials baked into the app itself. The seeded
        /// password must be changed on first login (MustChangePassword = true).
        /// </summary>
        public static async Task<string?> SeedIfEmptyAsync(MarketingDbContext db, IConfiguration config)
        {
            if (await db.Agents.AnyAsync()) return null;

            string password = config["Seed:DefaultAdminPassword"] ?? "Admin@123";

            db.Agents.Add(new FieldAgent
            {
                Id = Guid.NewGuid(),
                AgentId = DefaultAgentId,
                Name = "System Administrator",
                Phone = "0000000000",
                Role = "Admin",
                District = "HQ",
                Block = "HQ",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                MustChangePassword = true,
                IsActive = true,
            });

            await db.SaveChangesAsync();
            return password;
        }
    }
}
