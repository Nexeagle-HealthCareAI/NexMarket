using System;
using System.Data.Common;
using System.Linq;
using System.Threading;

namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>One organisation (a hospital, lab, pharmacy… with its branches). Each has its own database.</summary>
    public sealed record OrgInfo(string Key, string Name, string? Database);

    /// <summary>
    /// Which organisation the current piece of work belongs to. A web request sets it from the signed-in person's token;
    /// background work sets it with <see cref="Enter"/>. Every database connection made while it is set goes to that
    /// organisation's own database. Nothing set = the first organisation (the server's own connection string).
    /// </summary>
    public static class OrgScope
    {
        private static readonly AsyncLocal<OrgInfo?> _current = new();
        public static OrgInfo? Current => _current.Value;

        public static IDisposable Enter(OrgInfo? org)
        {
            var before = _current.Value;
            _current.Value = org;
            return new Leave(before);
        }

        private sealed class Leave : IDisposable
        {
            private readonly OrgInfo? _before;
            private bool _done;
            public Leave(OrgInfo? before) { _before = before; }
            public void Dispose() { if (_done) return; _done = true; _current.Value = _before; }
        }
    }

    public static class OrgNames
    {
        public const int MaxKey = 30;

        /// <summary>The short name an organisation signs in with: 3–30 of a–z, 0–9 and "-", starting with a letter. Null when it isn't one.</summary>
        public static string? Key(string? raw)
        {
            var s = (raw ?? "").Trim().ToLowerInvariant();
            if (s.Length < 3 || s.Length > MaxKey) return null;
            if (!(s[0] >= 'a' && s[0] <= 'z')) return null;
            if (s[^1] == '-' || s.Contains("--")) return null;
            return s.All(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') ? s : null;
        }

        /// <summary>The database name for an organisation. Built only from a checked key, so it is safe to put in SQL.</summary>
        public static string DatabaseFor(string key)
        {
            var k = Key(key) ?? throw new ArgumentException("Not an organisation key.", nameof(key));
            return "nm_" + k.Replace('-', '_');
        }

        /// <summary>The server's connection string, pointed at another database on the same server.</summary>
        public static string Connection(string baseConnection, string? database)
        {
            if (string.IsNullOrWhiteSpace(database)) return baseConnection;
            var b = new DbConnectionStringBuilder { ConnectionString = baseConnection };
            b["Database"] = database;
            return b.ConnectionString;
        }
    }
}
