using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// The field agents' Android app for the CRM's Field app page. The Android build (android-apk.yml, develop) puts the
    /// newest APK and a small latest.json (version, build, date, what changed) in storage under app-releases/android/.
    /// No sign-in, so an agent's phone can open the link from the page's QR code; the app itself still needs a login.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/app/android")]
    public class AppReleaseController : ControllerBase
    {
        private const string Folder = "app-releases/android/";
        private readonly IFileStore _files;

        public AppReleaseController(IFileStore files) { _files = files; }

        private sealed record Release(string Version, int Build, DateTime? BuiltAt, string? Commit, string? Notes, long? Size, string File);

        private async Task<Release?> LatestAsync(CancellationToken ct)
        {
            var f = await _files.OpenReleaseAsync(Folder + "latest.json", ct);
            if (f == null) return null;
            await using var s = f.Value.Content;
            try
            {
                using var doc = await JsonDocument.ParseAsync(s, cancellationToken: ct);
                var r = doc.RootElement;
                string? Str(string k) => r.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var version = Str("version") ?? "";
                var build = r.TryGetProperty("build", out var b) && b.TryGetInt32(out var n) ? n : 0;
                var built = DateTime.TryParse(Str("builtAt"), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d : (DateTime?)null;
                var size = r.TryGetProperty("size", out var z) && z.TryGetInt64(out var bytes) ? bytes : (long?)null;
                var notes = Str("notes");
                if (notes is { Length: > 300 }) notes = notes[..300];
                return new Release(version, build, built, Str("commit"), notes, size, $"nexeagle-field-{version}-{build}.apk");
            }
            catch (JsonException)
            {
                return null;
            }
        }

        /// <summary>The newest build: version, build number, when it was made, what changed and its size.</summary>
        [HttpGet]
        public async Task<IActionResult> Info(CancellationToken ct)
        {
            var r = await LatestAsync(ct);
            if (r == null) return NotFound(new { message = "No app build has been published yet." });
            Response.Headers["Cache-Control"] = "no-cache";
            return Ok(new { version = r.Version, build = r.Build, builtAt = r.BuiltAt, commit = r.Commit, notes = r.Notes, size = r.Size, file = r.File });
        }

        /// <summary>The newest APK as a download.</summary>
        [HttpGet("download")]
        [EnableRateLimiting("appdownload")]
        public async Task<IActionResult> Download(CancellationToken ct)
        {
            var r = await LatestAsync(ct);
            var f = await _files.OpenReleaseAsync(Folder + "latest.apk", ct);
            if (f == null) return NotFound(new { message = "No app build has been published yet." });
            Response.Headers["Cache-Control"] = "no-store";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            if (f.Value.Length is long len) Response.ContentLength = len;
            return File(f.Value.Content, "application/vnd.android.package-archive", r?.File ?? "nexeagle-field.apk");
        }
    }
}
