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
    public class HealthCardPlanDto
    {
        public string? Name { get; set; }
        public decimal? Price { get; set; }
        public int? ValidMonths { get; set; }
        public int? MaxMembers { get; set; }
        public decimal? OpdDiscountPct { get; set; }
        public decimal? IpdDiscountPct { get; set; }
        public decimal? LabDiscountPct { get; set; }
        public decimal? PharmacyDiscountPct { get; set; }
        public int? FreeOpdVisits { get; set; }
        public string? Extras { get; set; }
        public string? Color { get; set; }
        public bool? Active { get; set; }
    }

    public class HealthCardDto
    {
        public Guid? PlanId { get; set; }
        public string? HolderName { get; set; }
        public string? Phone { get; set; }
        public int? Age { get; set; }
        public string? Sex { get; set; }
        public string? Village { get; set; }
        public string? Block { get; set; }
        public string? District { get; set; }
        public List<HealthCards.Member>? Members { get; set; }
        public DateOnly? IssuedOn { get; set; }
        public decimal? Fee { get; set; }
        public string? PayMode { get; set; }
        public string? Source { get; set; }
        public Guid? CampPatientId { get; set; }
        public Guid? CampId { get; set; }
        public string? AgentId { get; set; }
        public string? Note { get; set; }
    }

    public class HealthCardRenewDto { public decimal? Fee { get; set; } public string? PayMode { get; set; } public DateOnly? On { get; set; } }
    public class HealthCardCancelDto { public string? Reason { get; set; } }

    public class HealthCardUseDto
    {
        public DateOnly? On { get; set; }
        public string? Kind { get; set; }
        public string? MemberName { get; set; }
        public decimal? BillAmount { get; set; }
        /// <summary>Empty: worked out from the plan.</summary>
        public decimal? Discount { get; set; }
        public string? ReferralClientId { get; set; }
        public string? Note { get; set; }
    }

    public class HealthCardLinkDto { public Guid? CardId { get; set; } }

    /// <summary>
    /// The hospital's own health cards: plans, giving a card (at a camp, by an agent or at the desk), checking one when the
    /// patient comes, visits with the discount given, renewals, and what the cards bring in.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Camps, Pages.Desk, Pages.Pipeline)]
    [Route("api/v1/health-cards")]
    public class HealthCardsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;
        public HealthCardsController(IMarketingDbContext db, ILiveEvents live) { _db = db; _live = live; }

        private static DateOnly Today => AttendanceService.TodayIst;
        private static string? Clean(string? s, int max) => Hoardings.Clean(s, max);

        private async Task<string> MyNameAsync(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            return await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
        }

        private static object PlanShape(HealthCardPlan p) => new
        {
            id = p.Id, name = p.Name, price = p.Price, validMonths = p.ValidMonths, maxMembers = p.MaxMembers,
            opdDiscountPct = p.OpdDiscountPct, ipdDiscountPct = p.IpdDiscountPct, labDiscountPct = p.LabDiscountPct, pharmacyDiscountPct = p.PharmacyDiscountPct,
            freeOpdVisits = p.FreeOpdVisits, extras = p.Extras, color = p.Color, active = p.Active, order = p.Order,
        };

        private static object CardShape(HealthCard c, HealthCardPlan? p, int visits, decimal billed, decimal discount, int freeUsed, string? campTitle, string? agentName) => new
        {
            id = c.Id, number = c.Number, planId = c.PlanId, planName = p?.Name, color = p?.Color,
            holderName = c.HolderName, phone = c.Phone, age = c.Age, sex = c.Sex, village = c.Village, block = c.Block, district = c.District,
            members = HealthCards.Members(c.MembersJson),
            issuedOn = c.IssuedOn.ToString("yyyy-MM-dd"), validTill = c.ValidTill.ToString("yyyy-MM-dd"),
            status = HealthCards.Status(c, Today), cancelReason = c.CancelReason, renewals = c.Renewals,
            source = c.Source, campId = c.CampId, campTitle, campPatientId = c.CampPatientId, agentId = c.AgentId, agentName, note = c.Note,
            visits, billed, discount, freeLeft = p == null ? 0 : Math.Max(0, p.FreeOpdVisits - freeUsed),
            createdByName = c.CreatedByName, createdAt = c.CreatedAt,
        };

        private async Task<List<object>> ShapeAsync(List<HealthCard> cards, CancellationToken ct)
        {
            var ids = cards.Select(c => c.Id).ToList();
            var plans = await _db.HealthCardPlans.AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
            var uses = (await _db.HealthCardUses.AsNoTracking().Where(u => ids.Contains(u.CardId) && !u.Removed)
                    .Select(u => new { u.CardId, u.BillAmount, u.Discount, u.FreeVisit }).ToListAsync(ct))
                .GroupBy(u => u.CardId).ToDictionary(g => g.Key, g => g.ToList());
            var campIds = cards.Where(c => c.CampId != null).Select(c => c.CampId!.Value).Distinct().ToList();
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => campIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Title, ct);
            var agentIds = cards.Where(c => c.AgentId != null).Select(c => c.AgentId!).Distinct().ToList();
            var agents = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            return cards.Select(c =>
            {
                var u = uses.GetValueOrDefault(c.Id);
                return CardShape(c, plans.GetValueOrDefault(c.PlanId), u?.Count ?? 0, u?.Sum(x => x.BillAmount) ?? 0, u?.Sum(x => x.Discount) ?? 0, u?.Count(x => x.FreeVisit) ?? 0,
                    c.CampId != null ? camps.GetValueOrDefault(c.CampId.Value) : null, c.AgentId != null ? agents.GetValueOrDefault(c.AgentId) : null);
            }).ToList();
        }

        /// <summary>Field agents, to credit a card to the one who gave it.</summary>
        [HttpGet("agents")]
        public async Task<IActionResult> Agents(CancellationToken ct) =>
            Ok((await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { agentId = a.AgentId, name = a.Name, role = a.Role, block = a.Block }).ToListAsync(ct))
                .Where(a => !RoleChecks.IsDashboardRole(a.role)).OrderBy(a => a.name));

        // ── Plans ───────────────────────────────────────────────────────────────

        [HttpGet("plans")]
        public async Task<IActionResult> Plans(CancellationToken ct) =>
            Ok((await _db.HealthCardPlans.AsNoTracking().OrderBy(p => p.Order).ThenBy(p => p.Name).ToListAsync(ct)).Select(PlanShape));

        private static string? ApplyPlan(HealthCardPlan p, HealthCardPlanDto d)
        {
            var err = HealthCards.PlanProblem(d.Name, d.Price, d.ValidMonths, d.MaxMembers,
                new[] { d.OpdDiscountPct, d.IpdDiscountPct, d.LabDiscountPct, d.PharmacyDiscountPct }, d.FreeOpdVisits);
            if (err != null) return err;
            p.Name = Clean(d.Name, 80)!;
            p.Price = Math.Round(d.Price!.Value, 2);
            p.ValidMonths = d.ValidMonths!.Value;
            p.MaxMembers = d.MaxMembers!.Value;
            p.OpdDiscountPct = d.OpdDiscountPct ?? 0; p.IpdDiscountPct = d.IpdDiscountPct ?? 0;
            p.LabDiscountPct = d.LabDiscountPct ?? 0; p.PharmacyDiscountPct = d.PharmacyDiscountPct ?? 0;
            p.FreeOpdVisits = d.FreeOpdVisits ?? 0;
            p.Extras = Clean(d.Extras, 600);
            if (!string.IsNullOrWhiteSpace(d.Color) && System.Text.RegularExpressions.Regex.IsMatch(d.Color, "^#[0-9a-fA-F]{6}$")) p.Color = d.Color;
            if (d.Active != null) p.Active = d.Active.Value;
            p.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        [HttpPost("plans")]
        public async Task<IActionResult> AddPlan([FromBody] HealthCardPlanDto d, CancellationToken ct)
        {
            var p = new HealthCardPlan { CreatedBy = User.AgentIdOf(), Order = await _db.HealthCardPlans.CountAsync(ct) + 1 };
            var err = ApplyPlan(p, d);
            if (err != null) return BadRequest(new { message = err });
            _db.HealthCardPlans.Add(p);
            await _db.SaveChangesAsync(ct);
            return Ok(PlanShape(p));
        }

        /// <summary>Changes apply to cards given from now on and to discounts worked out from now on; past visits keep theirs.</summary>
        [HttpPut("plans/{id:guid}")]
        public async Task<IActionResult> SavePlan(Guid id, [FromBody] HealthCardPlanDto d, CancellationToken ct)
        {
            var p = await _db.HealthCardPlans.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p == null) return NotFound(new { message = "That card plan isn't here any more." });
            var err = ApplyPlan(p, d);
            if (err != null) return BadRequest(new { message = err });
            await _db.SaveChangesAsync(ct);
            return Ok(PlanShape(p));
        }

        // ── Cards ───────────────────────────────────────────────────────────────

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] string? status, [FromQuery] Guid? planId, [FromQuery] string? source,
            [FromQuery] Guid? campId, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        {
            page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 200);
            var today = Today; var soon = today.AddDays(HealthCards.ExpiringDays);
            var all = _db.HealthCards.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                all = all.Where(c => c.HolderName.ToLower().Contains(s) || c.Number.ToLower().Contains(s) || (c.Village != null && c.Village.ToLower().Contains(s))
                                     || (digits.Length >= 4 && c.Phone != null && c.Phone.Contains(digits)));
            }
            if (planId != null) all = all.Where(c => c.PlanId == planId);
            if (!string.IsNullOrWhiteSpace(source)) all = all.Where(c => c.Source == source);
            if (campId != null) all = all.Where(c => c.CampId == campId);
            var counts = new
            {
                all = await all.CountAsync(ct),
                active = await all.CountAsync(c => c.Status != "cancelled" && c.ValidTill >= today, ct),
                expiring = await all.CountAsync(c => c.Status != "cancelled" && c.ValidTill >= today && c.ValidTill <= soon, ct),
                expired = await all.CountAsync(c => c.Status != "cancelled" && c.ValidTill < today, ct),
                cancelled = await all.CountAsync(c => c.Status == "cancelled", ct),
            };
            var list = status switch
            {
                "active" => all.Where(c => c.Status != "cancelled" && c.ValidTill >= today),
                "expiring" => all.Where(c => c.Status != "cancelled" && c.ValidTill >= today && c.ValidTill <= soon),
                "expired" => all.Where(c => c.Status != "cancelled" && c.ValidTill < today),
                "cancelled" => all.Where(c => c.Status == "cancelled"),
                _ => all,
            };
            var total = await list.CountAsync(ct);
            var rows = await (status == "expiring" ? list.OrderBy(c => c.ValidTill) : list.OrderByDescending(c => c.CreatedAt))
                .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            return Ok(new { items = await ShapeAsync(rows, ct), total, page, pageSize, counts });
        }

        /// <summary>At the desk: find a card by its number or the mobile number, and say whether it can be used today.</summary>
        [HttpGet("check")]
        public async Task<IActionResult> Check([FromQuery] string? q, CancellationToken ct)
        {
            var s = (q ?? "").Trim().ToUpperInvariant();
            if (s.Length < 3) return Ok(Array.Empty<object>());
            var phone = HealthCards.Phone(s);
            var rows = await _db.HealthCards.AsNoTracking()
                .Where(c => c.Number == s || c.Number.EndsWith(s) || (phone != null && c.Phone == phone))
                .OrderByDescending(c => c.ValidTill).Take(10).ToListAsync(ct);
            return Ok(await ShapeAsync(rows, ct));
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> One(Guid id, CancellationToken ct)
        {
            var c = await _db.HealthCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here." });
            var plan = await _db.HealthCardPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == c.PlanId, ct);
            var uses = await _db.HealthCardUses.AsNoTracking().Where(u => u.CardId == id && !u.Removed).OrderByDescending(u => u.On).ThenByDescending(u => u.CreatedAt).ToListAsync(ct);
            var pays = await _db.HealthCardPayments.AsNoTracking().Where(p => p.CardId == id).OrderByDescending(p => p.On).ToListAsync(ct);
            var refs = await _db.Referrals.AsNoTracking().Where(r => r.HealthCardId == id).OrderByDescending(r => r.CreatedAt)
                .Select(r => new { clientId = r.ClientId, name = r.PatientName, department = r.Department, status = r.Status, createdAt = r.CreatedAt }).ToListAsync(ct);
            return Ok(new
            {
                card = (await ShapeAsync(new List<HealthCard> { c }, ct))[0],
                plan = plan == null ? null : PlanShape(plan),
                uses = uses.Select(u => new { id = u.Id, on = u.On.ToString("yyyy-MM-dd"), kind = u.Kind, memberName = u.MemberName, billAmount = u.BillAmount, discount = u.Discount, freeVisit = u.FreeVisit, referralClientId = u.ReferralClientId, note = u.Note, byName = u.ByName }),
                payments = pays.Select(p => new { id = p.Id, kind = p.Kind, amount = p.Amount, on = p.On.ToString("yyyy-MM-dd"), mode = p.Mode }),
                referrals = refs,
            });
        }

        private static string? ApplyHolder(HealthCard c, HealthCardDto d, HealthCardPlan plan)
        {
            var name = Clean(d.HolderName, 80);
            if (name == null) return "Write the card holder's name.";
            string? phone = null;
            if (!string.IsNullOrWhiteSpace(d.Phone)) { phone = HealthCards.Phone(d.Phone); if (phone == null) return "Check the mobile number (10 digits)."; }
            if (d.Age is < 0 or > 120) return "Check the age.";
            var members = (d.Members ?? new()).Where(m => !string.IsNullOrWhiteSpace(m.Name)).ToList();
            if (members.Count + 1 > plan.MaxMembers)
                return plan.MaxMembers == 1 ? "This card is for one person only." : $"This card covers {plan.MaxMembers} people: the holder and {plan.MaxMembers - 1} more.";
            c.HolderName = name; c.Phone = phone; c.Age = d.Age;
            c.Sex = d.Sex is "M" or "F" or "O" ? d.Sex : null;
            c.Village = Clean(d.Village, 80); c.Block = Clean(d.Block, 80); c.District = Clean(d.District, 80);
            c.MembersJson = HealthCards.MembersJson(members);
            c.Note = Clean(d.Note, 400);
            return null;
        }

        /// <summary>Give a card: from a camp patient (their details filled in), by an agent, or at the desk.</summary>
        [HttpPost]
        public async Task<IActionResult> Issue([FromBody] HealthCardDto d, CancellationToken ct)
        {
            var plan = d.PlanId == null ? null : await _db.HealthCardPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == d.PlanId && p.Active, ct);
            if (plan == null) return BadRequest(new { message = "Pick the kind of card." });
            var today = Today;
            var on = d.IssuedOn ?? today;
            if (on > today || on < today.AddYears(-3)) return BadRequest(new { message = "Check the date it was given." });
            var fee = d.Fee ?? plan.Price;
            if (fee < 0 || fee > HealthCards.MaxMoney) return BadRequest(new { message = "Check the fee." });
            var c = new HealthCard
            {
                PlanId = plan.Id, IssuedOn = on, ValidTill = HealthCards.ValidTill(on, plan.ValidMonths),
                Source = HealthCards.Sources.Contains(d.Source ?? "") ? d.Source! : "desk",
                CreatedBy = User.AgentIdOf(), CreatedByName = await MyNameAsync(ct),
            };
            var err = ApplyHolder(c, d, plan);
            if (err != null) return BadRequest(new { message = err });

            if (d.CampPatientId != null)
            {
                var p = await _db.CampPatients.AsNoTracking().FirstOrDefaultAsync(x => x.Id == d.CampPatientId, ct);
                if (p == null) return BadRequest(new { message = "That camp patient isn't here any more." });
                var had = await _db.HealthCards.AsNoTracking().Where(x => x.CampPatientId == p.Id && x.Status != "cancelled").Select(x => x.Number).FirstOrDefaultAsync(ct);
                if (had != null) return Conflict(new { message = $"{p.Name} already has card {had} from this camp." });
                c.CampPatientId = p.Id; c.CampId = p.CampId; c.Source = "camp"; c.PartnerClientId = p.PartnerClientId;
                if (c.Village == null) c.Village = p.Village;
                var camp = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == p.CampId, ct);
                c.Block ??= camp?.Block; c.District ??= camp?.District;
            }
            else if (d.CampId != null && await _db.HealthCamps.AnyAsync(x => x.Id == d.CampId, ct)) { c.CampId = d.CampId; c.Source = "camp"; }
            if (!string.IsNullOrWhiteSpace(d.AgentId) && await _db.Agents.AnyAsync(a => a.AgentId == d.AgentId, ct)) c.AgentId = d.AgentId;
            if (c.Phone != null)
            {
                var same = await _db.HealthCards.AsNoTracking().Where(x => x.Phone == c.Phone && x.HolderName.ToLower() == c.HolderName.ToLower() && x.Status != "cancelled" && x.ValidTill >= today)
                    .Select(x => x.Number).FirstOrDefaultAsync(ct);
                if (same != null) return Conflict(new { message = $"{c.HolderName} already has a valid card, {same}. Renew or open that one." });
            }

            for (int attempt = 0; ; attempt++)
            {
                c.Number = await HealthCards.NextNumberAsync(_db, on.Year, ct);
                _db.HealthCards.Add(c);
                if (fee > 0 || d.PayMode == "free")
                    _db.HealthCardPayments.Add(new HealthCardPayment { CardId = c.Id, Kind = "issue", Amount = fee, On = on, Mode = HealthCards.Modes.Contains(d.PayMode ?? "") ? d.PayMode : "cash", By = c.CreatedBy });
                // The camp patient's place on the Referral desk carries the card too.
                if (c.CampPatientId != null)
                {
                    var refId = PatientResults.CampClientId(c.CampPatientId.Value);
                    var r = await _db.Referrals.FirstOrDefaultAsync(x => x.ClientId == refId, ct);
                    if (r != null && r.HealthCardId == null) r.HealthCardId = c.Id;
                }
                try { await _db.SaveChangesAsync(ct); break; }
                catch (DbUpdateException) when (attempt < 3)
                {
                    // Someone else took that number at the same moment: take the next one.
                    foreach (var e in _db.ChangeTracker.Entries().Where(e => e.State == EntityState.Added).ToList()) e.State = EntityState.Detached;
                }
            }
            await _live.PublishAsync(new LiveEvent { Kind = "health_card", Text = $"Health card {c.Number} given to {c.HolderName}", RefId = c.Id.ToString() });
            return Ok((await ShapeAsync(new List<HealthCard> { c }, ct))[0]);
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Edit(Guid id, [FromBody] HealthCardDto d, CancellationToken ct)
        {
            var c = await _db.HealthCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here." });
            var plan = await _db.HealthCardPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == c.PlanId, ct);
            if (plan == null) return Conflict(new { message = "This card's plan is missing. Check Health cards → Card types." });
            var err = ApplyHolder(c, d, plan);
            if (err != null) return BadRequest(new { message = err });
            if (d.AgentId != null) c.AgentId = string.IsNullOrWhiteSpace(d.AgentId) ? null : d.AgentId;
            c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok((await ShapeAsync(new List<HealthCard> { c }, ct))[0]);
        }

        /// <summary>Another term from the day after it ends (or from today if it has already run out).</summary>
        [HttpPost("{id:guid}/renew")]
        public async Task<IActionResult> Renew(Guid id, [FromBody] HealthCardRenewDto d, CancellationToken ct)
        {
            var c = await _db.HealthCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here." });
            if (c.Status == "cancelled") return Conflict(new { message = "This card was cancelled. Give a new card instead." });
            var plan = await _db.HealthCardPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == c.PlanId, ct);
            if (plan == null) return Conflict(new { message = "This card's plan is missing. Check Health cards → Card types." });
            var today = Today;
            var on = d.On ?? today;
            var fee = d.Fee ?? plan.Price;
            if (fee < 0 || fee > HealthCards.MaxMoney) return BadRequest(new { message = "Check the fee." });
            var from = c.ValidTill >= today ? c.ValidTill.AddDays(1) : today;
            c.ValidTill = HealthCards.ValidTill(from, plan.ValidMonths);
            c.Renewals++;
            c.UpdatedAt = DateTime.UtcNow;
            _db.HealthCardPayments.Add(new HealthCardPayment { CardId = c.Id, Kind = "renewal", Amount = fee, On = on, Mode = HealthCards.Modes.Contains(d.PayMode ?? "") ? d.PayMode : "cash", By = User.AgentIdOf() });
            await _db.SaveChangesAsync(ct);
            return Ok((await ShapeAsync(new List<HealthCard> { c }, ct))[0]);
        }

        [HttpPost("{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id, [FromBody] HealthCardCancelDto d, CancellationToken ct)
        {
            var c = await _db.HealthCards.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here." });
            var reason = Clean(d.Reason, 200);
            if (reason == null) return BadRequest(new { message = "Say why it is cancelled (e.g. given by mistake, lost and replaced)." });
            c.Status = "cancelled"; c.CancelReason = reason; c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>A visit with the card. The discount is worked out from the plan unless the desk writes what was given.</summary>
        [HttpPost("{id:guid}/uses")]
        public async Task<IActionResult> AddUse(Guid id, [FromBody] HealthCardUseDto d, CancellationToken ct)
        {
            var c = await _db.HealthCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound(new { message = "That card isn't here." });
            var on = d.On ?? Today;
            if (on > Today) return BadRequest(new { message = "A visit can't be in the future." });
            if (!HealthCards.Usable(c, on))
                return Conflict(new { message = c.Status == "cancelled" ? "This card was cancelled." : $"The card wasn't valid on that day (valid {c.IssuedOn:d MMM yyyy} – {c.ValidTill:d MMM yyyy}). Renew it first." });
            var kind = (d.Kind ?? "opd").Trim().ToLowerInvariant();
            if (!HealthCards.UseKinds.Contains(kind)) return BadRequest(new { message = "Pick what the visit was for." });
            var bill = d.BillAmount ?? 0;
            if (bill < 0 || bill > HealthCards.MaxMoney) return BadRequest(new { message = "Check the bill amount." });
            var member = Clean(d.MemberName, 80);
            if (member != null && !string.Equals(member, c.HolderName, StringComparison.OrdinalIgnoreCase)
                && !HealthCards.Members(c.MembersJson).Any(m => string.Equals(m.Name, member, StringComparison.OrdinalIgnoreCase)))
                return BadRequest(new { message = $"{member} isn't on this card." });
            var plan = await _db.HealthCardPlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == c.PlanId, ct);
            if (plan == null) return Conflict(new { message = "This card's plan is missing. Check Health cards → Card types." });
            var uses = await _db.HealthCardUses.AsNoTracking().Where(u => u.CardId == id && !u.Removed).ToListAsync(ct);
            var (auto, free) = HealthCards.DiscountFor(plan, kind, bill, HealthCards.FreeLeft(plan, uses));
            var discount = d.Discount ?? auto;
            if (discount < 0 || discount > bill) return BadRequest(new { message = "The discount can't be more than the bill." });
            if (d.Discount != null && free && discount < bill) free = false;      // a smaller discount than "free" isn't a free visit
            string? refId = null;
            if (!string.IsNullOrWhiteSpace(d.ReferralClientId))
            {
                var r = await _db.Referrals.FirstOrDefaultAsync(x => x.ClientId == d.ReferralClientId, ct);
                if (r == null) return BadRequest(new { message = "That referral isn't here." });
                refId = r.ClientId;
                r.HealthCardId ??= c.Id;
            }
            var use = new HealthCardUse
            {
                CardId = id, On = on, Kind = kind, MemberName = member == null || string.Equals(member, c.HolderName, StringComparison.OrdinalIgnoreCase) ? null : member,
                BillAmount = bill, Discount = discount, FreeVisit = free, ReferralClientId = refId, Note = Clean(d.Note, 300),
                By = User.AgentIdOf(), ByName = await MyNameAsync(ct),
            };
            _db.HealthCardUses.Add(use);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = use.Id, discount = use.Discount, freeVisit = use.FreeVisit, freeLeft = HealthCards.FreeLeft(plan, uses.Append(use)) });
        }

        [HttpPost("uses/{useId:guid}/remove")]
        public async Task<IActionResult> RemoveUse(Guid useId, CancellationToken ct)
        {
            var u = await _db.HealthCardUses.FirstOrDefaultAsync(x => x.Id == useId && !x.Removed, ct);
            if (u == null) return NotFound(new { message = "That visit isn't here any more." });
            u.Removed = true;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>The card linked to a patient on the Referral desk, or cards with the same mobile number to link.</summary>
        [HttpGet("for-referral/{clientId}")]
        public async Task<IActionResult> ForReferral(string clientId, CancellationToken ct)
        {
            var r = await _db.Referrals.AsNoTracking().FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (r == null) return NotFound(new { message = "Referral not found." });
            if (r.HealthCardId != null)
            {
                var c = await _db.HealthCards.AsNoTracking().FirstOrDefaultAsync(x => x.Id == r.HealthCardId, ct);
                if (c != null) return Ok(new { linked = (await ShapeAsync(new List<HealthCard> { c }, ct))[0], suggestions = Array.Empty<object>() });
            }
            var phone = HealthCards.Phone(r.ClientPhone);
            var campPatient = clientId.StartsWith("camp-") && Guid.TryParse(clientId[5..], out var pid) ? pid : (Guid?)null;
            var found = await _db.HealthCards.AsNoTracking()
                .Where(c => c.Status != "cancelled" && ((phone != null && c.Phone == phone) || (campPatient != null && c.CampPatientId == campPatient)))
                .OrderByDescending(c => c.ValidTill).Take(5).ToListAsync(ct);
            return Ok(new { linked = (object?)null, suggestions = await ShapeAsync(found, ct) });
        }

        [HttpPut("for-referral/{clientId}")]
        public async Task<IActionResult> LinkReferral(string clientId, [FromBody] HealthCardLinkDto d, CancellationToken ct)
        {
            var r = await _db.Referrals.FirstOrDefaultAsync(x => x.ClientId == clientId, ct);
            if (r == null) return NotFound(new { message = "Referral not found." });
            if (d.CardId != null && !await _db.HealthCards.AnyAsync(c => c.Id == d.CardId, ct)) return BadRequest(new { message = "That card isn't here." });
            r.HealthCardId = d.CardId;
            r.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ── What the cards bring in ─────────────────────────────────────────────

        [HttpGet("results")]
        public async Task<IActionResult> Results([FromQuery] string? from, [FromQuery] string? to, CancellationToken ct)
        {
            var today = Today;
            var end = Hoardings.Date(to) ?? today;
            var start = Hoardings.Date(from) ?? new DateOnly(today.Year, today.Month, 1);
            if (start > end) (start, end) = (end, start);
            var issued = await _db.HealthCards.AsNoTracking().Where(c => c.IssuedOn >= start && c.IssuedOn <= end).ToListAsync(ct);
            var pays = await _db.HealthCardPayments.AsNoTracking().Where(p => p.On >= start && p.On <= end).ToListAsync(ct);
            var uses = await _db.HealthCardUses.AsNoTracking().Where(u => !u.Removed && u.On >= start && u.On <= end).ToListAsync(ct);
            var plans = await _db.HealthCardPlans.AsNoTracking().ToListAsync(ct);
            var usedCardIds = uses.Select(u => u.CardId).Distinct().ToList();
            var usedCards = await _db.HealthCards.AsNoTracking().Where(c => usedCardIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, ct);
            var issuedIds = issued.Select(c => c.Id).ToList();
            var everUsed = (await _db.HealthCardUses.AsNoTracking().Where(u => !u.Removed && issuedIds.Contains(u.CardId)).Select(u => u.CardId).Distinct().ToListAsync(ct)).ToHashSet();
            var campIds = issued.Where(c => c.CampId != null).Select(c => c.CampId!.Value).Concat(usedCards.Values.Where(c => c.CampId != null).Select(c => c.CampId!.Value)).Distinct().ToList();
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => campIds.Contains(c.Id)).Select(c => new { c.Id, c.Title, c.Date, c.Block }).ToListAsync(ct);
            var agentIds = issued.Where(c => c.AgentId != null).Select(c => c.AgentId!).Distinct().ToList();
            var agents = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            var soon = today.AddDays(HealthCards.ExpiringDays);

            object VisitTally(IEnumerable<HealthCardUse> u)
            {
                var l = u.ToList();
                return new
                {
                    visits = l.Count, people = l.Select(x => (x.CardId, x.MemberName)).Distinct().Count(),
                    opd = l.Count(x => x.Kind == "opd"), admitted = l.Count(x => x.Kind is "ipd" or "procedure"), free = l.Count(x => x.FreeVisit),
                    billed = l.Sum(x => x.BillAmount), discount = l.Sum(x => x.Discount), net = l.Sum(x => x.BillAmount - x.Discount),
                };
            }
            var payCardIds = pays.Select(p => p.CardId).Distinct().ToList();
            var planOfCard = (await _db.HealthCards.AsNoTracking().Where(c => payCardIds.Contains(c.Id)).Select(c => new { c.Id, c.PlanId }).ToListAsync(ct))
                .Concat(usedCards.Values.Select(c => new { c.Id, c.PlanId })).GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First().PlanId);

            return Ok(new
            {
                from = start.ToString("yyyy-MM-dd"), to = end.ToString("yyyy-MM-dd"),
                cards = new
                {
                    issued = issued.Count,
                    fromCamps = issued.Count(c => c.Source == "camp"), byAgents = issued.Count(c => c.Source == "agent"), atDesk = issued.Count(c => c.Source == "desk"),
                    used = issued.Count(c => everUsed.Contains(c.Id)),
                    feeCollected = pays.Sum(p => p.Amount), renewals = pays.Count(p => p.Kind == "renewal"),
                    activeNow = await _db.HealthCards.CountAsync(c => c.Status != "cancelled" && c.ValidTill >= today, ct),
                    expiringSoon = await _db.HealthCards.CountAsync(c => c.Status != "cancelled" && c.ValidTill >= today && c.ValidTill <= soon, ct),
                },
                visits = VisitTally(uses),
                byPlan = plans.Select(p => new
                {
                    id = p.Id, name = p.Name, color = p.Color,
                    issued = issued.Count(c => c.PlanId == p.Id),
                    fee = pays.Where(x => planOfCard.GetValueOrDefault(x.CardId) == p.Id).Sum(x => x.Amount),
                    n = uses.Count(u => usedCards.TryGetValue(u.CardId, out var c) && c.PlanId == p.Id),
                    visits = VisitTally(uses.Where(u => usedCards.TryGetValue(u.CardId, out var c) && c.PlanId == p.Id)),
                }).Where(x => x.issued > 0 || x.n > 0 || x.fee > 0),
                byCamp = camps.Select(cp => new
                {
                    id = cp.Id, title = cp.Title, date = cp.Date.ToString("yyyy-MM-dd"), block = cp.Block,
                    issued = issued.Count(c => c.CampId == cp.Id),
                    used = issued.Count(c => c.CampId == cp.Id && everUsed.Contains(c.Id)),
                    visits = VisitTally(uses.Where(u => usedCards.TryGetValue(u.CardId, out var c) && c.CampId == cp.Id)),
                }).OrderByDescending(x => x.date),
                byAgent = issued.Where(c => c.AgentId != null).GroupBy(c => c.AgentId!).Select(g => new
                {
                    agentId = g.Key, name = agents.GetValueOrDefault(g.Key) ?? g.Key, issued = g.Count(), used = g.Count(c => everUsed.Contains(c.Id)),
                }).OrderByDescending(x => x.issued),
                byKind = HealthCards.UseKinds.Select(k => new { kind = k, n = uses.Count(u => u.Kind == k), billed = uses.Where(u => u.Kind == k).Sum(u => u.BillAmount), discount = uses.Where(u => u.Kind == k).Sum(u => u.Discount) }).Where(x => x.n > 0),
            });
        }

        [HttpGet("export")]
        public async Task<IActionResult> Export(CancellationToken ct)
        {
            var cards = await _db.HealthCards.AsNoTracking().OrderBy(c => c.IssuedOn).ToListAsync(ct);
            var plans = await _db.HealthCardPlans.AsNoTracking().ToDictionaryAsync(p => p.Id, p => p.Name, ct);
            var uses = (await _db.HealthCardUses.AsNoTracking().Where(u => !u.Removed).Select(u => new { u.CardId, u.BillAmount, u.Discount }).ToListAsync(ct))
                .GroupBy(u => u.CardId).ToDictionary(g => g.Key, g => (N: g.Count(), Billed: g.Sum(x => x.BillAmount), Discount: g.Sum(x => x.Discount)));
            var camps = await _db.HealthCamps.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Title, ct);
            var agents = await _db.Agents.AsNoTracking().ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            static string c(string? v) => v == null ? "" : (v.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v);
            var sb = new StringBuilder("Card number,Card,Holder,Mobile,Age,Village,Block,Members,Given on,Valid till,Status,Given at,Camp,Agent,Visits,Billed,Discount given\n");
            var today = Today;
            foreach (var x in cards)
            {
                var members = string.Join("; ", HealthCards.Members(x.MembersJson).Select(m => m.Name + (m.Relation != null ? $" ({m.Relation})" : "")));
                var u = uses.GetValueOrDefault(x.Id);
                sb.Append(string.Join(",", c(x.Number), c(plans.GetValueOrDefault(x.PlanId)), c(x.HolderName), c(x.Phone), x.Age?.ToString(CultureInfo.InvariantCulture) ?? "", c(x.Village), c(x.Block), c(members),
                    x.IssuedOn.ToString("yyyy-MM-dd"), x.ValidTill.ToString("yyyy-MM-dd"), HealthCards.Status(x, today), x.Source,
                    c(x.CampId != null ? camps.GetValueOrDefault(x.CampId.Value) : null), c(x.AgentId != null ? agents.GetValueOrDefault(x.AgentId) : null),
                    u.N, HealthCards.Money(u.Billed), HealthCards.Money(u.Discount))).Append('\n');
            }
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"health-cards-{Today:yyyy-MM-dd}.csv");
        }
    }
}
