using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Infrastructure.Services
{
    /// <summary>
    /// Settings saved from the CRM, cached for 20 seconds. Secrets are encrypted with AES-GCM using a key derived from
    /// Settings__EncryptionKey (or, when that isn't set, the server's Jwt__Key). If that key ever changes, saved secrets
    /// can't be read and the CRM asks the admin to enter them again.
    /// </summary>
    public class AppSettingsStore : IAppSettings
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<AppSettingsStore> _logger;
        private readonly byte[] _key;
        private readonly object _gate = new();
        private Snapshot? _snap;

        private sealed class Snapshot
        {
            public DateTime LoadedAt;
            public Dictionary<string, string> Values = new();
            public HashSet<string> Unreadable = new();
            public Dictionary<string, DateTime> Updated = new();
        }

        public AppSettingsStore(IServiceScopeFactory scopes, IConfiguration config, ILogger<AppSettingsStore> logger)
        {
            _scopes = scopes;
            _logger = logger;
            var secret = config["Settings:EncryptionKey"] ?? config["Jwt:Key"] ?? "";
            if (string.IsNullOrWhiteSpace(secret)) throw new InvalidOperationException("Settings:EncryptionKey (or Jwt:Key) is needed to protect saved settings.");
            _key = HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(secret), 32, Encoding.UTF8.GetBytes("nexmarket-settings"), Encoding.UTF8.GetBytes("app-settings-v1"));
        }

        private Snapshot Load()
        {
            var s = _snap;
            if (s != null && s.LoadedAt > DateTime.UtcNow.AddSeconds(-20)) return s;
            lock (_gate)
            {
                s = _snap;
                if (s != null && s.LoadedAt > DateTime.UtcNow.AddSeconds(-20)) return s;
                var next = new Snapshot { LoadedAt = DateTime.UtcNow };
                try
                {
                    using var scope = _scopes.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                    foreach (var row in db.AppSettings.AsNoTracking().ToList())
                    {
                        next.Updated[row.Key] = row.UpdatedAt;
                        if (string.IsNullOrEmpty(row.Value)) continue;
                        if (!row.IsSecret) { next.Values[row.Key] = row.Value; continue; }
                        var plain = Unprotect(row.Value);
                        if (plain == null) next.Unreadable.Add(row.Key); else next.Values[row.Key] = plain;
                    }
                }
                catch (Exception ex)
                {
                    // Database not reachable (or not migrated yet): keep the last good values, fall back to server config.
                    _logger.LogWarning(ex, "Could not load app settings");
                    if (s != null) { s.LoadedAt = DateTime.UtcNow; return s; }
                }
                _snap = next;
                return next;
            }
        }

        public string? Get(string key) => Load().Values.TryGetValue(key, out var v) ? v : null;
        public bool Unreadable(string key) => Load().Unreadable.Contains(key);
        public DateTime? UpdatedAt(string key) => Load().Updated.TryGetValue(key, out var d) ? d : null;

        public async Task SetAsync(IDictionary<string, string?> values, ICollection<string> secretKeys, string updatedBy, CancellationToken ct = default)
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var keys = values.Keys.ToList();
            var rows = await db.AppSettings.Where(r => keys.Contains(r.Key)).ToListAsync(ct);
            var now = DateTime.UtcNow;
            foreach (var (key, raw) in values)
            {
                var secret = secretKeys.Contains(key);
                var value = string.IsNullOrWhiteSpace(raw) ? "" : secret ? Protect(raw.Trim()) : raw.Trim();
                var row = rows.FirstOrDefault(r => r.Key == key);
                if (row == null)
                {
                    if (value == "") continue;
                    db.AppSettings.Add(new AppSetting { Key = key, Value = value, IsSecret = secret, UpdatedAt = now, UpdatedBy = updatedBy });
                }
                else
                {
                    // Cleared values are kept as an empty row (nothing is deleted), so the change shows in the activity log.
                    row.Value = value;
                    row.IsSecret = secret;
                    row.UpdatedAt = now;
                    row.UpdatedBy = updatedBy;
                }
            }
            await db.SaveChangesAsync(ct);
            lock (_gate) { _snap = null; }
        }

        private string Protect(string plain)
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var data = Encoding.UTF8.GetBytes(plain);
            var cipher = new byte[data.Length];
            var tag = new byte[16];
            using (var aes = new AesGcm(_key, 16)) aes.Encrypt(nonce, data, cipher, tag);
            return "enc:v1:" + Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
        }

        private string? Unprotect(string stored)
        {
            if (!stored.StartsWith("enc:v1:")) return null;
            try
            {
                var all = Convert.FromBase64String(stored[7..]);
                if (all.Length < 28) return null;
                var nonce = all[..12];
                var tag = all[12..28];
                var cipher = all[28..];
                var plain = new byte[cipher.Length];
                using (var aes = new AesGcm(_key, 16)) aes.Decrypt(nonce, cipher, tag, plain);
                return Encoding.UTF8.GetString(plain);
            }
            catch (Exception ex) when (ex is CryptographicException || ex is FormatException)
            {
                return null;
            }
        }
    }
}
