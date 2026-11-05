using System;
using System.Linq;
using Microsoft.Extensions.Caching.Memory;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Stops password guessing on one account: after <see cref="MaxFails"/> wrong passwords in 15 minutes, that User ID
    /// is locked for 15 minutes, then 30, 60… (up to 4 hours) if it keeps happening the same day. Works alongside the
    /// per-address limit on the sign-in endpoints. Kept in memory, so a restart clears it.
    /// </summary>
    public static class LoginGuard
    {
        public const int MaxFails = 5;
        public const string LockPrefix = "login-lock:";
        private const string FailPrefix = "login-fail:";
        private const string LocksPrefix = "login-locks:";
        private static readonly object Gate = new();

        /// <summary>A valid BCrypt hash of a random value, checked when the User ID doesn't exist (same timing either way).</summary>
        public static readonly string DummyHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N"));

        public static string Key(string userId) => userId.Trim().ToLowerInvariant();

        public static int LockMinutes(int lockNumber) => (int)Math.Min(240, 15 * Math.Pow(2, Math.Max(0, lockNumber - 1)));

        /// <summary>Counts a wrong password. Returns the count, and when the account is now locked until (or null).</summary>
        public static (int Fails, DateTime? LockedUntil) Fail(IMemoryCache cache, string key)
        {
            lock (Gate)
            {
                var fails = (cache.TryGetValue<int>(FailPrefix + key, out var n) ? n : 0) + 1;
                if (fails < MaxFails)
                {
                    cache.Set(FailPrefix + key, fails, TimeSpan.FromMinutes(15));
                    return (fails, null);
                }
                var locks = (cache.TryGetValue<int>(LocksPrefix + key, out var l) ? l : 0) + 1;
                cache.Set(LocksPrefix + key, locks, TimeSpan.FromHours(24));
                var until = DateTime.UtcNow.AddMinutes(LockMinutes(locks));
                cache.Set(LockPrefix + key, until, until);
                cache.Remove(FailPrefix + key);
                return (fails, until);
            }
        }

        public static void Reset(IMemoryCache cache, string key)
        {
            cache.Remove(FailPrefix + key);
            cache.Remove(LockPrefix + key);
        }

        private static readonly string[] Common =
        {
            "password", "password1", "password123", "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
            "qwerty123", "qwertyuiop", "iloveyou", "welcome1", "welcome123", "admin123", "abcd1234", "nexeagle", "nexmarket",
            "glisan123", "hospital", "hospital123", "india123", "bihar123",
        };

        /// <summary>Why a new password is too easy to guess, or null if it's fine.</summary>
        public static string? Weak(string pw, string agentId, string? phone, string? name)
        {
            var p = pw.Trim().ToLowerInvariant();
            if (pw.Length < 8) return "Use at least 8 characters.";
            if (p.Distinct().Count() <= 2) return "Use a mix of different letters and numbers.";
            if (Common.Contains(p)) return "That password is too common. Pick something only you would know.";
            if (p.Contains(agentId.ToLowerInvariant())) return "Don't use your User ID in the password.";
            var digits = new string((phone ?? "").Where(char.IsDigit).ToArray());
            if (digits.Length >= 10 && p.Contains(digits[^10..])) return "Don't use your phone number in the password.";
            var first = (name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.ToLowerInvariant();
            if (first is { Length: >= 4 } && p.Contains(first) && p.Length - first.Length < 4) return "Don't build the password from your name.";
            var seq = "0123456789abcdefghijklmnopqrstuvwxyz";
            if (p.Length >= 8 && (seq.Contains(p) || new string(seq.Reverse().ToArray()).Contains(p))) return "Avoid simple sequences like 12345678 or abcdefgh.";
            return null;
        }

        public static string LockedMessage(DateTime until)
        {
            var mins = Math.Max(1, (int)Math.Ceiling((until - DateTime.UtcNow).TotalMinutes));
            return $"Too many wrong passwords. Sign-in for this User ID is locked for {mins} more minute{(mins == 1 ? "" : "s")}. Ask your admin if you've forgotten the password.";
        }
    }
}
