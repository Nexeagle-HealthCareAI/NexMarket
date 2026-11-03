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

        public ChatController(IMarketingDbContext db, IPermissionService perms, IFileStore files, ILiveEvents live, INotifier notifier)
        {
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

        private object Shape(ChatMessage m, Dictionary<Guid, ChatMessage> replies) => new
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

            return Ok(new
            {
                messages = list.Select(m => Shape(m, replies)),
                otherReadAt,
                otherSeenAt,
                hasMore = after == null && list.Count == limit,
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
