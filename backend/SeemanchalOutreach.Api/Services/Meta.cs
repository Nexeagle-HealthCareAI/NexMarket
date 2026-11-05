using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The connection to the hospital's Facebook Page, its Instagram account and its ad account, set up by an admin in
    /// the CRM (Facebook &amp; Instagram → Setup). Secrets are stored encrypted.
    /// </summary>
    public class MetaConfig
    {
        public const string Prefix = "meta.";
        /// <summary>Setting key and whether it is secret.</summary>
        public static readonly (string Key, bool Secret)[] Fields =
        {
            ("appId", false), ("appSecret", true), ("accessToken", true), ("verifyToken", false), ("apiVersion", false),
            ("pageId", false), ("pageName", false), ("pageToken", true), ("igId", false), ("igUsername", false),
            ("adAccountId", false), ("adAccountName", false), ("currency", false), ("connectedAt", false), ("datasetId", false),
        };
        public static IEnumerable<string> SecretKeys => Fields.Where(f => f.Secret).Select(f => Prefix + f.Key);

        public string? AppId { get; set; }
        public string? AppSecret { get; set; }
        /// <summary>A system-user (or long-lived user) token with access to the Page and the ad account.</summary>
        public string? AccessToken { get; set; }
        public string? VerifyToken { get; set; }
        public string ApiVersion { get; set; } = "v21.0";
        public string? PageId { get; set; }
        public string? PageName { get; set; }
        /// <summary>The Page's own token (read from the access token when the Page is picked); used for leads and messages.</summary>
        public string? PageToken { get; set; }
        public string? IgId { get; set; }
        public string? IgUsername { get; set; }
        /// <summary>act_1234…</summary>
        public string? AdAccountId { get; set; }
        public string? AdAccountName { get; set; }
        public string? Currency { get; set; }
        public string? ConnectedAt { get; set; }
        /// <summary>The dataset (pixel) that receives lead stages from the CRM (Conversions API for CRM). Empty = off.</summary>
        public string? DatasetId { get; set; }

        public bool PageConnected => !string.IsNullOrWhiteSpace(PageId) && !string.IsNullOrWhiteSpace(PageToken);

        public static MetaConfig Load(IAppSettings s)
        {
            string? g(string k) { var v = s.Get(Prefix + k); return string.IsNullOrWhiteSpace(v) ? null : v; }
            return new MetaConfig
            {
                AppId = g("appId"), AppSecret = g("appSecret"), AccessToken = g("accessToken"), VerifyToken = g("verifyToken"),
                ApiVersion = g("apiVersion") ?? "v21.0", PageId = g("pageId"), PageName = g("pageName"), PageToken = g("pageToken"),
                IgId = g("igId"), IgUsername = g("igUsername"), AdAccountId = g("adAccountId"), AdAccountName = g("adAccountName"),
                Currency = g("currency"), ConnectedAt = g("connectedAt"), DatasetId = g("datasetId"),
            };
        }
    }

    /// <summary>Reads and writes the Meta Graph API.</summary>
    public class MetaGraph
    {
        private readonly IHttpClientFactory _http;
        private readonly ILogger<MetaGraph> _log;

        public MetaGraph(IHttpClientFactory http, ILogger<MetaGraph> log)
        {
            _http = http;
            _log = log;
        }

        public async Task<(bool Ok, JsonDocument? Doc, string? Error)> GetAsync(string version, string pathAndQuery, string? token, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(token)) return (false, null, "Not connected to Facebook yet.");
            return await SendAsync(new HttpRequestMessage(HttpMethod.Get, Url(version, pathAndQuery)), token, ct);
        }

        public async Task<(bool Ok, JsonDocument? Doc, string? Error)> PostAsync(string version, string path, string? token, object? body, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(token)) return (false, null, "Not connected to Facebook yet.");
            var req = new HttpRequestMessage(HttpMethod.Post, Url(version, path));
            if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            return await SendAsync(req, token, ct);
        }

        private static string Url(string version, string path) => $"https://graph.facebook.com/{version}/{path.TrimStart('/')}";

        private async Task<(bool Ok, JsonDocument? Doc, string? Error)> SendAsync(HttpRequestMessage req, string token, CancellationToken ct)
        {
            try
            {
                using (req)
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    var client = _http.CreateClient("meta");
                    using var res = await client.SendAsync(req, ct);
                    var body = await res.Content.ReadAsStringAsync(ct);
                    JsonDocument? doc = null;
                    try { doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body); } catch (JsonException) { /* not JSON */ }
                    if (res.IsSuccessStatusCode) return (true, doc ?? JsonDocument.Parse("{}"), null);
                    var msg = doc != null && doc.RootElement.TryGetProperty("error", out var e) && e.TryGetProperty("message", out var m) ? m.GetString() : null;
                    doc?.Dispose();
                    return (false, null, msg ?? $"Facebook said {(int)res.StatusCode}.");
                }
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                _log.LogWarning(ex, "Meta Graph call failed");
                return (false, null, "Could not reach Facebook.");
            }
        }
    }

    /// <summary>
    /// Everything that comes in from Facebook and Instagram: Lead Ads forms become leads, Page and Instagram messages
    /// land in the social inbox (and become leads once they share a phone number), and replies go back out.
    /// </summary>
    public class MetaService
    {
        private static readonly ConcurrentDictionary<string, string> FormNames = new();
        private static readonly Regex PhoneInText = new(@"(?<!\d)(?:\+?91[\s-]?|0)?([6-9]\d{4}[\s-]?\d{5})(?!\d)");

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly MetaGraph _graph;
        private readonly INotifier _notifier;
        private readonly IPermissionService _perms;
        private readonly WhatsAppOutbox _outbox;
        private readonly ILogger<MetaService> _log;

        public MetaService(IMarketingDbContext db, IAppSettings settings, MetaGraph graph, INotifier notifier, IPermissionService perms, WhatsAppOutbox outbox, ILogger<MetaService> log)
        {
            _outbox = outbox;
            _db = db;
            _settings = settings;
            _graph = graph;
            _notifier = notifier;
            _perms = perms;
            _log = log;
        }

        public MetaConfig Config => MetaConfig.Load(_settings);

        public static string? Str(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
                ? v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False ? v.GetRawText() : null
                : null;

        // ─── Webhook ───

        /// <summary>Handles one webhook delivery. Each event is saved on its own, so one bad event doesn't lose the rest.</summary>
        public async Task HandleWebhookAsync(JsonElement root, CancellationToken ct)
        {
            var obj = Str(root, "object");
            if (!root.TryGetProperty("entry", out var entries) || entries.ValueKind != JsonValueKind.Array) return;
            foreach (var entry in entries.EnumerateArray())
            {
                if (entry.TryGetProperty("changes", out var changes) && changes.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ch in changes.EnumerateArray())
                    {
                        if (Str(ch, "field") != "leadgen" || !ch.TryGetProperty("value", out var v)) continue;
                        var id = Str(v, "leadgen_id");
                        if (id == null) continue;
                        await SafeAsync(() => ProcessLeadgenAsync(id, ct), "lead form");
                    }
                }
                if (entry.TryGetProperty("messaging", out var messaging) && messaging.ValueKind == JsonValueKind.Array)
                {
                    var channel = obj == "instagram" ? "instagram" : "messenger";
                    foreach (var ev in messaging.EnumerateArray()) await SafeAsync(() => ProcessMessagingAsync(channel, ev, ct), channel + " message");
                }
            }
        }

        private async Task SafeAsync(Func<Task> work, string what)
        {
            try { await work(); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Facebook {What} could not be saved", what);
                if (_db is DbContext ctx) ctx.ChangeTracker.Clear();
            }
        }

        // ─── Lead Ads ───

        /// <summary>Reads a Lead Ads submission from Meta and turns it into a lead (once; repeats are ignored).</summary>
        public async Task<AdLead?> ProcessLeadgenAsync(string leadgenId, CancellationToken ct)
        {
            if (await _db.AdLeads.AsNoTracking().AnyAsync(x => x.LeadgenId == leadgenId, ct)) return null;
            var cfg = Config;
            var res = await _graph.GetAsync(cfg.ApiVersion,
                $"{leadgenId}?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic", cfg.PageToken, ct);
            var ad = new AdLead { LeadgenId = leadgenId, PageId = cfg.PageId, ReceivedAt = DateTime.UtcNow };
            if (!res.Ok || res.Doc == null)
            {
                ad.Error = res.Error;
                _db.AdLeads.Add(ad);
                await _db.SaveChangesAsync(ct);
                NotifyDesk($"A Facebook lead couldn't be read", $"Check Facebook & Instagram → Setup. {res.Error}", "social:forms", leadgenId, await DeskAsync(ct));
                return ad;
            }
            using (res.Doc) FillFromLead(ad, res.Doc.RootElement);
            if (ad.FormId != null) ad.FormName = await FormNameAsync(cfg, ad.FormId, ct);
            await SaveAdLeadAsync(ad, ct);
            return ad;
        }

        private static void FillFromLead(AdLead ad, JsonElement r)
        {
            ad.AdId = Str(r, "ad_id");
            ad.AdName = Str(r, "ad_name");
            ad.AdsetName = Str(r, "adset_name");
            ad.CampaignId = Str(r, "campaign_id");
            ad.CampaignName = Str(r, "campaign_name");
            ad.FormId = Str(r, "form_id");
            ad.Platform = (Str(r, "platform") ?? "fb").ToLowerInvariant() is "ig" or "instagram" ? "ig" : "fb";
            ad.IsOrganic = Str(r, "is_organic") == "true";
            if (DateTime.TryParse(Str(r, "created_time"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t)) ad.CreatedAt = t;
            if (r.TryGetProperty("field_data", out var fd) && fd.ValueKind == JsonValueKind.Array)
            {
                ad.FieldsJson = fd.GetRawText();
                string? val(params string[] names) => fd.EnumerateArray()
                    .Where(f => names.Contains((Str(f, "name") ?? "").ToLowerInvariant()))
                    .Select(f => f.TryGetProperty("values", out var vs) && vs.ValueKind == JsonValueKind.Array ? vs.EnumerateArray().Select(x => x.ToString()).FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)) : null)
                    .FirstOrDefault(x => x != null);
                ad.Name = val("full_name", "name") ?? string.Join(" ", new[] { val("first_name"), val("last_name") }.Where(x => x != null));
                if (string.IsNullOrWhiteSpace(ad.Name)) ad.Name = null;
                ad.Phone = LeadInbox.NormalizePhone(val("phone_number", "phone", "mobile", "mobile_number", "whatsapp_number"));
            }
        }

        private async Task<string?> FormNameAsync(MetaConfig cfg, string formId, CancellationToken ct)
        {
            if (FormNames.TryGetValue(formId, out var n)) return n;
            var r = await _graph.GetAsync(cfg.ApiVersion, $"{formId}?fields=name", cfg.PageToken, ct);
            if (!r.Ok || r.Doc == null) return null;
            using (r.Doc)
            {
                var name = Str(r.Doc.RootElement, "name");
                if (name != null) FormNames[formId] = name;
                return name;
            }
        }

        /// <summary>The answers that aren't name or phone, as "Question: answer" lines, for the lead's note.</summary>
        public static List<(string Q, string A)> Answers(string? fieldsJson)
        {
            var list = new List<(string, string)>();
            if (string.IsNullOrWhiteSpace(fieldsJson)) return list;
            try
            {
                using var doc = JsonDocument.Parse(fieldsJson);
                foreach (var f in doc.RootElement.EnumerateArray())
                {
                    var name = Str(f, "name") ?? "";
                    var values = f.TryGetProperty("values", out var vs) && vs.ValueKind == JsonValueKind.Array ? string.Join(", ", vs.EnumerateArray().Select(x => x.ToString())) : "";
                    list.Add((Pretty(name), values));
                }
            }
            catch (JsonException) { /* keep what we have */ }
            return list;
        }

        private static string Pretty(string key)
        {
            var k = key.Replace('_', ' ').Trim();
            return k.Length == 0 ? key : char.ToUpperInvariant(k[0]) + k[1..];
        }

        private async Task SaveAdLeadAsync(AdLead ad, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            _db.AdLeads.Add(ad);
            Lead? lead = null;
            bool isNew = false;
            var where = ad.Platform == "ig" ? "Instagram" : "Facebook";
            var source = ad.Platform == "ig" ? "ig_form" : "fb_form";
            var from = ad.CampaignName ?? ad.FormName ?? (ad.IsOrganic ? "Page form" : null);
            var extra = Answers(ad.FieldsJson).Where(a => !IsNameOrPhone(a.Q)).Select(a => $"{a.Q}: {a.A}").ToList();
            if (ad.Phone != null)
            {
                lead = _db.Leads.Local.FirstOrDefault(l => l.Phone == ad.Phone) ?? await _db.Leads.FirstOrDefaultAsync(l => l.Phone == ad.Phone, ct);
                if (lead == null)
                {
                    isNew = true;
                    lead = new Lead
                    {
                        Phone = ad.Phone, Name = ad.Name ?? "+" + ad.Phone, Source = source, SourceRef = from,
                        Note = extra.Count > 0 ? LeadInbox.Shorten(string.Join("\n", extra), 500) : null, CreatedAt = now,
                        LastActivityAt = now,
                    };
                    _db.Leads.Add(lead);
                    _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "created", CreatedAt = now, Text = $"Filled the {where} form{(from != null ? $" ({from})" : "")}" });
                    await LeadInbox.AutoAssignAsync(_db, WaAutomation.Load(_settings), lead, now, ct);
                }
                else
                {
                    if (lead.ClosedAt != null && lead.ClosedAt < now.AddDays(-7))
                    {
                        lead.Status = "new"; lead.ClosedAt = null; lead.FirstResponseAt = null; lead.LostReason = null;
                        isNew = true;
                    }
                    lead.LastActivityAt = now;
                    if (lead.Name.StartsWith("+") && ad.Name != null) lead.Name = ad.Name;
                    _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "note", CreatedAt = now, Text = $"Filled the {where} form again{(from != null ? $" ({from})" : "")}" + (extra.Count > 0 ? "\n" + string.Join("\n", extra) : "") });
                }
                ad.LeadId = lead.Id;
            }
            await _db.SaveChangesAsync(ct);

            // The first minute matters most: a new form lead gets a WhatsApp thank-you straight away, when a template is chosen
            // for it (WhatsApp → Setup → "Facebook/Instagram form: instant thank-you"). Their reply opens a normal chat.
            if (lead != null && isNew && _outbox.Config.Template("form_welcome") != null)
            {
                try
                {
                    var first = (lead.Name.StartsWith("+") ? "" : lead.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()) ?? "";
                    var cfgWa = _outbox.Config;
                    await _outbox.SendUseAsync(lead.Phone, "form_welcome", "hi", new[] { first.Length > 0 ? first : "जी", cfgWa.HospitalName },
                        $"Thank-you for filling the {where} form ({cfgWa.Template("form_welcome")})", "form_welcome", null, lead.Id, null, ct);
                    await _db.SaveChangesAsync(ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogWarning(ex, "Instant WhatsApp to a form lead failed"); }
            }

            var to = lead?.OwnerId != null ? new List<string> { lead.OwnerId } : await DeskAsync(ct);
            NotifyDesk(
                lead == null ? $"{where} form filled without a phone number" : isNew ? $"New lead: {lead.Name} ({where} form)" : $"{lead.Name} filled the {where} form again",
                from ?? "Lead Ads", lead != null ? $"lead:{lead.Id}" : "social:forms", lead?.Id.ToString() ?? ad.LeadgenId, to);
        }

        private static bool IsNameOrPhone(string q)
        {
            var k = q.ToLowerInvariant().Replace(' ', '_');
            return k is "full_name" or "name" or "first_name" or "last_name" or "phone_number" or "phone" or "mobile" or "mobile_number" or "whatsapp_number";
        }

        /// <summary>
        /// Fetches Lead Ads submissions from the last <paramref name="days"/> days for every form on the Page, and adds
        /// any the webhook missed. Returns how many were new.
        /// </summary>
        public async Task<(int Added, string? Error)> SyncLeadFormsAsync(int days, CancellationToken ct)
        {
            var cfg = Config;
            if (!cfg.PageConnected) return (0, "Connect the Facebook Page first.");
            var forms = await _graph.GetAsync(cfg.ApiVersion, $"{cfg.PageId}/leadgen_forms?fields=id,name&limit=100", cfg.PageToken, ct);
            if (!forms.Ok || forms.Doc == null) return (0, forms.Error);
            var since = new DateTimeOffset(DateTime.UtcNow.AddDays(-Math.Clamp(days, 1, 90))).ToUnixTimeSeconds();
            var added = 0;
            var ids = new List<(string Id, string? Name)>();
            using (forms.Doc)
                if (forms.Doc.RootElement.TryGetProperty("data", out var fs))
                    foreach (var f in fs.EnumerateArray()) if (Str(f, "id") is { } id) ids.Add((id, Str(f, "name")));
            foreach (var (formId, formName) in ids)
            {
                if (formName != null) FormNames[formId] = formName;
                var filter = Uri.EscapeDataString($"[{{\"field\":\"time_created\",\"operator\":\"GREATER_THAN\",\"value\":{since}}}]");
                var path = $"{formId}/leads?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic&limit=100&filtering={filter}";
                for (var pageNo = 0; pageNo < 20 && path != null; pageNo++)
                {
                    var r = await _graph.GetAsync(cfg.ApiVersion, path, cfg.PageToken, ct);
                    if (!r.Ok || r.Doc == null) return (added, r.Error);
                    string? next = null;
                    using (r.Doc)
                    {
                        var root = r.Doc.RootElement;
                        if (root.TryGetProperty("data", out var leads))
                        {
                            foreach (var l in leads.EnumerateArray())
                            {
                                var id = Str(l, "id");
                                if (id == null || await _db.AdLeads.AsNoTracking().AnyAsync(x => x.LeadgenId == id, ct)) continue;
                                var ad = new AdLead { LeadgenId = id, PageId = cfg.PageId, ReceivedAt = DateTime.UtcNow };
                                FillFromLead(ad, l);
                                ad.FormName ??= formName;
                                await SaveAdLeadAsync(ad, ct);
                                added++;
                            }
                        }
                        if (root.TryGetProperty("paging", out var pg) && pg.TryGetProperty("cursors", out var cur) && Str(cur, "after") is { } after && Str(pg, "next") != null)
                            next = $"{formId}/leads?fields=created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic&limit=100&filtering={filter}&after={Uri.EscapeDataString(after)}";
                    }
                    path = next;
                }
            }
            return (added, null);
        }

        // ─── Messenger & Instagram ───

        private async Task ProcessMessagingAsync(string channel, JsonElement ev, CancellationToken ct)
        {
            if (!ev.TryGetProperty("message", out var message)) return; // reads, reactions, postbacks: not stored
            var cfg = Config;
            var sender = ev.TryGetProperty("sender", out var s) ? Str(s, "id") : null;
            var recipient = ev.TryGetProperty("recipient", out var rc) ? Str(rc, "id") : null;
            if (sender == null || recipient == null) return;
            var echo = Str(message, "is_echo") == "true";
            var own = new[] { cfg.PageId, cfg.IgId }.Where(x => x != null).ToHashSet();
            if (!echo && own.Contains(sender)) echo = true;
            var person = echo ? recipient : sender;
            var mid = Str(message, "mid");
            if (mid != null && await _db.SocialMessages.AsNoTracking().AnyAsync(x => x.ExternalId == mid, ct)) return; // already have it (e.g. our own reply)

            var text = Str(message, "text");
            var type = "text";
            if (text == null && message.TryGetProperty("attachments", out var att) && att.ValueKind == JsonValueKind.Array && att.GetArrayLength() > 0)
            {
                type = Str(att[0], "type") switch { "image" => "image", "video" => "video", "audio" => "audio", "file" => "file", "story_mention" => "story_reply", _ => "other" };
                text = type switch { "image" => "📷 Photo", "video" => "🎥 Video", "audio" => "🎤 Voice message", "file" => "📎 File", "story_reply" => "Mentioned the hospital in their story", _ => "Attachment" };
            }
            if (message.TryGetProperty("reply_to", out var rt) && rt.TryGetProperty("story", out _)) type = "story_reply";
            var at = ev.TryGetProperty("timestamp", out var ts) && ts.TryGetInt64(out var ms) ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : DateTime.UtcNow;

            var conv = await _db.SocialConversations.FirstOrDefaultAsync(c => c.Channel == channel && c.ExternalId == person, ct);
            var isNewConv = conv == null;
            if (conv == null)
            {
                conv = new SocialConversation { Channel = channel, ExternalId = person, PageId = cfg.PageId, CreatedAt = at, LastMessageAt = at };
                await FillProfileAsync(cfg, conv, ct);
                _db.SocialConversations.Add(conv);
            }
            var msg = new SocialMessage
            {
                ConversationId = conv.Id, Direction = echo ? "out" : "in", Type = type, Text = text, ExternalId = mid,
                Status = echo ? "sent" : "received", CreatedAt = at,
            };
            _db.SocialMessages.Add(msg);
            conv.LastMessage = LeadInbox.Shorten(text, 160);
            conv.LastDirection = msg.Direction;
            conv.LastMessageAt = at;
            if (echo) { await _db.SaveChangesAsync(ct); return; }

            conv.LastInboundAt = at;
            conv.Unread++;
            conv.Status = "open";

            // A phone number in the message makes them a lead (or links them to the one they already are).
            Lead? lead = conv.LeadId != null ? await _db.Leads.FirstOrDefaultAsync(l => l.Id == conv.LeadId, ct) : null;
            bool newLead = false;
            if (lead == null && text != null && PhoneInText.Match(text) is { Success: true } m && LeadInbox.NormalizePhone(m.Groups[1].Value) is { } phone)
            {
                (lead, newLead) = await LinkLeadAsync(conv, phone, null, null, ct);
            }
            if (lead != null)
            {
                lead.LastActivityAt = at;
                lead.LastMessage = LeadInbox.Shorten(text, 160);
                if (lead.Status is "lost" && lead.ClosedAt < at.AddDays(-7)) { lead.Status = "new"; lead.ClosedAt = null; lead.FirstResponseAt = null; }
            }
            await _db.SaveChangesAsync(ct);

            var where = channel == "instagram" ? "Instagram" : "Facebook";
            var owner = lead?.OwnerId ?? conv.AssignedTo;
            NotifyDesk(newLead ? $"New lead: {lead!.Name} ({where} message)" : $"{where} message from {conv.Name}",
                string.IsNullOrEmpty(text) ? "(message)" : LeadInbox.Shorten(text, 200),
                $"social:{conv.Id}", conv.Id.ToString(), owner != null ? new List<string> { owner } : await DeskAsync(ct));
            if (isNewConv) _log.LogInformation("New {Channel} conversation", channel);
        }

        private async Task FillProfileAsync(MetaConfig cfg, SocialConversation conv, CancellationToken ct)
        {
            var fields = conv.Channel == "instagram" ? "name,username" : "first_name,last_name,name";
            var r = await _graph.GetAsync(cfg.ApiVersion, $"{conv.ExternalId}?fields={fields}", cfg.PageToken, ct);
            if (r.Ok && r.Doc != null)
            {
                using (r.Doc)
                {
                    var p = r.Doc.RootElement;
                    conv.Username = Str(p, "username");
                    conv.Name = Str(p, "name") ?? string.Join(" ", new[] { Str(p, "first_name"), Str(p, "last_name") }.Where(x => x != null)).Trim();
                }
            }
            if (string.IsNullOrWhiteSpace(conv.Name)) conv.Name = conv.Username != null ? "@" + conv.Username : (conv.Channel == "instagram" ? "Instagram user" : "Facebook user");
        }

        /// <summary>Links a conversation to the lead with this phone number, creating the lead if there isn't one.</summary>
        public async Task<(Lead Lead, bool IsNew)> LinkLeadAsync(SocialConversation conv, string phone, string? name, string? by, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            conv.Phone = phone;
            var where = conv.Channel == "instagram" ? "Instagram" : "Facebook";
            var lead = _db.Leads.Local.FirstOrDefault(l => l.Phone == phone) ?? await _db.Leads.FirstOrDefaultAsync(l => l.Phone == phone, ct);
            var isNew = lead == null;
            if (lead == null)
            {
                lead = new Lead
                {
                    Phone = phone, Name = !string.IsNullOrWhiteSpace(name) ? name!.Trim() : conv.Name, Source = conv.Channel == "instagram" ? "instagram" : "facebook",
                    SourceRef = conv.Username != null ? "@" + conv.Username : null, Note = conv.LastMessage, CreatedAt = now, CreatedBy = by, LastActivityAt = now,
                };
                _db.Leads.Add(lead);
                _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "created", By = by, CreatedAt = now, Text = $"Messaged the hospital on {where}" + (by == null ? " and shared their number" : "") });
                await LeadInbox.AutoAssignAsync(_db, WaAutomation.Load(_settings), lead, now, ct);
            }
            else
            {
                _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "note", By = by, CreatedAt = now, Text = $"Also messaged on {where}{(conv.Username != null ? $" (@{conv.Username})" : "")}" });
            }
            conv.LeadId = lead.Id;
            conv.AssignedTo ??= lead.OwnerId;
            return (lead, isNew);
        }

        /// <summary>
        /// A reply from the CRM. Meta only delivers free replies within 24 hours of the person's last message, so the
        /// caller checks that first. Saves the message either way (failed ones show why).
        /// </summary>
        public async Task<SocialMessage> ReplyAsync(SocialConversation conv, string text, string by, CancellationToken ct)
        {
            var cfg = Config;
            var msg = new SocialMessage { ConversationId = conv.Id, Direction = "out", Type = "text", Text = text, SentBy = by, CreatedAt = DateTime.UtcNow };
            var r = await _graph.PostAsync(cfg.ApiVersion, $"{cfg.PageId}/messages", cfg.PageToken, new
            {
                recipient = new { id = conv.ExternalId },
                messaging_type = "RESPONSE",
                message = new { text },
            }, ct);
            if (r.Ok && r.Doc != null)
            {
                using (r.Doc) msg.ExternalId = Str(r.Doc.RootElement, "message_id");
                msg.Status = "sent";
            }
            else { msg.Status = "failed"; msg.Error = r.Error; }
            _db.SocialMessages.Add(msg);
            if (msg.Status == "sent")
            {
                conv.LastMessage = LeadInbox.Shorten(text, 160);
                conv.LastDirection = "out";
                conv.LastMessageAt = msg.CreatedAt;
                conv.AssignedTo ??= by;
            }
            return msg;
        }

        // ─── Ads ───

        public class AdsCampaign
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public string? Status { get; set; }
            public decimal Spend { get; set; }
            public long Impressions { get; set; }
            public long Reach { get; set; }
            public long Clicks { get; set; }
            /// <summary>Leads Meta counted (forms filled).</summary>
            public long MetaLeads { get; set; }
            /// <summary>Message conversations the ad started (click-to-WhatsApp / Messenger / Instagram).</summary>
            public long Chats { get; set; }
            /// <summary>Lead form submissions that reached the CRM.</summary>
            public int CrmLeads { get; set; }
            /// <summary>Of those, how many came to the hospital (arrived or admitted).</summary>
            public int Arrived { get; set; }
            public decimal? CostPerLead { get; set; }
            public decimal? CostPerArrival { get; set; }
        }

        /// <summary>Spend and results per campaign from the ad account, joined with the leads that reached the CRM.</summary>
        public async Task<(List<AdsCampaign> Rows, string? Currency, string? Error)> AdsAsync(DateOnly from, DateOnly to, CancellationToken ct)
        {
            var cfg = Config;
            if (string.IsNullOrWhiteSpace(cfg.AdAccountId)) return (new(), null, "Pick the ad account in Setup.");
            var range = Uri.EscapeDataString($"{{\"since\":\"{from:yyyy-MM-dd}\",\"until\":\"{to:yyyy-MM-dd}\"}}");
            var rows = new Dictionary<string, AdsCampaign>();
            string? path = $"{cfg.AdAccountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,reach,clicks,actions&time_range={range}&limit=200";
            for (var i = 0; i < 10 && path != null; i++)
            {
                var r = await _graph.GetAsync(cfg.ApiVersion, path, cfg.AccessToken, ct);
                if (!r.Ok || r.Doc == null) return (rows.Values.ToList(), cfg.Currency, r.Error);
                using (r.Doc)
                {
                    var root = r.Doc.RootElement;
                    if (root.TryGetProperty("data", out var data))
                    {
                        foreach (var x in data.EnumerateArray())
                        {
                            var id = Str(x, "campaign_id") ?? "";
                            var row = new AdsCampaign
                            {
                                Id = id, Name = Str(x, "campaign_name") ?? id,
                                Spend = Dec(Str(x, "spend")), Impressions = (long)Dec(Str(x, "impressions")), Reach = (long)Dec(Str(x, "reach")), Clicks = (long)Dec(Str(x, "clicks")),
                            };
                            if (x.TryGetProperty("actions", out var acts))
                            {
                                foreach (var a in acts.EnumerateArray())
                                {
                                    var t = Str(a, "action_type") ?? "";
                                    var v = (long)Dec(Str(a, "value"));
                                    if (t is "lead" or "onsite_conversion.lead_grouped" or "leadgen_grouped") row.MetaLeads = Math.Max(row.MetaLeads, v);
                                    if (t == "onsite_conversion.messaging_conversation_started_7d") row.Chats = Math.Max(row.Chats, v);
                                }
                            }
                            rows[id] = row;
                        }
                    }
                    path = root.TryGetProperty("paging", out var pg) && Str(pg, "next") != null && pg.TryGetProperty("cursors", out var cur) && Str(cur, "after") is { } after
                        ? $"{cfg.AdAccountId}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,reach,clicks,actions&time_range={range}&limit=200&after={Uri.EscapeDataString(after)}"
                        : null;
                }
            }

            // Leads that reached the CRM from each campaign in the same dates (India time), and how many came in.
            var fromUtc = DateTime.SpecifyKind(from.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc) - IstClock.Offset;
            var toUtc = DateTime.SpecifyKind(to.AddDays(1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc) - IstClock.Offset;
            var crm = await (from a in _db.AdLeads.AsNoTracking()
                             where a.CampaignId != null && a.CreatedAt >= fromUtc && a.CreatedAt < toUtc
                             join l in _db.Leads.AsNoTracking() on a.LeadId equals (Guid?)l.Id into lj
                             from l in lj.DefaultIfEmpty()
                             select new { a.CampaignId, a.CampaignName, Status = l != null ? l.Status : null }).ToListAsync(ct);
            foreach (var g in crm.GroupBy(x => x.CampaignId!))
            {
                if (!rows.TryGetValue(g.Key, out var row)) rows[g.Key] = row = new AdsCampaign { Id = g.Key, Name = g.First().CampaignName ?? g.Key };
                row.CrmLeads = g.Count();
                row.Arrived = g.Count(x => x.Status is "arrived" or "admitted");
            }
            foreach (var row in rows.Values)
            {
                var leads = row.MetaLeads > 0 ? row.MetaLeads : row.CrmLeads;
                row.CostPerLead = leads > 0 && row.Spend > 0 ? Math.Round(row.Spend / leads, 2) : null;
                row.CostPerArrival = row.Arrived > 0 && row.Spend > 0 ? Math.Round(row.Spend / row.Arrived, 2) : null;
            }
            return (rows.Values.OrderByDescending(x => x.Spend).ThenByDescending(x => x.CrmLeads).ToList(), cfg.Currency, null);
        }

        private static decimal Dec(string? s) => decimal.TryParse(s, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : 0;

        // ─── Helpers ───

        private Task<List<string>> DeskAsync(CancellationToken ct) => LeadInbox.DeskPeopleAsync(_db, _perms, ct);

        private void NotifyDesk(string title, string body, string link, string refId, List<string> to)
        {
            if (to.Count == 0) return;
            _notifier.Notify(new NotifyJob { To = to, Kind = "lead", Title = title, Body = body, Link = link, RefId = refId });
        }
    }
}
