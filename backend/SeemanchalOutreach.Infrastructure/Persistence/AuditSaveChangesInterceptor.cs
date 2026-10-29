using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Infrastructure.Persistence
{
    /// <summary>
    /// Writes one AuditLog row for every record that is added, changed or removed, in the same save,
    /// with who did it, from which device, and the before → after value of each changed field.
    /// Passwords, tokens and photo data are never written.
    /// </summary>
    public sealed class AuditSaveChangesInterceptor : SaveChangesInterceptor
    {
        private readonly IAuditActor _actor;
        public AuditSaveChangesInterceptor(IAuditActor actor) => _actor = actor;

        // High-volume or internal tables that would drown the log.
        private static readonly HashSet<Type> Skip = new()
        {
            typeof(AuditLog), typeof(TrajectoryPoint), typeof(AgentRefreshToken), typeof(AiBriefing),
        };

        private static readonly Dictionary<string, string> Friendly = new()
        {
            ["OutreachContact"] = "Partner", ["PatientReferral"] = "Referral", ["FieldAgent"] = "Person",
            ["FieldVisit"] = "Visit", ["FieldShift"] = "Shift", ["AgentTask"] = "Task", ["BlockAssignment"] = "Block assignment",
            ["PartnerPayment"] = "Payment", ["ContactNote"] = "Partner note", ["ContactDocument"] = "Partner document",
            ["ContactHistoryEntry"] = "Partner history", ["ReferralStatusEntry"] = "Referral status", ["SurveyResponse"] = "Survey",
            ["SurveyEdit"] = "Survey edit", ["LeaveRequest"] = "Leave request", ["CallLog"] = "Call", ["CallCycle"] = "Call cycle",
            ["RolePermission"] = "Role permission", ["AiItem"] = "AI item", ["BroadcastRecipient"] = "Broadcast recipient",
            ["SurveyQuestion"] = "Survey question",
        };

        private static bool Secret(string prop) =>
            prop.Contains("Password", StringComparison.OrdinalIgnoreCase) || prop.Contains("TokenHash", StringComparison.OrdinalIgnoreCase)
            || prop.EndsWith("Secret", StringComparison.OrdinalIgnoreCase);

        private static bool Blob(string prop) =>
            prop.EndsWith("DataUri", StringComparison.OrdinalIgnoreCase) || prop.EndsWith("Base64", StringComparison.OrdinalIgnoreCase);

        private static readonly string[] NameProps = { "Name", "PatientName", "Title", "FirstName", "Question", "Text" };
        private static readonly string[] SkipProps = { "UpdatedAt", "ModifiedAt", "LastModified", "RowVersion" };

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Capture(eventData.Context);
            return base.SavingChanges(eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Capture(eventData.Context);
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }

        private void Capture(DbContext? db)
        {
            if (db == null) return;
            var entries = db.ChangeTracker.Entries()
                .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                .Where(e => !Skip.Contains(e.Entity.GetType()) && !e.Metadata.IsOwned())
                .ToList();
            if (entries.Count == 0) return;

            var now = DateTime.UtcNow;
            var logs = new List<AuditLog>();
            foreach (var e in entries)
            {
                var changes = new Dictionary<string, object?>();
                foreach (var p in e.Properties)
                {
                    var name = p.Metadata.Name;
                    if (SkipProps.Contains(name)) continue;
                    if (e.State == EntityState.Modified && (!p.IsModified || Equals(p.OriginalValue, p.CurrentValue))) continue;
                    object? from = e.State == EntityState.Added ? null : p.OriginalValue;
                    object? to = e.State == EntityState.Deleted ? null : p.CurrentValue;
                    if (e.State == EntityState.Added && to == null) continue;
                    if (e.State == EntityState.Deleted && from == null) continue;
                    if (Secret(name)) { changes[name] = new { from = from == null ? null : "••••", to = to == null ? null : "•••• (changed)" }; continue; }
                    changes[name] = new { from = Show(name, from), to = Show(name, to) };
                }
                if (e.State == EntityState.Modified && changes.Count == 0) continue;

                var type = e.Entity.GetType().Name;
                logs.Add(new AuditLog
                {
                    At = now,
                    ActorId = _actor.ActorId, ActorName = _actor.ActorName, ActorRole = _actor.ActorRole, Source = _actor.Source,
                    DeviceId = _actor.DeviceId, DeviceType = _actor.DeviceType, Ip = _actor.Ip, Request = Cut(_actor.Request, 200),
                    Action = e.State switch { EntityState.Added => "create", EntityState.Deleted => "delete", _ => "update" },
                    Entity = Friendly.TryGetValue(type, out var f) ? f : type,
                    EntityId = Cut(KeyOf(e), 100),
                    Summary = Cut(NameOf(e), 200),
                    ChangesJson = changes.Count == 0 ? null : JsonSerializer.Serialize(changes),
                });
            }
            if (logs.Count > 0) db.Set<AuditLog>().AddRange(logs);
        }

        private static string? KeyOf(EntityEntry e)
        {
            var key = e.Metadata.FindPrimaryKey();
            if (key == null) return null;
            return string.Join("/", key.Properties.Select(k => e.Property(k.Name).CurrentValue?.ToString()));
        }

        private static string? NameOf(EntityEntry e)
        {
            foreach (var n in NameProps)
            {
                var p = e.Properties.FirstOrDefault(x => x.Metadata.Name == n);
                var v = (e.State == EntityState.Deleted ? p?.OriginalValue : p?.CurrentValue) as string;
                if (!string.IsNullOrWhiteSpace(v))
                {
                    if (n == "FirstName")
                    {
                        var last = e.Properties.FirstOrDefault(x => x.Metadata.Name == "LastName")?.CurrentValue as string;
                        return string.IsNullOrWhiteSpace(last) ? v : $"{v} {last}";
                    }
                    return v;
                }
            }
            return null;
        }

        private static object? Show(string prop, object? v)
        {
            if (v == null) return null;
            if (Blob(prop)) return "(file data)";
            return v switch
            {
                string s when s.StartsWith("data:", StringComparison.Ordinal) => "(file data)",
                string s => Cut(s, 300),
                DateTime d => d.ToString("o"),
                DateOnly d => d.ToString("yyyy-MM-dd"),
                bool or int or long or double or decimal or float or Guid => v,
                Enum en => en.ToString(),
                _ => Cut(v is System.Collections.IEnumerable and not string ? JsonSafe(v) : v.ToString(), 300),
            };
        }

        private static string? JsonSafe(object v)
        {
            try { return JsonSerializer.Serialize(v); } catch { return v.ToString(); }
        }

        private static string? Cut(string? s, int n) => s == null ? null : s.Length <= n ? s : s[..n] + "…";
    }
}
