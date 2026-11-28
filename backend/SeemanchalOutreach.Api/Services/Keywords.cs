using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Keywords: what people around the hospital search for, and how much of it the hospital is missing.
    ///
    /// Every morning (after the Google fetch) the words people used are gathered from Search Console, the Business Profile,
    /// Google Ads search terms and incoming WhatsApp messages, tagged with language, intent and district, and grouped into
    /// topics. Once a week, and on "Refresh volumes", Google Keyword Planner adds new ideas and how many people search for
    /// each, across Bihar and per district. Each topic is then scored: demand × value to the hospital × how much is missed.
    /// </summary>
    public class KeywordService
    {
        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly GoogleApi _api;

        public KeywordService(IMarketingDbContext db, IAppSettings settings, GoogleApi api) { _db = db; _settings = settings; _api = api; }

        public sealed record RunResult(bool Ok, int Keywords, int Topics, bool Planner, string? Error);

        public const string PlannerAtKey = "keywords.plannerAt";
        public const string PlannerResultKey = "keywords.plannerResult";
        public const string GeoKey = "keywords.geo";
        public const string BrandKey = "keywords.brand";
        public const string RunAtKey = "keywords.runAt";

        // ─── Starter topics ─────────────────────────────────────────────────────────────────────────────────────────

        public sealed record Starter(string Name, string Department, string Intent, string[] Terms);

        /// <summary>Topics every hospital starts with. People can add their own and edit the words of these.</summary>
        public static readonly Starter[] Catalogue =
        {
            new("Kidney stone treatment", "Urology", "visit", new[] { "kidney stone", "pathri", "pathari", "पथरी", "किडनी स्टोन", "gurde ki pathri", "stone operation" }),
            new("Prostate and urine problems", "Urology", "visit", new[] { "prostate", "प्रोस्टेट", "peshab", "पेशाब", "urine infection", "uti" }),
            new("Dialysis", "Nephrology", "visit", new[] { "dialysis", "डायलिसिस", "kidney failure", "किडनी फेल", "creatinine" }),
            new("Knee and hip replacement", "Orthopaedics", "compare", new[] { "knee replacement", "hip replacement", "joint replacement", "ghutne", "घुटने", "ghutna" }),
            new("Fractures and bone care", "Orthopaedics", "visit", new[] { "fracture", "haddi", "हड्डी", "bone doctor", "orthopedic", "orthopaedic", "ortho doctor", "plaster" }),
            new("Delivery and pregnancy", "Obstetrics & Gynaecology", "visit", new[] { "delivery", "prasav", "प्रसव", "c section", "cesarean", "caesarean", "pregnancy", "garbh", "गर्भ", "डिलीवरी" }),
            new("Women's health", "Obstetrics & Gynaecology", "visit", new[] { "gynecologist", "gynaecologist", "lady doctor", "mahila doctor", "महिला डॉक्टर", "pcod", "pcos", "bachedani", "बच्चेदानी", "periods" }),
            new("Child specialist", "Paediatrics", "visit", new[] { "child specialist", "pediatrician", "paediatrician", "bacchon ka doctor", "baccho ka doctor", "बच्चों के डॉक्टर", "shishu", "शिशु", "nicu" }),
            new("Heart care", "Cardiology", "visit", new[] { "heart", "cardiologist", "dil ka", "दिल", "हृदय", "chest pain", "heart attack", "ecg", "echo test" }),
            new("Fever, dengue and malaria", "Medicine", "visit", new[] { "dengue", "डेंगू", "malaria", "मलेरिया", "typhoid", "टाइफाइड", "bukhar", "बुखार", "fever", "platelet" }),
            new("Diabetes, BP and thyroid", "Medicine", "learn", new[] { "diabetes", "sugar ka", "शुगर", "madhumeh", "मधुमेह", "blood pressure", "bp ka", "thyroid", "थायराइड" }),
            new("Gall bladder, hernia and piles surgery", "General Surgery", "visit", new[] { "gall bladder", "gallbladder", "pitt ki thaili", "पित्त", "hernia", "हर्निया", "appendix", "piles", "bawasir", "बवासीर", "laparoscopic" }),
            new("Emergency, ICU and ambulance", "Emergency", "visit", new[] { "emergency", "इमरजेंसी", "icu", "ambulance", "एम्बुलेंस", "24 hour hospital", "24 ghante", "trauma", "accident" }),
            new("Scans and tests", "Diagnostics", "visit", new[] { "ct scan", "mri", "ultrasound", "अल्ट्रासाउंड", "x ray", "xray", "blood test", "जांच", "pathology", "test lab" }),
            new("Best hospital nearby", "General", "compare", new[] { "best hospital", "hospital near me", "multispeciality", "multi speciality", "super speciality", "अस्पताल", "aspatal", "hospital in" }),
        };

        // ─── Text rules (pure, tested) ──────────────────────────────────────────────────────────────────────────────

        private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);
        private static readonly Regex Junk = new(@"[^\p{L}\p{M}\p{Nd}\s]", RegexOptions.Compiled);

        /// <summary>Lower case, no punctuation, single spaces. Devanagari and Bangla are kept as they are.</summary>
        public static string Normalize(string? text)
        {
            var t = (text ?? "").ToLowerInvariant().Normalize(NormalizationForm.FormC);
            t = Junk.Replace(t, " ");
            return Spaces.Replace(t, " ").Trim();
        }

        private static readonly HashSet<string> HinglishWords = new(StringComparer.Ordinal)
        {
            "ka", "ki", "ke", "ko", "mein", "mai", "se", "hai", "kya", "kaise", "kaha", "kahan", "kitna", "kitne", "kharcha", "ilaj", "ilaaj", "dard",
            "doctor", "wala", "wali", "accha", "achha", "sabse", "sasta", "pathri", "bukhar", "bacchon", "baccho", "ghutne", "ghutna", "peshab", "haddi",
            "aspatal", "prasav", "garbh", "bawasir", "lakshan", "upchar", "dawai", "dawa", "nazdik", "paas", "ghante", "mahila",
        };

        /// <summary>hi (Devanagari), bn (Bangla script), hinglish (Hindi in Latin letters) or en.</summary>
        public static string LangOf(string text)
        {
            int dev = 0, ben = 0;
            foreach (var ch in text) { if (ch >= 'ऀ' && ch <= 'ॿ') dev++; else if (ch >= 'ঀ' && ch <= '৿') ben++; }
            if (dev > 0 && dev >= ben) return "hi";
            if (ben > 0) return "bn";
            var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return words.Count(w => HinglishWords.Contains(w) && w != "doctor") > 0 ? "hinglish" : "en";
        }

        private static readonly string[] VisitWords = { "treatment", "ilaj", "ilaaj", "इलाज", "operation", "ऑपरेशन", "surgery", "centre", "center", "specialist", "near me", "nearby", "nazdik", "paas", "पास", "emergency", "appointment", "booking", "contact", "number", "address", "timing", "opd", "kahan", "kaha", "कहाँ", "कहां", "hospital in", "doctor in", "clinic in" };
        private static readonly string[] CompareWords = { "best", "cost", "price", "fees", "fee", "charges", "kharcha", "खर्च", "rate", "kitna", "kitne", "कितना", "sasta", "cheap", "top", "review", "sabse accha", "सबसे अच्छा" };
        private static readonly string[] LearnWords = { "symptoms", "lakshan", "लक्षण", "kya hai", "क्या है", "kaise", "कैसे", "why", "causes", "kyon", "kyu", "क्यों", "diet", "gharelu", "घरेलू", "home remedy", "meaning" };

        /// <summary>visit (wants to come), compare (weighing options), learn (reading), or brand (the hospital's own name).</summary>
        public static string IntentOf(string text, IEnumerable<string>? brandTerms = null, IReadOnlyDictionary<string, string>? places = null)
        {
            bool has(IEnumerable<string> ws) => ws.Any(w => Contains(text, w));
            if (brandTerms != null && has(brandTerms.Where(b => b.Length >= 3))) return "brand";
            if (has(CompareWords)) return "compare";
            if (has(LearnWords)) return "learn";
            if (has(VisitWords)) return "visit";
            if (places != null && DistrictOf(text, places) != null) return "visit";
            if (Contains(text, "hospital") || Contains(text, "doctor") || Contains(text, "अस्पताल") || Contains(text, "डॉक्टर") || Contains(text, "clinic")) return "visit";
            return "learn";
        }

        /// <summary>Whole-word (or whole-phrase) match; Devanagari and Bangla match anywhere, as words join with matras.</summary>
        public static bool Contains(string text, string term)
        {
            if (string.IsNullOrEmpty(term)) return false;
            var i = text.IndexOf(term, StringComparison.Ordinal);
            if (i < 0) return false;
            if (term.Any(c => c >= 'ऀ' && c <= '৿')) return true;
            while (i >= 0)
            {
                var before = i == 0 || !char.IsLetterOrDigit(text[i - 1]);
                var end = i + term.Length;
                var after = end >= text.Length || !char.IsLetterOrDigit(text[end]);
                if (before && after) return true;
                i = text.IndexOf(term, i + 1, StringComparison.Ordinal);
            }
            return false;
        }

        /// <summary>Other spellings people use for the districts of Seemanchal; the panchayat list adds every block.</summary>
        public static readonly Dictionary<string, string[]> DistrictAliases = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Purnia"] = new[] { "purnia", "purnea", "पूर्णिया", "पूर्णियां", "पुर्णिया" },
            ["Katihar"] = new[] { "katihar", "कटिहार" },
            ["Araria"] = new[] { "araria", "अररिया" },
            ["Kishanganj"] = new[] { "kishanganj", "किशनगंज" },
            ["Madhepura"] = new[] { "madhepura", "मधेपुरा" },
            ["Saharsa"] = new[] { "saharsa", "सहरसा" },
            ["Supaul"] = new[] { "supaul", "सुपौल" },
            ["Bhagalpur"] = new[] { "bhagalpur", "भागलपुर" },
        };

        /// <summary>The district a phrase names, by district or block name; null when it names none.</summary>
        public static string? DistrictOf(string text, IReadOnlyDictionary<string, string> placeToDistrict)
        {
            foreach (var (place, district) in placeToDistrict.OrderByDescending(p => p.Key.Length))
                if (place.Length >= 4 && Contains(text, place)) return district;
            return null;
        }

        /// <summary>Topic terms, one per line (or comma).</summary>
        public static string[] TermsOf(string matchTerms) =>
            matchTerms.Split(new[] { '\n', ',' }, StringSplitOptions.RemoveEmptyEntries).Select(Normalize).Where(t => t.Length >= 2).Distinct().ToArray();

        /// <summary>The topic a phrase belongs to: the one whose longest term it contains.</summary>
        public static Guid? TopicFor(string text, IEnumerable<(Guid Id, string[] Terms)> topics)
        {
            Guid? best = null; var len = 0;
            foreach (var (id, terms) in topics)
                foreach (var t in terms)
                    if (t.Length > len && Contains(text, t)) { best = id; len = t.Length; }
            return best;
        }

        /// <summary>How much of the topic the hospital misses, from its best Google position (null = not found at all).</summary>
        public static int GapFromPosition(double? position) => position switch
        {
            null => 95,
            <= 3 => 25,
            <= 10 => 55,
            <= 20 => 80,
            _ => 90,
        };

        /// <summary>0–100: demand on a log scale against the biggest topic, × value, × gap.</summary>
        public static int Score(int demand, int maxDemand, int valuePct, int gapPct)
        {
            if (demand <= 0 || maxDemand <= 0) return 0;
            var d = Math.Log10(1 + demand) / Math.Log10(1 + Math.Max(maxDemand, demand));
            var s = 100 * d * (0.4 + 0.6 * Math.Clamp(valuePct, 0, 100) / 100.0) * Math.Clamp(gapPct, 0, 100) / 100.0;
            return (int)Math.Round(Math.Clamp(s, 0, 100));
        }

        private static readonly HashSet<string> Stop = new(StringComparer.Ordinal)
        {
            "hi", "hello", "sir", "madam", "ji", "please", "pls", "ok", "okay", "yes", "no", "the", "a", "an", "is", "are", "i", "my", "me", "to", "for", "of", "and", "in",
            "hai", "ka", "ki", "ke", "ko", "se", "me", "mein", "kya", "aur", "bhi", "to", "ho", "hain", "tha", "nahi", "haan", "है", "का", "की", "के", "को", "से", "में", "और", "जी",
        };

        /// <summary>
        /// Two- and three-word phrases from incoming messages, with how many different people used each. Words with digits
        /// (numbers, dates, codes) are dropped, so phone numbers and names with numbers never become phrases.
        /// </summary>
        public static Dictionary<string, int> Phrases(IEnumerable<(string Phone, string Text)> messages)
        {
            var who = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            foreach (var (phone, raw) in messages)
            {
                var words = Normalize(raw).Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !w.Any(char.IsDigit) && w.Length <= 24).ToArray();
                for (int n = 2; n <= 3; n++)
                    for (int i = 0; i + n <= words.Length; i++)
                    {
                        var part = words.Skip(i).Take(n).ToArray();
                        if (Stop.Contains(part[0]) || Stop.Contains(part[^1])) continue;
                        var p = string.Join(' ', part);
                        if (!who.TryGetValue(p, out var set)) who[p] = set = new HashSet<string>();
                        set.Add(phone);
                    }
            }
            return who.ToDictionary(k => k.Key, k => k.Value.Count);
        }

        /// <summary>Months (1–12) when searches run at least 20% above the year's average.</summary>
        public static int[] PeakMonths(IEnumerable<(int Month, long Searches)> points)
        {
            var byMonth = points.GroupBy(p => p.Month).ToDictionary(g => g.Key, g => g.Sum(x => x.Searches));
            if (byMonth.Count < 6) return Array.Empty<int>();
            var avg = byMonth.Values.Average();
            if (avg <= 0) return Array.Empty<int>();
            return byMonth.Where(kv => kv.Value >= avg * 1.2).Select(kv => kv.Key).OrderBy(m => m).ToArray();
        }

        public static string[] SourcesOf(string s) => s.Split(',', StringSplitOptions.RemoveEmptyEntries);
        public static string AddSource(string s, string src) => SourcesOf(s).Contains(src) ? s : string.Join(',', SourcesOf(s).Append(src));

        // ─── The run ────────────────────────────────────────────────────────────────────────────────────────────────

        public async Task EnsureTopicsAsync(CancellationToken ct)
        {
            var have = (await _db.KwTopics.Select(t => t.Name).ToListAsync(ct)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var s in Catalogue.Where(s => !have.Contains(s.Name)))
                _db.KwTopics.Add(new KwTopic { Name = s.Name, Department = s.Department, Intent = s.Intent, MatchTerms = string.Join('\n', s.Terms) });
            await _db.SaveChangesAsync(ct);
        }

        /// <summary>District and block names (and other spellings), each pointing at its district.</summary>
        public async Task<Dictionary<string, string>> PlacesAsync(CancellationToken ct)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            var rows = await _db.Panchayats.AsNoTracking().Select(p => new { p.District, p.Block }).Distinct().ToListAsync(ct);
            foreach (var r in rows)
            {
                if (!string.IsNullOrWhiteSpace(r.District)) map[Normalize(r.District)] = Title(r.District);
                if (!string.IsNullOrWhiteSpace(r.Block) && !string.IsNullOrWhiteSpace(r.District)) map.TryAdd(Normalize(r.Block), Title(r.District));
            }
            foreach (var (d, names) in DistrictAliases)
                foreach (var n in names) map[Normalize(n)] = d;
            return map;
        }

        private static string Title(string s) => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.Trim().ToLowerInvariant());

        public string[] BrandTerms()
        {
            var b = _settings.Get(BrandKey);
            return string.IsNullOrWhiteSpace(b) ? Array.Empty<string>() : TermsOf(b);
        }

        /// <summary>Gathers, tags, groups and scores. With <paramref name="planner"/>, also asks Keyword Planner (slower, uses the Ads API).</summary>
        public async Task<RunResult> RunAsync(bool planner, string by, CancellationToken ct)
        {
            await EnsureTopicsAsync(ct);
            var places = await PlacesAsync(ct);
            var brand = BrandTerms();
            var topics = await _db.KwTopics.Where(t => t.Status != "dismissed").ToListAsync(ct);
            var topicTerms = topics.Select(t => (t.Id, TermsOf(t.MatchTerms))).ToList();
            var all = await _db.KwKeywords.ToDictionaryAsync(k => k.Text, ct);
            var now = DateTime.UtcNow;
            var today = DateOnly.FromDateTime(IstClock.NowIst);

            KwKeyword Get(string text, string source)
            {
                if (!all.TryGetValue(text, out var k))
                {
                    k = new KwKeyword { Text = text, CreatedAt = now };
                    _db.KwKeywords.Add(k);
                    all[text] = k;
                }
                k.Sources = AddSource(k.Sources, source);
                k.UpdatedAt = now;
                return k;
            }

            // 1. Search Console: queries over the last 90 days.
            var from90 = today.AddDays(-89);
            var gsc = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "gsc" && m.Dimension.StartsWith("query:") && m.Date >= from90)
                .GroupBy(m => new { m.Dimension, m.Metric }).Select(g => new { g.Key.Dimension, g.Key.Metric, V = g.Sum(x => x.Value) }).ToListAsync(ct);
            foreach (var q in gsc.GroupBy(x => x.Dimension))
            {
                var text = Normalize(q.Key["query:".Length..]);
                if (text.Length < 3) continue;
                decimal v(string metric) => q.Where(x => x.Metric == metric).Sum(x => x.V);
                var impr = v("impressions");
                var k = Get(text, "gsc");
                k.Impressions = (int)Math.Min(int.MaxValue, impr);
                k.Clicks = (int)v("clicks");
                k.Position = impr > 0 ? Math.Round((double)(v("position_x_impr") / impr), 1) : null;
            }

            // 2. Business Profile search terms, last 3 months.
            var from3m = new DateOnly(today.Year, today.Month, 1).AddMonths(-3);
            var gbp = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "gbp" && m.Dimension.StartsWith("keyword:") && m.Metric == "keyword_views" && m.Date >= from3m)
                .GroupBy(m => m.Dimension).Select(g => new { g.Key, V = g.Sum(x => x.Value) }).ToListAsync(ct);
            foreach (var g in gbp)
            {
                var text = Normalize(g.Key["keyword:".Length..]);
                if (text.Length < 3) continue;
                Get(text, "gbp").GbpViews = (int)Math.Min(int.MaxValue, g.V);
            }

            // 3. Google Ads search terms, last 90 days.
            var ads = await _db.ChannelMetrics.AsNoTracking()
                .Where(m => m.Source == "google_ads" && m.Dimension.StartsWith("term:") && m.Date >= from90 && (m.Metric == "clicks" || m.Metric == "cost"))
                .GroupBy(m => new { m.Dimension, m.Metric }).Select(g => new { g.Key.Dimension, g.Key.Metric, V = g.Sum(x => x.Value) }).ToListAsync(ct);
            foreach (var a in ads.GroupBy(x => x.Dimension))
            {
                var text = Normalize(a.Key["term:".Length..]);
                if (text.Length < 3) continue;
                var k = Get(text, "ads");
                k.AdClicks = (int)a.Where(x => x.Metric == "clicks").Sum(x => x.V);
                k.AdCostMicros = (long)(a.Where(x => x.Metric == "cost").Sum(x => x.V) * 1_000_000m);
            }

            // 4. WhatsApp: phrases people write, used by 3 or more people and naming a topic. Only counts are kept.
            var since = now.AddDays(-90);
            var msgs = await _db.WaMessages.AsNoTracking()
                .Where(m => m.Direction == "in" && m.Type == "text" && m.CreatedAt >= since && m.Text.Length >= 6 && m.Text.Length <= 400)
                .OrderByDescending(m => m.CreatedAt).Take(8000).Select(m => new { m.Phone, m.Text }).ToListAsync(ct);
            var normMsgs = msgs.Select(m => (m.Phone, Text: Normalize(m.Text))).ToList();
            foreach (var (phrase, people) in Phrases(normMsgs).Where(p => p.Value >= 3).OrderByDescending(p => p.Value).Take(400))
                if (TopicFor(phrase, topicTerms) != null) Get(phrase, "chats");

            // 5. Keyword Planner: new ideas and volumes (weekly, or when asked).
            string? plannerError = null;
            var plannerRan = false;
            if (planner)
            {
                var cfg = GoogleConfig.Load(_settings);
                (plannerRan, plannerError) = await PlannerAsync(cfg, topics, topicTerms, places, Get, ct);
                await _settings.SetAsync(new Dictionary<string, string?>
                {
                    [PlannerAtKey] = now.ToString("o"),
                    [PlannerResultKey] = plannerError ?? "ok",
                }, Array.Empty<string>(), by, ct);
            }

            // 6. Tag every keyword and count how often people write it.
            foreach (var k in all.Values)
            {
                k.Lang = LangOf(k.Text);
                k.Intent = IntentOf(k.Text, brand, places);
                k.District = DistrictOf(k.Text, places);
                if (!SourcesOf(k.Sources).Contains("manual")) k.TopicId = TopicFor(k.Text, topicTerms);
                k.ChatCount = k.TopicId != null && k.Text.Length >= 4 ? normMsgs.Count(m => Contains(m.Text, k.Text)) : 0;
            }
            await _db.SaveChangesAsync(ct);

            await ScoreAsync(topics, ct);
            await _settings.SetAsync(new Dictionary<string, string?> { [RunAtKey] = DateTime.UtcNow.ToString("o") }, Array.Empty<string>(), by, ct);
            return new RunResult(plannerError == null, all.Count, topics.Count, plannerRan, plannerError);
        }

        /// <summary>Demand, value, gap and score for every topic, from its keywords and the hospital's own leads.</summary>
        public async Task ScoreAsync(List<KwTopic> topics, CancellationToken ct)
        {
            var kws = await _db.KwKeywords.AsNoTracking().Where(k => k.TopicId != null && !k.Hidden)
                .Select(k => new { k.TopicId, k.Volume, k.Impressions, k.GbpViews, k.Position, k.VolumeJson }).ToListAsync(ct);

            // Value: how often a department's enquiries become patients (last year).
            var yearAgo = DateTime.UtcNow.AddDays(-365);
            var leads = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= yearAgo && l.Department != null)
                .GroupBy(l => l.Department!).Select(g => new { g.Key, N = g.Count(), Came = g.Count(l => l.Status == "arrived" || l.Status == "admitted"), Admitted = g.Count(l => l.Status == "admitted") })
                .ToListAsync(ct);
            int ValueOf(string? dept)
            {
                var row = leads.FirstOrDefault(r => dept != null && string.Equals(r.Key, dept, StringComparison.OrdinalIgnoreCase));
                if (row == null || row.N < 5) return 40;
                return Math.Clamp((int)Math.Round(100.0 * (row.Came + row.Admitted) / row.N), 10, 100);
            }

            var demand = topics.ToDictionary(t => t.Id, t => kws.Where(k => k.TopicId == t.Id).Sum(k => k.Volume ?? Math.Max(k.Impressions / 3, k.GbpViews / 3)));
            var max = demand.Values.DefaultIfEmpty(0).Max();
            foreach (var t in topics)
            {
                var mine = kws.Where(k => k.TopicId == t.Id).ToList();
                t.Demand = demand[t.Id];
                t.ValuePct = ValueOf(t.Department);
                t.BestPosition = mine.Where(k => k.Position != null && k.Impressions >= 10).Select(k => k.Position).Min();
                t.GapPct = GapFromPosition(t.BestPosition);
                t.Score = Score(t.Demand, max, t.ValuePct, t.GapPct);
                var months = new List<(int, long)>();
                foreach (var k in mine.Where(k => k.VolumeJson != null))
                    foreach (var (m, v) in MonthsOf(k.VolumeJson)) months.Add((int.Parse(m[5..]), v));
                var peaks = PeakMonths(months);
                t.PeakMonths = peaks.Length == 0 ? null : string.Join(',', peaks);
                t.ScoredAt = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync(ct);
        }

        /// <summary>[{"m":"2026-01","v":880},…] → ("2026-01", 880)…</summary>
        public static List<(string Month, long Searches)> MonthsOf(string? json)
        {
            var list = new List<(string, long)>();
            if (string.IsNullOrWhiteSpace(json)) return list;
            try
            {
                using var doc = JsonDocument.Parse(json);
                foreach (var e in doc.RootElement.EnumerateArray())
                    if (e.TryGetProperty("m", out var m) && m.GetString() is { Length: 7 } ms && e.TryGetProperty("v", out var v) && v.TryGetInt64(out var n)) list.Add((ms, n));
            }
            catch (JsonException) { /* bad value: ignored */ }
            return list;
        }

        // ─── Keyword Planner ────────────────────────────────────────────────────────────────────────────────────────

        private static readonly string[] MonthNames = { "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER" };

        /// <summary>Google's place codes for Bihar and each district, looked up once and kept.</summary>
        public async Task<(Dictionary<string, string> Geo, string? Error)> GeoAsync(GoogleConfig cfg, IEnumerable<string> districts, CancellationToken ct)
        {
            var saved = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try { if (_settings.Get(GeoKey) is { Length: > 0 } j) saved = JsonSerializer.Deserialize<Dictionary<string, string>>(j) ?? saved; } catch (JsonException) { }
            saved = new Dictionary<string, string>(saved, StringComparer.OrdinalIgnoreCase);
            var want = districts.Append("Bihar").Where(d => !saved.ContainsKey(d)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (want.Count == 0) return (saved, null);
            var r = await _api.PostAsync(cfg, $"https://googleads.googleapis.com/{cfg.AdsVersion}/geoTargetConstants:suggest",
                new { locale = "en", countryCode = "IN", locationNames = new { names = want } }, ct, GoogleSyncService.AdsHeaders(cfg));
            if (!r.Ok || r.Doc == null) return (saved, r.Error);
            using (r.Doc)
                if (r.Doc.RootElement.TryGetProperty("geoTargetConstantSuggestions", out var list))
                    foreach (var s in list.EnumerateArray())
                    {
                        var term = GoogleApi.Str(s, "searchTerm");
                        if (term == null || saved.ContainsKey(term) || !s.TryGetProperty("geoTargetConstant", out var g)) continue;
                        var canonical = GoogleApi.Str(g, "canonicalName") ?? "";
                        var res = GoogleApi.Str(g, "resourceName");
                        if (res != null && canonical.Contains("Bihar", StringComparison.OrdinalIgnoreCase) && canonical.Contains("India", StringComparison.OrdinalIgnoreCase))
                            saved[term] = res;
                    }
            await _settings.SetAsync(new Dictionary<string, string?> { [GeoKey] = JsonSerializer.Serialize(saved) }, Array.Empty<string>(), "keywords", ct);
            return (saved, null);
        }

        private async Task<(bool Ran, string? Error)> PlannerAsync(GoogleConfig cfg, List<KwTopic> topics, List<(Guid Id, string[] Terms)> topicTerms,
            Dictionary<string, string> places, Func<string, string, KwKeyword> get, CancellationToken ct)
        {
            if (!cfg.Connected || string.IsNullOrWhiteSpace(cfg.AdsCustomer)) return (false, "Connect Google Ads in Google → Setup to get search volumes.");
            if (string.IsNullOrWhiteSpace(cfg.AdsDeveloperToken)) return (false, "Add the Google Ads developer token in Google → Setup to get search volumes.");
            var districts = places.Values.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var (geo, geoErr) = await GeoAsync(cfg, districts, ct);
            if (!geo.TryGetValue("Bihar", out var bihar)) return (false, geoErr ?? "Google didn't find Bihar for Keyword Planner.");
            var headers = GoogleSyncService.AdsHeaders(cfg);
            var baseUrl = $"https://googleads.googleapis.com/{cfg.AdsVersion}/customers/{cfg.AdsCustomer}";
            string? lastError = null;

            // Ideas for each topic, across Bihar.
            foreach (var (id, terms) in topicTerms)
            {
                var seeds = terms.Where(t => t.Length >= 3).Take(20).ToArray();
                if (seeds.Length == 0) continue;
                var r = await _api.PostAsync(cfg, $"{baseUrl}:generateKeywordIdeas", new
                {
                    geoTargetConstants = new[] { bihar }, keywordPlanNetwork = "GOOGLE_SEARCH", includeAdultKeywords = false,
                    keywordSeed = new { keywords = seeds }, pageSize = 500,
                }, ct, headers);
                if (!r.Ok || r.Doc == null) { lastError = r.Error; if (r.Status is 401 or 403) break; continue; }
                using (r.Doc)
                    if (r.Doc.RootElement.TryGetProperty("results", out var results))
                        foreach (var x in results.EnumerateArray().Take(500))
                        {
                            var text = Normalize(GoogleApi.Str(x, "text"));
                            if (text.Length < 3 || !x.TryGetProperty("keywordIdeaMetrics", out var m)) continue;
                            // Keep ideas that stay on the topic: Keyword Planner wanders.
                            if (TopicFor(text, topicTerms) != id) continue;
                            ApplyMetrics(get(text, "planner"), m);
                        }
            }

            // Searches per district for the keywords that matter most.
            var top = places.Count == 0 ? new List<string>() : _db.KwKeywords.Local.Where(k => k.TopicId != null || TopicFor(k.Text, topicTerms) != null)
                .OrderByDescending(k => k.Volume ?? 0).ThenByDescending(k => k.Impressions).Select(k => k.Text).Take(700).ToList();
            var byText = _db.KwKeywords.Local.GroupBy(k => k.Text).ToDictionary(g => g.Key, g => g.First());
            var existing = await _db.KwAreaVolumes.ToListAsync(ct);
            foreach (var d in districts)
            {
                if (top.Count == 0 || !geo.TryGetValue(d, out var g)) continue;
                var r = await _api.PostAsync(cfg, $"{baseUrl}:generateKeywordHistoricalMetrics", new
                {
                    keywords = top, geoTargetConstants = new[] { g }, keywordPlanNetwork = "GOOGLE_SEARCH",
                }, ct, headers);
                if (!r.Ok || r.Doc == null) { lastError = r.Error; continue; }
                using (r.Doc)
                    if (r.Doc.RootElement.TryGetProperty("results", out var results))
                        foreach (var x in results.EnumerateArray())
                        {
                            var text = Normalize(GoogleApi.Str(x, "text"));
                            if (!byText.TryGetValue(text, out var k) || !x.TryGetProperty("keywordMetrics", out var m)) continue;
                            var vol = (int)Math.Min(int.MaxValue, GoogleApi.Num(m, "avgMonthlySearches"));
                            var row = existing.FirstOrDefault(a => a.KeywordId == k.Id && a.District == d);
                            if (row == null) { row = new KwAreaVolume { KeywordId = k.Id, District = d }; _db.KwAreaVolumes.Add(row); existing.Add(row); }
                            row.Volume = vol;
                            row.UpdatedAt = DateTime.UtcNow;
                        }
            }
            return (true, lastError);
        }

        public static void ApplyMetrics(KwKeyword k, JsonElement m)
        {
            k.Volume = (int)Math.Min(int.MaxValue, GoogleApi.Num(m, "avgMonthlySearches"));
            k.Competition = int.TryParse(GoogleApi.Str(m, "competitionIndex"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var c) ? c : null;
            var low = GoogleApi.Num(m, "lowTopOfPageBidMicros");
            var high = GoogleApi.Num(m, "highTopOfPageBidMicros");
            k.BidLowMicros = low > 0 ? (long)low : null;
            k.BidHighMicros = high > 0 ? (long)high : null;
            if (m.TryGetProperty("monthlySearchVolumes", out var mv) && mv.ValueKind == JsonValueKind.Array)
            {
                var months = new List<object>();
                foreach (var e in mv.EnumerateArray())
                {
                    var name = GoogleApi.Str(e, "month") ?? "";
                    var mi = Array.IndexOf(MonthNames, name) + 1;
                    var y = (int)GoogleApi.Num(e, "year");
                    if (mi <= 0 || y < 2000) continue;
                    months.Add(new { m = $"{y:D4}-{mi:D2}", v = (long)GoogleApi.Num(e, "monthlySearches") });
                }
                if (months.Count > 0) k.VolumeJson = JsonSerializer.Serialize(months);
            }
            k.VolumeAt = DateTime.UtcNow;
        }

        /// <summary>Weekly Keyword Planner run is due.</summary>
        public bool PlannerDue()
        {
            var at = _settings.Get(PlannerAtKey);
            return !DateTime.TryParse(at, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) || t < DateTime.UtcNow.AddDays(-7);
        }
    }
}
