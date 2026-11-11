using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The hospital's own LiveKit server, which carries the calls' audio and video. Set LiveKit__Url (the public wss://
    /// address the phones and browsers connect to), LiveKit__ApiKey and LiveKit__ApiSecret (the same pair as in the
    /// LiveKit server's config). Without them, calling is off and the apps hide the call buttons.
    /// </summary>
    public class LiveKitSettings
    {
        public string? Url { get; set; }
        public string? ApiKey { get; set; }
        public string? ApiSecret { get; set; }
        /// <summary>How long a call rings before it counts as missed.</summary>
        public int RingSeconds { get; set; } = 45;
        public bool Configured => !string.IsNullOrWhiteSpace(Url) && !string.IsNullOrWhiteSpace(ApiKey) && (ApiSecret?.Length ?? 0) >= 32;
    }

    public static class LiveKitTokens
    {
        /// <summary>A short-lived pass for one person to join one call's room (LiveKit access token: HS256 JWT with a "video" grant).</summary>
        public static string Create(LiveKitSettings s, string room, string identity, string name, string metadata, TimeSpan life)
        {
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(s.ApiSecret!));
            var header = new JwtHeader(new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
            var now = DateTimeOffset.UtcNow;
            var payload = new JwtPayload
            {
                { "iss", s.ApiKey! },
                { "sub", identity },
                { "name", name },
                { "metadata", metadata },
                { "nbf", now.AddSeconds(-10).ToUnixTimeSeconds() },
                { "exp", now.Add(life).ToUnixTimeSeconds() },
                { "video", new Dictionary<string, object>
                    {
                        ["room"] = room, ["roomJoin"] = true, ["canPublish"] = true, ["canSubscribe"] = true, ["canPublishData"] = true,
                    } },
            };
            return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(header, payload));
        }
    }

    public class StartCallDto { public Guid ThreadId { get; set; } public bool Video { get; set; } }

    /// <summary>
    /// Voice and video calls from chat. One-to-one chats ring the other person; an agent's office chat rings the agent
    /// (when the office calls) or everyone in the office (when the agent calls; the first to answer takes it); the Field
    /// team chat starts a huddle that people join. The same access rules as the chat apply. Calls are never recorded.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/calls")]
    public class CallsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IPermissionService _perms;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        private readonly LiveKitSettings _lk;

        public CallsController(IMarketingDbContext db, IPermissionService perms, INotifier notifier, ILiveEvents live, IOptions<LiveKitSettings> lk)
        {
            _db = db;
            _perms = perms;
            _notifier = notifier;
            _live = live;
            _lk = lk.Value;
        }

        private string Me => User.AgentIdOf();
        private string MyName => User.FindFirst(ClaimTypes.Name)?.Value ?? Me;
        private const string Off = "Calling isn't switched on yet. Ask your manager.";

        private async Task<bool> IsOfficeAsync()
        {
            if (!User.IsDashboardUser()) return false;
            if (User.IsAdmin() || RoleChecks.CanonicalDashboardRole(User.RoleOf()) == RoleChecks.MarketingManager) return true;
            return await _perms.GetLevelAsync(User, Pages.Field) >= Pages.View;
        }

        /// <summary>The chat, if this person may use it (same rules as the chat itself).</summary>
        private async Task<(ChatThread? Thread, bool Office)> ThreadAsync(Guid id, CancellationToken ct)
        {
            var t = await _db.ChatThreads.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null || t.Kind == "merged") return (null, false);
            var office = await IsOfficeAsync();
            if (t.Kind == "direct") return t.AgentId == Me || t.PeerId == Me ? (t, office) : (null, false);
            if (office || t.Kind == "team" || t.AgentId == Me) return (t, office);
            return (null, false);
        }

        private object Shape(CallSession c, ChatThread? t, List<CallParticipant> people) => new
        {
            id = c.Id,
            threadId = c.ThreadId,
            threadKind = t?.Kind,
            kind = c.Kind,
            video = c.Video,
            status = c.Status,
            startedBy = c.StartedBy,
            startedByName = c.StartedByName,
            mine = c.StartedBy == Me,
            startedAt = c.StartedAt,
            answeredAt = c.AnsweredAt,
            endedAt = c.EndedAt,
            seconds = c.AnsweredAt != null ? (int)((c.EndedAt ?? DateTime.UtcNow) - c.AnsweredAt.Value).TotalSeconds : 0,
            people = people.Select(p => new { userId = p.UserId, name = p.UserName, joinedAt = p.JoinedAt, leftAt = p.LeftAt, declined = p.Declined, inCall = p.JoinedAt != null && p.LeftAt == null }),
        };

        private object Pass(CallSession c) => new
        {
            url = _lk.Url,
            room = c.Id.ToString(),
            token = LiveKitTokens.Create(_lk, c.Id.ToString(), Me, MyName, JsonSerializer.Serialize(new { office = User.IsDashboardUser() }), TimeSpan.FromHours(6)),
        };

        [HttpGet("status")]
        public IActionResult Status() => Ok(new { on = _lk.Configured, ringSeconds = _lk.RingSeconds });

        /// <summary>Starts a call (or a huddle in the Field team chat) and rings the other side. Returns my pass to join.</summary>
        [HttpPost]
        public async Task<IActionResult> Start([FromBody] StartCallDto dto, CancellationToken ct)
        {
            if (!_lk.Configured) return StatusCode(503, new { message = Off });
            var (t, office) = await ThreadAsync(dto.ThreadId, ct);
            if (t == null) return NotFound();
            await CallSweeper.SweepAsync(_db, _notifier, _live, _lk, ct);

            // Already a call going on in this chat? Join it instead of starting a second one.
            var going = await _db.CallSessions.Where(c => c.ThreadId == t.Id && (c.Status == "ringing" || c.Status == "active")).OrderByDescending(c => c.StartedAt).FirstOrDefaultAsync(ct);
            if (going != null) return await JoinAsync(going, t, ct);

            var call = new CallSession
            {
                ThreadId = t.Id, Kind = t.Kind == "team" ? "huddle" : "call", Video = dto.Video, StartedBy = Me, StartedByName = MyName,
                Status = t.Kind == "team" ? "active" : "ringing",
            };
            if (call.Kind == "huddle") call.AnsweredAt = call.StartedAt;
            _db.CallSessions.Add(call);
            _db.CallParticipants.Add(new CallParticipant { CallId = call.Id, UserId = Me, UserName = MyName, JoinedAt = DateTime.UtcNow });

            var ring = new NotifyJob { Kind = call.Kind == "huddle" ? "huddle" : "call", Link = $"call:{call.Id}", RefId = call.Id.ToString(), Except = Me };
            var what = call.Video ? "video call" : "voice call";
            if (t.Kind == "direct")
            {
                var peer = t.AgentId == Me ? t.PeerId! : t.AgentId!;
                var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == peer).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? peer;
                _db.CallParticipants.Add(new CallParticipant { CallId = call.Id, UserId = peer, UserName = name });
                ring.To.Add(peer);
                ring.Title = MyName;
                ring.Body = $"Incoming {what}";
            }
            else if (t.Kind == "agent")
            {
                if (office && t.AgentId != Me)
                {
                    var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == t.AgentId).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? t.AgentId!;
                    _db.CallParticipants.Add(new CallParticipant { CallId = call.Id, UserId = t.AgentId!, UserName = name });
                    ring.To.Add(t.AgentId!);
                    ring.Title = $"{MyName} · Office";
                }
                else
                {
                    ring.ToOffice = true;
                    ring.Title = $"{MyName} · field agent";
                }
                ring.Body = $"Incoming {what}";
            }
            else
            {
                ring.To.AddRange(await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => a.AgentId).ToListAsync(ct));
                ring.ToOffice = true;
                ring.Title = $"{MyName} started a team huddle";
                ring.Body = call.Video ? "Video huddle in Field team – tap to join" : "Voice huddle in Field team – tap to join";
            }
            if (call.Kind == "call")
            {
                // Phones ring full screen like a phone call (the app's own ringing), for as long as the call can ring.
                ring.Ring = true;
                ring.TtlSeconds = _lk.RingSeconds;
                ring.Data["callId"] = call.Id.ToString();
                ring.Data["caller"] = ring.Title;
                ring.Data["video"] = call.Video ? "1" : "0";
            }
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(ring);
            await _live.PublishChatAsync(t.Id);
            var people = await _db.CallParticipants.AsNoTracking().Where(p => p.CallId == call.Id).ToListAsync(ct);
            return Ok(new { call = Shape(call, t, people), join = Pass(call) });
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            await CallSweeper.SweepAsync(_db, _notifier, _live, _lk, ct);
            var c = await _db.CallSessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var (t, _) = await ThreadAsync(c.ThreadId, ct);
            if (t == null) return NotFound();
            var people = await _db.CallParticipants.AsNoTracking().Where(p => p.CallId == id).ToListAsync(ct);
            return Ok(Shape(c, t, people));
        }

        /// <summary>
        /// Calls ringing for me and huddles going on in chats I can see, newest first: the apps check this when they open
        /// or come back, so a ring is never missed because a push didn't arrive.
        /// </summary>
        [HttpGet("active")]
        public async Task<IActionResult> Active(CancellationToken ct)
        {
            if (!_lk.Configured) return Ok(Array.Empty<object>());
            await CallSweeper.SweepAsync(_db, _notifier, _live, _lk, ct);
            var me = Me;
            var calls = await _db.CallSessions.AsNoTracking().Where(c => c.Status == "ringing" || c.Status == "active").OrderByDescending(c => c.StartedAt).Take(50).ToListAsync(ct);
            var result = new List<object>();
            foreach (var c in calls)
            {
                var (t, office) = await ThreadAsync(c.ThreadId, ct);
                if (t == null) continue;
                var people = await _db.CallParticipants.AsNoTracking().Where(p => p.CallId == c.Id).ToListAsync(ct);
                var mineRow = people.FirstOrDefault(p => p.UserId == me);
                if (mineRow != null && (mineRow.Declined || (mineRow.JoinedAt != null && mineRow.LeftAt == null && c.Kind != "huddle"))) continue;
                bool forMe = c.Kind == "huddle"
                    || (c.Status == "ringing" && c.StartedBy != me && (mineRow != null || (t.Kind == "agent" && office && t.AgentId != me && c.StartedBy == t.AgentId)));
                if (!forMe) continue;
                result.Add(Shape(c, t, people));
            }
            return Ok(result);
        }

        [HttpPost("{id:guid}/join")]
        public async Task<IActionResult> Join(Guid id, CancellationToken ct)
        {
            if (!_lk.Configured) return StatusCode(503, new { message = Off });
            await CallSweeper.SweepAsync(_db, _notifier, _live, _lk, ct);
            var c = await _db.CallSessions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var (t, _) = await ThreadAsync(c.ThreadId, ct);
            if (t == null) return NotFound();
            return await JoinAsync(c, t, ct);
        }

        private async Task<IActionResult> JoinAsync(CallSession c, ChatThread t, CancellationToken ct)
        {
            if (c.Status is not ("ringing" or "active")) return Conflict(new { message = "This call has ended." });
            var me = Me;
            var row = await _db.CallParticipants.FirstOrDefaultAsync(p => p.CallId == c.Id && p.UserId == me, ct);
            // An office call someone else in the office already answered stays theirs.
            if (row == null && t.Kind == "agent" && c.Kind == "call" && c.Status == "active" && c.StartedBy != me
                && await _db.CallParticipants.AnyAsync(p => p.CallId == c.Id && p.UserId != c.StartedBy && p.JoinedAt != null, ct))
                return Conflict(new { message = "Someone else in the office answered this call." });
            if (row == null) { row = new CallParticipant { CallId = c.Id, UserId = me, UserName = MyName }; _db.CallParticipants.Add(row); }
            row.JoinedAt = DateTime.UtcNow;
            row.LeftAt = null;
            row.Declined = false;
            var answered = c.Status == "ringing" && me != c.StartedBy;
            if (answered) { c.Status = "active"; c.AnsweredAt = DateTime.UtcNow; }
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { return Conflict(new { message = "Please try again." }); }
            // Answered: the other phones that were ringing for it (the rest of the office) stop.
            if (answered) CallSweeper.StopRinging(_notifier, c, t);
            await _live.PublishChatAsync(t.Id);
            var people = await _db.CallParticipants.AsNoTracking().Where(p => p.CallId == c.Id).ToListAsync(ct);
            return Ok(new { call = Shape(c, t, people), join = Pass(c) });
        }

        /// <summary>Says no to a ringing call. A one-to-one call ends; an office ring keeps ringing for the others.</summary>
        [HttpPost("{id:guid}/decline")]
        public async Task<IActionResult> Decline(Guid id, CancellationToken ct)
        {
            var c = await _db.CallSessions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var (t, _) = await ThreadAsync(c.ThreadId, ct);
            if (t == null) return NotFound();
            var me = Me;
            var row = await _db.CallParticipants.FirstOrDefaultAsync(p => p.CallId == c.Id && p.UserId == me, ct);
            if (row == null) { row = new CallParticipant { CallId = c.Id, UserId = me, UserName = MyName }; _db.CallParticipants.Add(row); }
            row.Declined = true;
            // The only person rung said no: the call is over.
            var single = c.Kind == "call" && c.Status == "ringing" && (t.Kind == "direct" || (t.Kind == "agent" && c.StartedBy != t.AgentId));
            await _db.SaveChangesAsync(ct);
            if (single) await CallSweeper.FinishAsync(_db, _notifier, _live, c, "declined", ct);
            return Ok(new { ok = true });
        }

        /// <summary>Leaves a call (hang up). A call ends when fewer than two people are left in it; a huddle when nobody is.</summary>
        [HttpPost("{id:guid}/leave")]
        public async Task<IActionResult> Leave(Guid id, CancellationToken ct)
        {
            var c = await _db.CallSessions.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var (t, _) = await ThreadAsync(c.ThreadId, ct);
            if (t == null) return NotFound();
            var me = Me;
            var row = await _db.CallParticipants.FirstOrDefaultAsync(p => p.CallId == c.Id && p.UserId == me, ct);
            if (row != null && row.LeftAt == null) row.LeftAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            if (c.Status is "ringing" or "active")
            {
                var inCall = await _db.CallParticipants.CountAsync(p => p.CallId == c.Id && p.JoinedAt != null && p.LeftAt == null, ct);
                if (c.Status == "ringing" && me == c.StartedBy) await CallSweeper.FinishAsync(_db, _notifier, _live, c, "missed", ct);
                else if (c.Kind == "huddle" ? inCall == 0 : inCall < 2) await CallSweeper.FinishAsync(_db, _notifier, _live, c, c.AnsweredAt != null ? "ended" : "missed", ct);
                else await _live.PublishChatAsync(c.ThreadId);
            }
            return Ok(new { ok = true });
        }
    }

    /// <summary>
    /// Ends calls nobody answered (after the ring time) or that were left open (6 hours), and writes the call into the chat
    /// ("Missed video call", "Voice call · 3 min", "Huddle · 12 min · 5 joined") so both sides see it.
    /// </summary>
    public class CallSweeper : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<CallSweeper> _logger;
        public CallSweeper(IServiceScopeFactory scopes, ILogger<CallSweeper> logger) { _scopes = scopes; _logger = logger; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var sp = scope.ServiceProvider;
                    await SweepAsync(sp.GetRequiredService<IMarketingDbContext>(), sp.GetRequiredService<INotifier>(), sp.GetRequiredService<ILiveEvents>(),
                        sp.GetRequiredService<IOptions<LiveKitSettings>>().Value, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogDebug(ex, "Call sweep failed"); }
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }

        public static async Task SweepAsync(IMarketingDbContext db, INotifier notifier, ILiveEvents live, LiveKitSettings lk, CancellationToken ct)
        {
            var ringUntil = DateTime.UtcNow.AddSeconds(-Math.Max(15, lk.RingSeconds));
            var stale = DateTime.UtcNow.AddHours(-6);
            var due = await db.CallSessions.Where(c => (c.Status == "ringing" && c.StartedAt < ringUntil) || (c.Status == "active" && c.StartedAt < stale)).Take(50).ToListAsync(ct);
            foreach (var c in due) await FinishAsync(db, notifier, live, c, c.Status == "ringing" ? "missed" : "ended", ct);
        }

        /// <summary>
        /// Tells the phones that were rung for this call to stop ringing (a data-only push; the app cancels its full-screen
        /// ring). Same people the call rang: the other person, the agent, or the office.
        /// </summary>
        public static void StopRinging(INotifier notifier, CallSession c, ChatThread t)
        {
            if (c.Kind != "call") return;
            var job = new NotifyJob
            {
                Kind = "call", Quiet = true, TtlSeconds = 120, Except = c.StartedBy,
                Data = new() { ["kind"] = "call-stop", ["callId"] = c.Id.ToString() },
            };
            if (t.Kind == "direct") job.To.Add(t.AgentId == c.StartedBy ? t.PeerId! : t.AgentId!);
            else if (t.Kind == "agent") { if (c.StartedBy == t.AgentId) job.ToOffice = true; else job.To.Add(t.AgentId!); }
            else return;
            notifier.Notify(job);
        }

        public static async Task FinishAsync(IMarketingDbContext db, INotifier notifier, ILiveEvents live, CallSession c, string status, CancellationToken ct)
        {
            if (c.Status is "ended" or "missed" or "declined") return;
            var wasRinging = c.Status == "ringing";
            c.Status = status;
            c.EndedAt = DateTime.UtcNow;
            var people = await db.CallParticipants.Where(p => p.CallId == c.Id).ToListAsync(ct);
            foreach (var p in people.Where(p => p.JoinedAt != null && p.LeftAt == null)) p.LeftAt = c.EndedAt;

            var what = c.Video ? "video call" : "voice call";
            var mins = c.AnsweredAt == null ? 0 : (int)Math.Ceiling((c.EndedAt.Value - c.AnsweredAt.Value).TotalMinutes);
            var text = c.Kind == "huddle"
                ? $"{(c.Video ? "📹" : "📞")} Huddle · {Math.Max(1, mins)} min · {people.Count(p => p.JoinedAt != null)} joined"
                : status switch
                {
                    "missed" => $"{(c.Video ? "📹" : "📞")} Missed {what}",
                    "declined" => $"{(c.Video ? "📹" : "📞")} {char.ToUpper(what[0]) + what[1..]} declined",
                    _ => $"{(c.Video ? "📹" : "📞")} {char.ToUpper(what[0]) + what[1..]} · {Math.Max(1, mins)} min",
                };
            var clientId = $"call:{c.Id}";
            var t = await db.ChatThreads.FirstOrDefaultAsync(x => x.Id == c.ThreadId, ct);
            if (t != null && !await db.ChatMessages.AnyAsync(m => m.ClientId == clientId, ct))
            {
                var fromOffice = await db.Agents.AsNoTracking().Where(a => a.AgentId == c.StartedBy).Select(a => a.Role).FirstOrDefaultAsync(ct) is { } role && RoleChecks.IsDashboardRole(role);
                var m = new ChatMessage { ClientId = clientId, ThreadId = c.ThreadId, SenderId = c.StartedBy, SenderName = c.StartedByName, FromOffice = fromOffice, Text = text, CreatedAt = c.EndedAt.Value };
                db.ChatMessages.Add(m);
                t.LastMessageAt = m.CreatedAt;
                t.LastPreview = text;
            }
            await db.SaveChangesAsync(ct);
            if (t != null) await live.PublishChatAsync(t.Id);
            // Still ringing on someone's phone (missed, declined, or the caller hung up): stop it.
            if (wasRinging && t != null) StopRinging(notifier, c, t);

            // A missed call reaches the bell of whoever was rung.
            if (status == "missed" && c.Kind == "call" && t != null)
            {
                var job = new NotifyJob { Kind = "call", Title = c.StartedByName, Body = $"Missed {what}", Link = $"chat:{t.Id}", RefId = c.Id.ToString(), Except = c.StartedBy };
                if (t.Kind == "direct") job.To.Add(t.AgentId == c.StartedBy ? t.PeerId! : t.AgentId!);
                else if (t.Kind == "agent") { if (c.StartedBy == t.AgentId) job.ToOffice = true; else job.To.Add(t.AgentId!); }
                notifier.Notify(job);
            }
        }
    }
}
