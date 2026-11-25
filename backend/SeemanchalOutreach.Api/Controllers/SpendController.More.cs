using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SpendKindDto
    {
        public string? Label { get; set; }
        /// <summary>constant | variable</summary>
        public string? Nature { get; set; }
        public string? Color { get; set; }
        public bool? AgentCanUse { get; set; }
        public int? Order { get; set; }
        public bool? Archived { get; set; }
    }

    public class SpendProjectDto
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        /// <summary>Empty for no budget; -1 clears it.</summary>
        public decimal? Budget { get; set; }
        public DateOnly? StartDate { get; set; }
        public DateOnly? EndDate { get; set; }
        public string? LeadId { get; set; }
        public string? Color { get; set; }
        /// <summary>active | closed</summary>
        public string? Status { get; set; }
        /// <summary>Health camps to put in the project (added to those already in it).</summary>
        public List<Guid>? CampIds { get; set; }
    }

    public class SpendFundDto
    {
        public Guid? ProjectId { get; set; }
        public decimal? Amount { get; set; }
        public DateOnly? On { get; set; }
        public string? Source { get; set; }
        public string? Mode { get; set; }
        public string? Note { get; set; }
        /// <summary>The person who received it in hand (a money manager); empty when it went to the organisation's account.</summary>
        public string? ReceivedBy { get; set; }
    }

    public class SpendRecurringDto
    {
        public string? Title { get; set; }
        public string? Category { get; set; }
        public decimal? Amount { get; set; }
        public string? Every { get; set; }
        public int? DueDay { get; set; }
        public string? FromMonth { get; set; }
        public Guid? ProjectId { get; set; }
        public string? Payee { get; set; }
        public string? ForAgentId { get; set; }
        public string? Note { get; set; }
    }

    public class SpendRecurringPayDto
    {
        public string? Period { get; set; }
        public decimal? Amount { get; set; }
        public DateOnly? On { get; set; }
        public string? Mode { get; set; }
        public string? Note { get; set; }
        /// <summary>office (default) | person: a person paid it from the money they hold.</summary>
        public string? PaidBy { get; set; }
        public string? AgentId { get; set; }
    }

    public class SpendManagerDto { public string? AgentId { get; set; } public string? Note { get; set; } }

    /// <summary>
    /// The organised side of Marketing spend: the team's own kinds of spend (constant or variable), projects with their
    /// funds and budget, constant payments due every month, quarter or year, and money managers who hold the funds and
    /// hand them out. Money managers can do everything here that moves money, even with view-only access to Payments.
    /// </summary>
    public partial class SpendController
    {
        private bool? _canHandle;
        private bool? _isManager;

        private async Task<bool> IsManagerAsync(CancellationToken ct)
        {
            if (_isManager != null) return _isManager.Value;
            var me = User.AgentIdOf();
            return (_isManager = await _db.SpendManagers.AsNoTracking().AnyAsync(m => m.AgentId == me && m.Active, ct)).Value;
        }

        /// <summary>Can this person record and approve money: edit rights on Payments, or a money manager.</summary>
        private async Task<bool> CanHandleAsync(CancellationToken ct)
        {
            if (_canHandle != null) return _canHandle.Value;
            if (User.IsAdmin()) return (_canHandle = true).Value;
            var perms = HttpContext.RequestServices.GetRequiredService<IPermissionService>();
            if (await perms.GetLevelAsync(User, Pages.Payments) >= Pages.Edit) return (_canHandle = true).Value;
            return (_canHandle = await IsManagerAsync(ct)).Value;
        }

        private ObjectResult NotAllowed() => StatusCode(403, new { message = "Only a money manager or someone who can edit Payments can do this." });

        private async Task<List<Spend.Kind>> KindsAsync(CancellationToken ct) => Spend.KindsOf(await _db.SpendCategories.AsNoTracking().ToListAsync(ct));

        private static object KindShape(Spend.Kind k) => new { key = k.Key, label = k.Label, nature = k.Nature, color = k.Color, order = k.Order, agentCanUse = k.AgentCanUse, archived = k.Archived };

        // ── Kinds of spend ──────────────────────────────────────────────────────

        [HttpGet("kinds")]
        public async Task<IActionResult> Kinds(CancellationToken ct) => Ok((await KindsAsync(ct)).Select(KindShape));

        /// <summary>A new kind of spend, constant or variable.</summary>
        [HttpPost("kinds")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> AddKind([FromBody] SpendKindDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var kinds = await KindsAsync(ct);
            var err = Spend.KindProblem(d.Label, d.Nature ?? "variable", kinds);
            if (err != null) return BadRequest(new { message = err });
            await EnsureDefaultKindsAsync(kinds, ct);
            var row = new SpendCategory
            {
                Key = "c-" + Guid.NewGuid().ToString("N")[..8], Label = d.Label!.Trim(), Nature = d.Nature == "constant" ? "constant" : "variable",
                Color = ColorOf(d.Color) ?? Spend.Palette[kinds.Count % Spend.Palette.Length], Order = d.Order ?? (kinds.Where(k => k.Key != "other").Select(k => k.Order).DefaultIfEmpty(0).Max() + 1),
                AgentCanUse = d.AgentCanUse ?? true, CreatedBy = User.AgentIdOf(),
            };
            _db.SpendCategories.Add(row);
            await _db.SaveChangesAsync(ct);
            return Ok(KindShape(Spend.KindsOf(new[] { row }).First(k => k.Key == row.Key)));
        }

        /// <summary>Rename a kind, make it constant or variable, change its colour, or archive it (old entries keep it).</summary>
        [HttpPut("kinds/{key}")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> EditKind(string key, [FromBody] SpendKindDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var kinds = await KindsAsync(ct);
            if (kinds.All(k => k.Key != key)) return NotFound(new { message = "That kind isn't here any more." });
            if (d.Label != null || d.Nature != null)
            {
                var err = Spend.KindProblem(d.Label ?? kinds.First(k => k.Key == key).Label, d.Nature, kinds, key);
                if (err != null) return BadRequest(new { message = err });
            }
            if (d.Archived == true && (key == "other" || key == "agents")) return BadRequest(new { message = key == "other" ? "Other is always there for what fits nowhere else." : "Salaries are needed for the team's pay." });
            await EnsureDefaultKindsAsync(kinds, ct);
            await _db.SaveChangesAsync(ct);
            var row = await _db.SpendCategories.FirstOrDefaultAsync(c => c.Key == key, ct);
            if (row == null) return NotFound(new { message = "That kind isn't here any more." });
            if (d.Label != null) row.Label = d.Label.Trim();
            if (d.Nature != null) row.Nature = d.Nature == "constant" ? "constant" : "variable";
            if (ColorOf(d.Color) is string c) row.Color = c;
            if (d.AgentCanUse != null) row.AgentCanUse = key != "agents" && d.AgentCanUse.Value;
            if (d.Order != null) row.Order = d.Order.Value;
            if (d.Archived != null) row.Archived = d.Archived.Value;
            await _db.SaveChangesAsync(ct);
            return Ok(KindShape(Spend.KindsOf(new[] { row }).First(k => k.Key == row.Key)));
        }

        /// <summary>The table starts empty on databases that skipped the seed: write the default kinds before the first change.</summary>
        private async Task EnsureDefaultKindsAsync(List<Spend.Kind> kinds, CancellationToken ct)
        {
            var have = await _db.SpendCategories.Select(c => c.Key).ToListAsync(ct);
            foreach (var d in Spend.DefaultKinds.Where(d => !have.Contains(d.Key)))
                _db.SpendCategories.Add(new SpendCategory { Key = d.Key, Label = d.Label, Nature = d.Nature, Color = d.Color, Order = d.Order, AgentCanUse = d.AgentCanUse, CreatedBy = "system" });
        }

        private static string? ColorOf(string? c) => c != null && System.Text.RegularExpressions.Regex.IsMatch(c, "^#[0-9a-fA-F]{6}$") ? c.ToLowerInvariant() : null;

        // ── Projects ────────────────────────────────────────────────────────────

        private async Task<object> ProjectRowAsync(SpendProject p, List<MarketingExpense> expenses, List<SpendFund> funds, List<Spend.Kind> kinds, List<string>? camps = null)
        {
            var m = Spend.MoneyOf(p, expenses, funds, kinds);
            await Task.CompletedTask;
            return new
            {
                id = p.Id, name = p.Name, description = p.Description, budget = p.Budget, startDate = p.StartDate?.ToString("yyyy-MM-dd"), endDate = p.EndDate?.ToString("yyyy-MM-dd"),
                status = p.Status, leadId = p.LeadId, leadName = p.LeadName, color = p.Color,
                received = m.Received, spent = m.Spent, constant = m.Constant, variable = m.Variable, pending = m.Pending, left = m.Left, usedPct = m.UsedPct, entries = m.Entries,
                camps = camps ?? new List<string>(),
            };
        }

        /// <summary>Every project with its money: budget, received, spent (constant and variable), waiting and left.</summary>
        [HttpGet("projects")]
        public async Task<IActionResult> Projects(CancellationToken ct)
        {
            var projects = await _db.SpendProjects.AsNoTracking().OrderBy(p => p.Status).ThenByDescending(p => p.CreatedAt).ToListAsync(ct);
            var expenses = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.ProjectId != null).ToListAsync(ct);
            var funds = await _db.SpendFunds.AsNoTracking().Where(f => !f.Removed).ToListAsync(ct);
            var kinds = await KindsAsync(ct);
            var camps = await CampNamesAsync(ct);
            var rows = new List<object>();
            foreach (var p in projects) rows.Add(await ProjectRowAsync(p, expenses, funds, kinds, camps.GetValueOrDefault(p.Id)));
            return Ok(rows);
        }

        private async Task<string?> ApplyProjectAsync(SpendProject p, SpendProjectDto d, CancellationToken ct)
        {
            var budget = d.Budget == -1 ? null : d.Budget ?? p.Budget;
            var err = Spend.ProjectProblem(d.Name ?? p.Name, budget, d.StartDate ?? p.StartDate, d.EndDate ?? p.EndDate);
            if (err != null) return err;
            if (d.Name != null) p.Name = d.Name.Trim();
            if (d.Description != null) p.Description = Hoardings.Clean(d.Description, 1000);
            p.Budget = budget;
            if (d.StartDate != null) p.StartDate = d.StartDate;
            if (d.EndDate != null) p.EndDate = d.EndDate;
            if (d.LeadId != null)
            {
                if (d.LeadId == "") { p.LeadId = null; p.LeadName = null; }
                else
                {
                    var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == d.LeadId).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                    if (a == null) return "Pick the person leading it.";
                    p.LeadId = a.AgentId; p.LeadName = a.Name;
                }
            }
            if (ColorOf(d.Color) is string c) p.Color = c;
            if (d.Status is "active" or "closed") p.Status = d.Status;
            p.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        [HttpPost("projects")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> AddProject([FromBody] SpendProjectDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var count = await _db.SpendProjects.CountAsync(ct);
            var p = new SpendProject { CreatedBy = User.AgentIdOf(), Color = Spend.Palette[count % Spend.Palette.Length], Name = "" };
            var err = await ApplyProjectAsync(p, d, ct);
            if (err != null) return BadRequest(new { message = err });
            _db.SpendProjects.Add(p);
            await LinkAsync(p.Id, d.CampIds, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(await ProjectRowAsync(p, new(), new(), await KindsAsync(ct)));
        }

        /// <summary>Change a project, or close it (it stays in the records and reports) and open it again.</summary>
        [HttpPut("projects/{id:guid}")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> EditProject(Guid id, [FromBody] SpendProjectDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var p = await _db.SpendProjects.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound(new { message = "That project isn't here any more." });
            var err = await ApplyProjectAsync(p, d, ct);
            if (err != null) return BadRequest(new { message = err });
            await LinkAsync(p.Id, d.CampIds, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>One project in full: its money, every fund received, every expense, by kind and by person, and its constant payments.</summary>
        [HttpGet("projects/{id:guid}")]
        public async Task<IActionResult> Project(Guid id, CancellationToken ct)
        {
            var p = await _db.SpendProjects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound(new { message = "That project isn't here any more." });
            var expenses = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.ProjectId == id).OrderByDescending(e => e.SpentOn).ThenByDescending(e => e.CreatedAt).Take(3000).ToListAsync(ct);
            var funds = await _db.SpendFunds.AsNoTracking().Where(f => !f.Removed && f.ProjectId == id).OrderByDescending(f => f.On).ThenByDescending(f => f.CreatedAt).ToListAsync(ct);
            var recurring = await _db.SpendRecurrings.AsNoTracking().Where(r => r.ProjectId == id).ToListAsync(ct);
            var kinds = await KindsAsync(ct);
            var names = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct)).GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
            var counted = expenses.Where(Spend.Counts).ToList();
            var campNames = (await CampNamesAsync(ct)).GetValueOrDefault(id);
            return Ok(new
            {
                project = await ProjectRowAsync(p, expenses, funds, kinds, campNames),
                camps = await ProjectCampsAsync(id, counted.Sum(e => e.Amount), ct),
                funds = funds.Select(FundShape),
                expenses = expenses.Select(SpendFiles.Shape),
                byKind = Spend.ByCategory(counted),
                byPerson = Spend.ByPerson(counted).Select(x => new { agentId = x.AgentId, name = names.GetValueOrDefault(x.AgentId, x.AgentId), total = x.Total }),
                byMonth = counted.GroupBy(e => Spend.Month(e.SpentOn)).OrderBy(g => g.Key)
                    .Select(g => new { month = g.Key, constant = g.Where(e => Spend.NatureOf(e.Category, kinds) == "constant").Sum(e => e.Amount), variable = g.Where(e => Spend.NatureOf(e.Category, kinds) != "constant").Sum(e => e.Amount) }),
                recurring = recurring.Select(r => new { id = r.Id, title = r.Title, amount = r.Amount, every = r.Every, active = r.Active }),
            });
        }

        // ── Funds received ──────────────────────────────────────────────────────

        private static object FundShape(SpendFund f) => new
        {
            id = f.Id, projectId = f.ProjectId, amount = f.Amount, on = f.On.ToString("yyyy-MM-dd"), source = f.Source, mode = f.Mode, note = f.Note,
            receivedBy = f.ReceivedBy, receivedByName = f.ReceivedByName, createdByName = f.CreatedByName, createdAt = f.CreatedAt,
        };

        [HttpGet("funds")]
        public async Task<IActionResult> Funds([FromQuery] Guid? project, CancellationToken ct)
        {
            var q = _db.SpendFunds.AsNoTracking().Where(f => !f.Removed);
            if (project != null) q = q.Where(f => f.ProjectId == project);
            return Ok((await q.OrderByDescending(f => f.On).ThenByDescending(f => f.CreatedAt).Take(2000).ToListAsync(ct)).Select(FundShape));
        }

        /// <summary>Money received for marketing: for a project or in general; in a person's hand or the organisation's account.</summary>
        [HttpPost("funds")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> AddFund([FromBody] SpendFundDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var err = Spend.Problem(d.Amount, d.On, AttendanceService.TodayIst, Spend.OfficeDaysBack);
            if (err != null) return BadRequest(new { message = err.Replace("Write the amount.", "Write the amount received.") });
            var source = Hoardings.Clean(d.Source, 120);
            if (source == null) return BadRequest(new { message = "Write who it came from, e.g. Hospital management." });
            if (d.ProjectId != null && !await _db.SpendProjects.AnyAsync(p => p.Id == d.ProjectId, ct)) return BadRequest(new { message = "That project isn't here any more." });
            var me = User.AgentIdOf();
            var f = new SpendFund
            {
                ProjectId = d.ProjectId, Amount = d.Amount!.Value, On = d.On!.Value, Source = source, Mode = Spend.ModeOf(d.Mode), Note = Hoardings.Clean(d.Note, 300),
                CreatedBy = me, CreatedByName = await MyNameAsync(ct),
            };
            var who = Hoardings.Clean(d.ReceivedBy, 40);
            if (who != null)
            {
                var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                if (a == null) return BadRequest(new { message = "Pick the person who received it." });
                f.ReceivedBy = a.AgentId; f.ReceivedByName = a.Name;
            }
            _db.SpendFunds.Add(f);
            await _db.SaveChangesAsync(ct);
            if (f.ReceivedBy != null)
                _notifier.Notify(new NotifyJob
                {
                    To = new() { f.ReceivedBy }, Except = me, Kind = "note", Link = "spend", RefId = f.Id.ToString(),
                    Title = $"{Spend.Rupees(f.Amount)} received by you for marketing",
                    Body = $"From {f.Source}. It counts in the money you hold.",
                });
            return Ok(FundShape(f));
        }

        [HttpPost("funds/{id:guid}/remove")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> RemoveFund(Guid id, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var f = await _db.SpendFunds.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (f == null) return NotFound(new { message = "That entry isn't here any more." });
            f.Removed = true;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Puts back money received that was taken out (Undo).</summary>
        [HttpPost("funds/{id:guid}/restore")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> RestoreFund(Guid id, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var f = await _db.SpendFunds.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (f == null) return NotFound(new { message = "That entry isn't here any more." });
            f.Removed = false;
            await _db.SaveChangesAsync(ct);
            return Ok(FundShape(f));
        }

        /// <summary>Correct money received: amount, day, from whom, how, who holds it, the project and the note.</summary>
        [HttpPut("funds/{id:guid}")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> EditFund(Guid id, [FromBody] SpendFundDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var f = await _db.SpendFunds.FirstOrDefaultAsync(x => x.Id == id && !x.Removed, ct);
            if (f == null) return NotFound(new { message = "That entry isn't here any more." });
            var err = Spend.Problem(d.Amount, d.On, AttendanceService.TodayIst, Spend.OfficeDaysBack);
            if (err != null) return BadRequest(new { message = err.Replace("Write the amount.", "Write the amount received.") });
            var source = Hoardings.Clean(d.Source, 120);
            if (source == null) return BadRequest(new { message = "Write who it came from, e.g. Hospital management." });
            if (d.ProjectId != null && d.ProjectId != Guid.Empty && !await _db.SpendProjects.AnyAsync(p => p.Id == d.ProjectId, ct)) return BadRequest(new { message = "That project isn't here any more." });
            var who = Hoardings.Clean(d.ReceivedBy, 40);
            if (who != null)
            {
                var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                if (a == null) return BadRequest(new { message = "Pick the person who received it." });
                f.ReceivedBy = a.AgentId; f.ReceivedByName = a.Name;
            }
            else { f.ReceivedBy = null; f.ReceivedByName = null; }
            f.Amount = d.Amount!.Value; f.On = d.On!.Value; f.Source = source; f.Mode = Spend.ModeOf(d.Mode); f.Note = Hoardings.Clean(d.Note, 300);
            f.ProjectId = d.ProjectId == Guid.Empty ? null : d.ProjectId;
            await _db.SaveChangesAsync(ct);
            return Ok(FundShape(f));
        }

        // ── Constant payments ───────────────────────────────────────────────────

        private static object RecurringShape(SpendRecurring r, List<Spend.Period> periods, DateOnly today, string? projectName)
        {
            var now = periods.FirstOrDefault();
            var overdue = periods.Where(p => p.Left > 0 && p.DueOn < today).ToList();
            var next = now == null ? null : now.Left > 0 ? now : null;
            return new
            {
                id = r.Id, title = r.Title, category = r.Category, amount = r.Amount, every = r.Every, dueDay = r.DueDay, fromMonth = r.FromMonth, toMonth = r.ToMonth,
                projectId = r.ProjectId, projectName, payee = r.Payee, forAgentId = r.ForAgentId, forAgentName = r.ForAgentName, note = r.Note, active = r.Active,
                current = now == null ? null : new { period = now.Month, dueOn = now.DueOn.ToString("yyyy-MM-dd"), due = now.Due, paid = now.Paid, left = now.Left, status = now.Status },
                overdueCount = overdue.Count, overdueSum = overdue.Sum(p => p.Left),
                nextDue = next?.DueOn.ToString("yyyy-MM-dd"),
                paidAllTime = periods.Sum(p => p.Paid),
                periods = periods.Take(24).Select(p => new { period = p.Month, dueOn = p.DueOn.ToString("yyyy-MM-dd"), due = p.Due, paid = p.Paid, left = p.Left, status = p.Status }),
            };
        }

        /// <summary>Every constant payment: this period's due and paid, what is overdue, and its history.</summary>
        [HttpGet("constant")]
        public async Task<IActionResult> Constant(CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var list = await _db.SpendRecurrings.AsNoTracking().OrderByDescending(r => r.Active).ThenBy(r => r.Title).ToListAsync(ct);
            var ids = list.Select(r => (Guid?)r.Id).ToList();
            var pays = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.RecurringId != null && ids.Contains(e.RecurringId)).ToListAsync(ct);
            var projects = (await _db.SpendProjects.AsNoTracking().Select(p => new { p.Id, p.Name }).ToListAsync(ct)).ToDictionary(p => p.Id, p => p.Name);
            string? ProjectName(Guid? id) => id != null && projects.TryGetValue(id.Value, out var n) ? n : null;
            var rows = list.Select(r => RecurringShape(r, Spend.Periods(r, pays.Where(p => p.RecurringId == r.Id), today), today, ProjectName(r.ProjectId))).ToList();
            return Ok(new { today = today.ToString("yyyy-MM-dd"), rows, payments = pays.OrderByDescending(e => e.SpentOn).Take(300).Select(SpendFiles.Shape) });
        }

        private async Task<string?> ApplyRecurringAsync(SpendRecurring r, SpendRecurringDto d, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var err = Spend.RecurringProblem(d.Title ?? r.Title, d.Amount ?? r.Amount, d.Every ?? r.Every, d.DueDay ?? r.DueDay, d.FromMonth ?? r.FromMonth, today);
            if (err != null) return err;
            var kinds = await KindsAsync(ct);
            r.Title = (d.Title ?? r.Title).Trim();
            if (d.Category != null) r.Category = Spend.KindOf(d.Category, kinds);
            r.Amount = d.Amount ?? r.Amount;
            r.Every = d.Every ?? r.Every;
            r.DueDay = d.DueDay ?? r.DueDay;
            r.FromMonth = Spend.MonthOf(d.FromMonth ?? r.FromMonth)!;
            if (d.ProjectId != null)
            {
                if (d.ProjectId == Guid.Empty) r.ProjectId = null;
                else if (!await _db.SpendProjects.AnyAsync(p => p.Id == d.ProjectId, ct)) return "That project isn't here any more.";
                else r.ProjectId = d.ProjectId;
            }
            if (d.Payee != null) r.Payee = Hoardings.Clean(d.Payee, 120);
            if (d.Note != null) r.Note = Hoardings.Clean(d.Note, 300);
            if (d.ForAgentId != null)
            {
                if (d.ForAgentId == "") { r.ForAgentId = null; r.ForAgentName = null; }
                else
                {
                    var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == d.ForAgentId).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                    if (a == null) return "Pick the person it is for.";
                    r.ForAgentId = a.AgentId; r.ForAgentName = a.Name;
                }
            }
            r.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        [HttpPost("constant")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> AddConstant([FromBody] SpendRecurringDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var r = new SpendRecurring { CreatedBy = User.AgentIdOf(), Category = d.Category ?? "rent", Every = d.Every ?? "month", DueDay = d.DueDay ?? 1, FromMonth = d.FromMonth ?? "" };
            var err = await ApplyRecurringAsync(r, d, ct);
            if (err != null) return BadRequest(new { message = err });
            if (d.Category == null) r.Category = "rent";
            _db.SpendRecurrings.Add(r);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = r.Id });
        }

        [HttpPut("constant/{id:guid}")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> EditConstant(Guid id, [FromBody] SpendRecurringDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var r = await _db.SpendRecurrings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "That constant payment isn't here any more." });
            var err = await ApplyRecurringAsync(r, d, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Stop a constant payment after a last month (its payments are kept), or start it again.</summary>
        [HttpPost("constant/{id:guid}/stop")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> StopConstant(Guid id, [FromBody] TeamOffDto d, [FromQuery] bool undo = false, CancellationToken ct = default)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var r = await _db.SpendRecurrings.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "That constant payment isn't here any more." });
            if (undo) { r.Active = true; r.ToMonth = null; }
            else
            {
                var last = Spend.MonthOf(d.LastMonth) ?? Spend.Month(AttendanceService.TodayIst);
                if (string.CompareOrdinal(last, r.FromMonth) < 0) last = r.FromMonth;
                r.Active = false; r.ToMonth = last;
            }
            r.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Record a payment for one period of a constant payment: all of it or a part. It counts in the daily spend under its kind.</summary>
        [HttpPost("constant/{id:guid}/pay")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> PayConstant(Guid id, [FromBody] SpendRecurringPayDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var today = AttendanceService.TodayIst;
            var r = await _db.SpendRecurrings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "That constant payment isn't here any more." });
            var err = Spend.Problem(d.Amount, d.On, today, Spend.OfficeDaysBack);
            if (err != null) return BadRequest(new { message = err });
            var period = Spend.PeriodFor(r, Spend.MonthOf(d.Period) ?? "");
            if (period == null) return BadRequest(new { message = "Pick a period while it was running." });
            var me = User.AgentIdOf();
            var e = new MarketingExpense
            {
                SpentOn = d.On!.Value, Category = r.Category, Amount = d.Amount!.Value, PaidBy = "office", ProjectId = r.ProjectId, RecurringId = r.Id, Period = period,
                Note = Hoardings.Clean(d.Note, 500) ?? r.Title, PayMode = Spend.ModeOf(d.Mode), ForAgentId = r.ForAgentId, ForAgentName = r.ForAgentName,
                Status = "approved", CreatedBy = me, CreatedByName = await MyNameAsync(ct), DecidedBy = me, DecidedAt = DateTime.UtcNow,
            };
            if (d.PaidBy == "person")
            {
                var who = Hoardings.Clean(d.AgentId, 40) ?? me;
                var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                if (a == null) return BadRequest(new { message = "Pick the person who paid." });
                e.PaidBy = "person"; e.AgentId = a.AgentId; e.AgentName = a.Name;
                e.ForAgentId ??= a.AgentId; e.ForAgentName ??= a.Name;
            }
            _db.MarketingExpenses.Add(e);
            await _db.SaveChangesAsync(ct);
            return Ok(SpendFiles.Shape(e));
        }

        // ── Money managers ──────────────────────────────────────────────────────

        /// <summary>The money managers, with what each holds: received, handed out to the team, spent, and left in hand.</summary>
        [HttpGet("managers")]
        public async Task<IActionResult> Managers(CancellationToken ct)
        {
            var list = await _db.SpendManagers.AsNoTracking().OrderByDescending(m => m.Active).ThenBy(m => m.Name).ToListAsync(ct);
            var ids = list.Select(m => m.AgentId).ToList();
            var moves = await _db.MarketingMoneyMoves.AsNoTracking().Where(m => !m.Removed && (ids.Contains(m.AgentId) || (m.FromAgentId != null && ids.Contains(m.FromAgentId)))).ToListAsync(ct);
            var expenses = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId != null && ids.Contains(e.AgentId)).ToListAsync(ct);
            var funds = await _db.SpendFunds.AsNoTracking().Where(f => !f.Removed && f.ReceivedBy != null && ids.Contains(f.ReceivedBy)).ToListAsync(ct);
            return Ok(list.Select(m => new { agentId = m.AgentId, name = m.Name, active = m.Active, note = m.Note, addedAt = m.AddedAt, balance = SpendFiles.Shape(Spend.BalanceOf(m.AgentId, moves, expenses, funds)) }));
        }

        /// <summary>Make a person a money manager. Needs edit rights on Payments (a manager can't make another).</summary>
        [HttpPost("managers")]
        public async Task<IActionResult> AddManager([FromBody] SpendManagerDto d, CancellationToken ct)
        {
            var who = Hoardings.Clean(d.AgentId, 40);
            var a = who == null ? null : await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
            if (a == null) return BadRequest(new { message = "Pick the person." });
            var m = await _db.SpendManagers.FirstOrDefaultAsync(x => x.AgentId == a.AgentId, ct);
            if (m == null) { m = new SpendManager { AgentId = a.AgentId, AddedBy = User.AgentIdOf() }; _db.SpendManagers.Add(m); }
            m.Name = a.Name; m.Active = true; m.Note = Hoardings.Clean(d.Note, 200) ?? m.Note; m.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = new() { a.AgentId }, Except = User.AgentIdOf(), Kind = "note", Link = "spend",
                Title = "You are now a money manager for marketing",
                Body = "You can record funds received, give money to the team, approve expenses and pay constant costs in Marketing spend.",
            });
            return Ok(new { ok = true });
        }

        [HttpPost("managers/{agentId}/remove")]
        public async Task<IActionResult> RemoveManager(string agentId, CancellationToken ct)
        {
            var m = await _db.SpendManagers.FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            if (m == null) return NotFound(new { message = "That person isn't a money manager." });
            m.Active = false; m.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }
}
