using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// How the CRM reaches the website's repository on GitHub. Saved in the CRM (Website → Setup); the app's private key
    /// and the token are stored encrypted. Either a GitHub App (app id + private key) or a fine-grained token works.
    /// </summary>
    public class SiteConfig
    {
        public const string Prefix = "site.";
        public static readonly (string Key, bool Secret)[] Fields =
        {
            ("repoOwner", false), ("repoName", false), ("branch", false), ("contentDir", false), ("mediaDir", false), ("siteUrl", false),
            ("appId", false), ("privateKey", true), ("token", true), ("reviewTypes", false), ("departments", false), ("ai", false),
            ("connectedAt", false), ("importedAt", false),
        };
        public static IEnumerable<string> SecretKeys => Fields.Where(f => f.Secret).Select(f => Prefix + f.Key);

        public string? RepoOwner { get; set; }
        public string? RepoName { get; set; }
        /// <summary>The branch the live website is built from.</summary>
        public string Branch { get; set; } = "main";
        public string ContentDir { get; set; } = "content";
        public string MediaDir { get; set; } = "public/media/blogs";
        public string? SiteUrl { get; set; }
        public string? AppId { get; set; }
        public string? PrivateKey { get; set; }
        public string? Token { get; set; }
        /// <summary>Content types a named reviewer must approve before publishing.</summary>
        public List<string> ReviewTypes { get; set; } = new() { "article" };
        public List<string> Departments { get; set; } = SiteRules.DefaultDepartments.ToList();
        public bool Ai { get; set; }
        public string? ConnectedAt { get; set; }
        public string? ImportedAt { get; set; }

        public bool HasKey => !string.IsNullOrWhiteSpace(Token) || (!string.IsNullOrWhiteSpace(AppId) && !string.IsNullOrWhiteSpace(PrivateKey));
        public bool Connected => !string.IsNullOrWhiteSpace(RepoOwner) && !string.IsNullOrWhiteSpace(RepoName) && HasKey;
        public string Repo => $"{RepoOwner}/{RepoName}";
        public string FilePath(string name) => ContentDir.Trim('/') + "/" + name;
        /// <summary>Where a picture in the media folder is reached on the website ("public/media/blogs" → "/media/blogs").</summary>
        public string MediaUrl(string file)
        {
            var dir = MediaDir.Trim('/');
            if (dir.StartsWith("public/", StringComparison.Ordinal)) dir = dir["public/".Length..];
            else if (dir == "public") dir = "";
            return "/" + (dir.Length > 0 ? dir + "/" : "") + file;
        }

        public static List<string> ListOf(string? v, IEnumerable<string> fallback)
        {
            var list = (v ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(x => x.ToLowerInvariant()).Distinct().ToList();
            return v == null ? fallback.ToList() : list;
        }

        public static SiteConfig Load(IAppSettings s)
        {
            string? g(string k) { var v = s.Get(Prefix + k); return string.IsNullOrWhiteSpace(v) ? null : v.Trim(); }
            return new SiteConfig
            {
                RepoOwner = g("repoOwner"), RepoName = g("repoName"), Branch = g("branch") ?? "main", ContentDir = g("contentDir") ?? "content",
                MediaDir = g("mediaDir") ?? "public/media/blogs", SiteUrl = g("siteUrl")?.TrimEnd('/'), AppId = g("appId"), PrivateKey = g("privateKey"), Token = g("token"),
                ReviewTypes = ListOf(s.Get(Prefix + "reviewTypes"), new[] { "article" }).Where(SiteRules.Types.Contains).ToList(),
                Departments = g("departments") == null ? SiteRules.DefaultDepartments.ToList() : ListOf(g("departments"), SiteRules.DefaultDepartments).Where(SiteRules.SlugOk).ToList(),
                Ai = g("ai") == "on", ConnectedAt = g("connectedAt"), ImportedAt = g("importedAt"),
            };
        }
    }

    /// <summary>
    /// The rules for website content, with no database or network in them so they can be tested:
    /// what a valid article, question or hospital-details record is (the same checks the website's own build makes),
    /// who may move it where, and the exact files the website is given.
    /// </summary>
    public static class SiteRules
    {
        public static readonly string[] Types = { "article", "faq", "site" };
        public static readonly string[] FaqCategories = { "appointment", "consultation", "hospital", "medical" };
        public static readonly string[] DefaultDepartments = { "urology", "ent", "general-medicine", "anesthesiology", "neurology" };
        public static readonly string[] SiteKeys = { "phone", "whatsappNumber", "email", "website", "consultationTimings", "emergencyInfo", "description", "medicalDisclaimer" };
        public static readonly Dictionary<string, string> SiteLabels = new()
        {
            ["phone"] = "Phone number", ["whatsappNumber"] = "WhatsApp number", ["email"] = "Email", ["website"] = "Website address",
            ["consultationTimings"] = "Consultation timings", ["emergencyInfo"] = "Emergency information", ["description"] = "Short description of the hospital",
            ["medicalDisclaimer"] = "Medical disclaimer",
        };

        public const int TitleBest = 60;
        public const int ExcerptMin = 70;
        public const int ExcerptMax = 160;
        public const int MaxSections = 30;
        public const int MaxImageBytes = 2 * 1024 * 1024;
        public static readonly Dictionary<string, string> ImageTypes = new() { ["image/jpeg"] = "jpg", ["image/png"] = "png", ["image/webp"] = "webp" };

        private static readonly Regex SlugRx = new("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.Compiled);
        public static bool SlugOk(string? s) => !string.IsNullOrEmpty(s) && s.Length <= 80 && SlugRx.IsMatch(s);

        /// <summary>"Kidney Stones: What to Do?" → "kidney-stones-what-to-do".</summary>
        public static string Slug(string? title)
        {
            var sb = new StringBuilder();
            foreach (var ch in (title ?? "").Trim().ToLowerInvariant())
            {
                if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) sb.Append(ch);
                else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
            }
            var s = sb.ToString().Trim('-');
            if (s.Length > 70) { s = s[..70]; var cut = s.LastIndexOf('-'); if (cut > 30) s = s[..cut]; }
            return s.Trim('-');
        }

        public static JsonObject Parse(string? json)
        {
            try { return JsonNode.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json) as JsonObject ?? new JsonObject(); }
            catch (JsonException) { return new JsonObject(); }
        }

        public static string Text(JsonNode? n)
        {
            if (n is JsonValue v && v.TryGetValue<string>(out var s)) return Regex.Replace(s, @"[ \t ]+", " ").Trim();
            return "";
        }

        private static List<string> Texts(JsonNode? n, int max) =>
            (n as JsonArray)?.Select(Text).Where(t => t.Length > 0).Take(max).ToList() ?? new List<string>();

        private static JsonArray Arr(IEnumerable<string> items) => new(items.Select(i => (JsonNode)JsonValue.Create(i)!).ToArray());

        /// <summary>The working copy in the website's shape: known fields only, trimmed, empty lines dropped.</summary>
        public static JsonObject Clean(string type, JsonObject d)
        {
            var o = new JsonObject();
            if (type == "faq")
            {
                o["id"] = Text(d["id"]); o["question"] = Text(d["question"]); o["answer"] = Text(d["answer"]); o["category"] = Text(d["category"]).ToLowerInvariant();
                return o;
            }
            if (type == "site")
            {
                foreach (var k in SiteKeys) o[k] = Text(d[k]);
                return o;
            }
            o["slug"] = Text(d["slug"]).ToLowerInvariant();
            o["title"] = Text(d["title"]); o["excerpt"] = Text(d["excerpt"]); o["departmentId"] = Text(d["departmentId"]).ToLowerInvariant(); o["author"] = Text(d["author"]);
            if (d["image"] is JsonObject img && (Text(img["src"]).Length > 0 || Text(img["alt"]).Length > 0))
                o["image"] = new JsonObject { ["src"] = Text(img["src"]), ["alt"] = Text(img["alt"]) };
            var sections = new JsonArray();
            foreach (var sec in (d["sections"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Take(MaxSections))
            {
                var heading = Text(sec["heading"]); var paras = Texts(sec["paragraphs"], 40); var points = Texts(sec["points"], 40);
                if (heading.Length == 0 && paras.Count == 0 && points.Count == 0) continue;
                var s = new JsonObject { ["heading"] = heading, ["paragraphs"] = Arr(paras) };
                if (points.Count > 0) s["points"] = Arr(points);
                sections.Add(s);
            }
            o["sections"] = sections;
            var refs = new JsonArray();
            foreach (var r in (d["references"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().Take(20))
            {
                var label = Text(r["label"]); var url = Text(r["url"]);
                if (label.Length == 0 && url.Length == 0) continue;
                refs.Add(new JsonObject { ["label"] = label, ["url"] = url });
            }
            if (refs.Count > 0) o["references"] = refs;
            return o;
        }

        public static string KeyOf(string type, JsonObject d) => type == "site" ? "site" : Text(d[type == "faq" ? "id" : "slug"]).ToLowerInvariant();
        public static string TitleOf(string type, JsonObject d) => type == "site" ? "Hospital details" : Text(d[type == "faq" ? "question" : "title"]);

        /// <summary>What stops this from going to the website, in plain words. Empty when it is fine.</summary>
        public static List<string> Problems(string type, JsonObject d, IReadOnlyCollection<string> departments, bool hasPicture = false)
        {
            var p = new List<string>();
            if (type == "site")
            {
                foreach (var k in SiteKeys) if (Text(d[k]).Length == 0) p.Add($"{SiteLabels[k]} is empty.");
                if (Text(d["phone"]).Length > 0 && !Regex.IsMatch(Text(d["phone"]), @"^\d{10}$")) p.Add("The phone number must be the 10 digits only, without +91, spaces or dashes.");
                return p;
            }
            if (type == "faq")
            {
                if (!SlugOk(Text(d["id"]))) p.Add("The question needs a short id in lowercase letters, numbers and hyphens.");
                if (Text(d["question"]).Length == 0) p.Add("Write the question.");
                if (Text(d["answer"]).Length == 0) p.Add("Write the answer.");
                if (!FaqCategories.Contains(Text(d["category"]))) p.Add("Pick what the question is about.");
                return p;
            }
            if (!SlugOk(Text(d["slug"]))) p.Add("The web address needs lowercase letters, numbers and hyphens only.");
            if (Text(d["title"]).Length == 0) p.Add("Write the title.");
            if (Text(d["excerpt"]).Length == 0) p.Add("Write the short summary.");
            if (Text(d["author"]).Length == 0) p.Add("Write who the author is.");
            if (!departments.Contains(Text(d["departmentId"]))) p.Add("Pick the department.");
            var sections = (d["sections"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
            if (sections.Count == 0) p.Add("Add at least one section.");
            for (var i = 0; i < sections.Count; i++)
            {
                var s = sections[i];
                if (Text(s["heading"]).Length == 0) p.Add($"Section {i + 1} has no heading.");
                if (Texts(s["paragraphs"], 99).Count == 0 && Texts(s["points"], 99).Count == 0) p.Add($"Section {i + 1} (\"{Text(s["heading"])}\") is empty.");
            }
            var refs = (d["references"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
            for (var i = 0; i < refs.Count; i++)
                if (Text(refs[i]["label"]).Length == 0 || !Regex.IsMatch(Text(refs[i]["url"]), @"^https://\S+$")) p.Add($"Reference {i + 1} needs a name and a link that starts with https://.");
            var img = d["image"] as JsonObject;
            if (hasPicture || (img != null && Text(img["src"]).Length > 0))
            {
                if (img == null || Text(img["alt"]).Length == 0) p.Add("Describe the picture in a few words (for people who can't see it, and for Google).");
                if (!hasPicture && img != null && !Text(img["src"]).StartsWith('/')) p.Add("The picture must be one uploaded here.");
            }
            return p;
        }

        /// <summary>Things that don't stop publishing but are worth fixing for search results.</summary>
        public static List<string> Warnings(string type, JsonObject d, bool hasPicture = false)
        {
            var w = new List<string>();
            if (type != "article") return w;
            var title = Text(d["title"]); var ex = Text(d["excerpt"]);
            if (title.Length > TitleBest) w.Add($"The title is {title.Length} characters. Google usually cuts titles after about {TitleBest}.");
            if (ex.Length > 0 && ex.Length < ExcerptMin) w.Add($"The summary is short ({ex.Length} characters). {ExcerptMin} to {ExcerptMax} reads best in search results.");
            if (ex.Length > ExcerptMax) w.Add($"The summary is {ex.Length} characters. Google usually cuts it after about {ExcerptMax}.");
            if (!hasPicture && Text((d["image"] as JsonObject)?["src"]).Length == 0) w.Add("There is no picture. Articles with one get more clicks when shared.");
            if ((d["references"] as JsonArray)?.Count is null or 0) w.Add("There are no references. Medical facts are more trusted with a source.");
            var words = (d["sections"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
                .Sum(s => Texts(s["paragraphs"], 99).Concat(Texts(s["points"], 99)).Sum(t => t.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length));
            if (words > 0 && words < 300) w.Add($"The article is short (about {words} words). 600 or more usually does better.");
            return w;
        }

        public static bool NeedsReview(string type, SiteConfig c) => c.ReviewTypes.Contains(type);

        public static bool Live(SiteContent c) => !string.IsNullOrEmpty(c.Published);

        // What may happen next, as the reason it can't (null = it can).
        public static string? CantEdit(SiteContent c) =>
            c.Archived ? "This is archived. Bring it back first." : c.Status == "publishing" ? "This is being published right now. Try again in a few minutes." : null;

        public static string? CantSubmit(SiteContent c, List<string> problems) =>
            CantEdit(c) ?? (c.Status is "review" ? "This is already waiting for review."
                : c.Status is "approved" ? "This is already approved."
                : c.Status is "published" ? "Nothing has changed since it was published."
                : problems.Count > 0 ? problems[0] : null);

        public static string? CantReview(SiteContent c) =>
            CantEdit(c) ?? (c.Status == "review" ? null : "This isn't waiting for review.");

        public static string? CantPublish(SiteContent c, SiteConfig cfg, List<string> problems) =>
            CantEdit(c) ?? (problems.Count > 0 ? problems[0]
                : c.Status != "approved" ? (NeedsReview(c.Type, cfg) ? "A reviewer has to approve this first." : "Mark it ready first.")
                : NeedsReview(c.Type, cfg) && string.IsNullOrWhiteSpace(c.ReviewedByName) ? "A named reviewer has to approve this first." : null);

        public static string? CantUnpublish(SiteContent c) =>
            c.Status == "publishing" ? "This is being published right now. Try again in a few minutes."
            : c.Type == "site" ? "The hospital's details can't be taken off the website."
            : !Live(c) ? "This isn't on the website." : null;

        public static string? CantArchive(SiteContent c) =>
            c.Status == "publishing" ? "This is being published right now." : Live(c) ? "Take it off the website first." : c.Type == "site" ? "The hospital's details can't be archived." : null;

        /// <summary>The copy the website gets. An article keeps its first publishing date and carries its reviewer's name.</summary>
        public static JsonObject LiveCopy(SiteContent c, DateOnly today, string? pictureUrl)
        {
            var d = Clean(c.Type, Parse(c.Data));
            if (c.Type != "article") return d;
            var o = new JsonObject
            {
                ["slug"] = Text(d["slug"]), ["title"] = Text(d["title"]), ["excerpt"] = Text(d["excerpt"]), ["departmentId"] = Text(d["departmentId"]),
                ["status"] = "published",
                ["publishedAt"] = (c.FirstPublishedOn ?? today).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                ["author"] = Text(d["author"]),
            };
            if (!string.IsNullOrWhiteSpace(c.ReviewedByName)) o["reviewedBy"] = c.ReviewedByName.Trim();
            var img = d["image"] as JsonObject;
            var src = pictureUrl ?? Text(img?["src"]);
            if (src.Length > 0) o["image"] = new JsonObject { ["src"] = src, ["alt"] = Text(img?["alt"]) };
            o["sections"] = d["sections"]!.DeepClone();
            if (d["references"] != null) o["references"] = d["references"]!.DeepClone();
            return o;
        }

        private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
        public static string FileText(JsonNode n) => n.ToJsonString(Pretty).Replace("\r\n", "\n") + "\n";

        /// <summary>content/blog.json: newest first, then by address, so the same articles always give the same file.</summary>
        public static string BlogFile(IEnumerable<JsonObject> live) =>
            FileText(new JsonArray(live.OrderByDescending(a => Text(a["publishedAt"]), StringComparer.Ordinal).ThenBy(a => Text(a["slug"]), StringComparer.Ordinal)
                .Select(a => (JsonNode)a.DeepClone()).ToArray()));

        /// <summary>content/faqs.json in the order set in the CRM.</summary>
        public static string FaqFile(IEnumerable<(int Order, JsonObject Faq)> live) =>
            FileText(new JsonArray(live.OrderBy(f => f.Order).ThenBy(f => Text(f.Faq["id"]), StringComparer.Ordinal).Select(f => (JsonNode)f.Faq.DeepClone()).ToArray()));

        /// <summary>The plain reason in a failed build's log (the website prints "content/&lt;file&gt;: …"), or null.</summary>
        public static string? FailureReason(string? log)
        {
            if (string.IsNullOrEmpty(log)) return null;
            var m = Regex.Match(log, @"content/[\w.\-]+\.json: [^\r\n]{3,300}");
            if (m.Success) return m.Value.Trim();
            m = Regex.Match(log, @"(?:##\[error\]|error TS\d+:|ERROR:?)\s*([^\r\n]{3,300})");
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }

        public static string Tail(string? s, int max) => string.IsNullOrEmpty(s) ? "" : s.Length <= max ? s : s[^max..];
    }

    public class GitHubException : Exception
    {
        public int Status { get; }
        public GitHubException(int status, string message) : base(message) { Status = status; }
    }

    /// <summary>The few GitHub calls publishing needs, for one repository, as a GitHub App or with a token.</summary>
    public class GitHubClient
    {
        private readonly IHttpClientFactory _http;
        private readonly IMemoryCache _cache;
        public GitHubClient(IHttpClientFactory http, IMemoryCache cache) { _http = http; _cache = cache; }

        private static string B64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        /// <summary>A short-lived proof that we are the GitHub App, signed with its private key.</summary>
        public static string AppJwt(string appId, string privateKeyPem, DateTimeOffset now)
        {
            using var rsa = RSA.Create();
            try { rsa.ImportFromPem(privateKeyPem.Trim()); }
            catch (Exception ex) when (ex is ArgumentException or CryptographicException)
            { throw new GitHubException(400, "The private key can't be read. Paste the whole .pem file, from -----BEGIN to -----END."); }
            var head = B64Url(Encoding.UTF8.GetBytes("{\"alg\":\"RS256\",\"typ\":\"JWT\"}"));
            var t = now.ToUnixTimeSeconds();
            var body = B64Url(Encoding.UTF8.GetBytes($"{{\"iat\":{t - 60},\"exp\":{t + 540},\"iss\":\"{appId.Trim()}\"}}"));
            var sig = rsa.SignData(Encoding.ASCII.GetBytes(head + "." + body), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            return head + "." + body + "." + B64Url(sig);
        }

        private async Task<HttpResponseMessage> RawAsync(string bearer, HttpMethod method, string url, JsonNode? body, CancellationToken ct)
        {
            var req = new HttpRequestMessage(method, url.StartsWith("http", StringComparison.Ordinal) ? url : "https://api.github.com" + url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            req.Headers.UserAgent.ParseAdd("NexMarket-CRM/1.0");
            req.Headers.Accept.ParseAdd("application/vnd.github+json");
            req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
            if (body != null) req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            try { return await _http.CreateClient("github").SendAsync(req, ct); }
            catch (HttpRequestException) { throw new GitHubException(502, "Couldn't reach GitHub just now."); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new GitHubException(504, "GitHub took too long to answer."); }
        }

        private static string Plain(int status, string? message, SiteConfig c) => status switch
        {
            401 => "GitHub refused the key. Check the app id and private key (or the token) in Website → Setup.",
            403 => "GitHub says this key isn't allowed to do that. The app needs: Contents, Pull requests (read and write), Checks and Actions (read)." + (string.IsNullOrWhiteSpace(message) ? "" : $" ({message})"),
            404 => $"GitHub can't find {c.Repo}, or the app isn't installed on that repository.",
            _ => $"GitHub answered {status}" + (string.IsNullOrWhiteSpace(message) ? "." : $": {message}"),
        };

        public async Task<string> TokenAsync(SiteConfig c, CancellationToken ct)
        {
            if (!string.IsNullOrWhiteSpace(c.Token)) return c.Token!.Trim();
            if (string.IsNullOrWhiteSpace(c.AppId) || string.IsNullOrWhiteSpace(c.PrivateKey)) throw new GitHubException(400, "The website isn't connected yet. Add the GitHub key in Website → Setup.");
            var key = $"gh-token:{c.AppId}:{c.Repo}:{c.PrivateKey!.Length}";
            if (_cache.TryGetValue(key, out string? cached) && cached != null) return cached;
            var jwt = AppJwt(c.AppId!, c.PrivateKey!, DateTimeOffset.UtcNow);
            using var inst = await RawAsync(jwt, HttpMethod.Get, $"/repos/{c.Repo}/installation", null, ct);
            if (!inst.IsSuccessStatusCode) throw new GitHubException((int)inst.StatusCode, Plain((int)inst.StatusCode, null, c));
            var id = JsonNode.Parse(await inst.Content.ReadAsStringAsync(ct))?["id"]?.ToString();
            using var tok = await RawAsync(jwt, HttpMethod.Post, $"/app/installations/{id}/access_tokens", null, ct);
            if (!tok.IsSuccessStatusCode) throw new GitHubException((int)tok.StatusCode, Plain((int)tok.StatusCode, null, c));
            var token = JsonNode.Parse(await tok.Content.ReadAsStringAsync(ct))?["token"]?.ToString() ?? throw new GitHubException(502, "GitHub gave no token.");
            _cache.Set(key, token, TimeSpan.FromMinutes(45));
            return token;
        }

        /// <summary>One call under /repos/{owner}/{name}. Null when <paramref name="missingOk"/> and GitHub says 404.</summary>
        public async Task<JsonNode?> SendAsync(SiteConfig c, HttpMethod method, string path, JsonNode? body, CancellationToken ct, bool missingOk = false)
        {
            using var res = await RawAsync(await TokenAsync(c, ct), method, $"/repos/{c.Repo}{path}", body, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (missingOk && (int)res.StatusCode == 404) return null;
            if (!res.IsSuccessStatusCode)
            {
                string? msg = null;
                try { msg = JsonNode.Parse(text)?["message"]?.ToString(); } catch (JsonException) { }
                throw new GitHubException((int)res.StatusCode, Plain((int)res.StatusCode, msg, c));
            }
            try { return string.IsNullOrWhiteSpace(text) ? new JsonObject() : JsonNode.Parse(text); }
            catch (JsonException) { return new JsonObject(); }
        }

        public Task<JsonNode?> GetAsync(SiteConfig c, string path, CancellationToken ct, bool missingOk = false) => SendAsync(c, HttpMethod.Get, path, null, ct, missingOk);

        /// <summary>A text file on a branch, or null when it isn't there.</summary>
        public async Task<string?> FileAsync(SiteConfig c, string path, string branch, CancellationToken ct)
        {
            var n = await GetAsync(c, $"/contents/{path}?ref={Uri.EscapeDataString(branch)}", ct, missingOk: true);
            var b64 = n?["content"]?.ToString();
            if (string.IsNullOrEmpty(b64)) return n == null ? null : "";
            return Encoding.UTF8.GetString(Convert.FromBase64String(b64.Replace("\n", "")));
        }

        /// <summary>The log of one build job (plain text), or "" when it can't be read.</summary>
        public async Task<string> JobLogAsync(SiteConfig c, string jobId, CancellationToken ct)
        {
            try
            {
                using var res = await RawAsync(await TokenAsync(c, ct), HttpMethod.Get, $"/repos/{c.Repo}/actions/jobs/{jobId}/logs", null, ct);
                return res.IsSuccessStatusCode ? await res.Content.ReadAsStringAsync(ct) : "";
            }
            catch (GitHubException) { return ""; }
        }
    }

    /// <summary>
    /// Publishing to the website. A publish is a pull request with the content files: the website's own checks run on
    /// it, the CRM merges it when they pass, and the website deploys as it always does. If a check fails, nothing is
    /// merged, the live site stays as it was, and the reason is shown in plain words.
    /// </summary>
    public class SitePublisher
    {
        public static readonly string[] Active = { "queued", "checking", "merging", "deploying" };
        public const int ChecksMinutes = 45;
        public const int MergeHours = 24;

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _app;
        private readonly GitHubClient _gh;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public SitePublisher(IMarketingDbContext db, IAppSettings app, GitHubClient gh, IFileStore files, INotifier notifier)
        { _db = db; _app = app; _gh = gh; _files = files; _notifier = notifier; }

        public record Ask(Guid Id, string Action);

        public static string PictureFile(SiteContent c) => $"{c.Key}.{SiteRules.ImageTypes.GetValueOrDefault(c.ImageMime ?? "", "jpg")}";

        /// <summary>Lines up a publish. Returns the reason it can't start, or the new job.</summary>
        public async Task<(string? Problem, SitePublish? Job)> StartAsync(IReadOnlyList<Ask> asks, string by, string byName, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            if (!cfg.Connected) return ("The website isn't connected yet. A developer does that once in Website → Setup.", null);
            if (cfg.ImportedAt == null) return ("First bring in what is on the website now (Website → Setup → Bring in from the website), so nothing there is lost.", null);
            if (asks.Count == 0) return ("Pick what to publish.", null);
            if (asks.Count > 30) return ("Publish up to 30 things at a time.", null);
            if (await _db.SitePublishes.AnyAsync(p => Active.Contains(p.Status), ct)) return ("Another publish is still running. Wait for it to finish.", null);

            var all = await _db.SiteContents.Where(c => !c.Archived).ToListAsync(ct);
            var today = AttendanceService.TodayIst;
            var items = new JsonArray(); var files = new JsonArray(); var titles = new List<string>(); var touched = new HashSet<string>();
            var next = all.ToDictionary(c => c.Id, c => c.Published);
            foreach (var ask in asks.GroupBy(a => a.Id).Select(g => g.First()))
            {
                var c = all.FirstOrDefault(x => x.Id == ask.Id);
                if (c == null) return ("One of those can't be found any more.", null);
                var data = SiteRules.Parse(c.Data);
                if (ask.Action == "unpublish")
                {
                    if (SiteRules.CantUnpublish(c) is { } no) return ($"{c.Title}: {no}", null);
                    next[c.Id] = null;
                    titles.Add($"Take down: {c.Title}");
                }
                else
                {
                    var problems = SiteRules.Problems(c.Type, data, cfg.Departments, c.ImageKey != null);
                    if (SiteRules.CantPublish(c, cfg, problems) is { } no) return ($"{c.Title}: {no}", null);
                    string? picture = null;
                    if (c.Type == "article" && c.ImageKey != null)
                    {
                        var file = PictureFile(c);
                        picture = cfg.MediaUrl(file);
                        files.Add(new JsonObject { ["path"] = cfg.MediaDir.Trim('/') + "/" + file, ["fileKey"] = c.ImageKey });
                    }
                    next[c.Id] = SiteRules.LiveCopy(c, today, picture).ToJsonString();
                    titles.Add($"Publish: {c.Title}");
                }
                touched.Add(c.Type);
                items.Add(new JsonObject { ["id"] = c.Id.ToString(), ["action"] = ask.Action == "unpublish" ? "unpublish" : "publish", ["was"] = c.Status, ["live"] = next[c.Id], ["version"] = c.Version });
                c.Status = "publishing";
            }

            // Only the files for the kinds of content in this publish are written; the others are left exactly as they are.
            IEnumerable<SiteContent> liveOf(string type) => all.Where(c => c.Type == type && next[c.Id] != null);
            if (touched.Contains("article"))
                files.Add(new JsonObject { ["path"] = cfg.FilePath("blog.json"), ["text"] = SiteRules.BlogFile(liveOf("article").Select(c => SiteRules.Parse(next[c.Id]))) });
            if (touched.Contains("faq"))
                files.Add(new JsonObject { ["path"] = cfg.FilePath("faqs.json"), ["text"] = SiteRules.FaqFile(liveOf("faq").Select(c => (c.SortOrder, SiteRules.Parse(next[c.Id])))) });
            if (touched.Contains("site") && liveOf("site").FirstOrDefault() is { } site)
                files.Add(new JsonObject { ["path"] = cfg.FilePath("site.json"), ["text"] = SiteRules.FileText(SiteRules.Parse(next[site.Id])) });

            var title = titles.Count == 1 ? titles[0] : $"{titles[0]} and {titles.Count - 1} more";
            var job = new SitePublish { Title = title.Length > 200 ? title[..200] : title, Items = items.ToJsonString(), Files = files.ToJsonString(), StartedBy = by, StartedByName = byName };
            _db.SitePublishes.Add(job);
            await _db.SaveChangesAsync(ct);
            return (null, job);
        }

        private static IEnumerable<JsonObject> ItemsOf(SitePublish p) => (JsonNode.Parse(p.Items) as JsonArray ?? new JsonArray()).OfType<JsonObject>();

        private void Stage(SitePublish p, string status, string? note = null)
        {
            p.Status = status; p.Note = note; p.UpdatedAt = DateTime.UtcNow; p.Tries = 0;
            if (status is "live" or "failed" or "deploy_failed") p.FinishedAt = DateTime.UtcNow;
        }

        /// <summary>The content is now in the website's main branch: record what is live.</summary>
        private async Task ApplyAsync(SitePublish p, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            foreach (var it in ItemsOf(p))
            {
                if (!Guid.TryParse(it["id"]?.ToString(), out var id)) continue;
                var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (c == null) continue;
                var publish = it["action"]?.ToString() != "unpublish";
                c.Published = publish ? it["live"]?.ToString() : null;
                c.Status = publish ? "published" : "unpublished";
                c.Note = null; c.UpdatedAt = DateTime.UtcNow;
                if (publish) { c.FirstPublishedOn ??= today; c.PublishedAt = DateTime.UtcNow; c.PublishedByName = p.StartedByName; }
                _db.SiteContentVersions.Add(new SiteContentVersion { ContentId = c.Id, Version = c.Version, Action = publish ? "published" : "unpublished", Data = c.Data, By = p.StartedBy, ByName = p.StartedByName });
            }
        }

        private async Task FailAsync(SitePublish p, string why, CancellationToken ct, string? log = null)
        {
            foreach (var it in ItemsOf(p))
            {
                if (!Guid.TryParse(it["id"]?.ToString(), out var id)) continue;
                var c = await _db.SiteContents.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (c == null || c.Status != "publishing") continue;
                c.Status = it["was"]?.ToString() ?? "approved";
                c.Note = "Publishing didn't work: " + why;
                _db.SiteContentVersions.Add(new SiteContentVersion { ContentId = c.Id, Version = c.Version, Action = "failed", Data = c.Data, Note = why, By = p.StartedBy, ByName = p.StartedByName });
            }
            if (log != null) p.Log = SiteRules.Tail(log, 8000);
            Stage(p, "failed", why);
            Tell(p, "Publishing didn't work", $"{p.Title}. {why} The live website is unchanged.");
        }

        private void Tell(SitePublish p, string title, string body) =>
            _notifier.Notify(new NotifyJob { To = new() { p.StartedBy }, Kind = "website", Title = title, Body = body.Length > 300 ? body[..300] : body, Link = "website", RefId = p.Id.ToString() });

        /// <summary>Moves one publish forward by one step. Safe to call again and again.</summary>
        public async Task StepAsync(SitePublish p, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            try
            {
                if (!cfg.Connected) await FailAsync(p, "The website isn't connected any more. Connect it again in Website → Setup.", ct);
                else if (p.Status == "queued") await OpenAsync(p, cfg, ct);
                else if (p.Status == "checking") await CheckAsync(p, cfg, ct);
                else if (p.Status == "merging") await MergeAsync(p, cfg, ct);
                else if (p.Status == "deploying") await DeployAsync(p, cfg, ct);
            }
            catch (GitHubException ex)
            {
                // A hiccup is tried again on the next round; after several, give up and say why.
                p.Tries++;
                if (p.Tries >= 6 || ex.Status is 400 or 401 or 403 or 404) await FailAsync(p, ex.Message, ct);
            }
            await _db.SaveChangesAsync(ct);
        }

        private async Task OpenAsync(SitePublish p, SiteConfig cfg, CancellationToken ct)
        {
            var baseSha = (await _gh.GetAsync(cfg, $"/git/ref/heads/{cfg.Branch}", ct))?["object"]?["sha"]?.ToString()
                ?? throw new GitHubException(404, $"The branch \"{cfg.Branch}\" isn't in the repository.");
            var baseTree = (await _gh.GetAsync(cfg, $"/git/commits/{baseSha}", ct))?["tree"]?["sha"]?.ToString();

            var entries = new JsonArray();
            foreach (var f in (JsonNode.Parse(p.Files) as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            {
                byte[] bytes;
                if (f["fileKey"]?.ToString() is { Length: > 0 } key)
                {
                    var opened = await _files.OpenAsync(key, ct);
                    if (opened == null) { await FailAsync(p, "A picture for this publish can't be found in storage. Upload it again.", ct); return; }
                    await using var s = opened.Value.Content; using var ms = new System.IO.MemoryStream();
                    await s.CopyToAsync(ms, ct); bytes = ms.ToArray();
                }
                else bytes = Encoding.UTF8.GetBytes(f["text"]?.ToString() ?? "");
                var blob = await _gh.SendAsync(cfg, HttpMethod.Post, "/git/blobs", new JsonObject { ["content"] = Convert.ToBase64String(bytes), ["encoding"] = "base64" }, ct);
                entries.Add(new JsonObject { ["path"] = f["path"]?.ToString(), ["mode"] = "100644", ["type"] = "blob", ["sha"] = blob?["sha"]?.ToString() });
            }
            var tree = (await _gh.SendAsync(cfg, HttpMethod.Post, "/git/trees", new JsonObject { ["base_tree"] = baseTree, ["tree"] = entries }, ct))?["sha"]?.ToString();
            if (tree == baseTree)
            {
                await ApplyAsync(p, ct);
                Stage(p, "live", "The website already had exactly this content, so nothing needed to change.");
                return;
            }
            var who = string.IsNullOrWhiteSpace(p.StartedByName) ? p.StartedBy : p.StartedByName;
            var commit = (await _gh.SendAsync(cfg, HttpMethod.Post, "/git/commits", new JsonObject
            {
                ["message"] = $"{p.Title}\n\nPublished from the CRM by {who}.", ["tree"] = tree, ["parents"] = new JsonArray(baseSha),
            }, ct))?["sha"]?.ToString();
            var branch = $"crm/publish-{p.StartedAt:yyyyMMdd-HHmmss}" + (p.Tries > 0 ? $"-{p.Tries}" : "");
            await _gh.SendAsync(cfg, HttpMethod.Post, "/git/refs", new JsonObject { ["ref"] = "refs/heads/" + branch, ["sha"] = commit }, ct);
            p.Branch = branch; p.HeadSha = commit;
            var lines = string.Join("\n", ItemsOf(p).Select(i => $"- {i["action"]}: {i["id"]}"));
            var pr = await _gh.SendAsync(cfg, HttpMethod.Post, "/pulls", new JsonObject
            {
                ["title"] = p.Title, ["head"] = branch, ["base"] = cfg.Branch,
                ["body"] = $"Published from the CRM (Website) by {who}.\n\nThe CRM merges this when the checks pass. If a check fails it is closed and the live site is unchanged.\n\n{lines}",
            }, ct);
            p.PrNumber = (int?)pr?["number"]; p.PrUrl = pr?["html_url"]?.ToString();
            Stage(p, "checking");
        }

        private record Runs(int Count, bool Running, string? BadName, string? BadId);

        private async Task<Runs> RunsAsync(SiteConfig cfg, string sha, CancellationToken ct)
        {
            var runs = ((await _gh.GetAsync(cfg, $"/commits/{sha}/check-runs?per_page=100", ct))?["check_runs"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToList();
            var bad = runs.FirstOrDefault(r => r["status"]?.ToString() == "completed" && r["conclusion"]?.ToString() is not ("success" or "neutral" or "skipped"));
            return new Runs(runs.Count, runs.Any(r => r["status"]?.ToString() != "completed"), bad?["name"]?.ToString(), bad?["id"]?.ToString());
        }

        private async Task CheckAsync(SitePublish p, SiteConfig cfg, CancellationToken ct)
        {
            var waited = DateTime.UtcNow - p.UpdatedAt;
            var runs = await RunsAsync(cfg, p.HeadSha!, ct);
            if (runs.BadName != null)
            {
                var log = runs.BadId == null ? "" : await _gh.JobLogAsync(cfg, runs.BadId, ct);
                try { await _gh.SendAsync(cfg, new HttpMethod("PATCH"), $"/pulls/{p.PrNumber}", new JsonObject { ["state"] = "closed" }, ct); } catch (GitHubException) { }
                await FailAsync(p, SiteRules.FailureReason(log) ?? $"The website's check \"{runs.BadName}\" failed. A developer can see why in Website → Developer.", ct, log);
                return;
            }
            if (runs.Running) { if (waited > TimeSpan.FromMinutes(ChecksMinutes)) await FailAsync(p, "The website's checks didn't finish in time. Try again.", ct); return; }
            if (runs.Count == 0 && waited < TimeSpan.FromMinutes(3)) return;   // checks take a moment to appear
            Stage(p, "merging");
        }

        private async Task MergeAsync(SitePublish p, SiteConfig cfg, CancellationToken ct)
        {
            var pr = await _gh.GetAsync(cfg, $"/pulls/{p.PrNumber}", ct);
            if (pr?["merged"]?.GetValue<bool>() != true)
            {
                if (pr?["state"]?.ToString() == "closed") { await FailAsync(p, "The pull request was closed on GitHub without merging.", ct); return; }
                try { await _gh.SendAsync(cfg, HttpMethod.Put, $"/pulls/{p.PrNumber}/merge", new JsonObject { ["merge_method"] = "squash", ["commit_title"] = $"{p.Title} (#{p.PrNumber})" }, ct); }
                catch (GitHubException ex) when (ex.Status is 405 or 409 or 422)
                {
                    // Usually a rule on the repository: a person must approve, or the branch is behind.
                    if (DateTime.UtcNow - p.UpdatedAt > TimeSpan.FromHours(MergeHours)) await FailAsync(p, "Nobody merged the pull request on GitHub within a day.", ct);
                    else p.Note = "The checks passed, but GitHub won't let the CRM merge yet (the repository may need a person's approval). Approve the pull request on GitHub and this carries on by itself.";
                    return;
                }
                pr = await _gh.GetAsync(cfg, $"/pulls/{p.PrNumber}", ct);
                if (pr?["merged"]?.GetValue<bool>() != true) return;
            }
            p.MergeSha = pr?["merge_commit_sha"]?.ToString();
            await ApplyAsync(p, ct);
            Stage(p, "deploying");
        }

        private async Task DeployAsync(SitePublish p, SiteConfig cfg, CancellationToken ct)
        {
            var waited = DateTime.UtcNow - p.UpdatedAt;
            var runs = string.IsNullOrEmpty(p.MergeSha) ? new Runs(0, false, null, null) : await RunsAsync(cfg, p.MergeSha, ct);
            if (runs.BadName != null)
            {
                var log = runs.BadId == null ? "" : await _gh.JobLogAsync(cfg, runs.BadId, ct);
                p.Log = SiteRules.Tail(log, 8000);
                Stage(p, "deploy_failed", $"The content was accepted, but putting the website live failed at \"{runs.BadName}\". The live site still shows the old content. A developer can run the deploy again on GitHub.");
                Tell(p, "The website didn't go live", $"{p.Title}. {p.Note}");
                return;
            }
            if (runs.Running && waited < TimeSpan.FromMinutes(ChecksMinutes)) return;
            if (runs.Count == 0 && waited < TimeSpan.FromMinutes(5)) return;
            Stage(p, "live", runs.Count == 0 ? "Accepted. The CRM couldn't see the website's deploy, so check the website in a few minutes."
                : runs.Running ? "Accepted. The deploy is taking long; check the website in a few minutes." : null);
            Tell(p, "Live on the website", p.Title + (p.Note == null ? "." : ". " + p.Note));
        }

        /// <summary>
        /// Brings in what the website has now, so the CRM starts from the truth and a first publish loses nothing.
        /// Only adds records the CRM doesn't have; nothing already in the CRM is changed.
        /// </summary>
        public async Task<(int Articles, int Faqs, bool Site)> ImportAsync(string by, string byName, CancellationToken ct)
        {
            var cfg = SiteConfig.Load(_app);
            var have = await _db.SiteContents.Select(c => c.Type + ":" + c.Key).ToListAsync(ct);
            int articles = 0, faqs = 0; var site = false;
            void Add(string type, JsonObject live, int order)
            {
                var data = SiteRules.Clean(type, live);
                var key = SiteRules.KeyOf(type, data);
                if (key.Length == 0 || have.Contains(type + ":" + key)) return;
                have.Add(type + ":" + key);
                var isLive = type != "article" || live["status"]?.ToString() == "published";
                var c = new SiteContent
                {
                    Type = type, Key = key, Title = SiteRules.TitleOf(type, data), Data = data.ToJsonString(), Published = isLive ? live.ToJsonString() : null,
                    Status = isLive ? "published" : "draft", SortOrder = order, CreatedBy = by, CreatedByName = byName, UpdatedByName = byName,
                    ReviewedByName = type == "article" ? SiteRules.Text(live["reviewedBy"]) is { Length: > 0 } r ? r : null : null,
                    FirstPublishedOn = type == "article" && isLive ? Hoardings.Date(live["publishedAt"]?.ToString()) : null,
                    PublishedAt = isLive ? DateTime.UtcNow : null, PublishedByName = isLive ? "Already on the website" : null,
                };
                _db.SiteContents.Add(c);
                _db.SiteContentVersions.Add(new SiteContentVersion { ContentId = c.Id, Version = 1, Action = "imported", Data = c.Data, By = by, ByName = byName });
                if (type == "article") articles++; else if (type == "faq") faqs++; else site = true;
            }
            async Task<JsonNode?> ReadAsync(string name)
            {
                var text = await _gh.FileAsync(cfg, cfg.FilePath(name), cfg.Branch, ct);
                if (text == null) throw new GitHubException(404, $"The website has no {cfg.FilePath(name)} on \"{cfg.Branch}\". The website's content files have to be merged first.");
                try { return JsonNode.Parse(text); } catch (JsonException) { throw new GitHubException(422, $"{cfg.FilePath(name)} on the website can't be read."); }
            }
            var n = 0;
            foreach (var a in (await ReadAsync("blog.json") as JsonArray ?? new JsonArray()).OfType<JsonObject>()) Add("article", a, 0);
            foreach (var f in (await ReadAsync("faqs.json") as JsonArray ?? new JsonArray()).OfType<JsonObject>()) Add("faq", f, ++n * 10);
            if (await ReadAsync("site.json") is JsonObject s) Add("site", s, 0);
            await _db.SaveChangesAsync(ct);
            await _app.SetAsync(new Dictionary<string, string?> { [SiteConfig.Prefix + "importedAt"] = DateTime.UtcNow.ToString("o") }, SiteConfig.SecretKeys.ToList(), by, ct);
            return (articles, faqs, site);
        }
    }

    /// <summary>Moves each organisation's running publish forward, a step every 20 seconds.</summary>
    public class SitePublishWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<SitePublishWorker> _logger;
        private readonly OrgDirectory _orgs;
        public SitePublishWorker(IServiceScopeFactory scopes, ILogger<SitePublishWorker> logger, OrgDirectory orgs) { _scopes = scopes; _logger = logger; _orgs = orgs; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _orgs.ForEachAsync(async _ =>
                    {
                        using var scope = _scopes.CreateScope();
                        var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                        var job = await db.SitePublishes.Where(p => SitePublisher.Active.Contains(p.Status)).OrderBy(p => p.StartedAt).FirstOrDefaultAsync(stoppingToken);
                        if (job != null) await scope.ServiceProvider.GetRequiredService<SitePublisher>().StepAsync(job, stoppingToken);
                    });
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
                catch (Exception ex) { _logger.LogError(ex, "The website publish worker failed this round."); }
                await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
            }
        }
    }
}
