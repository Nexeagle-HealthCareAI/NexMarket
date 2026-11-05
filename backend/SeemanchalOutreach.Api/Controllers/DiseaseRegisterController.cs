using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class DiseaseRowDto
    {
        public string? Date { get; set; }
        public string? Disease { get; set; }
        public string? Age { get; set; }
        public string? Sex { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public string? Panchayat { get; set; }
        public string? Count { get; set; }
    }

    public class DiseaseSaveDto
    {
        public List<DiseaseRowDto> Rows { get; set; } = new();
        public string? Source { get; set; }          // grid | upload
        public Guid? CampId { get; set; }
        /// <summary>true: only check the rows and say what would be saved.</summary>
        public bool DryRun { get; set; }
    }

    /// <summary>
    /// The disease register on the Health camps board: counts of people seen with a disease by date, age group, gender
    /// and place. Rows are typed into a grid or uploaded from Excel/CSV. No names or phone numbers are taken.
    /// </summary>
    [ApiController]
    [Route("api/v1/camps/disease")]
    [Authorize]
    [PageAccess(Pages.Camps)]
    public class DiseaseRegisterController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        public DiseaseRegisterController(IMarketingDbContext db) { _db = db; }

        private static DateOnly TodayIst => DateOnly.FromDateTime(IstClock.NowIst);

        /// <summary>Lists for the grid's drop-downs: known diseases, age groups, and places.</summary>
        [HttpGet("options")]
        public async Task<IActionResult> Options(CancellationToken ct)
        {
            var places = await DiseaseRegister.PlacesAsync(_db, ct);
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Status != "cancelled").OrderByDescending(c => c.Date).Take(60)
                .Select(c => new { id = c.Id, title = c.Title, date = c.Date, block = c.Block }).ToListAsync(ct);
            return Ok(new
            {
                today = TodayIst,
                conditions = CampBook.Conditions.Where(c => c.Code != "other").Select(c => new { code = c.Code, en = c.En, hi = c.Hi, dept = c.Dept }),
                ageBands = DiseaseRegister.AgeBands.Select(a => new { key = a, label = DiseaseRegister.AgeLabel(a) }),
                districts = places.GroupBy(p => p.District).OrderBy(g => g.Key).Select(g => new
                {
                    name = g.Key,
                    blocks = g.GroupBy(p => p.Block).OrderBy(b => b.Key).Select(b => new { name = b.Key, panchayats = b.OrderBy(p => p.Name).Select(p => new { id = p.Id, name = p.Name }) }),
                }),
                camps,
                maxRows = DiseaseRegister.MaxRows,
            });
        }

        /// <summary>
        /// Checks every row and saves them together, or none if any row has a problem (so the grid can show which cells to fix).
        /// </summary>
        [HttpPost("rows")]
        public async Task<IActionResult> Save([FromBody] DiseaseSaveDto dto, CancellationToken ct)
        {
            var rows = dto.Rows ?? new();
            if (rows.Count == 0) return BadRequest(new { message = "Add at least one row." });
            if (rows.Count > DiseaseRegister.MaxRows) return BadRequest(new { message = $"Up to {DiseaseRegister.MaxRows} rows at a time. Split the file and upload it in parts." });
            if (dto.CampId != null && !await _db.HealthCamps.AnyAsync(c => c.Id == dto.CampId, ct)) return BadRequest(new { message = "That camp wasn't found." });

            var places = await DiseaseRegister.PlacesAsync(_db, ct);
            string norm(string? s) => (s ?? "").Trim().ToLowerInvariant();
            var blocks = places.GroupBy(p => (d: norm(p.District), b: norm(p.Block))).ToDictionary(g => g.Key, g => (district: g.First().District, block: g.First().Block, list: g.ToList()));
            var blocksByName = places.GroupBy(p => norm(p.Block)).ToDictionary(g => g.Key, g => g.Select(p => (p.District, p.Block)).Distinct().ToList());
            var districts = places.Select(p => p.District).Distinct().ToDictionary(norm, x => x);

            var today = TodayIst;
            var errors = new List<object>();
            var ok = new List<DiseaseRecord>();
            var batch = Guid.NewGuid();
            var me = User.AgentIdOf();
            var source = dto.Source == "upload" ? "upload" : "grid";

            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                var bad = new Dictionary<string, string>();
                bool blank = string.IsNullOrWhiteSpace(r.Disease) && string.IsNullOrWhiteSpace(r.Age) && string.IsNullOrWhiteSpace(r.Sex)
                    && string.IsNullOrWhiteSpace(r.Block) && string.IsNullOrWhiteSpace(r.Panchayat) && string.IsNullOrWhiteSpace(r.District);
                if (blank) continue; // empty lines in a sheet are skipped

                var date = DiseaseRegister.ParseDate(r.Date, today);
                if (date == null) bad["date"] = "Use a date like 05/11/2026.";
                else if (date > today) bad["date"] = "This date is in the future.";
                else if (date < new DateOnly(2015, 1, 1)) bad["date"] = "This date is too far back.";

                var disease = (r.Disease ?? "").Trim();
                if (disease.Length == 0) bad["disease"] = "Enter the disease or complaint.";
                else if (disease.Length > 80) bad["disease"] = "Keep it under 80 characters.";
                var code = DiseaseRegister.MatchCondition(disease);

                var age = DiseaseRegister.ParseAge(r.Age);
                if (age == null) bad["age"] = "Enter an age (e.g. 42) or a group: 0-5, 6-14, 15-29, 30-44, 45-59, 60+.";
                var sex = DiseaseRegister.ParseSex(r.Sex);
                if (sex == null) bad["sex"] = "Use M, F or O.";

                int count = 1;
                if (!string.IsNullOrWhiteSpace(r.Count) && (!int.TryParse(r.Count.Trim(), out count) || count < 1 || count > DiseaseRegister.MaxCount))
                    bad["count"] = $"Use a whole number from 1 to {DiseaseRegister.MaxCount}.";

                // Place: district and block must be known; the panchayat is matched by name when it can be.
                string? district = null, block = null, panchayatId = null, panchayatText = null;
                var dn = norm(r.District); var bn = norm(r.Block); var pn = norm(r.Panchayat);
                if (bn.Length == 0 && pn.Length == 0) bad["block"] = "Enter the block (and the panchayat if you know it).";
                else
                {
                    if (bn.Length > 0)
                    {
                        if (dn.Length > 0 && blocks.TryGetValue((dn, bn), out var hit)) { district = hit.district; block = hit.block; }
                        else if (blocksByName.TryGetValue(bn, out var named) && (dn.Length == 0 || named.Count == 1))
                        {
                            if (named.Count > 1) bad["district"] = "This block name is in more than one district. Enter the district.";
                            else if (dn.Length > 0 && norm(named[0].District) != dn) bad["district"] = $"{named[0].Block} is in {named[0].District}.";
                            else { district = named[0].District; block = named[0].Block; }
                        }
                        else bad["block"] = dn.Length > 0 && !districts.ContainsKey(dn) ? "Unknown district and block." : "Unknown block. Pick one from the list.";
                    }
                    if (pn.Length > 0)
                    {
                        var pool = block != null ? blocks[(norm(district), norm(block))].list : places.Where(p => dn.Length == 0 || norm(p.District) == dn).ToList();
                        var m = pool.Where(p => norm(p.Name) == pn).ToList();
                        if (m.Count == 1) { panchayatId = m[0].Id; block ??= m[0].Block; district ??= m[0].District; bad.Remove("block"); }
                        else if (m.Count > 1 && block == null) bad["block"] = "This panchayat name is in more than one block. Enter the block.";
                        else if (block != null) panchayatText = r.Panchayat!.Trim()[..Math.Min(80, r.Panchayat.Trim().Length)]; // kept as typed; counted in its block
                        else bad["panchayat"] = "Unknown panchayat. Enter its block too.";
                    }
                }

                if (bad.Count > 0) { errors.Add(new { row = i, fields = bad }); continue; }
                ok.Add(new DiseaseRecord
                {
                    Date = date!.Value, Disease = code != null ? CampBook.ConditionLabel(code) : disease, ConditionCode = code,
                    AgeBand = age!, Sex = sex!, District = district, Block = block, PanchayatId = panchayatId, Panchayat = panchayatText,
                    Count = count, CampId = dto.CampId, Source = source, BatchId = batch, CreatedBy = me,
                });
            }

            var summary = new
            {
                rows = ok.Count,
                cases = ok.Sum(x => x.Count),
                unmatchedDisease = ok.Where(x => x.ConditionCode == null).Select(x => x.Disease).Distinct().Take(20),
                unmatchedPanchayat = ok.Where(x => x.Panchayat != null).Select(x => x.Panchayat).Distinct().Take(20),
            };
            if (errors.Count > 0) return UnprocessableEntity(new { message = $"{errors.Count} row{(errors.Count == 1 ? " needs" : "s need")} fixing. Nothing was saved.", errors, summary });
            if (ok.Count == 0) return BadRequest(new { message = "All the rows are empty." });
            if (dto.DryRun) return Ok(new { ok = true, dryRun = true, summary });

            _db.DiseaseRecords.AddRange(ok);
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true, batchId = batch, summary });
        }

        private static DateOnly? D(string? s) => DateOnly.TryParse(s, out var d) ? d : null;

        /// <summary>The register as a table, newest first.</summary>
        [HttpGet("rows")]
        public async Task<IActionResult> List([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? district, [FromQuery] string? block,
            [FromQuery] string? panchayatId, [FromQuery] string? disease, [FromQuery] string? sex, [FromQuery] string? ageBand, [FromQuery] Guid? campId,
            [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
        {
            page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 10, 200);
            var q = DiseaseRegister.Filter(_db.DiseaseRecords.AsNoTracking(), D(from), D(to), district, block, panchayatId, disease, sex, ageBand, campId);
            var total = await q.CountAsync(ct);
            var cases = (await q.Select(r => r.Count).ToListAsync(ct)).Sum();
            var items = await q.OrderByDescending(r => r.Date).ThenByDescending(r => r.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
            var pids = items.Select(r => r.PanchayatId).Where(x => x != null).Distinct().ToList();
            var pnames = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
            var who = items.Select(r => r.CreatedBy).Distinct().ToList();
            var names = await _db.Agents.AsNoTracking().Where(a => who.Contains(a.AgentId)).ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            var campIds = items.Select(r => r.CampId).Where(x => x != null).Distinct().ToList();
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => campIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Title, ct);
            return Ok(new
            {
                total, cases, page, pageSize,
                items = items.Select(r => new
                {
                    id = r.Id, date = r.Date, disease = r.Disease, matched = r.ConditionCode != null, ageBand = r.AgeBand, age = DiseaseRegister.AgeLabel(r.AgeBand),
                    sex = r.Sex, district = r.District, block = r.Block, panchayatId = r.PanchayatId,
                    panchayat = r.PanchayatId != null ? pnames.GetValueOrDefault(r.PanchayatId) : r.Panchayat, panchayatMatched = r.PanchayatId != null,
                    count = r.Count, camp = r.CampId != null ? camps.GetValueOrDefault(r.CampId.Value) : null, source = r.Source, batchId = r.BatchId,
                    by = names.GetValueOrDefault(r.CreatedBy) ?? r.CreatedBy, at = r.CreatedAt,
                }),
            });
        }

        /// <summary>The filtered register as a CSV file (no names: there are none to give).</summary>
        [HttpGet("export.csv")]
        public async Task<IActionResult> Export([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? district, [FromQuery] string? block,
            [FromQuery] string? panchayatId, [FromQuery] string? disease, [FromQuery] string? sex, [FromQuery] string? ageBand, [FromQuery] Guid? campId, CancellationToken ct)
        {
            var q = DiseaseRegister.Filter(_db.DiseaseRecords.AsNoTracking(), D(from), D(to), district, block, panchayatId, disease, sex, ageBand, campId);
            var rows = await q.OrderByDescending(r => r.Date).Take(50000).ToListAsync(ct);
            var pnames = await _db.Panchayats.AsNoTracking().ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
            static string c(string? s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
            var sb = new StringBuilder("Date,Disease,Age group,Gender,District,Block,Panchayat,Count\n");
            foreach (var r in rows)
                sb.Append(string.Join(",", c(r.Date.ToString("yyyy-MM-dd")), c(r.Disease), c(r.AgeBand == "unknown" ? "" : r.AgeBand), c(r.Sex == "U" ? "" : r.Sex),
                    c(r.District), c(r.Block), c(r.PanchayatId != null ? pnames.GetValueOrDefault(r.PanchayatId) : r.Panchayat), r.Count.ToString())).Append('\n');
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"disease-register-{TodayIst:yyyy-MM-dd}.csv");
        }

        /// <summary>Brings every camp's patient register into Disease data (counts only). Safe to run again: rows are updated in place.</summary>
        [HttpPost("sync-camps")]
        public async Task<IActionResult> SyncCamps(CancellationToken ct)
        {
            var ids = await _db.CampPatients.AsNoTracking().Where(p => p.Status == "attended").Select(p => p.CampId).Distinct().ToListAsync(ct);
            var stale = await _db.DiseaseRecords.AsNoTracking().Where(r => r.Source == "camp" && r.Status == "active" && r.CampId != null).Select(r => r.CampId!.Value).Distinct().ToListAsync(ct);
            foreach (var id in ids.Union(stale)) await DiseaseRegister.SyncCampAsync(_db, id, ct);
            await _db.SaveChangesAsync(ct);
            var people = await _db.CampPatients.CountAsync(p => p.Status == "attended", ct);
            return Ok(new { camps = ids.Count, people });
        }

        /// <summary>Takes a wrong row out of the counts. It is kept, marked removed, and can be seen in the change history.</summary>
        [HttpPost("rows/{id:guid}/remove")]
        public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
        {
            var r = await _db.DiseaseRecords.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (r == null) return NotFound(new { message = "Row not found." });
            if (r.Status != "active") return Ok(new { ok = true });
            if (r.Source == "camp") return BadRequest(new { message = "This row comes from the camp's patient register. Correct the person there and it updates here." });
            r.Status = "removed"; r.RemovedBy = User.AgentIdOf(); r.RemovedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        /// <summary>Undo a whole upload or save: every row saved with it is taken out of the counts.</summary>
        [HttpPost("batches/{batchId:guid}/remove")]
        public async Task<IActionResult> RemoveBatch(Guid batchId, CancellationToken ct)
        {
            var rows = await _db.DiseaseRecords.Where(x => x.BatchId == batchId && x.Status == "active").ToListAsync(ct);
            var me = User.AgentIdOf(); var now = DateTime.UtcNow;
            foreach (var r in rows) { r.Status = "removed"; r.RemovedBy = me; r.RemovedAt = now; }
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true, removed = rows.Count });
        }

        /// <summary>The register added up: by disease, age group, gender, place and month.</summary>
        [HttpGet("patterns")]
        public async Task<IActionResult> Patterns([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? district, [FromQuery] string? block,
            [FromQuery] string? disease, [FromQuery] string? sex, [FromQuery] string? ageBand, [FromQuery] Guid? campId, CancellationToken ct)
        {
            var rows = await DiseaseRegister.Filter(_db.DiseaseRecords.AsNoTracking(), D(from), D(to), district, block, null, disease, sex, ageBand, campId).ToListAsync(ct);
            var places = await DiseaseRegister.PlacesAsync(_db, ct);
            return Ok(DiseaseRegister.Patterns(rows, places));
        }
    }
}
