using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SignupDto
    {
        public string? OrgName { get; set; }
        /// <summary>The short name people sign in with. Left empty, it is made from the organisation's name.</summary>
        public string? OrgKey { get; set; }
        public List<string>? Kinds { get; set; }
        public string? City { get; set; }
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? Password { get; set; }
        /// <summary>The 6-digit code sent to the phone and email, when this server can send codes.</summary>
        public string? Code { get; set; }
    }

    public class SignupCodeDto { public string? Phone { get; set; } public string? Email { get; set; } public string? OrgName { get; set; } }

    /// <summary>The rules for signing up, apart from the database, so they can be checked on their own.</summary>
    public static class Signup
    {
        /// <summary>Where a waiting sign-up code is kept: by the phone number being checked.</summary>
        public static string CodeKey(string phone) => "signup-code:" + phone;
        public static string CodeSendsKey(string phone) => "signup-code-sends:" + phone;
        public const string CodesTodayKey = "signup-codes-today";

        /// <summary>The code proves the phone, and the email too when one was given: change either and the code no longer fits.</summary>
        public static string CodeOwner(string phone, string? email) => phone + "|" + (email ?? "").Trim().ToLowerInvariant();

        public static readonly (string Key, string Label)[] Kinds =
        {
            ("hospital", "Hospital"), ("clinic", "Clinic"), ("diagnostic", "Diagnostic centre"), ("lab", "Pathology lab"),
            ("pharmacy", "Pharmacy"), ("dialysis", "Dialysis centre"), ("other", "Other healthcare"),
        };

        /// <summary>Names nobody may take: they look official or clash with addresses.</summary>
        public static readonly HashSet<string> Reserved = new()
        {
            "admin", "api", "app", "www", "main", "platform", "nexeagle", "nexmarket", "support", "help", "login", "signup",
            "system", "root", "test", "demo", "org", "billing", "status", "mail",
        };

        public const string FirstUserId = "admin";

        /// <summary>A short sign-in name made from the organisation's name: "City Lab & Scans" → "city-lab-scans".</summary>
        public static string? Suggest(string? name)
        {
            var sb = new StringBuilder();
            foreach (var ch in (name ?? "").Trim().ToLowerInvariant())
            {
                if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) sb.Append(ch);
                else if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
            }
            var s = sb.ToString().Trim('-');
            while (s.Length > 0 && !(s[0] >= 'a' && s[0] <= 'z')) s = s[1..].TrimStart('-');
            if (s.Length > OrgNames.MaxKey) s = s[..OrgNames.MaxKey].TrimEnd('-');
            return OrgNames.Key(s);
        }

        public static bool EmailOk(string? e)
        {
            e = (e ?? "").Trim();
            if (e.Length < 6 || e.Length > 120 || e.Any(char.IsWhiteSpace)) return false;
            var at = e.IndexOf('@');
            return at > 0 && at == e.LastIndexOf('@') && e.IndexOf('.', at) > at + 1 && !e.EndsWith('.');
        }

        /// <summary>What is wrong with the form, field by field. Empty = fine. <paramref name="key"/> is the sign-in name to use.</summary>
        public static Dictionary<string, string> Check(SignupDto d, string defaultKey, out string? key)
        {
            var bad = new Dictionary<string, string>();
            var orgName = (d.OrgName ?? "").Trim();
            if (orgName.Length < 2 || orgName.Length > 80) bad["orgName"] = "Enter the organisation's name (2 to 80 characters).";

            key = string.IsNullOrWhiteSpace(d.OrgKey) ? Suggest(orgName) : OrgNames.Key(d.OrgKey);
            if (key == null) bad["orgKey"] = "Use 3 to 30 small letters, numbers or hyphens, starting with a letter.";
            else if (Reserved.Contains(key) || key == defaultKey) bad["orgKey"] = "This name is not available. Choose another.";

            var kinds = (d.Kinds ?? new()).Select(k => (k ?? "").Trim().ToLowerInvariant()).Distinct().ToList();
            if (kinds.Count == 0 || kinds.Any(k => Kinds.All(x => x.Key != k))) bad["kinds"] = "Choose what your organisation is.";

            var person = (d.Name ?? "").Trim();
            if (person.Length < 2 || person.Length > 80) bad["name"] = "Enter your name.";
            if (Hoardings.Phone(d.Phone) == null) bad["phone"] = "Enter a 10-digit mobile number.";
            if (!string.IsNullOrWhiteSpace(d.Email) && !EmailOk(d.Email)) bad["email"] = "This email address doesn't look right.";

            var pw = d.Password ?? "";
            if (pw.Length < 8 || pw.Length > 200) bad["password"] = "Use a password of at least 8 characters.";
            else if (!pw.Any(char.IsLetter) || !pw.Any(char.IsDigit)) bad["password"] = "Use at least one letter and one number in the password.";
            return bad;
        }
    }

    /// <summary>
    /// Anyone can create an account for their healthcare organisation. Each new organisation gets its own empty database
    /// and one admin (the person signing up). Nothing here reads or changes another organisation's data.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/signup")]
    public class SignupController : ControllerBase
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly OrgDirectory _orgs;
        private readonly IConfiguration _config;
        private readonly ILogger<SignupController> _log;
        private readonly CodeSender _codes;
        private readonly IMemoryCache _cache;
        // One sign-up at a time: creating a database is heavy, and this keeps the daily limit exact.
        private static readonly SemaphoreSlim OneAtATime = new(1, 1);

        public SignupController(IServiceScopeFactory scopes, OrgDirectory orgs, IConfiguration config, ILogger<SignupController> log, CodeSender codes, IMemoryCache cache)
        {
            _scopes = scopes; _orgs = orgs; _config = config; _log = log; _codes = codes; _cache = cache;
        }

        private bool Open => !string.Equals(_config["Platform:SignUpOpen"], "false", StringComparison.OrdinalIgnoreCase);
        private int CodesPerDay => int.TryParse(_config["Platform:MaxSignupCodesPerDay"], out var n) && n > 0 ? n : 60;
        private int PerDay => int.TryParse(_config["Platform:MaxSignupsPerDay"], out var n) && n > 0 ? n : 10;

        [HttpGet("options")]
        public IActionResult Options() => Ok(new { open = Open, verify = _codes.Ready, verifyEmail = _codes.EmailReady, verifyWhatsApp = _codes.WhatsAppReady, kinds = Signup.Kinds.Select(k => new { key = k.Key, label = k.Label }) });

        /// <summary>Is this sign-in name free? Also suggests one from the organisation's name.</summary>
        [HttpGet("check")]
        [EnableRateLimiting("auth")]
        public async Task<IActionResult> Check([FromQuery] string? key, [FromQuery] string? name, CancellationToken ct)
        {
            var k = string.IsNullOrWhiteSpace(key) ? Signup.Suggest(name) : OrgNames.Key(key);
            if (k == null) return Ok(new { key = (string?)null, available = false, message = "Use 3 to 30 small letters, numbers or hyphens, starting with a letter." });
            if (Signup.Reserved.Contains(k) || k == _orgs.Default.Key) return Ok(new { key = k, available = false, message = "This name is not available." });
            using var platform = OrgScope.Enter(null);
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var taken = await db.Organisations.AsNoTracking().AnyAsync(o => o.Key == k && o.Status != "failed" && o.Status != "setting_up", ct);
            return Ok(new { key = k, available = !taken, message = taken ? "This name is already taken." : null });
        }

        /// <summary>For the sign-in page: the organisation's name, so people see they typed the right one.</summary>
        [HttpGet("org/{key}")]
        [EnableRateLimiting("auth")]
        public IActionResult Org(string key)
        {
            var k = OrgNames.Key(key);
            var org = k == null ? null : _orgs.Find(k);
            return org == null ? NotFound(new { message = "We don't know this organisation. Check the name and try again." }) : Ok(new { key = org.Key, name = org.Name });
        }

        /// <summary>
        /// Sends a code to the phone (WhatsApp) and email typed in the form, so an organisation can only be created by
        /// someone who really has them. Only when this server can send codes; otherwise sign-up works without one.
        /// </summary>
        [HttpPost("code")]
        [EnableRateLimiting("auth")]
        public async Task<IActionResult> SendCode([FromBody] SignupCodeDto dto, CancellationToken ct)
        {
            if (!Open) return StatusCode(403, new { message = "New sign-ups are closed at the moment." });
            if (!_codes.Ready) return Ok(new { needed = false });
            var phone = Hoardings.Phone(dto?.Phone);
            var email = string.IsNullOrWhiteSpace(dto?.Email) ? null : dto!.Email!.Trim().ToLowerInvariant();
            var bad = new Dictionary<string, string>();
            if (phone == null) bad["phone"] = "Enter a 10-digit mobile number.";
            if (email != null && !Signup.EmailOk(email)) bad["email"] = "This email address doesn't look right.";
            else if (email == null && !_codes.WhatsAppReady) bad["email"] = "Enter your email: the code is sent there.";
            if (bad.Count > 0) return BadRequest(new { message = "Please check the form.", fields = bad });

            using var platform = OrgScope.Enter(null);   // codes wait in the platform's own memory, whatever the request carried
            var sends = _cache.TryGetValue<int>(Signup.CodeSendsKey(phone!), out var n) ? n : 0;
            var today = _cache.TryGetValue<int>(Signup.CodesTodayKey, out var t) ? t : 0;
            if (sends >= Recovery.MaxSendsPerHour) return StatusCode(429, new { message = "Too many codes were sent to this number. Please wait an hour and try again." });
            if (today >= CodesPerDay) return StatusCode(429, new { message = "We can't send more codes today. Please try again tomorrow." });

            var code = Recovery.NewCode();
            var org = Hoardings.Clean(dto?.OrgName, 80) ?? "your organisation";
            var (byEmail, byWhatsApp) = await _codes.SendAsync(email, phone, code, $"Your NexEagle code: {code}", Recovery.SignupEmailText(code, org), ct);
            if (!byEmail && !byWhatsApp)
                return StatusCode(502, new { message = "We could not send the code. Check the mobile number and email, then try again." });

            _cache.Set(Signup.CodeSendsKey(phone!), sends + 1, TimeSpan.FromHours(1));
            _cache.Set(Signup.CodesTodayKey, today + 1, TimeSpan.FromHours(24));
            _cache.Set(Signup.CodeKey(phone!), new Recovery.Pending(Recovery.Hash(Signup.CodeOwner(phone!, email), code), DateTime.UtcNow.AddMinutes(Recovery.CodeMinutes), 0),
                TimeSpan.FromMinutes(Recovery.CodeMinutes + 1));
            return Ok(new { needed = true, email = byEmail, whatsapp = byWhatsApp, minutes = Recovery.CodeMinutes });
        }

        /// <summary>Checks the code typed with the form. Wrong tries are counted; five finish the code.</summary>
        private string? CodeProblem(SignupDto dto)
        {
            if (!_codes.Ready) return null;
            var phone = Hoardings.Phone(dto.Phone)!;
            using var platform = OrgScope.Enter(null);
            var key = Signup.CodeKey(phone);
            _cache.TryGetValue<Recovery.Pending>(key, out var pending);
            var result = Recovery.Check(pending, Signup.CodeOwner(phone, dto.Email), dto.Code, DateTime.UtcNow);
            if (result == Recovery.Result.Ok) return null;
            if (pending != null && result == Recovery.Result.Wrong)
                _cache.Set(key, pending with { Tries = pending.Tries + 1 }, pending.Expires - DateTime.UtcNow + TimeSpan.FromMinutes(1));
            return result == Recovery.Result.None ? "Ask for a code first: we send it to your mobile number and email."
                : "That code is wrong or has expired. Ask for a new one.";
        }

        [HttpPost]
        [EnableRateLimiting("webform")]
        public async Task<IActionResult> Create([FromBody] SignupDto dto, CancellationToken ct)
        {
            if (!Open) return StatusCode(403, new { message = "New sign-ups are closed at the moment." });
            var bad = Signup.Check(dto ?? new SignupDto(), _orgs.Default.Key, out var key);
            if (bad.Count > 0 || key == null) return BadRequest(new { message = "Please check the form.", fields = bad });
            if (CodeProblem(dto!) is { } codeProblem)
                return BadRequest(new { message = codeProblem, fields = new Dictionary<string, string> { ["code"] = codeProblem } });

            var orgName = dto!.OrgName!.Trim();
            var org = new OrgInfo(key, orgName, OrgNames.DatabaseFor(key));

            if (!await OneAtATime.WaitAsync(TimeSpan.FromSeconds(45), ct))
                return StatusCode(503, new { message = "Many people are signing up right now. Please try again in a minute." });
            try
            {
                // 1. Reserve the name in the platform's list.
                Guid rowId;
                using (OrgScope.Enter(null))
                using (var scope = _scopes.CreateScope())
                {
                    var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                    var since = DateTime.UtcNow.AddHours(-24);
                    if (await db.Organisations.CountAsync(o => o.CreatedAt > since, ct) >= PerDay)
                        return StatusCode(429, new { message = "We have reached today's limit for new organisations. Please try again tomorrow." });

                    var row = await db.Organisations.FirstOrDefaultAsync(o => o.Key == key, ct);
                    // Sign-ups run one at a time, so a row still "setting up" here was left by one that never finished.
                    if (row != null && row.Status != "failed" && row.Status != "setting_up")
                        return Conflict(new { message = "Please check the form.", fields = new Dictionary<string, string> { ["orgKey"] = "This name is already taken. Choose another." } });
                    if (row == null) { row = new Organisation { Key = key, CreatedAt = DateTime.UtcNow }; db.Organisations.Add(row); }
                    row.Name = orgName;
                    row.Database = org.Database;
                    row.Status = "setting_up";
                    row.Kinds = string.Join(",", dto.Kinds!.Select(k => k.Trim().ToLowerInvariant()).Distinct());
                    await db.SaveChangesAsync(ct);
                    rowId = row.Id;
                }

                // 2. Create its own database and the first admin, working only inside that database.
                //    From here it runs to the end even if the person closes the page, so nothing is left half made.
                ct = CancellationToken.None;
                try
                {
                    using (OrgScope.Enter(org))
                    using (var scope = _scopes.CreateScope())
                    {
                        await scope.ServiceProvider.GetRequiredService<IOrgDatabase>().SetUpAsync(ct);
                        var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                        // A sign-up that failed half way may have left an admin: this organisation was never usable, so it is theirs to finish.
                        var admin = await db.Agents.FirstOrDefaultAsync(a => a.AgentId == Signup.FirstUserId, ct);
                        if (admin == null) { admin = new FieldAgent { AgentId = Signup.FirstUserId }; db.Agents.Add(admin); }
                        var city = Hoardings.Clean(dto.City, 60) ?? "HQ";
                        admin.Name = dto.Name!.Trim();
                        admin.Phone = Hoardings.Phone(dto.Phone)!;
                        admin.Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim().ToLowerInvariant();
                        admin.Role = RoleChecks.Admin;
                        admin.District = city;
                        admin.Block = "HQ";
                        admin.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password);
                        admin.MustChangePassword = false;
                        admin.IsActive = true;
                        await db.SaveChangesAsync(ct);
                    }
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "Sign-up could not set up organisation {Org}", key);
                    await SetStatusAsync(rowId, "failed");
                    return StatusCode(500, new { message = "We could not finish setting up your organisation. Nothing was lost: please try again in a few minutes." });
                }

                using (OrgScope.Enter(null)) _cache.Remove(Signup.CodeKey(Hoardings.Phone(dto.Phone)!));   // a code works once

                // 3. Open it for sign-in.
                await SetStatusAsync(rowId, "active");
                _orgs.Refresh();
                _log.LogInformation("New organisation {Org} signed up", key);
                return Ok(new { key, name = orgName, userId = Signup.FirstUserId });
            }
            finally { OneAtATime.Release(); }
        }

        private async Task SetStatusAsync(Guid id, string status)
        {
            using var platform = OrgScope.Enter(null);
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var row = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id);
            if (row == null) return;
            row.Status = status;
            await db.SaveChangesAsync(CancellationToken.None);
        }
    }
}
