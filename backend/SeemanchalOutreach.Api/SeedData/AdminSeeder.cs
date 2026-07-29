using System;
using System.Security.Cryptography;
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

            // No hardcoded fallback — a fixed default like "Admin@123" would be a
            // guessable credential on every fresh deployment that forgets to set
            // Seed:DefaultAdminPassword. Generate a random one-time password instead.
            string password = config["Seed:DefaultAdminPassword"] ?? GenerateRandomPassword();

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

        private static string GenerateRandomPassword()
        {
            const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
            var bytes = RandomNumberGenerator.GetBytes(16);
            var passwordChars = new char[16];
            for (int i = 0; i < bytes.Length; i++)
            {
                passwordChars[i] = chars[bytes[i] % chars.Length];
            }
            return new string(passwordChars);
        }
    }
}
