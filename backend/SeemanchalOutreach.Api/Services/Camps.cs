using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Health camps: the lists used at the screening desk, the marketing plan every camp starts with, and booking
    /// people in from WhatsApp.
    /// </summary>
    public static class CampBook
    {
        public static readonly string[] Types = { "general", "eye", "bone_joint", "women", "diabetes_bp", "child", "dental", "heart", "other" };
        public static readonly string[] Statuses = { "planned", "confirmed", "done", "cancelled" };
        public static readonly string[] PatientStatuses = { "booked", "attended", "no_show", "cancelled" };
        public static readonly string[] Sources = { "prebooked", "whatsapp", "partner", "agent", "walk_in" };

        /// <summary>What people come with (code, English, Hindi).</summary>
        public static readonly (string Code, string En, string Hi)[] Symptoms =
        {
            ("fever", "Fever", "बुखार"), ("cough", "Cough", "खांसी"), ("breathless", "Breathlessness", "सांस फूलना"),
            ("chest_pain", "Chest pain", "सीने में दर्द"), ("joint_pain", "Joint / knee pain", "जोड़ों/घुटने में दर्द"), ("back_pain", "Back pain", "कमर दर्द"),
            ("headache", "Headache", "सिर दर्द"), ("dizziness", "Dizziness", "चक्कर"), ("stomach_pain", "Stomach pain", "पेट दर्द"),
            ("acidity", "Acidity / gas", "एसिडिटी / गैस"), ("loose_motion", "Loose motions", "दस्त"), ("weakness", "Weakness / tiredness", "कमज़ोरी / थकान"),
            ("weight_loss", "Weight loss", "वज़न घटना"), ("swelling", "Swelling", "सूजन"), ("skin", "Skin rash / itching", "खुजली / दाने"),
            ("vision", "Poor vision", "कम दिखना"), ("ear", "Ear / hearing", "कान / सुनना"), ("tooth", "Tooth / gum", "दांत / मसूड़े"),
            ("urine", "Urine problem", "पेशाब की समस्या"), ("periods", "Period problems", "माहवारी की समस्या"), ("pregnancy", "Pregnancy check", "गर्भावस्था जांच"),
            ("child_growth", "Child not growing", "बच्चे का विकास"), ("numbness", "Numbness / tingling", "सुन्नपन / झुनझुनी"), ("wound", "Wound / injury", "घाव / चोट"),
            ("thirst", "Excess thirst / urination", "ज़्यादा प्यास / पेशाब"),
        };

        /// <summary>What the doctor suspects (code, English, Hindi, usual department).</summary>
        public static readonly (string Code, string En, string Hi, string Dept)[] Conditions =
        {
            ("hypertension", "High BP", "हाई बीपी", "General Medicine"), ("diabetes", "Diabetes", "शुगर", "General Medicine"),
            ("anaemia", "Anaemia", "खून की कमी", "General Medicine"), ("arthritis", "Arthritis / joint disease", "गठिया", "Orthopaedics"),
            ("spine", "Spine / disc problem", "रीढ़ / डिस्क", "Orthopaedics"), ("cataract", "Cataract", "मोतियाबिंद", "Ophthalmology"),
            ("eyesight", "Needs glasses", "चश्मे की ज़रूरत", "Ophthalmology"), ("tb_suspect", "TB suspected", "टीबी का शक", "Pulmonology"),
            ("asthma_copd", "Asthma / COPD", "दमा", "Pulmonology"), ("heart", "Heart disease", "दिल की बीमारी", "Cardiology"),
            ("kidney", "Kidney problem", "किडनी", "Nephrology"), ("stone", "Kidney / gall stone", "पथरी", "General Surgery"),
            ("thyroid", "Thyroid", "थायरॉइड", "General Medicine"), ("gastric", "Gastric / liver", "पेट / लिवर", "Gastroenterology"),
            ("hernia_piles", "Hernia / piles", "हर्निया / बवासीर", "General Surgery"), ("gynae", "Women's health", "स्त्री रोग", "Obstetrics & Gynaecology"),
            ("anc", "Pregnancy care", "गर्भावस्था देखभाल", "Obstetrics & Gynaecology"), ("child", "Child health / malnutrition", "बाल स्वास्थ्य / कुपोषण", "Paediatrics"),
            ("skin", "Skin disease", "चर्म रोग", "Dermatology"), ("dental", "Dental", "दांत", "Dental"), ("ent", "Ear, nose, throat", "नाक, कान, गला", "ENT"),
            ("neuro", "Nerve / stroke", "नस / लकवा", "Neurology"), ("other", "Other", "अन्य", "General Medicine"),
        };

        public static string SymptomLabel(string c) => Symptoms.FirstOrDefault(s => s.Code == c).En ?? c;
        public static string ConditionLabel(string c) => Conditions.FirstOrDefault(s => s.Code == c).En ?? c;
        public static string DeptFor(string c) => Conditions.FirstOrDefault(s => s.Code == c).Dept ?? "General Medicine";

        public static string TypeLabel(string t) => t switch
        {
            "general" => "General health", "eye" => "Eye", "bone_joint" => "Bone & joint", "women" => "Women's health",
            "diabetes_bp" => "Diabetes & BP", "child" => "Child health", "dental" => "Dental", "heart" => "Heart", _ => "Other",
        };

        /// <summary>Readings that point to a condition, so the screening desk doesn't miss them.</summary>
        public static List<string> Flags(CampPatient p)
        {
            var f = new List<string>();
            if (p.BpSystolic >= 140 || p.BpDiastolic >= 90) f.Add("hypertension");
            if (p.Sugar >= 200) f.Add("diabetes");
            if (p.Spo2 is > 0 and < 94) f.Add("asthma_copd");
            return f;
        }

        public static List<string> Codes(string? csv) => string.IsNullOrWhiteSpace(csv) ? new() : csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        /// <summary>Only known codes, de-duplicated.</summary>
        public static string? CleanCodes(IEnumerable<string>? codes, IEnumerable<string> allowed)
        {
            if (codes == null) return null;
            var ok = new HashSet<string>(allowed);
            var list = codes.Select(c => c.Trim()).Where(ok.Contains).Distinct().Take(20).ToList();
            return list.Count == 0 ? null : string.Join(",", list);
        }

        private const string CodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

        /// <summary>A short camp code from its place and date, e.g. KSB12; random letters are added if taken.</summary>
        public static async Task<string> NewCodeAsync(IMarketingDbContext db, string? place, DateOnly date, CancellationToken ct)
        {
            var letters = new string((place ?? "").ToUpperInvariant().Where(char.IsLetter).Where(c => c is >= 'A' and <= 'Z').Take(3).ToArray());
            if (letters.Length < 3) letters = (letters + "CMP")[..3];
            var code = $"{letters}{date.Day:00}";
            for (var i = 0; i < 10 && await db.HealthCamps.AnyAsync(c => c.Code == code, ct); i++)
                code = $"{letters}{date.Day:00}{CodeChars[RandomNumberGenerator.GetInt32(CodeChars.Length)]}";
            return code;
        }

        public class ChecklistItem
        {
            public string Id { get; set; } = Guid.NewGuid().ToString("n")[..8];
            public string Phase { get; set; } = "before";        // before | week | day | after
            public string Text { get; set; } = string.Empty;
            public bool Done { get; set; }
            public string? DoneBy { get; set; }
            public DateTime? DoneAt { get; set; }
        }

        /// <summary>
        /// The marketing plan every camp starts with. It's the playbook in practice: build demand before the day,
        /// make booking easy, capture everyone on the day, and turn findings into hospital visits afterwards.
        /// </summary>
        public static List<ChecklistItem> DefaultChecklist(string type) => new()
        {
            new() { Phase = "before", Text = "Pick the place with the local partner (mukhiya, ASHA, school, PHC) and confirm the date" },
            new() { Phase = "before", Text = "Book the doctors and the screening kit (BP, sugar strips, SpO2, weight; eye chart for eye camps)" },
            new() { Phase = "before", Text = "Look at the panchayat's survey answers and past camps: which problems are common here?" },
            new() { Phase = "before", Text = "Print QR posters with the camp code and put them up at the PHC, shops, school and chemists" },
            new() { Phase = "week", Text = "WhatsApp broadcast: camp invite to every partner in the block" },
            new() { Phase = "week", Text = "Field agents visit ASHA workers and RMPs: each brings 10 people who need a check-up" },
            new() { Phase = "week", Text = "Reminder broadcast 2 days before; announcement by mic / e-rickshaw the day before" },
            new() { Phase = "week", Text = $"Pre-book at least half the slots (WhatsApp code or phone){(type == "women" ? "; ask ASHAs about pregnant women due for a check" : "")}" },
            new() { Phase = "day", Text = "Registration desk with token numbers; record consent before taking health details" },
            new() { Phase = "day", Text = "Screen everyone (BP, sugar, weight, SpO2) and note symptoms and what the doctor suspects" },
            new() { Phase = "day", Text = "Give each referred patient a hospital slip with the date to come, the department and the desk number" },
            new() { Phase = "day", Text = "Photos (with permission) and a short video for WhatsApp and social media" },
            new() { Phase = "after", Text = "Within 2 days: call every referred patient and book their hospital visit" },
            new() { Phase = "after", Text = "Thank-you WhatsApp to partners who brought people, with how many came" },
            new() { Phase = "after", Text = "Credit partners for patients who come to the hospital (Referral desk)" },
            new() { Phase = "after", Text = "Write what worked and what to change; compare cost per hospital visit with other camps" },
        };

        public static async Task<int> NextTokenAsync(IMarketingDbContext db, Guid campId, CancellationToken ct)
        {
            var local = db.CampPatients.Local.Where(p => p.CampId == campId).Select(p => p.Token).DefaultIfEmpty(0).Max();
            var saved = await db.CampPatients.Where(p => p.CampId == campId).OrderByDescending(p => p.Token).Select(p => p.Token).FirstOrDefaultAsync(ct);
            return Math.Max(local, saved) + 1;
        }

        public static List<ChecklistItem> ReadChecklist(HealthCamp c)
        {
            if (string.IsNullOrWhiteSpace(c.ChecklistJson)) return new();
            try { return JsonSerializer.Deserialize<List<ChecklistItem>>(c.ChecklistJson, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new(); }
            catch (JsonException) { return new(); }
        }

        public static string WriteChecklist(List<ChecklistItem> items) => JsonSerializer.Serialize(items, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        /// <summary>
        /// Someone wrote "Camp: KSB12" (from the camp's QR poster or link) on WhatsApp: book them into that camp.
        /// Returns the camp when the code matched an upcoming camp. Caller saves.
        /// </summary>
        public static async Task<HealthCamp?> BookFromWhatsAppAsync(IMarketingDbContext db, string campTag, string phone, string? name, Guid? leadId, string? partnerClientId, CancellationToken ct)
        {
            var tag = campTag.Trim().Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.ToUpperInvariant() ?? "";
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            var camp = await db.HealthCamps.FirstOrDefaultAsync(c => c.Code == tag && c.Status != "cancelled" && c.Date >= today, ct);
            if (camp == null) return null;
            if (await db.CampPatients.AnyAsync(p => p.CampId == camp.Id && p.Phone == phone && p.Status != "cancelled", ct)) return camp;
            var max = await NextTokenAsync(db, camp.Id, ct) - 1;
            db.CampPatients.Add(new CampPatient
            {
                CampId = camp.Id, Token = max + 1, Slot = null, Name = string.IsNullOrWhiteSpace(name) ? "+" + phone : name!.Trim(), Phone = phone,
                Source = "whatsapp", Status = "booked", LeadId = leadId, PartnerClientId = partnerClientId, CreatedBy = "whatsapp",
            });
            return camp;
        }
    }
}
