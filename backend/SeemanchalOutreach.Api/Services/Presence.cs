using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>Someone's chat presence: online now, or when they were last seen, and on what.</summary>
    public readonly record struct PresenceView(bool Online, DateTime? LastSeenAt, string? On);

    /// <summary>
    /// Who has the CRM or the app open right now. The CRM (while its tab is visible) and the app (while it
    /// is on screen) send a heartbeat every 30 seconds, and say "away" when they are hidden or closed.
    /// Someone is online while a heartbeat from any of their devices is less than 75 seconds old and not
    /// "away". This is kept in memory; "last seen" is also written to the person's row (at most once a
    /// minute), so it survives a server restart.
    /// </summary>
    public class PresenceTracker
    {
        public static readonly TimeSpan OnlineWindow = TimeSpan.FromSeconds(75);
        private static readonly TimeSpan WriteEvery = TimeSpan.FromSeconds(60);

        private readonly record struct Ping(DateTime At, bool Away);
        // agentId → (device kind → last heartbeat)
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, Ping>> _beats = new();
        private readonly ConcurrentDictionary<string, DateTime> _written = new();

        public static string Platform(string? on) => (on ?? "").Trim().ToLowerInvariant() switch
        {
            "android" => "android",
            "ios" => "ios",
            _ => "web",
        };

        /// <summary>Records a heartbeat; true when "last seen" should be written to the database now.</summary>
        public bool Beat(string agentId, string on, bool active, DateTime now)
        {
            agentId = OrgKeys.Of(agentId);   // the same User ID can exist in two organisations
            var devices = _beats.GetOrAdd(agentId, _ => new ConcurrentDictionary<string, Ping>());
            devices[on] = new Ping(now, !active);
            var last = _written.GetValueOrDefault(agentId);
            if (!active || now - last >= WriteEvery)
            {
                _written[agentId] = now;
                return true;
            }
            return false;
        }

        /// <summary>The live view from heartbeats alone (null when this server has heard nothing from them).</summary>
        public PresenceView? Live(string agentId, DateTime now)
        {
            if (!_beats.TryGetValue(OrgKeys.Of(agentId), out var devices) || devices.IsEmpty) return null;
            var all = devices.ToArray();
            var online = all.Where(d => !d.Value.Away && now - d.Value.At < OnlineWindow).OrderByDescending(d => d.Value.At).FirstOrDefault();
            if (online.Key != null) return new PresenceView(true, online.Value.At, online.Key);
            var latest = all.OrderByDescending(d => d.Value.At).First();
            return new PresenceView(false, latest.Value.At, latest.Key);
        }

        /// <summary>Heartbeats merged with the stored "last seen", for these people.</summary>
        public Dictionary<string, PresenceView> Merge(IEnumerable<(string AgentId, DateTime? LastActiveAt, string? LastActiveOn)> stored, DateTime now)
        {
            var result = new Dictionary<string, PresenceView>();
            foreach (var (id, at, on) in stored)
            {
                var live = Live(id, now);
                if (live is { Online: true }) result[id] = live.Value;
                else if (live is { } l && (at == null || l.LastSeenAt >= at)) result[id] = l;
                else result[id] = new PresenceView(false, at, on);
            }
            return result;
        }
    }

    public class PresenceBeatDto
    {
        /// <summary>False when the tab or app is being hidden or closed.</summary>
        public bool? Active { get; set; }
        /// <summary>"web", "android" or "ios".</summary>
        public string? On { get; set; }
    }

    /// <summary>The heartbeat behind "online" and "last seen" in chat.</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/presence")]
    public class PresenceController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly PresenceTracker _presence;

        public PresenceController(IMarketingDbContext db, PresenceTracker presence)
        {
            _db = db;
            _presence = presence;
        }

        [HttpPost]
        public async Task<IActionResult> Beat([FromBody] PresenceBeatDto? dto, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            if (string.IsNullOrEmpty(me)) return Ok(new { ok = false });
            var now = DateTime.UtcNow;
            var on = PresenceTracker.Platform(dto?.On);
            if (_presence.Beat(me, on, dto?.Active ?? true, now))
            {
                try
                {
                    await _db.Agents.Where(a => a.AgentId == me)
                        .ExecuteUpdateAsync(u => u.SetProperty(a => a.LastActiveAt, now).SetProperty(a => a.LastActiveOn, on), ct);
                }
                catch (Exception) { /* "last seen" is best effort; the live view still works */ }
            }
            return Ok(new { ok = true });
        }
    }
}
