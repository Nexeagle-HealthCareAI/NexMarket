using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ExpenseDto
    {
        public string? ClientId { get; set; }
        public DateOnly? SpentOn { get; set; }
        public string? Category { get; set; }
        public decimal? Amount { get; set; }
        public string? Note { get; set; }
        /// <summary>office | person (CRM only; from the phone it is always the agent themselves).</summary>
        public string? PaidBy { get; set; }
        public string? AgentId { get; set; }
        /// <summary>The person it was spent on, when the organisation paid directly (CRM only).</summary>
        public string? ForAgentId { get; set; }
    }

    public class TeamMemberDto
    {
        public string? AgentId { get; set; }
        public decimal? Salary { get; set; }
        /// <summary>"yyyy-MM": the month this salary starts from.</summary>
        public string? FromMonth { get; set; }
        public string? Note { get; set; }
    }

    public class TeamOffDto { public string? LastMonth { get; set; } }

    public class SalaryPayDto
    {
        public string? AgentId { get; set; }
        public string? Month { get; set; }
        public decimal? Amount { get; set; }
        public DateOnly? On { get; set; }
        public string? Mode { get; set; }
        public string? Note { get; set; }
    }

    public class ExpenseDecideDto { public bool Approve { get; set; } public string? Reason { get; set; } }

    public class MoneyMoveDto
    {
        public string? AgentId { get; set; }
        /// <summary>given | returned</summary>
        public string? Kind { get; set; }
        public decimal? Amount { get; set; }
        public DateOnly? On { get; set; }
        public string? Mode { get; set; }
        public string? Note { get; set; }
    }

    internal static class SpendFiles
    {
        public static async Task<string?> SaveBillAsync(IFileStore files, MarketingExpense e, IFormFile? file, CancellationToken ct)
        {
            if (file == null || file.Length == 0) return "No photo.";
            if (file.Length > 10 * 1024 * 1024) return "The photo can be up to 10 MB.";
            var mime = HoardingFiles.Images.ContainsKey(file.ContentType ?? "") ? file.ContentType! : "image/jpeg";
            await using var stream = file.OpenReadStream();
            e.BillKey = await files.SaveAsync("spend", $"bill-{e.Id:N}-{Guid.NewGuid():N}{HoardingFiles.Images[mime]}", stream, mime, ct);
            e.BillMime = mime;
            e.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        public static async Task<IActionResult> ServeBillAsync(ControllerBase c, IFileStore files, MarketingExpense e, CancellationToken ct)
        {
            if (e.BillKey == null) return c.NotFound();
            var f = await files.OpenAsync(e.BillKey, ct);
            if (f == null) return c.NotFound(new { message = "The photo is no longer in storage." });
            c.Response.Headers["X-Content-Type-Options"] = "nosniff";
            c.Response.Headers["Cache-Control"] = "private, max-age=86400";
            c.Response.Headers["Content-Disposition"] = $"inline; filename=\"bill-{e.Id:N}\"";
            return c.File(f.Value.Content, e.BillMime ?? f.Value.ContentType);
        }

        public static object Shape(MarketingExpense e) => new
        {
            id = e.Id,
            spentOn = e.SpentOn.ToString("yyyy-MM-dd"),
            category = e.Category,
            amount = e.Amount,
            note = e.Note,
            paidBy = e.PaidBy,
            agentId = e.AgentId,
            agentName = e.AgentName,
            forAgentId = Spend.ForOf(e),
            forAgentName = e.ForAgentName ?? (e.PaidBy == "person" ? e.AgentName : null),
            salaryMonth = e.SalaryMonth,
            payMode = e.PayMode,
            status = e.Status,
            rejectReason = e.RejectReason,
            hasBill = e.BillKey != null,
            fromApp = e.PaidBy == "person" && e.CreatedBy == e.AgentId,
            createdByName = e.CreatedByName,
            createdAt = e.CreatedAt,
        };

        public static object Shape(MarketingMoneyMove m) => new
        {
            id = m.Id, agentId = m.AgentId, agentName = m.AgentName, kind = m.Kind, amount = m.Amount,
            on = m.On.ToString("yyyy-MM-dd"), mode = m.Mode, note = m.Note, createdByName = m.CreatedByName, createdAt = m.CreatedAt,
        };

        public static object Shape(Spend.Balance b) => new { given = b.Given, returned = b.Returned, spent = b.Spent, pending = b.Pending, net = b.Net, holds = b.Holds, owed = b.Owed };
    }

    /// <summary>
    /// The CRM's Marketing spend page: what was spent each day and on what, expenses agents sent for approval, and each
    /// person's balance (money given, returned and spent). Viewing needs the Payments page; changing anything needs "Can edit".
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Payments)]
    [Route("api/v1/spend")]
    public class SpendController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public SpendController(IMarketingDbContext db, IFileStore files, INotifier notifier) { _db = db; _files = files; _notifier = notifier; }

        private async Task<string> MyNameAsync(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            return await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
        }

        /// <summary>Everything the page shows for a range of days (31 days by default, a year at most).</summary>
        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var end = Hoardings.Date(to) ?? today;
            var start = Hoardings.Date(from) ?? end.AddDays(-30);
            if (start > end) (start, end) = (end, start);
            if (end.DayNumber - start.DayNumber > 366) start = end.AddDays(-366);

            var inRange = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.SpentOn >= start && e.SpentOn <= end)
                .OrderByDescending(e => e.SpentOn).ThenByDescending(e => e.CreatedAt).Take(5000).ToListAsync(ct);
            // Waiting entries are shown whatever their day, so none is missed because of the dates picked.
            var waiting = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.Status == "pending")
                .OrderBy(e => e.CreatedAt).Take(500).ToListAsync(ct);

            // Balances are over all time, not the range.
            var allPerson = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId != null && e.Status != "rejected").ToListAsync(ct);
            var moves = await _db.MarketingMoneyMoves.AsNoTracking().Where(m => !m.Removed).ToListAsync(ct);
            var staff = await _db.Agents.AsNoTracking().Where(a => a.IsActive).OrderBy(a => a.Name)
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, block = a.Block }).ToListAsync(ct);
            var names = staff.ToDictionary(s => s.agentId, s => s);
            var ids = moves.Select(m => m.AgentId).Concat(allPerson.Select(e => e.AgentId!)).Distinct().ToList();
            var people = ids.Select(id =>
            {
                var b = Spend.BalanceOf(id, moves, allPerson);
                var s = names.GetValueOrDefault(id);
                return new
                {
                    agentId = id,
                    name = s?.name ?? moves.FirstOrDefault(m => m.AgentId == id)?.AgentName ?? id,
                    role = s?.role,
                    balance = SpendFiles.Shape(b),
                    net = b.Net,
                };
            }).OrderBy(p => p.net).ThenBy(p => p.name).ToList();

            var days = Spend.Days(inRange);
            var nameOf = new Func<string, string>(id => names.GetValueOrDefault(id)?.name ?? inRange.FirstOrDefault(e => Spend.ForOf(e) == id)?.ForAgentName ?? inRange.FirstOrDefault(e => e.AgentId == id)?.AgentName ?? id);
            return Ok(new
            {
                from = start.ToString("yyyy-MM-dd"),
                to = end.ToString("yyyy-MM-dd"),
                today = today.ToString("yyyy-MM-dd"),
                categories = Spend.Categories.Select(c => new { key = c, label = Spend.Label(c) }),
                modes = Spend.Modes,
                total = days.Sum(d => d.Total),
                byCategory = Spend.ByCategory(inRange),
                days = days.Select(d => new { date = d.Date.ToString("yyyy-MM-dd"), total = d.Total, byCategory = d.ByCategory }),
                byPerson = Spend.ByPerson(inRange).Select(p => new { agentId = p.AgentId, name = nameOf(p.AgentId), total = p.Total, byCategory = p.ByCategory }),
                items = inRange.Where(e => e.Status != "pending").Select(SpendFiles.Shape),
                waiting = waiting.Select(SpendFiles.Shape),
                people = people.Select(p => new { p.agentId, p.name, p.role, p.balance }),
                held = people.Sum(p => Math.Max(0, p.net)),
                owed = people.Sum(p => Math.Max(0, -p.net)),
                staff,
            });
        }

        private async Task<string?> ApplyAsync(MarketingExpense e, ExpenseDto d, CancellationToken ct)
        {
            var err = Spend.Problem(d.Amount, d.SpentOn, AttendanceService.TodayIst, Spend.OfficeDaysBack);
            if (err != null) return err;
            e.Amount = d.Amount!.Value;
            e.SpentOn = d.SpentOn!.Value;
            e.Category = Spend.CategoryOf(d.Category);
            e.Note = Hoardings.Clean(d.Note, 500);
            if (d.PaidBy == "person")
            {
                var who = Hoardings.Clean(d.AgentId, 40);
                var a = who == null ? null : await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                if (a == null) return "Pick the person who paid.";
                e.PaidBy = "person"; e.AgentId = a.AgentId; e.AgentName = a.Name;
                e.ForAgentId = a.AgentId; e.ForAgentName = a.Name;
            }
            else
            {
                e.PaidBy = "office"; e.AgentId = null; e.AgentName = null;
                var forWho = Hoardings.Clean(d.ForAgentId, 40);
                if (forWho == null) { if (e.SalaryMonth == null) { e.ForAgentId = null; e.ForAgentName = null; } }
                else
                {
                    var f = await _db.Agents.AsNoTracking().Where(x => x.AgentId == forWho).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
                    if (f == null) return "Pick the person it was for.";
                    e.ForAgentId = f.AgentId; e.ForAgentName = f.Name;
                }
            }
            // A salary payment stays a salary payment for its person and month.
            if (e.SalaryMonth != null) e.Category = "agents";
            e.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        /// <summary>An expense entered by the office counts straight away.</summary>
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ExpenseDto d, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var e = new MarketingExpense { Status = "approved", CreatedBy = me, CreatedByName = await MyNameAsync(ct), DecidedBy = me, DecidedAt = DateTime.UtcNow };
            var err = await ApplyAsync(e, d, ct);
            if (err != null) return BadRequest(new { message = err });
            _db.MarketingExpenses.Add(e);
            await _db.SaveChangesAsync(ct);
            return Ok(SpendFiles.Shape(e));
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] ExpenseDto d, CancellationToken ct)
        {
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id && !x.Removed, ct);
            if (e == null) return NotFound(new { message = "That entry isn't here any more." });
            // Whose money it was stays as the agent sent it; the office corrects the amount, day, kind and note.
            if (e.PaidBy == "person" && d.PaidBy == null) { d.PaidBy = "person"; d.AgentId = e.AgentId; }
            var err = await ApplyAsync(e, d, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(SpendFiles.Shape(e));
        }

        /// <summary>Approve or reject an expense an agent sent. Approving makes it count; rejecting needs a reason.</summary>
        [HttpPost("{id:guid}/decide")]
        public async Task<IActionResult> Decide(Guid id, [FromBody] ExpenseDecideDto d, CancellationToken ct)
        {
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id && !x.Removed, ct);
            if (e == null) return NotFound(new { message = "That entry isn't here any more." });
            var reason = Hoardings.Clean(d.Reason, 300);
            if (!d.Approve && reason == null) return BadRequest(new { message = "Say why, so the person knows." });
            e.Status = d.Approve ? "approved" : "rejected";
            e.RejectReason = d.Approve ? null : reason;
            e.DecidedBy = User.AgentIdOf();
            e.DecidedAt = e.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            if (e.AgentId != null)
                _notifier.Notify(new NotifyJob
                {
                    To = new() { e.AgentId }, Except = User.AgentIdOf(), Kind = "note",
                    Title = d.Approve ? $"Expense approved: {Spend.Rupees(e.Amount)} · {Spend.Label(e.Category)}" : $"Expense not approved: {Spend.Rupees(e.Amount)} · {Spend.Label(e.Category)}",
                    Body = d.Approve ? "It now counts in your balance." : reason!,
                    Link = "spend", RefId = e.Id.ToString(),
                });
            return Ok(SpendFiles.Shape(e));
        }

        /// <summary>Takes an entry out of the totals. It is kept, not deleted.</summary>
        [HttpPost("{id:guid}/remove")]
        public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
        {
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (e == null) return NotFound(new { message = "That entry isn't here any more." });
            e.Removed = true; e.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("{id:guid}/bill")]
        [RequestSizeLimit(12_000_000)]
        public async Task<IActionResult> AddBill(Guid id, IFormFile? file, CancellationToken ct)
        {
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id && !x.Removed, ct);
            if (e == null) return NotFound(new { message = "That entry isn't here any more." });
            var err = await SpendFiles.SaveBillAsync(_files, e, file, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(SpendFiles.Shape(e));
        }

        [HttpGet("{id:guid}/bill")]
        public async Task<IActionResult> Bill(Guid id, CancellationToken ct)
        {
            var e = await _db.MarketingExpenses.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            return e == null ? NotFound() : await SpendFiles.ServeBillAsync(this, _files, e, ct);
        }

        /// <summary>One person's account: every amount given or returned and every expense of theirs, newest first.</summary>
        [HttpGet("people/{agentId}")]
        public async Task<IActionResult> Person(string agentId, CancellationToken ct)
        {
            var moves = await _db.MarketingMoneyMoves.AsNoTracking().Where(m => !m.Removed && m.AgentId == agentId).OrderByDescending(m => m.On).ThenByDescending(m => m.CreatedAt).Take(1000).ToListAsync(ct);
            var expenses = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId == agentId).OrderByDescending(e => e.SpentOn).ThenByDescending(e => e.CreatedAt).Take(2000).ToListAsync(ct);
            var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == agentId).Select(x => new { x.Name, x.Role }).FirstOrDefaultAsync(ct);
            var b = Spend.BalanceOf(agentId, moves, expenses);
            var settle = Spend.Settling(b);
            return Ok(new
            {
                agentId, name = a?.Name ?? agentId, role = a?.Role,
                balance = SpendFiles.Shape(b),
                settle = settle == null ? null : new { kind = settle.Value.Kind, amount = settle.Value.Amount },
                moves = moves.Select(SpendFiles.Shape),
                expenses = expenses.Select(SpendFiles.Shape),
            });
        }

        // ── Team and salaries ───────────────────────────────────────────────────

        /// <summary>The marketing team for a month: each person's salary, what is paid and left, and what else was spent on them.</summary>
        [HttpGet("team")]
        public async Task<IActionResult> Team([FromQuery] string? month, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var m = Spend.MonthOf(month) ?? Spend.Month(today);
            var start = Spend.MonthStart(m)!.Value; var end = start.AddMonths(1).AddDays(-1);
            var staff = await _db.MarketingStaff.AsNoTracking().ToListAsync(ct);
            var rates = await _db.MarketingSalaryRates.AsNoTracking().ToListAsync(ct);
            var salary = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.Category == "agents" && e.SalaryMonth != null).ToListAsync(ct);
            var inMonth = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.Status == "approved" && e.SpentOn >= start && e.SpentOn <= end && e.SalaryMonth == null).ToListAsync(ct);
            var costs = Spend.ByPerson(inMonth).ToDictionary(p => p.AgentId);
            var agents = await _db.Agents.AsNoTracking().OrderBy(a => a.Name).Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, block = a.Block, active = a.IsActive }).ToListAsync(ct);
            var byId = agents.ToDictionary(a => a.agentId);
            var rows = staff.Select(s =>
            {
                var due = s.OnPayroll || s.ToMonth != null ? Spend.Due(s, rates, m) : 0;
                var paid = Spend.PaidFor(s.AgentId, m, salary);
                var owedBefore = Spend.Months(s, rates, salary, today).Where(x => string.CompareOrdinal(x.Month, m) < 0).Sum(x => x.Left);
                var c = costs.GetValueOrDefault(s.AgentId);
                return new
                {
                    agentId = s.AgentId, name = byId.GetValueOrDefault(s.AgentId)?.name ?? s.Name, role = byId.GetValueOrDefault(s.AgentId)?.role,
                    onPayroll = s.OnPayroll, fromMonth = s.FromMonth, toMonth = s.ToMonth, note = s.Note,
                    salary = Spend.Due(s, rates, m), due, paid, left = Math.Max(0, due - paid), status = Spend.PayStatus(due, paid), owedBefore,
                    otherCosts = c?.Total ?? 0, costs = c?.ByCategory ?? new Dictionary<string, decimal>(),
                };
            }).Where(r => r.onPayroll || r.due > 0 || r.paid > 0 || r.owedBefore > 0).OrderByDescending(r => r.onPayroll).ThenBy(r => r.name).ToList();
            var on = staff.Where(s => s.OnPayroll).Select(s => s.AgentId).ToHashSet();
            return Ok(new
            {
                month = m, thisMonth = Spend.Month(today), today = today.ToString("yyyy-MM-dd"),
                rows,
                due = rows.Sum(r => r.due), paid = rows.Sum(r => r.paid), left = rows.Sum(r => r.left), owedBefore = rows.Sum(r => r.owedBefore),
                candidates = agents.Where(a => a.active && !on.Contains(a.agentId)),
            });
        }

        /// <summary>Put a person on the marketing payroll, or change their salary from a month onwards.</summary>
        [HttpPost("team")]
        public async Task<IActionResult> SaveMember([FromBody] TeamMemberDto d, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var err = Spend.SalaryProblem(d.Salary, d.FromMonth, today);
            if (err != null) return BadRequest(new { message = err });
            var who = Hoardings.Clean(d.AgentId, 40);
            var a = who == null ? null : await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
            if (a == null) return BadRequest(new { message = "Pick the person." });
            var from = Spend.MonthOf(d.FromMonth)!;
            var me = User.AgentIdOf();
            var s = await _db.MarketingStaff.FirstOrDefaultAsync(x => x.AgentId == a.AgentId, ct);
            if (s == null) { s = new MarketingStaff { AgentId = a.AgentId, FromMonth = from, CreatedBy = me }; _db.MarketingStaff.Add(s); }
            else if (!s.OnPayroll) { s.OnPayroll = true; s.ToMonth = null; if (string.CompareOrdinal(from, s.FromMonth) < 0) s.FromMonth = from; }
            else if (string.CompareOrdinal(from, s.FromMonth) < 0) s.FromMonth = from;
            s.Name = a.Name; s.Note = Hoardings.Clean(d.Note, 300) ?? s.Note; s.UpdatedAt = DateTime.UtcNow;
            // One rate per starting month: saving again for the same month corrects it.
            var rate = await _db.MarketingSalaryRates.FirstOrDefaultAsync(r => r.AgentId == a.AgentId && r.FromMonth == from, ct);
            if (rate == null) _db.MarketingSalaryRates.Add(new MarketingSalaryRate { AgentId = a.AgentId, Amount = d.Salary!.Value, FromMonth = from, CreatedBy = me });
            else { rate.Amount = d.Salary!.Value; rate.CreatedBy = me; rate.CreatedAt = DateTime.UtcNow; }
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Take a person off the payroll after a last month. Their record and payments are kept.</summary>
        [HttpPost("team/{agentId}/off")]
        public async Task<IActionResult> MemberOff(string agentId, [FromBody] TeamOffDto d, CancellationToken ct)
        {
            var s = await _db.MarketingStaff.FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            if (s == null) return NotFound(new { message = "That person isn't on the team." });
            var last = Spend.MonthOf(d.LastMonth) ?? Spend.Month(AttendanceService.TodayIst);
            if (string.CompareOrdinal(last, s.FromMonth) < 0) last = s.FromMonth;
            s.OnPayroll = false; s.ToMonth = last; s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>One team member in full: salary over time, every month's due and paid, every payment, and what else was spent on them.</summary>
        [HttpGet("team/{agentId}")]
        public async Task<IActionResult> Member(string agentId, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var s = await _db.MarketingStaff.AsNoTracking().FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            var a = await _db.Agents.AsNoTracking().Where(x => x.AgentId == agentId).Select(x => new { x.Name, x.Role, x.Block }).FirstOrDefaultAsync(ct);
            if (s == null && a == null) return NotFound(new { message = "That person isn't here." });
            var rates = await _db.MarketingSalaryRates.AsNoTracking().Where(r => r.AgentId == agentId).OrderByDescending(r => r.FromMonth).ToListAsync(ct);
            var mine = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && (e.ForAgentId == agentId || (e.ForAgentId == null && e.PaidBy == "person" && e.AgentId == agentId)))
                .OrderByDescending(e => e.SpentOn).ThenByDescending(e => e.CreatedAt).Take(3000).ToListAsync(ct);
            var pays = mine.Where(Spend.IsSalary).ToList();
            var other = mine.Where(e => e.SalaryMonth == null).ToList();
            var months = s == null ? new List<Spend.MonthPay>() : Spend.Months(s, rates, pays, today);
            return Ok(new
            {
                agentId, name = a?.Name ?? s?.Name ?? agentId, role = a?.Role, block = a?.Block,
                onTeam = s != null, onPayroll = s?.OnPayroll ?? false, fromMonth = s?.FromMonth, toMonth = s?.ToMonth, note = s?.Note,
                salary = s == null ? 0 : Spend.Due(s, rates, Spend.Month(today)),
                rates = rates.Select(r => new { amount = r.Amount, fromMonth = r.FromMonth }),
                months = months.Select(x => new { month = x.Month, due = x.Due, paid = x.Paid, left = x.Left, status = x.Status }),
                totalDue = months.Sum(x => x.Due), totalPaid = pays.Sum(e => e.Amount), totalLeft = months.Sum(x => x.Left),
                payments = pays.Select(SpendFiles.Shape),
                otherTotal = other.Where(Spend.Counts).Sum(e => e.Amount),
                otherByCategory = Spend.ByCategory(other),
                other = other.Take(300).Select(SpendFiles.Shape),
                categories = Spend.Categories.Select(c => new { key = c, label = Spend.Label(c) }),
            });
        }

        /// <summary>A salary payment for a person and a month: all of it or a part. It counts in the daily spend under Salaries.</summary>
        [HttpPost("salary")]
        public async Task<IActionResult> PaySalary([FromBody] SalaryPayDto d, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var err = Spend.Problem(d.Amount, d.On, today, Spend.OfficeDaysBack);
            if (err != null) return BadRequest(new { message = err });
            var month = Spend.MonthOf(d.Month);
            if (month == null) return BadRequest(new { message = "Pick the month it is for." });
            var who = Hoardings.Clean(d.AgentId, 40);
            var s = who == null ? null : await _db.MarketingStaff.AsNoTracking().FirstOrDefaultAsync(x => x.AgentId == who, ct);
            if (s == null) return BadRequest(new { message = "Add the person to the marketing team first, with their salary." });
            var me = User.AgentIdOf();
            var e = new MarketingExpense
            {
                SpentOn = d.On!.Value, Category = "agents", Amount = d.Amount!.Value, Note = Hoardings.Clean(d.Note, 500), PaidBy = "office",
                ForAgentId = s.AgentId, ForAgentName = s.Name, SalaryMonth = month, PayMode = Spend.ModeOf(d.Mode),
                Status = "approved", CreatedBy = me, CreatedByName = await MyNameAsync(ct), DecidedBy = me, DecidedAt = DateTime.UtcNow,
            };
            _db.MarketingExpenses.Add(e);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = new() { s.AgentId }, Except = me, Kind = "note",
                Title = $"Salary paid: {Spend.Rupees(e.Amount)} for {Spend.MonthStart(month)!.Value.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture)}",
                Body = e.Note ?? (e.PayMode == null ? "Recorded by the office." : $"By {e.PayMode}."),
                Link = "spend", RefId = e.Id.ToString(),
            });
            return Ok(SpendFiles.Shape(e));
        }

        /// <summary>Money given to a person (an advance, or paying back what they spent) or returned by them.</summary>
        [HttpPost("moves")]
        public async Task<IActionResult> AddMove([FromBody] MoneyMoveDto d, CancellationToken ct)
        {
            var err = Spend.Problem(d.Amount, d.On, AttendanceService.TodayIst, Spend.OfficeDaysBack);
            if (err != null) return BadRequest(new { message = err });
            var who = Hoardings.Clean(d.AgentId, 40);
            var a = who == null ? null : await _db.Agents.AsNoTracking().Where(x => x.AgentId == who).Select(x => new { x.AgentId, x.Name }).FirstOrDefaultAsync(ct);
            if (a == null) return BadRequest(new { message = "Pick the person." });
            var me = User.AgentIdOf();
            var m = new MarketingMoneyMove
            {
                AgentId = a.AgentId, AgentName = a.Name, Kind = d.Kind == "returned" ? "returned" : "given", Amount = d.Amount!.Value, On = d.On!.Value,
                Mode = Spend.ModeOf(d.Mode), Note = Hoardings.Clean(d.Note, 300), CreatedBy = me, CreatedByName = await MyNameAsync(ct),
            };
            _db.MarketingMoneyMoves.Add(m);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                To = new() { a.AgentId }, Except = me, Kind = "note",
                Title = m.Kind == "given" ? $"{Spend.Rupees(m.Amount)} given to you for marketing work" : $"{Spend.Rupees(m.Amount)} returned by you was recorded",
                Body = m.Note ?? "See your balance in the app under Money.",
                Link = "spend", RefId = m.Id.ToString(),
            });
            return Ok(SpendFiles.Shape(m));
        }

        /// <summary>Takes a wrong entry out of the balance. It is kept, not deleted.</summary>
        [HttpPost("moves/{id:guid}/remove")]
        public async Task<IActionResult> RemoveMove(Guid id, CancellationToken ct)
        {
            var m = await _db.MarketingMoneyMoves.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (m == null) return NotFound(new { message = "That entry isn't here any more." });
            m.Removed = true;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }

    /// <summary>
    /// The agent app's side: add my own expense with a photo of the bill, and see my balance. An agent sees only their own
    /// entries. What they add waits for the office to approve it.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/spend")]
    public class MySpendController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IFileStore _files;
        private readonly INotifier _notifier;
        public MySpendController(IMarketingDbContext db, IFileStore files, INotifier notifier) { _db = db; _files = files; _notifier = notifier; }

        [HttpGet]
        public async Task<IActionResult> Mine(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var expenses = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.PaidBy == "person" && e.AgentId == me).OrderByDescending(e => e.SpentOn).ThenByDescending(e => e.CreatedAt).Take(2000).ToListAsync(ct);
            var moves = await _db.MarketingMoneyMoves.AsNoTracking().Where(m => !m.Removed && m.AgentId == me).OrderByDescending(m => m.On).ThenByDescending(m => m.CreatedAt).Take(1000).ToListAsync(ct);
            return Ok(new
            {
                today = AttendanceService.TodayIst.ToString("yyyy-MM-dd"),
                daysBack = Spend.AgentDaysBack,
                categories = Spend.AgentCategories.Select(c => new { key = c, label = Spend.Label(c) }),
                balance = SpendFiles.Shape(Spend.BalanceOf(me, moves, expenses)),
                items = expenses.Take(200).Select(SpendFiles.Shape),
                moves = moves.Take(100).Select(SpendFiles.Shape),
            });
        }

        /// <summary>Add my expense. The phone's own id makes sending it twice harmless.</summary>
        [HttpPost]
        public async Task<IActionResult> Add([FromBody] ExpenseDto d, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var cid = Hoardings.Clean(d.ClientId, 64);
            if (cid != null)
            {
                var had = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.ClientId == cid, ct);
                if (had != null) return had.AgentId == me ? Ok(SpendFiles.Shape(had)) : Conflict(new { message = "That entry was already sent." });
            }
            var err = Spend.Problem(d.Amount, d.SpentOn, AttendanceService.TodayIst, Spend.AgentDaysBack);
            if (err != null) return BadRequest(new { message = err });
            var cat = Spend.CategoryOf(d.Category);
            if (!Spend.AgentCategories.Contains(cat)) cat = "other";
            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
            var e = new MarketingExpense
            {
                SpentOn = d.SpentOn!.Value, Category = cat, Amount = d.Amount!.Value, Note = Hoardings.Clean(d.Note, 500),
                PaidBy = "person", AgentId = me, AgentName = name, ForAgentId = me, ForAgentName = name, Status = "pending", CreatedBy = me, CreatedByName = name,
            };
            if (cid != null) e.ClientId = cid;
            _db.MarketingExpenses.Add(e);
            await _db.SaveChangesAsync(ct);
            _notifier.Notify(new NotifyJob
            {
                ToOffice = true, Except = me, Kind = "note",
                Title = $"Expense from {name}: {Spend.Rupees(e.Amount)} · {Spend.Label(e.Category)}",
                Body = e.Note ?? "Approve it, or say why not.",
                Link = "spend", RefId = e.Id.ToString(),
            });
            return Ok(SpendFiles.Shape(e));
        }

        [HttpPost("{id:guid}/bill")]
        [RequestSizeLimit(12_000_000)]
        public async Task<IActionResult> AddBill(Guid id, IFormFile? file, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id && x.AgentId == me && !x.Removed, ct);
            if (e == null) return NotFound(new { message = "That entry isn't yours." });
            if (e.Status != "pending") return BadRequest(new { message = "The office has already decided on this one." });
            var err = await SpendFiles.SaveBillAsync(_files, e, file, ct);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(SpendFiles.Shape(e));
        }

        [HttpGet("{id:guid}/bill")]
        public async Task<IActionResult> Bill(Guid id, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var e = await _db.MarketingExpenses.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.AgentId == me, ct);
            return e == null ? NotFound() : await SpendFiles.ServeBillAsync(this, _files, e, ct);
        }

        /// <summary>Take back an entry I sent by mistake, while the office hasn't decided on it.</summary>
        [HttpPost("{id:guid}/remove")]
        public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            var e = await _db.MarketingExpenses.FirstOrDefaultAsync(x => x.Id == id && x.AgentId == me && !x.Removed, ct);
            if (e == null) return NotFound(new { message = "That entry isn't yours." });
            if (e.Status != "pending") return BadRequest(new { message = "The office has already decided on this one." });
            e.Removed = true; e.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }
    }
}
