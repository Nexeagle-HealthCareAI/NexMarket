using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// Patients from health camps, field agents and partners: how many were sent, how many came, OPD or admitted, and
    /// what they brought in. Counts the patients referred in the chosen days and everything that happened to them since.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Pipeline, Pages.Desk, Pages.Dashboard)]
    [Route("api/v1/referrals/results")]
    public class PatientResultsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        public PatientResultsController(IMarketingDbContext db) { _db = db; }

        private static DateOnly? D(string? s) => DateOnly.TryParseExact((s ?? "").Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

        private async Task<(DateOnly From, DateOnly To, List<PatientResults.Line> Lines)> LoadAsync(string? from, string? to, string? origin, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var end = D(to) ?? today;
            var start = D(from) ?? new DateOnly(today.Year, today.Month, 1);
            if (start > end) (start, end) = (end, start);
            if (end.DayNumber - start.DayNumber > 800) start = end.AddDays(-800);
            var fromUtc = AttendanceService.StartUtc(start);
            var toUtc = AttendanceService.StartUtc(end.AddDays(1));
            var refs = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= fromUtc && r.CreatedAt < toUtc).ToListAsync(ct);
            var ids = refs.Select(r => r.ClientId).ToList();
            var bills = await _db.ReferralBills.AsNoTracking().Where(b => ids.Contains(b.ReferralClientId) && b.Status == "active")
                .Select(b => new PatientResults.Bill(b.ReferralClientId, b.Kind, b.Amount, b.Collected)).ToListAsync(ct);
            var lines = PatientResults.Lines(refs, bills);
            if (origin is "camp" or "agent" or "partner") lines = lines.Where(l => l.Origin == origin).ToList();
            return (start, end, lines);
        }

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? origin, CancellationToken ct)
        {
            var (start, end, lines) = await LoadAsync(from, to, origin, ct);

            // Health camps: people seen at the camp next to what came of those sent to the hospital, and the camp's cost.
            var campIds = lines.Where(l => l.R.CampId != null).Select(l => l.R.CampId!.Value).Distinct().ToList();
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => campIds.Contains(c.Id) || (c.Date >= start && c.Date <= end && c.Status != "cancelled"))
                .Select(c => new { c.Id, c.Title, c.Date, c.Block, c.Budget, c.Spent, c.Status }).ToListAsync(ct);
            var allCampIds = camps.Select(c => c.Id).ToList();
            var seen = (await _db.CampPatients.AsNoTracking().Where(p => allCampIds.Contains(p.CampId) && p.Status == "attended").Select(p => p.CampId).ToListAsync(ct))
                .GroupBy(x => x).ToDictionary(g => g.Key, g => g.Count());
            var campRows = camps.Select(c =>
            {
                var t = PatientResults.TallyOf(lines.Where(l => l.R.CampId == c.Id));
                var cost = c.Spent > 0 ? c.Spent : c.Budget;
                return new { c, t, cost };
            }).Where(x => x.c.Status == "done" || x.t.Referred > 0 || seen.ContainsKey(x.c.Id)).OrderByDescending(x => x.c.Date).ToList();

            // Field agents.
            var agentIds = lines.Where(l => l.Origin != "camp" && !string.IsNullOrEmpty(l.R.AgentId)).Select(l => l.R.AgentId).Distinct().ToList();
            var names = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name, a.Block }).ToListAsync(ct);
            var agentRows = lines.Where(l => l.Origin != "camp" && !string.IsNullOrEmpty(l.R.AgentId)).GroupBy(l => l.R.AgentId)
                .Select(g => new { id = g.Key, a = names.FirstOrDefault(n => n.AgentId == g.Key), t = PatientResults.TallyOf(g) })
                .OrderByDescending(x => x.t.Billed).ThenByDescending(x => x.t.Admitted).ThenByDescending(x => x.t.Referred).ToList();

            // Month by month (by the month the patient was referred).
            var months = lines.GroupBy(l => (l.R.CreatedAt + IstClock.Offset).ToString("yyyy-MM", CultureInfo.InvariantCulture)).OrderBy(g => g.Key)
                .Select(g => new
                {
                    month = g.Key,
                    camp = PatientResults.TallyOf(g.Where(l => l.Origin == "camp")).Shape(),
                    agent = PatientResults.TallyOf(g.Where(l => l.Origin != "camp")).Shape(),
                    all = PatientResults.TallyOf(g).Shape(),
                }).ToList();

            var campTitles = camps.ToDictionary(c => c.Id, c => c.Title);
            var cardIds = lines.Where(l => l.R.HealthCardId != null).Select(l => l.R.HealthCardId!.Value).Distinct().ToList();
            var cardNumbers = await _db.HealthCards.AsNoTracking().Where(c => cardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Number, ct);
            var agentNames = names.ToDictionary(n => n.AgentId, n => n.Name);
            return Ok(new
            {
                from = start.ToString("yyyy-MM-dd"), to = end.ToString("yyyy-MM-dd"), origin = origin ?? "all",
                total = PatientResults.TallyOf(lines).Shape(),
                withCard = PatientResults.TallyOf(lines.Where(l => l.R.HealthCardId != null)).Shape(),
                byOrigin = new[] { "camp", "agent", "partner" }.Select(o => new { key = o, label = PatientResults.OriginLabel(o), tally = PatientResults.TallyOf(lines.Where(l => l.Origin == o)).Shape() }),
                camps = campRows.Select(x => new
                {
                    id = x.c.Id, title = x.c.Title, date = x.c.Date.ToString("yyyy-MM-dd"), block = x.c.Block, status = x.c.Status,
                    seen = seen.GetValueOrDefault(x.c.Id), cost = x.cost, tally = x.t.Shape(),
                    returnOnCost = x.cost > 0 ? Math.Round(x.t.Billed / x.cost, 1) : (decimal?)null,
                }),
                agents = agentRows.Select(x => new { agentId = x.id, name = x.a?.Name ?? x.id, block = x.a?.Block, tally = x.t.Shape() }),
                departments = lines.GroupBy(l => string.IsNullOrWhiteSpace(l.R.Department) ? "Not given" : l.R.Department)
                    .Select(g => new { name = g.Key, t = PatientResults.TallyOf(g) }).OrderByDescending(x => x.t.Referred).Take(15)
                    .Select(x => new { x.name, tally = x.t.Shape() }),
                months,
                patients = lines.OrderByDescending(l => l.R.CreatedAt).Take(400).Select(l => new
                {
                    clientId = l.R.ClientId, name = l.R.PatientName, department = l.R.Department, origin = l.Origin,
                    from = l.Origin == "camp" ? (l.R.CampId != null ? campTitles.GetValueOrDefault(l.R.CampId.Value) : null) : agentNames.GetValueOrDefault(l.R.AgentId),
                    referredAt = l.R.CreatedAt, arrivedAt = l.R.ArrivedAt, admittedAt = l.R.AdmittedAt, status = l.R.Status, outcome = l.Outcome,
                    billed = l.Billed, collected = l.Collected, card = l.R.HealthCardId != null ? cardNumbers.GetValueOrDefault(l.R.HealthCardId.Value) : null,
                }),
                count = lines.Count,
            });
        }

        /// <summary>Every patient in the chosen days, as a spreadsheet.</summary>
        [HttpGet("export")]
        public async Task<IActionResult> Export([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? origin, CancellationToken ct)
        {
            var (start, end, lines) = await LoadAsync(from, to, origin, ct);
            var campIds = lines.Where(l => l.R.CampId != null).Select(l => l.R.CampId!.Value).Distinct().ToList();
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => campIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Title, ct);
            var agentIds = lines.Select(l => l.R.AgentId).Distinct().ToList();
            var agents = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            static string c(string? v) => v == null ? "" : (v.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v);
            static string dt(DateTime? v) => v == null ? "" : (v.Value + IstClock.Offset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var sb = new StringBuilder("Referred on,Patient,Phone,Department,Came through,From,Outcome,Arrived on,Admitted on,Billed,OPD billed,Other billed,Collected\n");
            foreach (var l in lines.OrderBy(l => l.R.CreatedAt))
            {
                var fromName = l.Origin == "camp" ? (l.R.CampId != null ? camps.GetValueOrDefault(l.R.CampId.Value) : null) : agents.GetValueOrDefault(l.R.AgentId);
                var outcome = l.Outcome switch { "admitted" => "Admitted", "opd" => "OPD", "came" => "Came (outcome not recorded)", "lost" => "Did not come", _ => "Not come yet" };
                sb.Append(string.Join(",", dt(l.R.CreatedAt), c(l.R.PatientName), c(l.R.ClientPhone), c(l.R.Department), c(PatientResults.OriginLabel(l.Origin)), c(fromName), outcome,
                    dt(l.R.ArrivedAt), dt(l.R.AdmittedAt), l.Billed.ToString("0.##", CultureInfo.InvariantCulture), l.OpdBilled.ToString("0.##", CultureInfo.InvariantCulture),
                    l.IpdBilled.ToString("0.##", CultureInfo.InvariantCulture), l.Collected.ToString("0.##", CultureInfo.InvariantCulture))).Append('\n');
            }
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"patients-{start:yyyy-MM-dd}-to-{end:yyyy-MM-dd}.csv");
        }
    }
}
