using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
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
    public class TeamTermsDto
    {
        public DateOnly? JoinedOn { get; set; }
        public DateOnly? LeftOn { get; set; }
        /// <summary>fixed | attendance</summary>
        public string? PayBasis { get; set; }
        /// <summary>"yyyy-MM": the first month paid by attendance.</summary>
        public string? AttendanceFrom { get; set; }
        public string? Note { get; set; }
    }

    public class SalaryIncentiveDto
    {
        public string? AgentId { get; set; }
        public string? Month { get; set; }
        public decimal? Amount { get; set; }
        public string? Kind { get; set; }
        public string? Title { get; set; }
        public string? Basis { get; set; }
        public string? Details { get; set; }
    }

    public class PayrollApproveDto
    {
        public List<string> AgentIds { get; set; } = new();
        public string? Month { get; set; }
        public string? Note { get; set; }
    }

    public class PullReferralsDto
    {
        public string? AgentId { get; set; }
        public string? Month { get; set; }
    }

    public class PayrollReopenDto
    {
        public string? AgentId { get; set; }
        public string? Month { get; set; }
    }

    /// <summary>
    /// Salaries worked out from the date of joining and, for people paid by attendance, the days they worked; incentives
    /// with what they are for; and each month checked and approved before the salary is released.
    /// </summary>
    public partial class SpendController
    {
        /// <summary>
        /// What each person is due for each month: an approved month as approved; otherwise worked out now from their
        /// salary, joining and leaving days, attendance (for those paid by it, up to 13 months back) and incentives.
        /// </summary>
        private async Task<Func<MarketingStaff, string, Payroll.Calc>> PayCalcAsync(List<MarketingStaff> staff, List<MarketingSalaryRate> rates, ICollection<string> months, CancellationToken ct)
        {
            var ids = staff.Select(s => s.AgentId).ToList();
            var monthList = months.Distinct().ToList();
            var slips = (await _db.SalarySlips.AsNoTracking().Where(x => ids.Contains(x.AgentId) && monthList.Contains(x.Month)).ToListAsync(ct))
                .GroupBy(x => (x.AgentId, x.Month)).ToDictionary(g => g.Key, g => g.First());
            var inc = (await _db.SalaryIncentives.AsNoTracking().Where(x => ids.Contains(x.AgentId) && monthList.Contains(x.Month) && !x.Removed)
                    .Select(x => new { x.AgentId, x.Month, x.Amount }).ToListAsync(ct))
                .GroupBy(x => (x.AgentId, x.Month)).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));

            var today = AttendanceService.TodayIst;
            var oldest = Spend.Month(new DateOnly(today.Year, today.Month, 1).AddMonths(-12));
            var thisMonth = Spend.Month(today);
            var need = staff.SelectMany(s => monthList.Where(m => Payroll.ByAttendance(s, m) && !slips.ContainsKey((s.AgentId, m))
                                                                 && string.CompareOrdinal(m, oldest) >= 0 && string.CompareOrdinal(m, thisMonth) <= 0)
                .Select(m => (s.AgentId, m))).ToList();
            var days = new Dictionary<string, List<DayStatus>>();
            if (need.Count > 0)
            {
                var attendance = HttpContext.RequestServices.GetRequiredService<AttendanceService>();
                var first = Spend.MonthStart(need.Min(n => n.m))!.Value;
                var last = Spend.MonthStart(need.Max(n => n.m))!.Value.AddMonths(1).AddDays(-1);
                days = await attendance.RangeAsync(need.Select(n => n.AgentId).Distinct().ToList(), first, last, ct);
            }
            return (s, m) =>
            {
                if (slips.TryGetValue((s.AgentId, m), out var slip)) return Payroll.FromSlip(slip);
                var start = Spend.MonthStart(m)!.Value;
                var end = start.AddMonths(1).AddDays(-1);
                var mine = days.TryGetValue(s.AgentId, out var d) ? d.Where(x => x.Date >= start && x.Date <= end).ToList() : null;
                return Payroll.Compute(s, Spend.Due(s, rates, m), m, mine is { Count: > 0 } ? mine : null, inc.GetValueOrDefault((s.AgentId, m)));
            };
        }

        private static List<string> MonthsOf(MarketingStaff s, DateOnly today)
        {
            var list = new List<string>();
            var first = Spend.MonthStart(s.FromMonth);
            if (first == null) return list;
            var last = new DateOnly(today.Year, today.Month, 1);
            if (Spend.MonthStart(s.ToMonth) is { } end && end < last) last = end;
            for (var m = last; m >= first && list.Count < 60; m = m.AddMonths(-1)) list.Add(Spend.Month(m));
            return list;
        }

        private static object CalcShape(Payroll.Calc c) => new
        {
            basis = c.Basis, rate = c.Rate, monthDays = c.MonthDays, employedDays = c.EmployedDays,
            from = c.From?.ToString("yyyy-MM-dd"), to = c.To?.ToString("yyyy-MM-dd"),
            present = c.Present, paidLeave = c.PaidLeave, off = c.Off, absent = c.Absent, unpaidLeave = c.UnpaidLeave, half = c.Half, notYet = c.NotYet,
            payableDays = c.PayableDays, deductedDays = c.DeductedDays, perDay = Math.Round(c.PerDay, 2), earned = c.Earned, deduction = c.Deduction,
            incentives = c.Incentives, net = c.Net,
        };

        private static object IncentiveShape(SalaryIncentive x) => new
        {
            id = x.Id, agentId = x.AgentId, month = x.Month, amount = x.Amount, kind = x.Kind, title = x.Title, basis = x.Basis, details = x.Details,
            addedByName = x.AddedByName, addedAt = x.AddedAt,
        };

        /// <summary>The payroll for a month: each person's days, what they earned, incentives, approval and payments.</summary>
        [HttpGet("payroll")]
        public async Task<IActionResult> PayrollSheet([FromQuery] string? month, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var thisMonth = Spend.Month(today);
            var m = Spend.MonthOf(month) ?? thisMonth;
            var start = Spend.MonthStart(m)!.Value;
            var staff = await _db.MarketingStaff.AsNoTracking().ToListAsync(ct);
            var rates = await _db.MarketingSalaryRates.AsNoTracking().ToListAsync(ct);
            var salary = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.Category == "agents" && e.SalaryMonth != null).ToListAsync(ct);
            var allMonths = staff.SelectMany(s => MonthsOf(s, today)).Append(m).Distinct().ToList();
            var calc = await PayCalcAsync(staff, rates, allMonths, ct);
            var slips = await _db.SalarySlips.AsNoTracking().Where(x => x.Month == m).ToListAsync(ct);
            var incentives = await _db.SalaryIncentives.AsNoTracking().Where(x => x.Month == m && !x.Removed).OrderBy(x => x.AddedAt).ToListAsync(ct);
            var agents = await _db.Agents.AsNoTracking().OrderBy(a => a.Name)
                .Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, block = a.Block, active = a.IsActive }).ToListAsync(ct);
            var byId = agents.ToDictionary(a => a.agentId);
            var staffIds = staff.Select(x => x.AgentId).ToList();
            // Referral incentives approved in Payments and not paid yet: they can go out with the salary.
            var referral = (await _db.AgentIncentives.AsNoTracking().Where(i => staffIds.Contains(i.AgentId) && i.Status == "approved")
                    .Select(i => new { i.AgentId, i.Amount }).ToListAsync(ct))
                .GroupBy(i => i.AgentId).ToDictionary(g => g.Key, g => (Count: g.Count(), Amount: g.Sum(i => i.Amount)));

            var rows = staff.Select(s =>
            {
                var c = calc(s, m);
                var paid = Spend.PaidFor(s.AgentId, m, salary);
                var slip = slips.FirstOrDefault(x => x.AgentId == s.AgentId);
                var owedBefore = MonthsOf(s, today).Where(x => string.CompareOrdinal(x, m) < 0).Sum(x => Math.Max(0, calc(s, x).Net - Spend.PaidFor(s.AgentId, x, salary)));
                var a = byId.GetValueOrDefault(s.AgentId);
                return new
                {
                    s, c, paid, slip, owedBefore,
                    shape = new
                    {
                        agentId = s.AgentId, name = a?.name ?? s.Name, role = a?.role, block = string.IsNullOrWhiteSpace(a?.block) ? null : a!.block,
                        office = RoleChecks.IsDashboardRole(a?.role),
                        onPayroll = s.OnPayroll, fromMonth = s.FromMonth, toMonth = s.ToMonth, joinedOn = s.JoinedOn?.ToString("yyyy-MM-dd"), leftOn = s.LeftOn?.ToString("yyyy-MM-dd"),
                        payBasis = s.PayBasis, attendanceFrom = s.AttendanceFrom, note = s.Note,
                        calc = CalcShape(c),
                        incentives = incentives.Where(x => x.AgentId == s.AgentId).Select(IncentiveShape),
                        approved = slip == null ? null : new { by = slip.ApprovedByName, at = slip.ApprovedAt, note = slip.Note },
                        paid, left = Math.Max(0, c.Net - paid), status = Spend.PayStatus(c.Net, paid), owedBefore,
                        referralWaiting = referral.TryGetValue(s.AgentId, out var rw) ? new { count = rw.Count, amount = rw.Amount } : null,
                    },
                };
            }).Where(r => r.c.EmployedDays > 0 || r.paid > 0 || r.c.Incentives > 0).OrderBy(r => r.shape.name).ToList();

            var on = staff.Where(s => s.OnPayroll).Select(s => s.AgentId).ToHashSet();
            return Ok(new
            {
                month = m, thisMonth, today = today.ToString("yyyy-MM-dd"),
                monthOver = string.CompareOrdinal(m, thisMonth) < 0,
                monthDays = DateTime.DaysInMonth(start.Year, start.Month),
                canHandle = await CanHandleAsync(ct),
                rows = rows.Select(r => r.shape),
                totals = new
                {
                    people = rows.Count,
                    salaries = rows.Sum(r => r.c.Rate),
                    earned = rows.Sum(r => r.c.Earned),
                    deductions = rows.Sum(r => r.c.Deduction),
                    incentives = rows.Sum(r => r.c.Incentives),
                    net = rows.Sum(r => r.c.Net),
                    paid = rows.Sum(r => r.paid),
                    left = rows.Sum(r => Math.Max(0, r.c.Net - r.paid)),
                    approved = rows.Count(r => r.slip != null),
                    owedBefore = rows.Sum(r => r.owedBefore),
                },
                kinds = Payroll.IncentiveKinds,
                candidates = agents.Where(a => a.active && !on.Contains(a.agentId)),
            });
        }

        /// <summary>Date of joining or leaving, and whether the salary follows attendance.</summary>
        [HttpPut("team/{agentId}/terms")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> SaveTerms(string agentId, [FromBody] TeamTermsDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var s = await _db.MarketingStaff.FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            if (s == null) return NotFound(new { message = "That person isn't on the team." });
            var today = AttendanceService.TodayIst;
            if (d.JoinedOn is { } j && (j < today.AddYears(-30) || j > today.AddMonths(3))) return BadRequest(new { message = "Check the date of joining." });
            if (d.LeftOn is { } l && (l > today.AddMonths(3) || (d.JoinedOn is { } jj && l < jj))) return BadRequest(new { message = "The last working day must be after joining and not too far ahead." });
            var basis = (d.PayBasis ?? s.PayBasis).Trim().ToLowerInvariant();
            if (!Payroll.Bases.Contains(basis)) return BadRequest(new { message = "Choose fixed monthly or by attendance." });
            var attFrom = basis == "attendance" ? (Spend.MonthOf(d.AttendanceFrom) ?? s.AttendanceFrom ?? Spend.Month(today)) : s.AttendanceFrom;

            var wasLeft = s.LeftOn != null;
            s.JoinedOn = d.JoinedOn;
            if (d.JoinedOn is { } jn)
            {
                // The payroll starts in the month of joining; the first salary rate moves with it.
                var fm = Spend.Month(new DateOnly(jn.Year, jn.Month, 1));
                var myRates = await _db.MarketingSalaryRates.Where(r => r.AgentId == agentId).OrderBy(r => r.FromMonth).ToListAsync(ct);
                if (myRates.Count > 0 && string.CompareOrdinal(myRates[0].FromMonth, fm) > 0) myRates[0].FromMonth = fm;
                s.FromMonth = fm;
            }
            s.LeftOn = d.LeftOn;
            if (d.LeftOn is { } lo) { s.OnPayroll = false; s.ToMonth = Spend.Month(new DateOnly(lo.Year, lo.Month, 1)); }
            else if (wasLeft) { s.OnPayroll = true; s.ToMonth = null; }
            s.PayBasis = basis;
            s.AttendanceFrom = attFrom;
            if (d.Note != null) s.Note = Hoardings.Clean(d.Note, 300);
            s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Back on the payroll after a last working day was set by mistake.</summary>
        [HttpPost("team/{agentId}/back")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> MemberBack(string agentId, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var s = await _db.MarketingStaff.FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            if (s == null) return NotFound(new { message = "That person isn't on the team." });
            s.OnPayroll = true; s.ToMonth = null; s.LeftOn = null; s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpPost("incentives")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> AddIncentive([FromBody] SalaryIncentiveDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var today = AttendanceService.TodayIst;
            var kind = (d.Kind ?? "").Trim().ToLowerInvariant();
            var err = Payroll.IncentiveProblem(d.Amount, kind, d.Title, d.Month, today);
            if (err != null) return BadRequest(new { message = err });
            var month = Spend.MonthOf(d.Month)!;
            var who = Hoardings.Clean(d.AgentId, 40);
            var s = who == null ? null : await _db.MarketingStaff.AsNoTracking().FirstOrDefaultAsync(x => x.AgentId == who, ct);
            if (s == null) return BadRequest(new { message = "Add the person to the team first." });
            if (await _db.SalarySlips.AnyAsync(x => x.AgentId == s.AgentId && x.Month == month, ct))
                return Conflict(new { message = $"{Payroll.MonthName(month)} is already approved for {s.Name}. Reopen it to add an incentive." });
            var x = new SalaryIncentive
            {
                AgentId = s.AgentId, Month = month, Amount = d.Amount!.Value, Kind = kind, Title = Hoardings.Clean(d.Title, 120)!,
                Basis = Hoardings.Clean(d.Basis, 200), Details = Hoardings.Clean(d.Details, 600),
                AddedBy = User.AgentIdOf(), AddedByName = await MyNameAsync(ct),
            };
            _db.SalaryIncentives.Add(x);
            await _db.SaveChangesAsync(ct);
            return Ok(IncentiveShape(x));
        }

        [HttpPost("incentives/{id:guid}/remove")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> RemoveIncentive(Guid id, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var x = await _db.SalaryIncentives.FirstOrDefaultAsync(i => i.Id == id && !i.Removed, ct);
            if (x == null) return NotFound(new { message = "That incentive isn't here any more." });
            if (await _db.SalarySlips.AnyAsync(s => s.AgentId == x.AgentId && s.Month == x.Month, ct))
                return Conflict(new { message = $"{Payroll.MonthName(x.Month)} is already approved. Reopen it to change incentives." });
            x.Removed = true; x.RemovedBy = User.AgentIdOf(); x.RemovedAt = DateTime.UtcNow;
            if (!string.IsNullOrEmpty(x.SourceIds))
            {
                var src = x.SourceIds.Split(',').Select(v => Guid.TryParse(v, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
                foreach (var i in await _db.AgentIncentives.Where(i => src.Contains(i.Id) && i.Status == "paid").ToListAsync(ct))
                { i.Status = "approved"; i.PaidBy = null; i.PaidAt = null; i.PaymentReference = null; }
            }
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>
        /// Brings a person's approved referral incentives (from Payments) into a month's salary as one incentive, and marks
        /// them paid there so they aren't paid twice. Taking the incentive out sets them back to approved.
        /// </summary>
        [HttpPost("payroll/pull-referrals")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> PullReferrals([FromBody] PullReferralsDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var month = Spend.MonthOf(d.Month);
            if (month == null) return BadRequest(new { message = "Pick the month." });
            var s = await _db.MarketingStaff.AsNoTracking().FirstOrDefaultAsync(x => x.AgentId == d.AgentId, ct);
            if (s == null) return BadRequest(new { message = "That person isn't on the team." });
            if (await _db.SalarySlips.AnyAsync(x => x.AgentId == s.AgentId && x.Month == month, ct))
                return Conflict(new { message = $"{Payroll.MonthName(month)} is already approved. Reopen it first." });
            var list = await _db.AgentIncentives.Where(i => i.AgentId == s.AgentId && i.Status == "approved").OrderBy(i => i.CreatedAt).ToListAsync(ct);
            if (list.Count == 0) return BadRequest(new { message = "No approved referral incentives are waiting." });
            var me = User.AgentIdOf(); var myName = await MyNameAsync(ct);
            var x = new SalaryIncentive
            {
                AgentId = s.AgentId, Month = month, Amount = list.Sum(i => i.Amount), Kind = "referrals",
                Title = $"Referral incentives ({list.Count})",
                Basis = list.Count == 1 ? list[0].Reason : $"{list.Count} approved referral incentives",
                Details = Hoardings.Clean(string.Join("; ", list.Select(i => $"{i.Reason} {Spend.Rupees(i.Amount)}")), 600),
                SourceIds = string.Join(",", list.Select(i => i.Id)),
                AddedBy = me, AddedByName = myName,
            };
            _db.SalaryIncentives.Add(x);
            foreach (var i in list)
            {
                i.Status = "paid"; i.PaidBy = me; i.PaidAt = DateTime.UtcNow;
                i.PaymentReference = $"With salary for {Payroll.MonthName(month)}";
            }
            await _db.SaveChangesAsync(ct);
            return Ok(IncentiveShape(x));
        }

        /// <summary>Approve a month's salary for release: the days and amounts are kept as they are now.</summary>
        [HttpPost("payroll/approve")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> ApprovePayroll([FromBody] PayrollApproveDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var today = AttendanceService.TodayIst;
            var month = Spend.MonthOf(d.Month);
            if (month == null) return BadRequest(new { message = "Pick the month." });
            if (string.CompareOrdinal(month, Spend.Month(today)) > 0) return BadRequest(new { message = "A month can be approved once it has started." });
            var ids = (d.AgentIds ?? new()).Where(i => !string.IsNullOrWhiteSpace(i)).Distinct().ToList();
            if (ids.Count == 0) return BadRequest(new { message = "Choose who to approve." });
            var staff = await _db.MarketingStaff.AsNoTracking().Where(s => ids.Contains(s.AgentId)).ToListAsync(ct);
            if (staff.Count != ids.Count) return BadRequest(new { message = "Some of those people aren't on the team." });
            var already = await _db.SalarySlips.AsNoTracking().Where(x => ids.Contains(x.AgentId) && x.Month == month).Select(x => x.AgentId).ToListAsync(ct);
            var rates = await _db.MarketingSalaryRates.AsNoTracking().Where(r => ids.Contains(r.AgentId)).ToListAsync(ct);
            var calc = await PayCalcAsync(staff, rates, new[] { month }, ct);
            var me = User.AgentIdOf(); var myName = await MyNameAsync(ct);
            var note = Hoardings.Clean(d.Note, 300);
            var done = new List<(MarketingStaff S, Payroll.Calc C)>();
            foreach (var s in staff.Where(s => !already.Contains(s.AgentId)))
            {
                var c = calc(s, month);
                if (c.EmployedDays == 0 && c.Incentives == 0) continue;
                _db.SalarySlips.Add(new SalarySlip
                {
                    AgentId = s.AgentId, Month = month, Basis = c.Basis, Rate = c.Rate, MonthDays = c.MonthDays, EmployedDays = c.EmployedDays,
                    PresentDays = c.Present, PaidLeaveDays = c.PaidLeave, OffDays = c.Off, AbsentDays = c.Absent, UnpaidLeaveDays = c.UnpaidLeave,
                    HalfDays = c.Half, PayableDays = c.PayableDays, Earned = c.Earned, Incentives = c.Incentives, Net = c.Net,
                    Note = note, ApprovedBy = me, ApprovedByName = myName,
                });
                done.Add((s, c));
            }
            await _db.SaveChangesAsync(ct);
            foreach (var (s, c) in done)
                _notifier.Notify(new NotifyJob
                {
                    To = new() { s.AgentId }, Except = me, Kind = "note",
                    Title = $"Salary for {Payroll.MonthName(month)}: {Spend.Rupees(c.Net)}",
                    Body = $"{(c.Basis == "attendance" ? $"{c.PayableDays.ToString("0.#", CultureInfo.InvariantCulture)} of {c.MonthDays} days paid" : $"{c.EmployedDays} of {c.MonthDays} days")}{(c.Incentives > 0 ? $" + {Spend.Rupees(c.Incentives)} incentives" : "")}. Approved by {myName}; payment follows.",
                    Link = "spend",
                });
            return Ok(new { approved = done.Count, skipped = ids.Count - done.Count });
        }

        /// <summary>Undo an approval, to change incentives or pick up corrected attendance. Payments already made stay.</summary>
        [HttpPost("payroll/reopen")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> ReopenPayroll([FromBody] PayrollReopenDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var month = Spend.MonthOf(d.Month);
            var slip = month == null ? null : await _db.SalarySlips.FirstOrDefaultAsync(x => x.AgentId == d.AgentId && x.Month == month, ct);
            if (slip == null) return NotFound(new { message = "That month isn't approved." });
            _db.SalarySlips.Remove(slip);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>The month's payroll as a spreadsheet.</summary>
        [HttpGet("payroll/export")]
        public async Task<IActionResult> ExportPayroll([FromQuery] string? month, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var m = Spend.MonthOf(month) ?? Spend.Month(today);
            var staff = await _db.MarketingStaff.AsNoTracking().ToListAsync(ct);
            var rates = await _db.MarketingSalaryRates.AsNoTracking().ToListAsync(ct);
            var salary = await _db.MarketingExpenses.AsNoTracking().Where(e => !e.Removed && e.Category == "agents" && e.SalaryMonth == m).ToListAsync(ct);
            var slips = await _db.SalarySlips.AsNoTracking().Where(x => x.Month == m).Select(x => x.AgentId).ToListAsync(ct);
            var calc = await PayCalcAsync(staff, rates, new[] { m }, ct);
            static string c(string? v) => v == null ? "" : (v.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v);
            static string n(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture);
            var sb = new StringBuilder("Name,User ID,Joined,Pay basis,Monthly salary,Days in month,Days employed,Present,Paid leave,Days off,Absent,Unpaid leave,Half days,Payable days,Earned,Incentives,Net,Paid,Left,Approved\n");
            foreach (var s in staff.OrderBy(s => s.Name))
            {
                var x = calc(s, m);
                if (x.EmployedDays == 0 && x.Incentives == 0) continue;
                var paid = Spend.PaidFor(s.AgentId, m, salary);
                sb.Append(string.Join(",", c(s.Name), c(s.AgentId), s.JoinedOn?.ToString("yyyy-MM-dd") ?? "", x.Basis, n(x.Rate), x.MonthDays, x.EmployedDays, n(x.Present), x.PaidLeave, x.Off,
                    x.Absent, x.UnpaidLeave, x.Half, n(x.PayableDays), n(x.Earned), n(x.Incentives), n(x.Net), n(paid), n(Math.Max(0, x.Net - paid)), slips.Contains(s.AgentId) ? "yes" : "no")).Append('\n');
            }
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"payroll-{m}.csv");
        }
    }
}
