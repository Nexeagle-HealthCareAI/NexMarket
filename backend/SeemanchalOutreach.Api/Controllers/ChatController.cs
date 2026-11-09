using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ChatSendDto
    {
        public string? ClientId { get; set; }
        public string? Text { get; set; }
        public string? ContactClientId { get; set; }
        public Guid? ReplyToId { get; set; }
        public double? Lat { get; set; }
        public double? Lng { get; set; }
    }

    public class StartDirectDto { public string AgentId { get; set; } = ""; }
    public class ReactDto { public string Emoji { get; set; } = ""; }
    public class PinDto { public Guid? MessageId { get; set; } }

    /// <summary>
    /// Chat between the office (CRM) and field agents. Each agent has one private chat with the office;
    /// everyone shares the Team group; and any two people can have a direct (one-to-one) chat, which only
    /// those two can read — not even admins. Agents only ever see their own office chat, Team and their own
    /// direct chats. Office users are admins, marketing managers, and anyone with access to the field pages.
    /// Files are kept private and only streamed through <see cref="File"/> after the same check.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/chat")]
    public class ChatController : ControllerBase
    {
        public const long MaxFileBytes = 15 * 1024 * 1024;
        private const int MaxText = 4000;

        private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        {
            [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png", [".webp"] = "image/webp", [".heic"] = "image/heic",
            [".pdf"] = "application/pdf",
            [".doc"] = "application/msword", [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xls"] = "application/vnd.ms-excel", [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".ppt"] = "application/vnd.ms-powerpoint", [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            [".csv"] = "text/csv", [".txt"] = "text/plain",
        };

        private readonly IMarketingDbContext _db;
        private readonly IPermissionService _perms;
        private readonly IFileStore _files;
        private readonly ILiveEvents _live;
        private readonly INotifier _notifier;
        private readonly PresenceTracker _presence;

        public ChatController(IMarketingDbContext db, IPermissionService perms, IFileStore files, ILiveEvents live, INotifier notifier, PresenceTracker presence)
        {
            _presence = presence;
            _db = db;
            _perms = perms;
            _files = files;
            _live = live;
            _notifier = notifier;
        }

        /// <summary>Tell the other people in this chat (push + bell). Never the sender.</summary>
        private async Task NotifyAsync(ChatThread t, bool office, ChatMessage m, CancellationToken ct)
        {
            var preview = m.FileName != null ? $"📎 {m.FileName}{(string.IsNullOrWhiteSpace(m.Text) ? "" : " · " + m.Text)}" : m.Text ?? "";
            if (m.ContactName != null) preview += $" · #{m.ContactName}";
            var job = new NotifyJob { Kind = "chat", Body = preview, Link = $"chat:{t.Id}", RefId = m.Id.ToString(), Except = Me, Title = MyName };
            if (t.Kind == "direct")
            {
                var peer = PeerOf(t);
                if (peer == null) return;
                job.To.Add(peer);
            }
            else if (t.Kind == "agent")
            {
                if (office) job.To.Add(t.AgentId!);
                else { job.ToOffice = true; job.Title = $"{MyName} · field agent"; }
                if (office) job.Title = $"{MyName} · Office";
            }
            else
            {
                job.Kind = "team_chat";
                job.Title = $"{MyName} · Field team";
                job.To.AddRange(await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => a.AgentId).ToListAsync(ct));
            }
            _notifier.Notify(job);
        }

        private string Me => User.AgentIdOf();
        private string MyName => User.FindFirst(ClaimTypes.Name)?.Value ?? Me;

        /// <summary>Office side: admins, marketing managers, or anyone who can open the field pages.</summary>
        private async Task<bool> IsOfficeAsync()
        {
            if (!User.IsDashboardUser()) return false;
            if (User.IsAdmin() || RoleChecks.CanonicalDashboardRole(User.RoleOf()) == RoleChecks.MarketingManager) return true;
            return await _perms.GetLevelAsync(User, Pages.Field) >= Pages.View;
        }

        private async Task<ChatThread> TeamAsync(CancellationToken ct)
        {
            var t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Kind == "team", ct);
            if (t != null) return t;
            t = new ChatThread { Kind = "team", Title = "Field team" };
            _db.ChatThreads.Add(t);
            await _db.SaveChangesAsync(ct);
            return t;
        }

        private async Task<ChatThread> AgentThreadAsync(string agentId, string name, CancellationToken ct)
        {
            var t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Kind == "agent" && x.AgentId == agentId, ct);
            if (t != null) return t;
            t = new ChatThread { Kind = "agent", AgentId = agentId, Title = name, LastMessageAt = DateTime.UtcNow.AddYears(-1) };
            _db.ChatThreads.Add(t);
            await _db.SaveChangesAsync(ct);
            return t;
        }

        /// <summary>The thread, if this person may see it. A direct chat is only ever open to its two people.</summary>
        private async Task<(ChatThread? Thread, bool Office)> AccessAsync(Guid id, CancellationToken ct)
        {
            var t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return (null, false);
            var office = await IsOfficeAsync();
            if (t.Kind == "direct") return t.AgentId == Me || t.PeerId == Me ? (t, office) : (null, false);
            if (office || t.Kind == "team" || t.AgentId == Me) return (t, office);
            return (null, false);
        }

        /// <summary>The other person in a direct chat.</summary>
        private string? PeerOf(ChatThread t) => t.Kind != "direct" ? null : t.AgentId == Me ? t.PeerId : t.AgentId;

        private static string RoleLabel(string? role) => RoleChecks.CanonicalDashboardRole(role) switch
        {
            RoleChecks.Admin => "Admin",
            RoleChecks.MarketingManager => "Marketing manager",
            RoleChecks.HospitalRep => "Hospital representative",
            _ => string.IsNullOrWhiteSpace(role) ? "Field agent" : role.Trim(),
        };

        // ─── Direct chats ────────────────────────────────────────────────────

        /// <summary>Everyone this person can start a direct chat with: every other active user.</summary>
        [HttpGet("people")]
        public async Task<IActionResult> People(CancellationToken ct)
        {
            var me = Me;
            var people = await _db.Agents.AsNoTracking().Where(a => a.IsActive && a.AgentId != me)
                .Select(a => new { a.AgentId, a.Name, a.Role, a.Block, a.District, a.PhotoUrl }).ToListAsync(ct);
            return Ok(people
                .Select(a => new
                {
                    agentId = a.AgentId,
                    name = a.Name,
                    role = RoleLabel(a.Role),
                    kind = RoleChecks.IsDashboardRole(a.Role) ? "dashboard" : "field",
                    block = RoleChecks.IsDashboardRole(a.Role) ? null : a.Block,
                    photoUrl = a.PhotoUrl,
                })
                // The office first (admins, then managers…), then the field team, by name.
                .OrderBy(a => a.kind == "dashboard" ? 0 : 1).ThenBy(a => a.role == "Admin" ? 0 : 1).ThenBy(a => a.name));
        }

        /// <summary>Opens (or creates) the direct chat between me and this person.</summary>
        [HttpPost("direct")]
        public async Task<IActionResult> StartDirect([FromBody] StartDirectDto dto, CancellationToken ct)
        {
            var other = (dto.AgentId ?? "").Trim();
            if (other.Length == 0 || other == Me) return BadRequest(new { message = "Choose someone to message." });
            var person = await _db.Agents.AsNoTracking().Where(a => a.AgentId == other && a.IsActive).Select(a => new { a.AgentId, a.Name }).FirstOrDefaultAsync(ct);
            if (person == null) return NotFound(new { message = "That person isn't active any more." });
            var (a, b) = string.CompareOrdinal(Me, other) < 0 ? (Me, other) : (other, Me);
            var t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Kind == "direct" && x.AgentId == a && x.PeerId == b, ct);
            if (t == null)
            {
                t = new ChatThread { Kind = "direct", AgentId = a, PeerId = b, Title = "", LastMessageAt = DateTime.UtcNow };
                _db.ChatThreads.Add(t);
                try { await _db.SaveChangesAsync(ct); }
                catch (DbUpdateException)
                {
                    // Both people started the chat at the same moment: use the one that was saved.
                    _db.ChatThreads.Remove(t);
                    t = await _db.ChatThreads.FirstOrDefaultAsync(x => x.Kind == "direct" && x.AgentId == a && x.PeerId == b, ct);
                    if (t == null) return Conflict(new { message = "Please try again." });
                }
            }
            return Ok(new { id = t.Id });
        }

        // ─── Threads ─────────────────────────────────────────────────────────

        [HttpGet("threads")]
        public async Task<IActionResult> Threads(CancellationToken ct)
        {
            var office = await IsOfficeAsync();
            var team = await TeamAsync(ct);
            var me = Me;
            List<ChatThread> threads;
            Dictionary<string, (string Name, string? Block)> agents = new();
            if (office)
            {
                // Every active field agent has a chat, even before the first message.
                var field = (await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Name, a.Role, a.Block }).ToListAsync(ct))
                    .Where(a => !RoleChecks.IsDashboardRole(a.Role)).ToList();
                var have = await _db.ChatThreads.Where(x => x.Kind == "agent").Select(x => x.AgentId).ToListAsync(ct);
                var missing = field.Where(a => !have.Contains(a.AgentId)).ToList();
                foreach (var a in missing)
                    _db.ChatThreads.Add(new ChatThread { Kind = "agent", AgentId = a.AgentId, Title = a.Name, LastMessageAt = DateTime.UtcNow.AddYears(-1) });
                if (missing.Count > 0) await _db.SaveChangesAsync(ct);
                agents = field.ToDictionary(a => a.AgentId, a => (a.Name, (string?)a.Block));
                var agentIds = agents.Keys.ToList();
                threads = await _db.ChatThreads.AsNoTracking().Where(x => x.Kind == "team" || (x.Kind == "agent" && agentIds.Contains(x.AgentId!))).ToListAsync(ct);
            }
            else
            {
                var mine = await AgentThreadAsync(Me, MyName, ct);
                threads = new List<ChatThread> { mine, team };
            }
            // My direct chats (only once something was said, or I opened them).
            threads.AddRange(await _db.ChatThreads.AsNoTracking().Where(x => x.Kind == "direct" && (x.AgentId == me || x.PeerId == me)).ToListAsync(ct));
            var peerIds = threads.Select(PeerOf).Where(x => x != null).Cast<string>().Distinct().ToList();
            var peers = peerIds.Count == 0 ? new Dictionary<string, (string Name, string? Role, string? Block, string? Photo, bool Active)>()
                : (await _db.Agents.AsNoTracking().Where(a => peerIds.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name, a.Role, a.Block, a.PhotoUrl, a.IsActive }).ToListAsync(ct))
                    .ToDictionary(a => a.AgentId, a => (Name: a.Name, Role: (string?)a.Role, Block: (string?)a.Block, Photo: a.PhotoUrl, Active: a.IsActive));

            // Where each field person is right now (on a visit, on shift, or off), for the dots in the list.
            // Office people have no shifts, so only field people get a dot.
            var fieldIds = threads.Select(t => t.Kind == "agent" ? t.AgentId
                    : t.Kind == "direct" && PeerOf(t) is { } p && peers.TryGetValue(p, out var pr) && !RoleChecks.IsDashboardRole(pr.Role) ? p : null)
                .Where(x => x != null).Cast<string>().Distinct().ToList();
            var presence = await PresenceAsync(fieldIds, ct);
            var everyone = await EveryoneAsync(ct);

            var ids = threads.Select(t => t.Id).ToList();
            var reads = await _db.ChatReads.AsNoTracking().Where(r => ids.Contains(r.ThreadId) && r.UserId == Me)
                .ToDictionaryAsync(r => r.ThreadId, r => r.LastReadAt, ct);
            // Unread: messages from others after my last read.
            var unread = new Dictionary<Guid, int>();
            foreach (var t in threads)
            {
                var since = reads.TryGetValue(t.Id, out var r) ? r : DateTime.MinValue;
                if (t.LastMessageAt <= since) continue;
                unread[t.Id] = await _db.ChatMessages.CountAsync(m => m.ThreadId == t.Id && m.CreatedAt > since && m.SenderId != Me, ct);
            }

            return Ok(new
            {
                office,
                threads = threads
                    .OrderByDescending(t => t.Kind == "team" && !office)
                    .ThenByDescending(t => t.LastMessageAt)
                    .Select(t =>
                    {
                        var peerId = PeerOf(t);
                        var peer = peerId != null && peers.TryGetValue(peerId, out var pp) ? pp : default;
                        var hasPeer = peerId != null && peers.ContainsKey(peerId);
                        return new
                        {
                            id = t.Id,
                            kind = t.Kind,
                            agentId = t.Kind == "direct" ? peerId : t.AgentId,
                            title = t.Kind == "team" ? "Field team"
                                : t.Kind == "direct" ? (hasPeer ? peer.Name : peerId ?? "")
                                : office ? (agents.TryGetValue(t.AgentId ?? "", out var a) ? a.Name : t.Title) : "Office",
                            sub = t.Kind == "team" ? "Everyone in the field team and the office"
                                : t.Kind == "direct" ? (hasPeer ? string.Join(" · ", new[] { RoleLabel(peer.Role), RoleChecks.IsDashboardRole(peer.Role) ? null : peer.Block }.Where(x => !string.IsNullOrWhiteSpace(x))) + (peer.Active ? "" : " · inactive") : null)
                                : office ? (agents.TryGetValue(t.AgentId ?? "", out var b) ? b.Block : null) : "Marketing office",
                            photoUrl = t.Kind == "direct" && hasPeer ? peer.Photo : null,
                            lastMessageAt = t.LastPreview == null ? (DateTime?)null : t.LastMessageAt,
                            lastPreview = t.LastPreview,
                            unread = unread.GetValueOrDefault(t.Id),
                            presence = presence.GetValueOrDefault((t.Kind == "direct" ? peerId : t.AgentId) ?? ""),
                            live = LiveFor(t, office, everyone),
                        };
                    }),
            });
        }

        [HttpGet("unread")]
        public async Task<IActionResult> Unread(CancellationToken ct)
        {
            var office = await IsOfficeAsync();
            var me = Me;
            var visible = office
                ? _db.ChatThreads.AsNoTracking().Where(t => t.Kind != "direct" || t.AgentId == me || t.PeerId == me)
                : _db.ChatThreads.AsNoTracking().Where(t => t.Kind == "team" || (t.Kind == "agent" && t.AgentId == me) || (t.Kind == "direct" && (t.AgentId == me || t.PeerId == me)));
            var list = await visible.Select(t => new { t.Id, t.LastMessageAt }).ToListAsync(ct);
            var reads = await _db.ChatReads.AsNoTracking().Where(r => r.UserId == Me).ToDictionaryAsync(r => r.ThreadId, r => r.LastReadAt, ct);
            int total = 0;
            foreach (var t in list)
            {
                var since = reads.TryGetValue(t.Id, out var r) ? r : DateTime.MinValue;
                if (t.LastMessageAt <= since) continue;
                total += await _db.ChatMessages.CountAsync(m => m.ThreadId == t.Id && m.CreatedAt > since && m.SenderId != Me, ct);
            }
            return Ok(new { total });
        }

        // ─── Messages ────────────────────────────────────────────────────────

        private sealed record ReactionRow(Guid MessageId, string UserId, string UserName, string Emoji, DateTime CreatedAt);

        /// <summary>Reactions grouped per message: emoji, how many, whether I reacted, and who (first names).</summary>
        private Dictionary<Guid, List<object>> GroupReactions(IEnumerable<ReactionRow> rows) => rows
            .GroupBy(r => r.MessageId)
            .ToDictionary(g => g.Key, g => g.GroupBy(r => r.Emoji).OrderBy(e => e.Min(r => r.CreatedAt))
                .Select(e => (object)new { emoji = e.Key, count = e.Count(), mine = e.Any(r => r.UserId == Me), names = e.Select(r => r.UserId == Me ? "You" : r.UserName).Take(12).ToList() })
                .ToList());

        private async Task<Dictionary<Guid, List<object>>> ReactionsForAsync(List<Guid> messageIds, CancellationToken ct)
        {
            if (messageIds.Count == 0) return new();
            var rows = await _db.ChatReactions.AsNoTracking().Where(r => messageIds.Contains(r.MessageId))
                .Select(r => new ReactionRow(r.MessageId, r.UserId, r.UserName, r.Emoji, r.CreatedAt)).ToListAsync(ct);
            return GroupReactions(rows);
        }

        private object Shape(ChatMessage m, Dictionary<Guid, ChatMessage> replies, Dictionary<Guid, List<object>>? reactions = null) => new
        {
            id = m.Id,
            clientId = m.ClientId,
            threadId = m.ThreadId,
            senderId = m.SenderId,
            senderName = m.SenderName,
            fromOffice = m.FromOffice,
            mine = m.SenderId == Me,
            text = m.Text,
            contact = m.ContactClientId == null ? null : new { id = m.ContactClientId, name = m.ContactName },
            file = m.FileKey == null ? null : new { name = m.FileName, mime = m.FileMime, size = m.FileSize, url = $"/api/v1/chat/files/{m.Id}" },
            lat = m.Lat,
            lng = m.Lng,
            replyTo = m.ReplyToId != null && replies.TryGetValue(m.ReplyToId.Value, out var r)
                ? new { id = r.Id, senderName = r.SenderName, text = r.Text, fileName = r.FileName }
                : null,
            reactions = reactions != null && reactions.TryGetValue(m.Id, out var rx) ? rx : new List<object>(),
            createdAt = m.CreatedAt,
        };

        /// <summary>
        /// Messages oldest first. <c>after</c> = only newer than this (polling); <c>before</c> = older page.
        /// Also returns how far the other side has received and read, for the ticks.
        /// </summary>
        [HttpGet("threads/{id:guid}/messages")]
        public async Task<IActionResult> Messages(Guid id, [FromQuery] DateTime? after, [FromQuery] DateTime? before, [FromQuery] int limit = 60, CancellationToken ct = default)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            limit = Math.Clamp(limit, 1, 200);
            var q = _db.ChatMessages.AsNoTracking().Where(m => m.ThreadId == id);
            List<ChatMessage> list;
            if (after != null)
                list = await q.Where(m => m.CreatedAt > after.Value.ToUniversalTime()).OrderBy(m => m.CreatedAt).Take(limit).ToListAsync(ct);
            else
            {
                if (before != null) q = q.Where(m => m.CreatedAt < before.Value.ToUniversalTime());
                list = (await q.OrderByDescending(m => m.CreatedAt).Take(limit).ToListAsync(ct)).OrderBy(m => m.CreatedAt).ToList();
            }
            var replyIds = list.Where(m => m.ReplyToId != null).Select(m => m.ReplyToId!.Value).Distinct().ToList();
            var replies = replyIds.Count == 0 ? new Dictionary<Guid, ChatMessage>()
                : await _db.ChatMessages.AsNoTracking().Where(m => replyIds.Contains(m.Id)).ToDictionaryAsync(m => m.Id, ct);

            // Fetching counts as "delivered" for me.
            await TouchAsync(id, office, seen: true, read: false, ct);

            // The other side: for an agent's chat, the agent vs. the office; in Team, anyone else.
            var others = _db.ChatReads.AsNoTracking().Where(r => r.ThreadId == id && r.UserId != Me);
            if (t.Kind == "agent") others = office ? others.Where(r => r.UserId == t.AgentId) : others.Where(r => r.IsOffice);
            else if (t.Kind == "direct") { var peer = PeerOf(t); others = others.Where(r => r.UserId == peer); }
            var otherReadAt = await others.MaxAsync(r => (DateTime?)r.LastReadAt, ct);
            var otherSeenAt = await others.MaxAsync(r => r.LastSeenAt, ct);

            var reactions = await ReactionsForAsync(list.Select(m => m.Id).ToList(), ct);
            return Ok(new
            {
                messages = list.Select(m => Shape(m, replies, reactions)),
                otherReadAt,
                otherSeenAt,
                hasMore = after == null && list.Count == limit,
                pinned = await PinnedAsync(t, ct),
                live = LiveFor(t, office, await EveryoneAsync(ct)),
            });
        }

        [HttpPost("threads/{id:guid}/messages")]
        public async Task<IActionResult> Send(Guid id, [FromBody] ChatSendDto dto, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var text = (dto.Text ?? "").Trim();
            if (text.Length == 0) return BadRequest(new { message = "Type a message." });
            if (text.Length > MaxText) text = text[..MaxText];
            return await SaveAsync(t, office, dto, text, null, ct);
        }

        /// <summary>A photo or document, with an optional caption and tagged partner. Up to 15 MB.</summary>
        [HttpPost("threads/{id:guid}/files")]
        [RequestSizeLimit(MaxFileBytes + 1_000_000)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxFileBytes + 1_000_000)]
        public async Task<IActionResult> SendFile(Guid id, [FromForm] IFormFile file, [FromForm] string? clientId, [FromForm] string? text,
            [FromForm] string? contactClientId, [FromForm] Guid? replyToId, [FromForm] double? lat, [FromForm] double? lng, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            if (file == null || file.Length == 0) return BadRequest(new { message = "Choose a file." });
            if (file.Length > MaxFileBytes) return BadRequest(new { message = "Files can be up to 15 MB." });
            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!Allowed.TryGetValue(ext, out var mime))
                return BadRequest(new { message = "Send photos, PDF, Word, Excel, PowerPoint, CSV or text files." });

            var dto = new ChatSendDto { ClientId = clientId, Text = text, ContactClientId = contactClientId, ReplyToId = replyToId, Lat = lat, Lng = lng };
            if (!string.IsNullOrWhiteSpace(clientId))
            {
                var dup = await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(m => m.ClientId == clientId, ct);
                if (dup != null) return Ok(Shape(dup, new()));
            }
            await using var s = file.OpenReadStream();
            var key = await _files.SaveAsync("chat", file.FileName ?? $"file{ext}", s, mime, ct);
            var name = Path.GetFileName(file.FileName ?? $"file{ext}");
            if (name.Length > 120) name = name[^120..];
            var caption = (text ?? "").Trim();
            return await SaveAsync(t, office, dto, caption.Length == 0 ? null : caption[..Math.Min(caption.Length, MaxText)], (key, name, mime, file.Length), ct);
        }

        private async Task<IActionResult> SaveAsync(ChatThread t, bool office, ChatSendDto dto, string? text, (string Key, string Name, string Mime, long Size)? file, CancellationToken ct)
        {
            var clientId = string.IsNullOrWhiteSpace(dto.ClientId) ? Guid.NewGuid().ToString() : dto.ClientId.Trim();
            if (clientId.Length > 64) clientId = clientId[..64];
            var existing = await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(m => m.ClientId == clientId, ct);
            if (existing != null) return Ok(Shape(existing, new()));

            // A tagged partner must exist; an agent can only tag their own partners.
            string? contactId = null, contactName = null;
            if (!string.IsNullOrWhiteSpace(dto.ContactClientId))
            {
                var c = await _db.Contacts.AsNoTracking().Where(x => x.ClientId == dto.ContactClientId && !x.IsMerged)
                    .Select(x => new { x.ClientId, x.Name, x.AgentId }).FirstOrDefaultAsync(ct);
                if (c == null) return BadRequest(new { message = "That partner was not found. If you added them just now, wait for the phone to sync." });
                if (!office && c.AgentId != Me) return BadRequest(new { message = "You can only tag your own partners." });
                contactId = c.ClientId;
                contactName = c.Name;
            }
            Guid? replyTo = null;
            if (dto.ReplyToId != null && await _db.ChatMessages.AnyAsync(m => m.Id == dto.ReplyToId && m.ThreadId == t.Id, ct)) replyTo = dto.ReplyToId;

            var m = new ChatMessage
            {
                ClientId = clientId,
                ThreadId = t.Id,
                SenderId = Me,
                SenderName = MyName,
                FromOffice = office,
                Text = text,
                ContactClientId = contactId,
                ContactName = contactName,
                FileKey = file?.Key,
                FileName = file?.Name,
                FileMime = file?.Mime,
                FileSize = file?.Size,
                Lat = dto.Lat is >= -90 and <= 90 ? dto.Lat : null,
                Lng = dto.Lng is >= -180 and <= 180 ? dto.Lng : null,
                ReplyToId = replyTo,
            };
            _db.ChatMessages.Add(m);
            var tracked = t; // loaded with tracking in AccessAsync
            tracked.LastMessageAt = m.CreatedAt;
            var preview = file != null ? $"📎 {file.Value.Name}" : text ?? "";
            tracked.LastPreview = $"{(t.Kind != "direct" && (t.Kind == "team" || office) ? MyName.Split(' ')[0] + ": " : "")}{(preview.Length > 80 ? preview[..80] + "…" : preview)}";
            await _db.SaveChangesAsync(ct);
            // Sending means I've read everything up to now.
            await TouchAsync(t.Id, office, seen: true, read: true, ct);
            await _live.PublishChatAsync(t.Id);
            await NotifyAsync(t, office, m, ct);
            var replies = replyTo != null ? await _db.ChatMessages.AsNoTracking().Where(x => x.Id == replyTo).ToDictionaryAsync(x => x.Id, ct) : new();
            return Ok(Shape(m, replies));
        }

        [HttpPost("threads/{id:guid}/read")]
        public async Task<IActionResult> Read(Guid id, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            await TouchAsync(id, office, seen: true, read: true, ct);
            // Reading the chat clears its alerts in my bell / inbox too.
            var me = Me;
            var link = $"chat:{id}";
            var alerts = await _db.Notifications.Where(n => n.UserId == me && n.Link == link && n.ReadAt == null).ToListAsync(ct);
            if (alerts.Count > 0)
            {
                foreach (var n in alerts) n.ReadAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
            await _live.PublishChatAsync(id); // the sender's ticks turn blue
            return Ok(new { read = true });
        }

        // ─── Reactions ───────────────────────────────────────────────────────

        /// <summary>Adds my reaction, or takes it back if I had already reacted with that emoji.</summary>
        [HttpPost("threads/{id:guid}/messages/{messageId:guid}/react")]
        public async Task<IActionResult> React(Guid id, Guid messageId, [FromBody] ReactDto dto, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var emoji = (dto.Emoji ?? "").Trim();
            // An emoji is a few UTF-16 units with no letters or digits; this keeps words out of reactions.
            if (emoji.Length == 0 || emoji.Length > 16 || emoji.Any(char.IsLetterOrDigit)) return BadRequest(new { message = "Pick an emoji." });
            if (!await _db.ChatMessages.AnyAsync(m => m.Id == messageId && m.ThreadId == id, ct)) return NotFound();
            var me = Me;
            var mine = await _db.ChatReactions.FirstOrDefaultAsync(r => r.MessageId == messageId && r.UserId == me && r.Emoji == emoji, ct);
            if (mine != null) _db.ChatReactions.Remove(mine);
            else
            {
                if (await _db.ChatReactions.CountAsync(r => r.MessageId == messageId && r.UserId == me, ct) >= 6)
                    return BadRequest(new { message = "That's enough reactions on one message." });
                _db.ChatReactions.Add(new ChatReaction { ThreadId = id, MessageId = messageId, UserId = me, UserName = MyName.Split(' ')[0], Emoji = emoji });
            }
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { /* the same tap twice at once: the first one counts */ }
            await _live.PublishChatAsync(id);
            var r = await ReactionsForAsync(new List<Guid> { messageId }, ct);
            return Ok(new { messageId, reactions = r.GetValueOrDefault(messageId) ?? new List<object>() });
        }

        /// <summary>Reactions on this chat's messages from <c>from</c> on, so a screen can refresh the ones it shows.</summary>
        [HttpGet("threads/{id:guid}/reactions")]
        public async Task<IActionResult> Reactions(Guid id, [FromQuery] DateTime? from, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var since = (from ?? DateTime.UtcNow.AddDays(-7)).ToUniversalTime();
            var ids = _db.ChatMessages.Where(m => m.ThreadId == id && m.CreatedAt >= since).Select(m => m.Id);
            var rows = await _db.ChatReactions.AsNoTracking().Where(r => r.ThreadId == id && ids.Contains(r.MessageId))
                .Select(r => new ReactionRow(r.MessageId, r.UserId, r.UserName, r.Emoji, r.CreatedAt)).Take(2000).ToListAsync(ct);
            return Ok(GroupReactions(rows).ToDictionary(k => k.Key.ToString(), v => v.Value));
        }

        // ─── Pinned message ──────────────────────────────────────────────────

        private async Task<object?> PinnedAsync(ChatThread t, CancellationToken ct)
        {
            var pin = await _db.ChatPins.AsNoTracking().FirstOrDefaultAsync(p => p.ThreadId == t.Id, ct);
            if (pin == null) return null;
            var m = await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == pin.MessageId, ct);
            if (m == null) return null;
            return new { message = Shape(m, new()), pinnedBy = pin.PinnedBy == Me ? "You" : pin.PinnedByName, pinnedAt = pin.PinnedAt };
        }

        /// <summary>
        /// Pins one message at the top of the chat for everyone in it (or unpins with no message). In the Team chat and an
        /// agent's office chat only the office can pin; in a one-to-one chat either person can.
        /// </summary>
        [HttpPut("threads/{id:guid}/pin")]
        public async Task<IActionResult> Pin(Guid id, [FromBody] PinDto dto, CancellationToken ct)
        {
            var (t, office) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            if (t.Kind != "direct" && !office) return StatusCode(403, new { message = "Only the office can pin messages here." });
            var pin = await _db.ChatPins.FirstOrDefaultAsync(p => p.ThreadId == id, ct);
            if (dto.MessageId == null)
            {
                if (pin != null) _db.ChatPins.Remove(pin);
            }
            else
            {
                if (!await _db.ChatMessages.AnyAsync(m => m.Id == dto.MessageId && m.ThreadId == id, ct)) return NotFound();
                if (pin == null) _db.ChatPins.Add(pin = new ChatPin { ThreadId = id });
                pin.MessageId = dto.MessageId.Value;
                pin.PinnedBy = Me;
                pin.PinnedByName = MyName;
                pin.PinnedAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(ct);
            await _live.PublishChatAsync(id);
            return Ok(new { pinned = await PinnedAsync(t, ct) });
        }

        // ─── Search and shared items ─────────────────────────────────────────

        /// <summary>Messages in this chat whose text, file name or tagged partner matches, newest first.</summary>
        [HttpGet("threads/{id:guid}/search")]
        public async Task<IActionResult> Search(Guid id, [FromQuery] string? q, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var term = (q ?? "").Trim().ToLower();
            if (term.Length < 2) return Ok(Array.Empty<object>());
            if (term.Length > 100) term = term[..100];
            var me = Me;
            var hits = await _db.ChatMessages.AsNoTracking()
                .Where(m => m.ThreadId == id && ((m.Text != null && m.Text.ToLower().Contains(term)) || (m.FileName != null && m.FileName.ToLower().Contains(term)) || (m.ContactName != null && m.ContactName.ToLower().Contains(term))))
                .OrderByDescending(m => m.CreatedAt).Take(50)
                .Select(m => new { id = m.Id, createdAt = m.CreatedAt, senderName = m.SenderId == me ? "You" : m.SenderName, text = m.Text, fileName = m.FileName, contactName = m.ContactName })
                .ToListAsync(ct);
            return Ok(hits);
        }

        /// <summary>What was shared in this chat: photos, documents, places and tagged partners (latest first).</summary>
        [HttpGet("threads/{id:guid}/shared")]
        public async Task<IActionResult> Shared(Guid id, CancellationToken ct)
        {
            var (t, _) = await AccessAsync(id, ct);
            if (t == null) return NotFound();
            var rows = await _db.ChatMessages.AsNoTracking()
                .Where(m => m.ThreadId == id && (m.FileKey != null || m.Lat != null || m.ContactClientId != null))
                .OrderByDescending(m => m.CreatedAt).Take(200).ToListAsync(ct);
            var shaped = rows.Select(m => new { m, shape = Shape(m, new()) }).ToList();
            return Ok(new
            {
                media = shaped.Where(x => x.m.FileKey != null && (x.m.FileMime ?? "").StartsWith("image/")).Take(60).Select(x => x.shape),
                files = shaped.Where(x => x.m.FileKey != null && !(x.m.FileMime ?? "").StartsWith("image/")).Take(40).Select(x => x.shape),
                places = shaped.Where(x => x.m.Lat != null && x.m.Lng != null).Take(20).Select(x => x.shape),
                partners = rows.Where(m => m.ContactClientId != null).GroupBy(m => m.ContactClientId!)
                    .Select(g => new { id = g.Key, name = g.First().ContactName, count = g.Count(), lastAt = g.Max(m => m.CreatedAt) })
                    .OrderByDescending(p => p.lastAt).Take(30),
            });
        }

        // ─── Presence ────────────────────────────────────────────────────────

        /// <summary>For each field person: on a visit (and where), on shift, or off — with the time of their last sign of life today.</summary>
        private async Task<Dictionary<string, object>> PresenceAsync(List<string> agentIds, CancellationToken ct)
        {
            var result = new Dictionary<string, object>();
            if (agentIds.Count == 0) return result;
            var today = IstClock.TodayStartUtc;
            var shifts = await _db.Shifts.AsNoTracking().Where(s => agentIds.Contains(s.AgentId) && s.EndTime == null && s.StartTime >= today.AddHours(-12))
                .Select(s => new { s.AgentId, s.StartTime }).ToListAsync(ct);
            var visits = await _db.Visits.AsNoTracking().Where(v => agentIds.Contains(v.AgentId) && v.CheckInAt >= today && v.CheckOutAt == null)
                .Select(v => new { v.AgentId, v.PanchayatId, v.CheckInAt }).ToListAsync(ct);
            var pids = visits.Select(v => v.PanchayatId).Distinct().ToList();
            var pnames = pids.Count == 0 ? new Dictionary<string, string>()
                : await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
            var last = await _db.TrajectoryPoints.AsNoTracking().Where(p => agentIds.Contains(p.AgentId) && p.RecordedAt >= today)
                .GroupBy(p => p.AgentId).Select(g => new { AgentId = g.Key, At = g.Max(p => p.RecordedAt) }).ToListAsync(ct);
            var lastMap = last.ToDictionary(x => x.AgentId, x => x.At);
            foreach (var a in agentIds)
            {
                var v = visits.Where(x => x.AgentId == a).OrderByDescending(x => x.CheckInAt).FirstOrDefault();
                var s = shifts.FirstOrDefault(x => x.AgentId == a);
                DateTime? seen = lastMap.TryGetValue(a, out var l) ? l : null;
                if (v != null) result[a] = new { state = "visit", place = pnames.GetValueOrDefault(v.PanchayatId), since = v.CheckInAt, lastSeenAt = seen };
                else if (s != null) result[a] = new { state = "shift", place = (string?)null, since = s.StartTime, lastSeenAt = seen };
                else result[a] = new { state = "off", place = (string?)null, since = (DateTime?)null, lastSeenAt = seen };
            }
            return result;
        }

        /// <summary>Everyone active, with whether they are in the office and their online / last-seen state.</summary>
        private async Task<Dictionary<string, (bool Office, PresenceView View)>> EveryoneAsync(CancellationToken ct)
        {
            var rows = await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                .Select(a => new { a.AgentId, a.Role, a.LastActiveAt, a.LastActiveOn }).ToListAsync(ct);
            var views = _presence.Merge(rows.Select(r => (r.AgentId, r.LastActiveAt, r.LastActiveOn)), DateTime.UtcNow);
            return rows.ToDictionary(r => r.AgentId, r => (RoleChecks.IsDashboardRole(r.Role), views[r.AgentId]));
        }

        /// <summary>
        /// "Online" / "last seen" for the header and list: the other person in a direct chat; the agent in an agent's
        /// chat (office side); the office in the agent's own chat (anyone in the office online); and how many are online in Team.
        /// </summary>
        private object? LiveFor(ChatThread t, bool office, Dictionary<string, (bool Office, PresenceView View)> everyone)
        {
            var me = Me;
            if (t.Kind == "direct" || (t.Kind == "agent" && office))
            {
                var id = t.Kind == "direct" ? PeerOf(t) : t.AgentId;
                if (id == null || !everyone.TryGetValue(id, out var p)) return null;
                return new { online = p.View.Online, lastSeenAt = p.View.LastSeenAt, on = p.View.On, count = p.View.Online ? 1 : 0 };
            }
            var group = everyone.Where(e => e.Key != me && (t.Kind == "team" || e.Value.Office)).Select(e => e.Value.View).ToList();
            var n = group.Count(v => v.Online);
            return new { online = n > 0, lastSeenAt = group.Max(v => v.LastSeenAt), on = (string?)null, count = n };
        }

        private async Task TouchAsync(Guid threadId, bool office, bool seen, bool read, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var r = await _db.ChatReads.FirstOrDefaultAsync(x => x.ThreadId == threadId && x.UserId == Me, ct);
            if (r == null)
            {
                r = new ChatRead { ThreadId = threadId, UserId = Me, IsOffice = office, LastReadAt = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
                _db.ChatReads.Add(r);
            }
            if (seen) r.LastSeenAt = now;
            if (read) r.LastReadAt = now;
            r.IsOffice = office;
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { /* two requests raced to create the row; the other one won */ }
        }

        // ─── Files ───────────────────────────────────────────────────────────

        /// <summary>Streams a chat file to someone in that chat. No public links exist.</summary>
        [HttpGet("files/{messageId:guid}")]
        public async Task<IActionResult> File(Guid messageId, [FromQuery] bool download = false, CancellationToken ct = default)
        {
            var m = await _db.ChatMessages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == messageId, ct);
            if (m?.FileKey == null) return NotFound();
            var (t, _) = await AccessAsync(m.ThreadId, ct);
            if (t == null) return NotFound();
            var f = await _files.OpenAsync(m.FileKey, ct);
            if (f == null) return NotFound(new { message = "The file is no longer in storage." });
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.Headers["Cache-Control"] = "private, max-age=3600";
            var mime = m.FileMime ?? f.Value.ContentType;
            // Images and PDFs open in place; everything else downloads.
            var inline = !download && (mime.StartsWith("image/") || mime == "application/pdf");
            var name = m.FileName ?? "file";
            Response.Headers["Content-Disposition"] = $"{(inline ? "inline" : "attachment")}; filename*=UTF-8''{Uri.EscapeDataString(name)}";
            return File(f.Value.Content, mime);
        }

        // ─── For the Partners board ──────────────────────────────────────────

        /// <summary>Messages and files tagged with this partner (office: all chats; agent: their own and Team).</summary>
        [HttpGet("partner/{clientId}")]
        public async Task<IActionResult> ForPartner(string clientId, CancellationToken ct)
        {
            var office = await IsOfficeAsync();
            var me = Me;
            var q = _db.ChatMessages.AsNoTracking().Where(m => m.ContactClientId == clientId);
            // Direct chats stay between their two people; otherwise as for the chats themselves.
            var visible = office
                ? _db.ChatThreads.Where(t => t.Kind != "direct" || t.AgentId == me || t.PeerId == me).Select(t => t.Id)
                : _db.ChatThreads.Where(t => t.Kind == "team" || (t.Kind == "agent" && t.AgentId == me) || (t.Kind == "direct" && (t.AgentId == me || t.PeerId == me))).Select(t => t.Id);
            q = q.Where(m => visible.Contains(m.ThreadId));
            var list = await q.OrderByDescending(m => m.CreatedAt).Take(100).ToListAsync(ct);
            return Ok(list.Select(m => Shape(m, new())));
        }
    }
}
