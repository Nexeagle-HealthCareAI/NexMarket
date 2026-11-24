using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The disease register: rows of "how many people, of what age group and gender, from where, with what, on which day".
    /// No names or phone numbers are kept. This class reads what people type or upload, and adds the rows up.
    /// </summary>
    public static class DiseaseRegister
    {
        public static readonly string[] AgeBands = { "0-5", "6-14", "15-29", "30-44", "45-59", "60+" };
        public const int MaxRows = 2000;
        public const int MaxCount = 10000;

        public static string AgeLabel(string band) => band switch
        {
            "0-5" => "0–5 yrs", "6-14" => "6–14 yrs", "15-29" => "15–29 yrs", "30-44" => "30–44 yrs", "45-59" => "45–59 yrs", "60+" => "60+ yrs", _ => "Age not noted",
        };
        public static string SexLabel(string s) => s switch { "M" => "Male", "F" => "Female", "O" => "Other", _ => "Not noted" };

        public static string BandFor(int age) => age <= 5 ? "0-5" : age <= 14 ? "6-14" : age <= 29 ? "15-29" : age <= 44 ? "30-44" : age <= 59 ? "45-59" : "60+";

        /// <summary>"42", "30-44", "30 to 44", "60+", "60 plus" → an age band. Blank → unknown. Otherwise null (not understood).</summary>
        public static string? ParseAge(string? raw)
        {
            var s = (raw ?? "").Trim().ToLowerInvariant().Replace("yrs", "").Replace("years", "").Replace("yr", "").Replace("साल", "").Trim();
            if (s.Length == 0) return "unknown";
            if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n is >= 0 and <= 120 ? BandFor(n) : null;
            if (decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var dn) && dn is >= 0 and <= 120) return BandFor((int)dn);
            var plus = Regex.Match(s, @"^(\d{1,3})\s*(\+|plus|and above|above)$");
            if (plus.Success) return BandFor(int.Parse(plus.Groups[1].Value));
            var range = Regex.Match(s, @"^(\d{1,3})\s*(-|–|to)\s*(\d{1,3})$");
            if (range.Success)
            {
                int a = int.Parse(range.Groups[1].Value), b = int.Parse(range.Groups[3].Value);
                if (a > b || b > 120) return null;
                // A range must sit inside one band; otherwise it would be counted in the wrong group.
                var ba = BandFor(a); return BandFor(b) == ba ? ba : null;
            }
            return null;
        }

        /// <summary>M/F/O, male/female, पुरुष/महिला… Blank → U (not noted). Otherwise null.</summary>
        public static string? ParseSex(string? raw)
        {
            var s = (raw ?? "").Trim().ToLowerInvariant();
            if (s.Length == 0) return "U";
            if (s is "m" or "male" or "man" or "boy" or "पुरुष" or "लड़का" or "mard" or "purush") return "M";
            if (s is "f" or "female" or "woman" or "girl" or "महिला" or "स्त्री" or "लड़की" or "aurat" or "mahila") return "F";
            if (s is "o" or "other" or "others" or "transgender" or "अन्य") return "O";
            if (s is "u" or "unknown" or "not noted" or "-" or "—") return "U";
            return null;
        }

        /// <summary>yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, or "today"/blank (→ today). India time.</summary>
        public static DateOnly? ParseDate(string? raw, DateOnly today)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0 || s.Equals("today", StringComparison.OrdinalIgnoreCase)) return today;
            string[] formats = { "yyyy-MM-dd", "yyyy-M-d", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yy", "d/M/yy", "d MMM yyyy", "d MMMM yyyy", "dd-MMM-yyyy", "d-MMM-yy" };
            if (DateOnly.TryParseExact(s, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
            return null;
        }

        private static readonly (string Code, string[] Words)[] Aliases =
        {
            ("hypertension", new[] { "bp", "high bp", "hypertension", "blood pressure", "हाई बीपी", "बीपी" }),
            ("diabetes", new[] { "sugar", "diabetes", "dm", "शुगर", "मधुमेह", "madhumeh" }),
            ("anaemia", new[] { "anemia", "anaemia", "khoon ki kami", "खून की कमी" }),
            ("arthritis", new[] { "arthritis", "joint pain", "knee pain", "joint / knee pain", "gathiya", "गठिया", "जोड़ों का दर्द" }),
            ("spine", new[] { "back pain", "spine", "disc", "kamar dard", "कमर दर्द" }),
            ("cataract", new[] { "cataract", "motiyabind", "मोतियाबिंद" }),
            ("eyesight", new[] { "glasses", "spectacles", "eyesight", "chashma", "चश्मा", "refractive error" }),
            ("tb_suspect", new[] { "tb", "tuberculosis", "टीबी" }),
            ("asthma_copd", new[] { "asthma", "copd", "dama", "दमा", "breathlessness" }),
            ("heart", new[] { "heart", "cardiac", "दिल" }),
            ("kidney", new[] { "kidney", "किडनी", "renal" }),
            ("stone", new[] { "stone", "pathri", "पथरी", "gall stone", "kidney stone" }),
            ("thyroid", new[] { "thyroid", "थायरॉइड" }),
            ("gastric", new[] { "gastric", "acidity", "liver", "gas", "jaundice", "पेट" }),
            ("hernia_piles", new[] { "hernia", "piles", "बवासीर", "हर्निया", "fissure", "fistula" }),
            ("gynae", new[] { "gynae", "gynaecology", "women's health", "white discharge", "period", "स्त्री रोग" }),
            ("anc", new[] { "anc", "pregnancy", "pregnant", "गर्भावस्था" }),
            ("child", new[] { "malnutrition", "child health", "kuposhan", "कुपोषण" }),
            ("skin", new[] { "skin", "itching", "fungal", "scabies", "चर्म रोग", "खुजली" }),
            ("dental", new[] { "dental", "tooth", "teeth", "दांत" }),
            ("ent", new[] { "ent", "ear", "nose", "throat", "कान" }),
            ("neuro", new[] { "stroke", "paralysis", "lakwa", "लकवा", "nerve", "epilepsy" }),
        };

        /// <summary>A known condition for what was typed (its code, English or Hindi name, or a common word), or null.</summary>
        public static string? MatchCondition(string text)
        {
            var s = text.Trim().ToLowerInvariant();
            if (s.Length == 0) return null;
            foreach (var c in CampBook.Conditions)
                if (c.Code == s || c.En.ToLowerInvariant() == s || c.Hi == text.Trim() || c.En.ToLowerInvariant().Split(" / ").Contains(s)) return c.Code == "other" ? null : c.Code;
            foreach (var (code, words) in Aliases)
                if (words.Contains(s)) return code;
            return null;
        }

        // ── One person's readings, as on the printed camp sheet ────────────────────

        /// <summary>What was read from the cells. Values are null when the cell was blank.</summary>
        public sealed record Readings(int? BpSystolic, int? BpDiastolic, int? Sugar, decimal? WeightKg, decimal? HeightCm, int? Spo2, int? Pulse, decimal? TempF)
        {
            public bool Any => BpSystolic != null || Sugar != null || WeightKg != null || HeightCm != null || Spo2 != null || Pulse != null || TempF != null;
        }

        private static string Bare(string? raw) =>
            Regex.Replace((raw ?? "").Trim().ToLowerInvariant(), @"\s*(mm\s*hg|mg\s*/\s*dl|mg/dl|kgs?|cms?|bpm|/\s*min|%|°\s*[fc]|deg\s*[fc]?)\s*$", "").Trim();

        private static bool Num(string s, out decimal v) => decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out v);

        /// <summary>
        /// Reads BP ("130/85"), sugar, weight, height (cm, or feet and inches like 5'4"), SpO2, pulse and temperature
        /// (°F; a value up to 45 is taken as °C and turned into °F). Units typed after the number are ignored. Each cell
        /// that can't be read, or is outside what a person can have, gets a message for the grid.
        /// </summary>
        public static (Readings Value, Dictionary<string, string> Bad) ParseReadings(string? bp, string? sugar, string? weight, string? height, string? spo2, string? pulse, string? temp)
        {
            var bad = new Dictionary<string, string>();
            int? sys = null, dia = null, sug = null, sp = null, pu = null;
            decimal? wt = null, ht = null, tf = null;

            var b = Bare(bp);
            if (b.Length > 0)
            {
                var m = Regex.Match(b, @"^(\d{2,3})\s*[/\\\-\s]\s*(\d{2,3})$");
                if (!m.Success) bad["bp"] = "Write BP as upper/lower, e.g. 130/85.";
                else
                {
                    int x = int.Parse(m.Groups[1].Value), y = int.Parse(m.Groups[2].Value);
                    if (x is < 60 or > 260 || y is < 30 or > 160) bad["bp"] = "That BP can't be right: upper 60–260, lower 30–160.";
                    else if (y >= x) bad["bp"] = "The upper number comes first and is bigger, e.g. 130/85.";
                    else { sys = x; dia = y; }
                }
            }
            var s = Bare(sugar);
            if (s.Length > 0)
            {
                if (!Num(s, out var v) || v != Math.Round(v)) bad["sugar"] = "Write sugar as a whole number in mg/dL, e.g. 140.";
                else if (v is < 20 or > 700) bad["sugar"] = "Sugar should be 20–700 mg/dL.";
                else sug = (int)v;
            }
            var w = Bare(weight);
            if (w.Length > 0)
            {
                if (!Num(w, out var v)) bad["weight"] = "Write weight in kg, e.g. 62.5.";
                else if (v is < 1 or > 250) bad["weight"] = "Weight should be 1–250 kg.";
                else wt = Math.Round(v, 1);
            }
            var h = (height ?? "").Trim().ToLowerInvariant();
            if (h.Length > 0)
            {
                var ft = Regex.Match(h, @"^(\d)\s*(?:'|ft|feet|foot)\s*(?:(\d{1,2})\s*(?:""|in|inch|inches)?)?$");
                decimal v;
                if (ft.Success) v = Math.Round((int.Parse(ft.Groups[1].Value) * 12 + (ft.Groups[2].Success ? int.Parse(ft.Groups[2].Value) : 0)) * 2.54m, 1);
                else if (!Num(Bare(h), out v)) { bad["height"] = "Write height in cm, e.g. 160, or feet like 5'4\"."; v = -1; }
                if (!bad.ContainsKey("height"))
                {
                    if (v is < 30 or > 230) bad["height"] = "Height should be 30–230 cm.";
                    else ht = Math.Round(v, 1);
                }
            }
            var o = Bare(spo2);
            if (o.Length > 0)
            {
                if (!Num(o, out var v) || v != Math.Round(v)) bad["spo2"] = "Write SpO2 as a whole number, e.g. 97.";
                else if (v is < 50 or > 100) bad["spo2"] = "SpO2 should be 50–100%.";
                else sp = (int)v;
            }
            var p = Bare(pulse);
            if (p.Length > 0)
            {
                if (!Num(p, out var v) || v != Math.Round(v)) bad["pulse"] = "Write the pulse as beats a minute, e.g. 78.";
                else if (v is < 30 or > 220) bad["pulse"] = "Pulse should be 30–220 a minute.";
                else pu = (int)v;
            }
            var t = Bare(temp);
            if (t.Length > 0)
            {
                if (!Num(t, out var v)) bad["temp"] = "Write the temperature, e.g. 98.6 (°F) or 37 (°C).";
                else
                {
                    if (v <= 45) v = v * 9 / 5 + 32;   // °C
                    if (v is < 90 or > 110) bad["temp"] = "Temperature should be 90–110 °F (32–43 °C).";
                    else tf = Math.Round(v, 1);
                }
            }
            return (new Readings(sys, dia, sug, wt, ht, sp, pu, tf), bad);
        }

        public static decimal? Bmi(decimal? kg, decimal? cm) => kg is decimal w && cm is decimal h && h > 0 ? Math.Round(w / (h / 100m * h / 100m), 1) : null;

        /// <summary>
        /// The readings added up, for the patterns page: how many were measured, how many were outside the usual range
        /// (BP 140/90 or more, random sugar 200 or more, SpO2 under 94, temperature 100.4 °F or more, pulse over 100 or under 60,
        /// BMI under 18.5 or 25 and over, adults only), averages, and the same by age group. Only rows for one person carry readings.
        /// </summary>
        public static object ReadingsSummary(List<DiseaseRecord> rows)
        {
            // A person may be on several rows (one per disease) with the same readings: count each reading once per person.
            var people = rows.Where(r => r.Count == 1 && (r.BpSystolic != null || r.Sugar != null || r.WeightKg != null || r.HeightCm != null || r.Spo2 != null || r.Pulse != null || r.TempF != null))
                .GroupBy(r => (r.BatchId, r.Date, r.AgeBand, r.Sex, r.PanchayatId ?? r.Panchayat ?? r.Block, r.BpSystolic, r.BpDiastolic, r.Sugar, r.WeightKg, r.HeightCm, r.Spo2, r.Pulse, r.TempF))
                .Select(g => g.First()).ToList();
            bool HighBp(DiseaseRecord r) => r.BpSystolic >= 140 || r.BpDiastolic >= 90;
            bool HighSugar(DiseaseRecord r) => r.Sugar >= 200;
            bool LowSpo2(DiseaseRecord r) => r.Spo2 < 94;
            static double? Avg(IEnumerable<decimal?> xs) { var l = xs.Where(x => x != null).Select(x => (double)x!.Value).ToList(); return l.Count == 0 ? null : Math.Round(l.Average(), 1); }
            // Adult cut-offs: children's BMI needs growth charts, so 0–14 are left out of the BMI groups.
            var bmis = people.Where(r => r.AgeBand is not ("0-5" or "6-14")).Select(r => Bmi(r.WeightKg, r.HeightCm)).Where(b => b != null).Select(b => b!.Value).ToList();
            return new
            {
                people = people.Count,
                measured = new
                {
                    bp = people.Count(r => r.BpSystolic != null), sugar = people.Count(r => r.Sugar != null), weight = people.Count(r => r.WeightKg != null),
                    height = people.Count(r => r.HeightCm != null), spo2 = people.Count(r => r.Spo2 != null), pulse = people.Count(r => r.Pulse != null), temp = people.Count(r => r.TempF != null),
                    bmi = bmis.Count,
                },
                flags = new
                {
                    highBp = people.Count(HighBp), veryHighBp = people.Count(r => r.BpSystolic >= 180 || r.BpDiastolic >= 110),
                    highSugar = people.Count(HighSugar), lowSpo2 = people.Count(LowSpo2), veryLowSpo2 = people.Count(r => r.Spo2 < 90),
                    fever = people.Count(r => r.TempF >= 100.4m), fastPulse = people.Count(r => r.Pulse > 100), slowPulse = people.Count(r => r.Pulse < 60),
                    underweight = bmis.Count(b => b < 18.5m), overweight = bmis.Count(b => b >= 25 && b < 30), obese = bmis.Count(b => b >= 30),
                },
                averages = new
                {
                    bpSystolic = Avg(people.Select(r => (decimal?)r.BpSystolic)), bpDiastolic = Avg(people.Select(r => (decimal?)r.BpDiastolic)),
                    sugar = Avg(people.Select(r => (decimal?)r.Sugar)), weightKg = Avg(people.Select(r => r.WeightKg)), spo2 = Avg(people.Select(r => (decimal?)r.Spo2)),
                    pulse = Avg(people.Select(r => (decimal?)r.Pulse)), tempF = Avg(people.Select(r => r.TempF)), bmi = Avg(bmis.Select(b => (decimal?)b)),
                },
                byAge = AgeBands.Append("unknown").Select(a =>
                {
                    var g = people.Where(r => r.AgeBand == a).ToList();
                    return new
                    {
                        key = a, label = AgeLabel(a), people = g.Count,
                        bp = g.Count(r => r.BpSystolic != null), highBp = g.Count(HighBp),
                        sugar = g.Count(r => r.Sugar != null), highSugar = g.Count(HighSugar),
                        spo2 = g.Count(r => r.Spo2 != null), lowSpo2 = g.Count(LowSpo2),
                        weightKg = Avg(g.Select(r => r.WeightKg)),
                    };
                }).Where(x => x.people > 0),
            };
        }

        public static string KeyOf(DiseaseRecord r) => r.ConditionCode ?? "txt:" + r.Disease.Trim().ToLowerInvariant();
        public static string DeptOf(DiseaseRecord r) => r.ConditionCode != null ? CampBook.DeptFor(r.ConditionCode) : "Not matched to a department";

        public sealed record Place(string Id, string Name, string Block, string District, string? Lgd, double? Lat, double? Lng);

        public static async Task<List<Place>> PlacesAsync(IMarketingDbContext db, CancellationToken ct) =>
            await db.Panchayats.AsNoTracking()
                .Select(p => new Place(p.PanchayatId, p.Name, p.Block, p.District, p.LgdCode, p.ManualLat ?? p.CentroidLat, p.ManualLng ?? p.CentroidLng))
                .ToListAsync(ct);

        public static IQueryable<DiseaseRecord> Filter(IQueryable<DiseaseRecord> q, DateOnly? from, DateOnly? to, string? district, string? block,
            string? panchayatId, string? disease, string? sex, string? ageBand, Guid? campId)
        {
            q = q.Where(r => r.Status == "active");
            if (from != null) q = q.Where(r => r.Date >= from);
            if (to != null) q = q.Where(r => r.Date <= to);
            if (!string.IsNullOrWhiteSpace(district)) q = q.Where(r => r.District == district);
            if (!string.IsNullOrWhiteSpace(block)) q = q.Where(r => r.Block == block);
            if (!string.IsNullOrWhiteSpace(panchayatId)) q = q.Where(r => r.PanchayatId == panchayatId);
            if (!string.IsNullOrWhiteSpace(disease))
            {
                if (disease.StartsWith("txt:")) { var t = disease[4..]; q = q.Where(r => r.ConditionCode == null && r.Disease.ToLower() == t); }
                else q = q.Where(r => r.ConditionCode == disease);
            }
            if (!string.IsNullOrWhiteSpace(sex)) q = q.Where(r => r.Sex == sex);
            if (!string.IsNullOrWhiteSpace(ageBand)) q = q.Where(r => r.AgeBand == ageBand);
            if (campId != null) q = q.Where(r => r.CampId == campId);
            return q;
        }

        /// <summary>
        /// Everything the patterns page and the AI analyst need, added up. Counts only: nothing here can identify a person.
        /// </summary>
        public static object Patterns(List<DiseaseRecord> rows, List<Place> places, int topN = 12)
        {
            var placeById = places.GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.First());
            int total = rows.Sum(r => r.Count);
            var label = rows.GroupBy(KeyOf).ToDictionary(g => g.Key, g => g.First().ConditionCode != null ? CampBook.ConditionLabel(g.First().ConditionCode!) : g.First().Disease.Trim());
            var byDisease = rows.GroupBy(KeyOf).Select(g => new { key = g.Key, label = label[g.Key], dept = DeptOf(g.First()), n = g.Sum(r => r.Count) })
                .OrderByDescending(x => x.n).ToList();
            var top = byDisease.Take(topN).Select(x => x.key).ToList();
            var topSet = top.ToHashSet();

            var months = rows.GroupBy(r => r.Date.ToString("yyyy-MM")).OrderBy(g => g.Key).Select(g => new
            {
                month = g.Key,
                n = g.Sum(r => r.Count),
                diseases = g.Where(r => topSet.Contains(KeyOf(r))).GroupBy(KeyOf).ToDictionary(x => x.Key, x => x.Sum(r => r.Count)),
            }).ToList();

            var blocks = rows.GroupBy(r => (r.District ?? "—", r.Block ?? "—")).Select(g => new
            {
                district = g.Key.Item1,
                block = g.Key.Item2,
                n = g.Sum(r => r.Count),
                panchayats = g.Select(r => r.PanchayatId ?? r.Panchayat).Where(x => x != null).Distinct().Count(),
                diseases = g.GroupBy(KeyOf).ToDictionary(x => x.Key, x => x.Sum(r => r.Count)),
            }).OrderByDescending(x => x.n).ToList();

            var pan = rows.Where(r => r.PanchayatId != null && placeById.ContainsKey(r.PanchayatId)).GroupBy(r => r.PanchayatId!).Select(g =>
            {
                var p = placeById[g.Key];
                return new
                {
                    id = p.Id, lgd = p.Lgd, name = p.Name, block = p.Block, district = p.District, lat = p.Lat, lng = p.Lng,
                    n = g.Sum(r => r.Count),
                    diseases = g.GroupBy(KeyOf).ToDictionary(x => x.Key, x => x.Sum(r => r.Count)),
                };
            }).OrderByDescending(x => x.n).ToList();

            return new
            {
                totals = new
                {
                    cases = total,
                    rows = rows.Count,
                    diseases = byDisease.Count,
                    blocks = blocks.Count(b => b.block != "—"),
                    panchayats = rows.Select(r => r.PanchayatId ?? r.Panchayat).Where(x => x != null).Distinct().Count(),
                    firstDate = rows.Count == 0 ? (DateOnly?)null : rows.Min(r => r.Date),
                    lastDate = rows.Count == 0 ? (DateOnly?)null : rows.Max(r => r.Date),
                    unmatchedPlace = rows.Where(r => r.PanchayatId == null).Sum(r => r.Count),
                    unmatchedDisease = rows.Where(r => r.ConditionCode == null).Sum(r => r.Count),
                },
                diseases = byDisease,
                top,
                bySex = new[] { "F", "M", "O", "U" }.Select(s => new { key = s, label = SexLabel(s), n = rows.Where(r => r.Sex == s).Sum(r => r.Count) }),
                byAge = AgeBands.Append("unknown").Select(a => new { key = a, label = AgeLabel(a), n = rows.Where(r => r.AgeBand == a).Sum(r => r.Count) }),
                diseaseByAge = byDisease.Take(topN).Select(d => new
                {
                    key = d.key,
                    cells = AgeBands.Append("unknown").ToDictionary(a => a, a => rows.Where(r => r.AgeBand == a && KeyOf(r) == d.key).Sum(r => r.Count)),
                }),
                diseaseBySex = byDisease.Take(topN).Select(d => new
                {
                    key = d.key,
                    cells = new[] { "F", "M", "O", "U" }.ToDictionary(s => s, s => rows.Where(r => r.Sex == s && KeyOf(r) == d.key).Sum(r => r.Count)),
                }),
                months,
                blocks,
                panchayats = pan,
                readings = ReadingsSummary(rows),
            };
        }

        /// <summary>
        /// Keeps Disease data in step with one camp's patient register: everyone marked attended is counted by what the
        /// doctor suspected (or, if nothing was ticked, by their symptoms), with their age group and gender, at the camp's
        /// place and date. Only counts are written, never names. Rows are updated in place, so saving again changes nothing
        /// twice; rows that no longer apply are taken out of the counts. The caller saves.
        /// </summary>
        public static async Task SyncCampAsync(IMarketingDbContext db, Guid campId, CancellationToken ct)
        {
            var camp = await db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(c => c.Id == campId, ct);
            var existing = await db.DiseaseRecords.Where(r => r.CampId == campId && r.Source == "camp" && r.Status == "active").ToListAsync(ct);
            var want = new Dictionary<(string Key, string Age, string Sex), (string? Code, string Disease, int N)>();
            if (camp != null && camp.Status != "cancelled")
            {
                var people = await db.CampPatients.AsNoTracking().Where(p => p.CampId == campId && p.Status == "attended")
                    .Select(p => new { p.Age, p.Sex, p.Conditions, p.Symptoms }).ToListAsync(ct);
                foreach (var p in people)
                {
                    var age = p.Age is >= 0 and <= 120 ? BandFor(p.Age.Value) : "unknown";
                    var sex = p.Sex is "M" or "F" or "O" ? p.Sex : "U";
                    var items = CampBook.Codes(p.Conditions).Where(c => c != "other").Select(c => ((string?)c, CampBook.ConditionLabel(c))).ToList();
                    if (items.Count == 0)
                        items = CampBook.Codes(p.Symptoms).Select(s => { var label = CampBook.SymptomLabel(s); return (MatchCondition(label), label); }).ToList();
                    foreach (var (code, label) in items.DistinctBy(i => i.Item1 ?? i.Item2))
                    {
                        var k = (code ?? "txt:" + label.ToLowerInvariant(), age, sex);
                        var cur = want.GetValueOrDefault(k, (code, code != null ? CampBook.ConditionLabel(code) : label, 0));
                        want[k] = (cur.Item1, cur.Item2, cur.Item3 + 1);
                    }
                }
            }

            string? district = camp?.District, block = camp?.Block, pid = camp?.PanchayatId;
            if (camp != null && pid != null)
            {
                var pl = await db.Panchayats.AsNoTracking().Where(x => x.PanchayatId == pid).Select(x => new { x.Block, x.District }).FirstOrDefaultAsync(ct);
                if (pl != null) { block ??= pl.Block; district ??= pl.District; }
            }
            var now = DateTime.UtcNow;
            var seen = new HashSet<Guid>();
            foreach (var (k, v) in want)
            {
                var row = existing.FirstOrDefault(r => KeyOf(r) == k.Key && r.AgeBand == k.Age && r.Sex == k.Sex);
                if (row == null)
                {
                    db.DiseaseRecords.Add(new DiseaseRecord
                    {
                        Date = camp!.Date, ConditionCode = v.Code, Disease = v.Disease, AgeBand = k.Age, Sex = k.Sex,
                        District = district, Block = block, PanchayatId = pid, Count = v.N, CampId = campId, Source = "camp", BatchId = campId, CreatedBy = "camp",
                    });
                    continue;
                }
                seen.Add(row.Id);
                row.Count = v.N; row.Date = camp!.Date; row.District = district; row.Block = block; row.PanchayatId = pid;
            }
            foreach (var r in existing.Where(r => !seen.Contains(r.Id)))
            {
                r.Status = "removed"; r.RemovedBy = "camp"; r.RemovedAt = now;
            }
        }
    }
}
