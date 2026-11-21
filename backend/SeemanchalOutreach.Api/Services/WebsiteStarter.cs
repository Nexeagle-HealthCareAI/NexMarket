using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// A working website made from the CRM's own records, for an organisation that has none yet: hospital details, doctors
    /// (Departments &amp; doctors), departments, upcoming health camps, and anything already written on the Website page.
    /// It is a small static site that reads the same content files every NexMarket website reads, so the Website page can
    /// publish to it straight away. Delivered as a download, or as a pull request into an empty repository.
    /// </summary>
    public class SiteStarter
    {
        private readonly IMarketingDbContext _db;
        public SiteStarter(IMarketingDbContext db) { _db = db; }

        public static readonly string[] Template = { "build.mjs", "style.css", "README.md", "deploy-example.yml", "package.json" };

        public static byte[] TemplateFile(string name)
        {
            var asm = typeof(SiteStarter).Assembly;
            var res = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith(".Starter." + name, StringComparison.Ordinal) || n.EndsWith("Starter." + name, StringComparison.Ordinal))
                ?? throw new InvalidOperationException("The starter website template is missing from the server: " + name);
            using var s = asm.GetManifestResourceStream(res)!;
            using var ms = new MemoryStream(); s.CopyTo(ms); return ms.ToArray();
        }

        private static byte[] Json(JsonNode n) => Encoding.UTF8.GetBytes(SiteRules.FileText(n));

        /// <summary>Every file of the starter website, by path.</summary>
        public async Task<List<(string Path, byte[] Bytes)>> FilesAsync(string orgName, SiteConfig cfg, CancellationToken ct)
        {
            var files = new List<(string, byte[])>();
            var live = await _db.SiteContents.AsNoTracking().Where(c => c.Published != null && !c.Archived).ToListAsync(ct);
            JsonObject L(SiteContent c) => SiteRules.Parse(c.Published);

            var siteItem = live.FirstOrDefault(c => c.Type == "site");
            var site = siteItem != null ? L(siteItem) : new JsonObject();
            if (SiteRules.Text(site["name"]).Length == 0) site["name"] = orgName;
            if (SiteRules.Text(site["description"]).Length == 0) site["description"] = $"{orgName}: doctors, departments, health camps and how to reach us.";
            if (cfg.SiteUrl != null && SiteRules.Text(site["website"]).Length == 0) site["website"] = cfg.SiteUrl;
            files.Add(("content/site.json", Json(site)));

            var depts = await _db.Departments.AsNoTracking().OrderBy(d => d.Name).ToListAsync(ct);
            var deptNames = depts.ToDictionary(d => d.Id, d => d.Name);
            files.Add(("content/departments.json", Json(new JsonArray(depts.Select(d => (JsonNode)new JsonObject { ["name"] = d.Name }).ToArray()))));

            var doctorItems = live.Where(c => c.Type == "doctor").OrderBy(c => c.SortOrder).ToList();
            JsonArray doctors;
            if (doctorItems.Count > 0) doctors = new JsonArray(doctorItems.Select(c => (JsonNode)L(c)).ToArray());
            else
            {
                var crm = await _db.Doctors.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Name).ToListAsync(ct);
                doctors = new JsonArray(crm.Select(d =>
                {
                    var dept = d.DepartmentId != null ? deptNames.GetValueOrDefault(d.DepartmentId.Value) : null;
                    var o = new JsonObject { ["id"] = SiteRules.Slug(d.Name), ["name"] = d.Name, ["department"] = dept ?? "", ["specialty"] = dept ?? "", ["qualifications"] = d.Qualification ?? "" };
                    var opd = string.Join(": ", new[] { d.OpdDays, d.OpdTimings }.Where(x => !string.IsNullOrWhiteSpace(x)));
                    if (opd.Length > 0) o["consultationTimings"] = opd;
                    return (JsonNode)o;
                }).ToArray());
            }
            files.Add(("content/doctors.json", Json(doctors)));

            JsonArray Of(string type) => new(live.Where(c => c.Type == type).OrderBy(c => c.SortOrder).ThenBy(c => c.Key, StringComparer.Ordinal).Select(c => (JsonNode)L(c)).ToArray());
            files.Add(("content/faqs.json", Json(Of("faq"))));
            files.Add(("content/blog.json", Json(Of("article"))));
            files.Add(("content/notices.json", Json(Of("notice"))));
            files.Add(("content/testimonials.json", Json(Of("testimonial"))));
            files.Add(("content/locations.json", Json(Of("location"))));
            files.Add(("content/redirects.json", Json(Of("redirect"))));

            var campItems = Of("camp");
            if (campItems.Count == 0)
            {
                var today = AttendanceService.TodayIst;
                var crm = await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= today && c.Status != "cancelled").OrderBy(c => c.Date).Take(20).ToListAsync(ct);
                campItems = new JsonArray(crm.Select(c => (JsonNode)new JsonObject
                {
                    ["slug"] = SiteRules.Slug(c.Title + " " + c.Date.ToString("yyyy-MM-dd")), ["title"] = c.Title, ["date"] = c.Date.ToString("yyyy-MM-dd"),
                    ["startTime"] = c.StartTime, ["endTime"] = c.EndTime, ["place"] = c.Venue ?? c.Block ?? c.District ?? "", ["description"] = "Free health check-up camp.",
                    ["services"] = new JsonArray(), ["doctors"] = new JsonArray(), ["free"] = true,
                }).ToArray());
            }
            files.Add(("content/camps.json", Json(campItems)));

            foreach (var t in Template) files.Add((t == "deploy-example.yml" ? "deploy-example.yml" : t, TemplateFile(t)));
            files.Add(("public/.gitkeep", Array.Empty<byte>()));
            return files;
        }

        public static byte[] Zip(IEnumerable<(string Path, byte[] Bytes)> files, string folder)
        {
            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
                foreach (var (path, bytes) in files)
                {
                    var e = zip.CreateEntry(folder + "/" + path, CompressionLevel.Optimal);
                    using var s = e.Open(); s.Write(bytes);
                }
            return ms.ToArray();
        }
    }
}
