using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class CampDto
    {
        public string Title { get; set; } = string.Empty;
        public string? CampType { get; set; }
        public List<string>? Departments { get; set; }
        public List<string>? Doctors { get; set; }
        public DateOnly Date { get; set; }
        public string? StartTime { get; set; }
        public string? EndTime { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public string? PanchayatId { get; set; }
        public string? Venue { get; set; }
        public string? HostPartnerClientId { get; set; }
        public string? Status { get; set; }
        public int? Capacity { get; set; }
        public int? TargetRegistrations { get; set; }
        public int? TargetReferrals { get; set; }
        public decimal? Budget { get; set; }
        public decimal? Spent { get; set; }
        public string? Notes { get; set; }
        public string? Outcome { get; set; }
    }

    public class CampPatientDto
    {
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public int? Age { get; set; }
        public string? Sex { get; set; }
        public string? Village { get; set; }
        public string? Source { get; set; }
        public string? PartnerClientId { get; set; }
        public string? Slot { get; set; }
        public string? Status { get; set; }
        public string? Complaint { get; set; }
        public List<string>? Symptoms { get; set; }
        public List<string>? Conditions { get; set; }
        public int? BpSystolic { get; set; }
        public int? BpDiastolic { get; set; }
        public int? Sugar { get; set; }
        public decimal? WeightKg { get; set; }
        public int? Spo2 { get; set; }
        public string? Advice { get; set; }
        public bool? ReferToHospital { get; set; }
        public string? Department { get; set; }
        public bool? Urgent { get; set; }
        public bool? Consent { get; set; }
    }

    public class ChecklistDto { public List<CampBook.ChecklistItem> Items { get; set; } = new(); }

    /// <summary>
    /// Health camps: plan them (with a marketing checklist), pre-book people, record what each person came with and
    /// what was found, and send those who need the hospital to the Leads inbox for follow-up.
    /// </summary>
    [ApiController]
    [Route("api/v1/camps")]
    [Authorize]
    [PageAccess(Pages.Camps)]
    public class CampsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;
        private readonly INotifier _notifier;
        private readonly IPermissionService _perms;

        public CampsController(IMarketingDbContext db, IAppSettings settings, IConfiguration config, INotifier notifier, IPermissionService perms)
        {
            _db = db;
            _settings = settings;
            _config = config;
            _notifier = notifier;
            _perms = perms;
        }

        private static bool Time(string? s) => WaAutomation.ParseTime(s) != null;

        /// <summary>Choices for the forms: camp types, symptoms, conditions.</summary>
        [HttpGet("options")]
        public IActionResult Options() => Ok(new
        {
            types = CampBook.Types.Select(t => new { key = t, label = CampBook.TypeLabel(t) }),
            symptoms = CampBook.Symptoms.Select(s => new { code = s.Code, en = s.En, hi = s.Hi }),
            conditions = CampBook.Conditions.Select(s => new { code = s.Code, en = s.En, hi = s.Hi, dept = s.Dept }),
        });

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? when, [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            var all = _db.HealthCamps.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                all = all.Where(c => c.Title.ToLower().Contains(s) || c.Code.ToLower().Contains(s) || (c.Block != null && c.Block.ToLower().Contains(s)) || (c.Venue != null && c.Venue.ToLower().Contains(s)));
            }
            var counts = new
            {
                upcoming = await all.CountAsync(c => c.Date >= today && c.Status != "cancelled" && c.Status != "done", ct),
                past = await all.CountAsync(c => c.Date < today || c.Status == "done", ct),
                cancelled = await all.CountAsync(c => c.Status == "cancelled", ct),
            };
            var list = when switch
            {
                "past" => all.Where(c => (c.Date < today || c.Status == "done") && c.Status != "cancelled").OrderByDescending(c => c.Date),
                "cancelled" => all.Where(c => c.Status == "cancelled").OrderByDescending(c => c.Date),
                "all" => all.OrderByDescending(c => c.Date),
                _ => all.Where(c => c.Date >= today && c.Status != "cancelled" && c.Status != "done").OrderBy(c => c.Date),
            };
            var total = await list.CountAsync(ct);
            var rows = await list.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var ids = rows.Select(r => r.Id).ToList();
            var stats = await StatsAsync(ids, ct);
            return Ok(new { items = rows.Select(c => Row(c, stats.GetValueOrDefault(c.Id))), total, page, pageSize, counts });
        }

        public class Stat { public int Booked; public int Attended; public int Referred; public int Arrived; }

        private async Task<Dictionary<Guid, Stat>> StatsAsync(List<Guid> ids, CancellationToken ct)
        {
            var pts = await _db.CampPatients.AsNoTracking().Where(p => ids.Contains(p.CampId) && p.Status != "cancelled")
                .Select(p => new { p.CampId, p.Status, p.ReferToHospital, p.LeadId }).ToListAsync(ct);
            var leadIds = pts.Where(p => p.LeadId != null).Select(p => p.LeadId!.Value).Distinct().ToList();
            var arrived = leadIds.Count == 0 ? new HashSet<Guid>() : (await _db.Leads.AsNoTracking().Where(l => leadIds.Contains(l.Id) && (l.Status == "arrived" || l.Status == "admitted")).Select(l => l.Id).ToListAsync(ct)).ToHashSet();
            return pts.GroupBy(p => p.CampId).ToDictionary(g => g.Key, g => new Stat
            {
                Booked = g.Count(),
                Attended = g.Count(p => p.Status == "attended"),
                Referred = g.Count(p => p.ReferToHospital),
                Arrived = g.Count(p => p.ReferToHospital && p.LeadId != null && arrived.Contains(p.LeadId.Value)),
            });
        }

        private static object Row(HealthCamp c, Stat? s) => new
        {
            id = c.Id, title = c.Title, code = c.Code, campType = c.CampType, typeLabel = CampBook.TypeLabel(c.CampType),
            date = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime, district = c.District, block = c.Block, venue = c.Venue,
            status = c.Status, capacity = c.Capacity, targetRegistrations = c.TargetRegistrations, targetReferrals = c.TargetReferrals,
            budget = c.Budget, spent = c.Spent,
            booked = s?.Booked ?? 0, attended = s?.Attended ?? 0, referred = s?.Referred ?? 0, arrived = s?.Arrived ?? 0,
            checklistDone = CampBook.ReadChecklist(c).Count(i => i.Done), checklistTotal = CampBook.ReadChecklist(c).Count,
        };

        private string? Validate(CampDto d)
        {
            if (string.IsNullOrWhiteSpace(d.Title) || d.Title.Trim().Length > 120) return "Give the camp a name (up to 120 characters).";
            if (d.Date == default) return "Pick the date.";
            if (d.CampType != null && !CampBook.Types.Contains(d.CampType)) return "Unknown camp type.";
            if (d.StartTime != null && !Time(d.StartTime) || d.EndTime != null && !Time(d.EndTime)) return "Times look like 09:00.";
            if (d.Status != null && !CampBook.Statuses.Contains(d.Status)) return "Unknown status.";
            if (d.Capacity is < 0 or > 5000 || d.TargetRegistrations is < 0 or > 5000 || d.TargetReferrals is < 0 or > 5000) return "Numbers must be between 0 and 5,000.";
            if (d.Budget is < 0 || d.Spent is < 0) return "Amounts can't be negative.";
            return null;
        }

        private static void Apply(HealthCamp c, CampDto d)
        {
            c.Title = d.Title.Trim();
            c.CampType = d.CampType ?? c.CampType;
            if (d.Departments != null) c.Departments = d.Departments.Count == 0 ? null : string.Join(",", d.Departments.Select(x => x.Trim().Replace(",", " ")).Where(x => x.Length > 0).Distinct());
            if (d.Doctors != null) c.Doctors = d.Doctors.Count == 0 ? null : string.Join(",", d.Doctors.Select(x => x.Trim().Replace(",", " ")).Where(x => x.Length > 0).Distinct());
            c.Date = d.Date;
            c.StartTime = d.StartTime ?? c.StartTime;
            c.EndTime = d.EndTime ?? c.EndTime;
            c.District = d.District?.Trim() is { Length: > 0 } di ? di : c.District;
            c.Block = d.Block?.Trim() is { Length: > 0 } bl ? bl : c.Block;
            c.PanchayatId = d.PanchayatId ?? c.PanchayatId;
            c.Venue = d.Venue?.Trim() is { Length: > 0 } v ? v : c.Venue;
            c.HostPartnerClientId = d.HostPartnerClientId is { Length: > 0 } h ? h : d.HostPartnerClientId == "" ? null : c.HostPartnerClientId;
            c.Status = d.Status ?? c.Status;
            c.Capacity = d.Capacity ?? c.Capacity;
            c.TargetRegistrations = d.TargetRegistrations ?? c.TargetRegistrations;
            c.TargetReferrals = d.TargetReferrals ?? c.TargetReferrals;
            c.Budget = d.Budget ?? c.Budget;
            c.Spent = d.Spent ?? c.Spent;
            c.Notes = d.Notes ?? c.Notes;
            c.Outcome = d.Outcome ?? c.Outcome;
            c.UpdatedAt = DateTime.UtcNow;
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CampDto dto, CancellationToken ct)
        {
            var err = Validate(dto);
            if (err != null) return BadRequest(new { message = err });
            var c = new HealthCamp { CreatedBy = User.AgentIdOf(), CampType = "general" };
            Apply(c, dto);
            c.Code = await CampBook.NewCodeAsync(_db, c.Block ?? c.Venue ?? c.Title, c.Date, ct);
            c.ChecklistJson = CampBook.WriteChecklist(CampBook.DefaultChecklist(c.CampType));
            _db.HealthCamps.Add(c);
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = c.Id, code = c.Code });
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Update(Guid id, [FromBody] CampDto dto, CancellationToken ct)
        {
            var c = await _db.HealthCamps.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var err = Validate(dto);
            if (err != null) return BadRequest(new { message = err });
            Apply(c, dto);
            await _db.SaveChangesAsync(ct);
            // Date, place or status may have changed: keep the camp's counts in Disease data in step.
            await DiseaseRegister.SyncCampAsync(_db, id, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        [HttpGet("{id:guid}")]
        public async Task<IActionResult> Get(Guid id, CancellationToken ct)
        {
            var c = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            var stats = (await StatsAsync(new List<Guid> { id }, ct)).GetValueOrDefault(id);
            var host = c.HostPartnerClientId != null ? await _db.Contacts.AsNoTracking().Where(x => x.ClientId == c.HostPartnerClientId).Select(x => new { clientId = x.ClientId, x.Name, x.Role }).FirstOrDefaultAsync(ct) : null;
            var wa = LeadInbox.Wa(_settings, _config);
            var message = LeadInbox.QrMessage(wa, null, c.Code);
            var pts = await _db.CampPatients.AsNoTracking().Where(p => p.CampId == id && p.Status != "cancelled").ToListAsync(ct);
            var symptoms = pts.SelectMany(p => CampBook.Codes(p.Symptoms)).GroupBy(x => x).Select(g => new { code = g.Key, label = CampBook.SymptomLabel(g.Key), n = g.Count() }).OrderByDescending(x => x.n).ToList();
            var conditions = pts.SelectMany(p => CampBook.Codes(p.Conditions)).GroupBy(x => x).Select(g => new { code = g.Key, label = CampBook.ConditionLabel(g.Key), n = g.Count() }).OrderByDescending(x => x.n).ToList();
            var attended = pts.Where(p => p.Status == "attended").ToList();
            return Ok(new
            {
                camp = new
                {
                    id = c.Id, title = c.Title, code = c.Code, campType = c.CampType, typeLabel = CampBook.TypeLabel(c.CampType),
                    departments = CampBook.Codes(c.Departments), doctors = CampBook.Codes(c.Doctors),
                    date = c.Date.ToString("yyyy-MM-dd"), startTime = c.StartTime, endTime = c.EndTime,
                    district = c.District, block = c.Block, panchayatId = c.PanchayatId, venue = c.Venue, hostPartnerClientId = c.HostPartnerClientId,
                    status = c.Status, capacity = c.Capacity, targetRegistrations = c.TargetRegistrations, targetReferrals = c.TargetReferrals,
                    budget = c.Budget, spent = c.Spent, notes = c.Notes, outcome = c.Outcome, createdAt = c.CreatedAt,
                },
                host,
                checklist = CampBook.ReadChecklist(c),
                stats = new
                {
                    booked = stats?.Booked ?? 0, attended = stats?.Attended ?? 0, referred = stats?.Referred ?? 0, arrived = stats?.Arrived ?? 0,
                    prebooked = pts.Count(p => p.Source != "walk_in"), walkIn = pts.Count(p => p.Source == "walk_in"),
                    noShow = pts.Count(p => p.Status == "no_show"),
                    women = attended.Count(p => p.Sex == "F"), men = attended.Count(p => p.Sex == "M"),
                    over60 = attended.Count(p => p.Age >= 60), children = attended.Count(p => p.Age < 15),
                    highBp = attended.Count(p => p.BpSystolic >= 140 || p.BpDiastolic >= 90), highSugar = attended.Count(p => p.Sugar >= 200),
                    costPerAttendee = attended.Count > 0 && c.Spent > 0 ? Math.Round(c.Spent / attended.Count) : (decimal?)null,
                    costPerArrival = (stats?.Arrived ?? 0) > 0 && c.Spent > 0 ? Math.Round(c.Spent / stats!.Arrived) : (decimal?)null,
                },
                symptoms, conditions,
                link = new { message, waLink = LeadInbox.WaLink(wa, message), displayPhone = LeadInbox.DisplayPhone(wa), hospital = wa.HospitalName },
            });
        }

        [HttpPut("{id:guid}/checklist")]
        public async Task<IActionResult> SaveChecklist(Guid id, [FromBody] ChecklistDto dto, CancellationToken ct)
        {
            var c = await _db.HealthCamps.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            if (dto.Items.Count > 60) return BadRequest(new { message = "Up to 60 checklist items." });
            var old = CampBook.ReadChecklist(c).ToDictionary(i => i.Id);
            var me = User.AgentIdOf();
            foreach (var i in dto.Items)
            {
                i.Text = (i.Text ?? "").Trim();
                if (i.Text.Length == 0 || i.Text.Length > 300) return BadRequest(new { message = "Each item needs text (up to 300 characters)." });
                if (i.Phase is not ("before" or "week" or "day" or "after")) i.Phase = "before";
                var was = old.GetValueOrDefault(i.Id);
                if (i.Done && was?.Done != true) { i.DoneBy = me; i.DoneAt = DateTime.UtcNow; }
                else if (i.Done) { i.DoneBy = was!.DoneBy; i.DoneAt = was.DoneAt; }
                else { i.DoneBy = null; i.DoneAt = null; }
            }
            c.ChecklistJson = CampBook.WriteChecklist(dto.Items);
            c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        // ─── People at the camp ───
        [HttpGet("{id:guid}/patients")]
        public async Task<IActionResult> Patients(Guid id, [FromQuery] string? status, [FromQuery] string? q, [FromQuery] bool referred = false,
            [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);
            var all = _db.CampPatients.AsNoTracking().Where(p => p.CampId == id);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                var digits = new string(s.Where(char.IsDigit).ToArray());
                all = all.Where(p => p.Name.ToLower().Contains(s) || (p.Village != null && p.Village.ToLower().Contains(s)) || (digits.Length >= 3 && ((p.Phone != null && p.Phone.Contains(digits)) || p.Token.ToString() == digits)));
            }
            var counts = await all.GroupBy(p => p.Status).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
            var referredCount = await all.CountAsync(p => p.ReferToHospital, ct);
            var list = all;
            if (!string.IsNullOrWhiteSpace(status)) list = list.Where(p => p.Status == status);
            if (referred) list = list.Where(p => p.ReferToHospital);
            var total = await list.CountAsync(ct);
            var rows = await list.OrderBy(p => p.Token).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var pids = rows.Where(r => r.PartnerClientId != null).Select(r => r.PartnerClientId!).Distinct().ToList();
            var partners = pids.Count == 0 ? new Dictionary<string, string>() : await _db.Contacts.AsNoTracking().Where(c => pids.Contains(c.ClientId)).ToDictionaryAsync(c => c.ClientId, c => c.Name, ct);
            var lids = rows.Where(r => r.LeadId != null).Select(r => r.LeadId!.Value).ToList();
            var leads = lids.Count == 0 ? new Dictionary<Guid, string>() : await _db.Leads.AsNoTracking().Where(l => lids.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            return Ok(new
            {
                items = rows.Select(p => PatientRow(p, partners, leads)),
                total, page, pageSize, counts, referred = referredCount,
            });
        }

        private static object PatientRow(CampPatient p, Dictionary<string, string> partners, Dictionary<Guid, string> leads) => new
        {
            id = p.Id, token = p.Token, name = p.Name, phone = p.Phone, age = p.Age, sex = p.Sex, village = p.Village, source = p.Source,
            partnerClientId = p.PartnerClientId, partnerName = p.PartnerClientId != null ? partners.GetValueOrDefault(p.PartnerClientId) : null,
            slot = p.Slot, status = p.Status, arrivedAt = p.ArrivedAt, complaint = p.Complaint,
            symptoms = CampBook.Codes(p.Symptoms), conditions = CampBook.Codes(p.Conditions),
            bpSystolic = p.BpSystolic, bpDiastolic = p.BpDiastolic, sugar = p.Sugar, weightKg = p.WeightKg, spo2 = p.Spo2,
            advice = p.Advice, referToHospital = p.ReferToHospital, department = p.Department, urgent = p.Urgent, consent = p.Consent,
            leadId = p.LeadId, leadStatus = p.LeadId != null ? leads.GetValueOrDefault(p.LeadId.Value) : null,
            flags = CampBook.Flags(p),
        };

        private string? ApplyPatient(CampPatient p, CampPatientDto d)
        {
            if (d.Name != null) { var n = d.Name.Trim(); if (n.Length == 0 || n.Length > 120) return "Enter the person's name."; p.Name = n; }
            if (d.Phone != null)
            {
                if (d.Phone.Trim().Length == 0) p.Phone = null;
                else { var ph = LeadInbox.NormalizePhone(d.Phone); if (ph == null) return "Mobile number should be 10 digits."; p.Phone = ph; }
            }
            if (d.Age != null) { if (d.Age is < 0 or > 120) return "Age looks wrong."; p.Age = d.Age; }
            if (d.Sex != null) { if (d.Sex is not ("M" or "F" or "O" or "")) return "Unknown sex."; p.Sex = d.Sex == "" ? null : d.Sex; }
            if (d.Village != null) p.Village = d.Village.Trim().Length == 0 ? null : d.Village.Trim()[..Math.Min(80, d.Village.Trim().Length)];
            if (d.Source != null) { if (!CampBook.Sources.Contains(d.Source)) return "Unknown source."; p.Source = d.Source; }
            if (d.PartnerClientId != null) p.PartnerClientId = d.PartnerClientId.Length == 0 ? null : d.PartnerClientId;
            if (d.Slot != null) { if (d.Slot.Length > 0 && !Time(d.Slot)) return "Slot looks like 10:30."; p.Slot = d.Slot.Length == 0 ? null : d.Slot; }
            if (d.Status != null)
            {
                if (!CampBook.PatientStatuses.Contains(d.Status)) return "Unknown status.";
                if (d.Status == "attended" && p.Status != "attended") p.ArrivedAt = DateTime.UtcNow;
                p.Status = d.Status;
            }
            if (d.Complaint != null) p.Complaint = d.Complaint.Trim().Length == 0 ? null : d.Complaint.Trim()[..Math.Min(500, d.Complaint.Trim().Length)];
            if (d.Symptoms != null) p.Symptoms = CampBook.CleanCodes(d.Symptoms, CampBook.Symptoms.Select(s => s.Code));
            if (d.Conditions != null) p.Conditions = CampBook.CleanCodes(d.Conditions, CampBook.Conditions.Select(s => s.Code));
            if (d.BpSystolic != null) { if (d.BpSystolic is < 50 or > 300) return "BP (upper) looks wrong."; p.BpSystolic = d.BpSystolic; }
            if (d.BpDiastolic != null) { if (d.BpDiastolic is < 30 or > 200) return "BP (lower) looks wrong."; p.BpDiastolic = d.BpDiastolic; }
            if (d.Sugar != null) { if (d.Sugar is < 20 or > 800) return "Sugar looks wrong."; p.Sugar = d.Sugar; }
            if (d.WeightKg != null) { if (d.WeightKg is < 1 or > 300) return "Weight looks wrong."; p.WeightKg = d.WeightKg; }
            if (d.Spo2 != null) { if (d.Spo2 is < 50 or > 100) return "SpO2 looks wrong."; p.Spo2 = d.Spo2; }
            if (d.Advice != null) p.Advice = d.Advice.Trim().Length == 0 ? null : d.Advice.Trim()[..Math.Min(1000, d.Advice.Trim().Length)];
            if (d.ReferToHospital != null) p.ReferToHospital = d.ReferToHospital.Value;
            if (d.Department != null) p.Department = d.Department.Trim().Length == 0 ? null : d.Department.Trim();
            if (d.Urgent != null) p.Urgent = d.Urgent.Value;
            if (d.Consent != null) p.Consent = d.Consent.Value;
            p.UpdatedAt = DateTime.UtcNow;
            return null;
        }

        /// <summary>A booking before the day, or someone registering at the camp.</summary>
        [HttpPost("{id:guid}/patients")]
        public async Task<IActionResult> AddPatient(Guid id, [FromBody] CampPatientDto dto, CancellationToken ct)
        {
            var c = await _db.HealthCamps.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (c == null) return NotFound();
            if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest(new { message = "Enter the person's name." });
            var p = new CampPatient { CampId = id, CreatedBy = User.AgentIdOf(), Source = "walk_in", Status = "booked" };
            var err = ApplyPatient(p, dto);
            if (err != null) return BadRequest(new { message = err });
            if (p.Phone != null)
            {
                var dup = await _db.CampPatients.AsNoTracking().FirstOrDefaultAsync(x => x.CampId == id && x.Phone == p.Phone && x.Status != "cancelled" && x.Name == p.Name, ct);
                if (dup != null) return Ok(new { id = dup.Id, token = dup.Token, existed = true });
            }
            p.Token = await CampBook.NextTokenAsync(_db, id, ct);
            if (dto.Status == "attended") p.ArrivedAt = DateTime.UtcNow;
            _db.CampPatients.Add(p);
            await _db.SaveChangesAsync(ct);
            if (p.Status == "attended") { await DiseaseRegister.SyncCampAsync(_db, id, ct); await _db.SaveChangesAsync(ct); }
            return Ok(new { id = p.Id, token = p.Token, existed = false });
        }

        [HttpPatch("patients/{pid:guid}")]
        public async Task<IActionResult> UpdatePatient(Guid pid, [FromBody] CampPatientDto dto, CancellationToken ct)
        {
            var p = await _db.CampPatients.FirstOrDefaultAsync(x => x.Id == pid, ct);
            if (p == null) return NotFound();
            var err = ApplyPatient(p, dto);
            if (err != null) return BadRequest(new { message = err });
            // Referred to the hospital: make sure the desk follows up.
            if (p.ReferToHospital && p.LeadId == null && p.Phone != null && p.Consent) await FollowUpAsync(p, ct);
            await _db.SaveChangesAsync(ct);
            await DiseaseRegister.SyncCampAsync(_db, p.CampId, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true, leadId = p.LeadId, flags = CampBook.Flags(p) });
        }

        /// <summary>A person the doctor wants at the hospital becomes (or joins) a lead in the Leads inbox, tagged with the camp.</summary>
        private async Task FollowUpAsync(CampPatient p, CancellationToken ct)
        {
            var camp = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(c => c.Id == p.CampId, ct);
            var me = User.AgentIdOf();
            var now = DateTime.UtcNow;
            var found = string.Join(", ", CampBook.Codes(p.Conditions).Select(CampBook.ConditionLabel));
            var note = $"Health camp {camp?.Title}: {(found.Length > 0 ? found : p.Complaint ?? "needs a hospital visit")}" + (p.Advice != null ? $". Advice: {p.Advice}" : "");
            var lead = await _db.Leads.FirstOrDefaultAsync(l => l.Phone == p.Phone, ct);
            if (lead == null)
            {
                lead = new Lead
                {
                    Name = p.Name, Phone = p.Phone!, Source = "camp", SourceRef = camp?.Title, PartnerClientId = p.PartnerClientId,
                    Department = p.Department ?? CampBook.Codes(p.Conditions).Select(CampBook.DeptFor).FirstOrDefault(), Note = LeadInbox.Shorten(note, 500),
                    CreatedBy = me, CreatedAt = now, LastActivityAt = now, Status = "new",
                };
                _db.Leads.Add(lead);
                _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "created", By = me, CreatedAt = now, Text = $"Referred from {camp?.Title}" });
            }
            else
            {
                _db.LeadActivities.Add(new LeadActivity { LeadId = lead.Id, Kind = "note", By = me, CreatedAt = now, Text = note });
                if (!LeadInbox.Open.Contains(lead.Status)) { lead.Status = "new"; lead.ClosedAt = null; }
                lead.Department ??= p.Department;
                lead.PartnerClientId ??= p.PartnerClientId;
                lead.LastActivityAt = now;
            }
            p.LeadId = lead.Id;
            _notifier.Notify(new NotifyJob
            {
                To = await LeadInbox.DeskPeopleAsync(_db, _perms, ct), Except = me, Kind = "lead",
                Title = $"{(p.Urgent ? "Urgent: " : "")}{p.Name} referred from {camp?.Title}", Body = LeadInbox.Shorten(note, 200), Link = $"lead:{lead.Id}", RefId = lead.Id.ToString(),
            });
        }

        // ─── Across all camps ───
        /// <summary>What camps find, where, and how many people they bring to the hospital: to plan the next ones.</summary>
        [HttpGet("insights")]
        public async Task<IActionResult> Insights([FromQuery] int days = 365, CancellationToken ct = default)
        {
            days = Math.Clamp(days, 7, 3650);
            var from = DateOnly.FromDateTime(IstClock.NowIst.AddDays(-days));
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= from && c.Status != "cancelled").ToListAsync(ct);
            var ids = camps.Select(c => c.Id).ToList();
            var pts = await _db.CampPatients.AsNoTracking().Where(p => ids.Contains(p.CampId) && p.Status == "attended")
                .Select(p => new { p.CampId, p.Symptoms, p.Conditions, p.Age, p.Sex, p.ReferToHospital, p.LeadId, p.Source }).ToListAsync(ct);
            var leadIds = pts.Where(p => p.LeadId != null).Select(p => p.LeadId!.Value).Distinct().ToList();
            var arrived = leadIds.Count == 0 ? new HashSet<Guid>() : (await _db.Leads.AsNoTracking().Where(l => leadIds.Contains(l.Id) && (l.Status == "arrived" || l.Status == "admitted")).Select(l => l.Id).ToListAsync(ct)).ToHashSet();
            var byCamp = camps.ToDictionary(c => c.Id);
            var stats = await StatsAsync(ids, ct);

            var condByBlock = pts.SelectMany(p => CampBook.Codes(p.Conditions).Select(code => new { block = byCamp[p.CampId].Block ?? "—", code }))
                .GroupBy(x => x.block).Select(g => new
                {
                    block = g.Key,
                    top = g.GroupBy(x => x.code).OrderByDescending(x => x.Count()).Take(3).Select(x => new { code = x.Key, label = CampBook.ConditionLabel(x.Key), n = x.Count() }),
                    total = g.Count(),
                }).OrderByDescending(x => x.total).ToList();

            return Ok(new
            {
                camps = camps.Count,
                attended = pts.Count,
                referred = pts.Count(p => p.ReferToHospital),
                arrived = pts.Count(p => p.ReferToHospital && p.LeadId != null && arrived.Contains(p.LeadId.Value)),
                prebookedShare = pts.Count > 0 ? Math.Round(100.0 * pts.Count(p => p.Source != "walk_in") / pts.Count) : 0,
                spent = camps.Sum(c => c.Spent),
                symptoms = pts.SelectMany(p => CampBook.Codes(p.Symptoms)).GroupBy(x => x).Select(g => new { code = g.Key, label = CampBook.SymptomLabel(g.Key), n = g.Count() }).OrderByDescending(x => x.n).Take(15),
                conditions = pts.SelectMany(p => CampBook.Codes(p.Conditions)).GroupBy(x => x).Select(g => new { code = g.Key, label = CampBook.ConditionLabel(g.Key), dept = CampBook.DeptFor(g.Key), n = g.Count() }).OrderByDescending(x => x.n).Take(15),
                byBlock = condByBlock,
                byType = camps.GroupBy(c => c.CampType).Select(g => new
                {
                    type = g.Key, label = CampBook.TypeLabel(g.Key), camps = g.Count(),
                    attended = g.Sum(c => stats.GetValueOrDefault(c.Id)?.Attended ?? 0),
                    referred = g.Sum(c => stats.GetValueOrDefault(c.Id)?.Referred ?? 0),
                    arrived = g.Sum(c => stats.GetValueOrDefault(c.Id)?.Arrived ?? 0),
                    spent = g.Sum(c => c.Spent),
                }).OrderByDescending(x => x.arrived),
                ages = new
                {
                    children = pts.Count(p => p.Age < 15), adults = pts.Count(p => p.Age >= 15 && p.Age < 60), over60 = pts.Count(p => p.Age >= 60),
                    women = pts.Count(p => p.Sex == "F"), men = pts.Count(p => p.Sex == "M"),
                },
            });
        }
    }
}
