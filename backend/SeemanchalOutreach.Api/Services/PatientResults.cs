using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Patients sent to the hospital by marketing — from health camps, field agents and partners — and what became of
    /// them: did they come, were they seen in OPD or admitted, and what the hospital billed and collected.
    /// </summary>
    public static class PatientResults
    {
        public const string CampDevice = "crm-camp";
        public static string CampClientId(Guid campPatientId) => "camp-" + campPatientId;

        /// <summary>camp (a health camp) | partner (a partner's QR code or WhatsApp, via the Leads inbox) | agent (a field agent's app or the CRM).</summary>
        public static string OriginOf(PatientReferral r) =>
            r.DeviceId == CampDevice || r.CampId != null ? "camp" : r.DeviceId == "crm-leads" ? "partner" : "agent";

        public static string OriginLabel(string origin) => origin switch
        {
            "camp" => "Health camps",
            "partner" => "Partners (QR code / WhatsApp)",
            _ => "Field agents",
        };

        public static readonly string[] AdmittedStages = { "admitted", "converted", "procedure", "discharged" };
        public static readonly string[] CameStages = { "arrived", "opd", "admitted", "converted", "procedure", "discharged" };

        /// <summary>
        /// What happened, as one word: admitted | opd (seen in OPD, not admitted) | came (arrived, outcome not recorded yet)
        /// | lost | waiting (not come yet).
        /// </summary>
        public static string Outcome(PatientReferral r, bool hasOpdBill = false)
        {
            var s = r.Status;
            if (r.AdmittedAt != null || AdmittedStages.Contains(s)) return "admitted";
            if (s == "opd") return "opd";
            if (r.ArrivedAt != null || CameStages.Contains(s)) return hasOpdBill ? "opd" : "came";
            if (s == "lost") return "lost";
            return "waiting";
        }

        public static bool Came(string outcome) => outcome is "admitted" or "opd" or "came";

        /// <summary>
        /// A camp patient the doctor sent to the hospital is put on the Referral desk (once), so the desk marks them
        /// arrived, OPD or admitted and enters the bills like any referral. No field agent: no agent incentive.
        /// If the doctor takes the referral back before the patient came, it is removed. The caller saves.
        /// </summary>
        public static async Task EnsureCampReferralAsync(IMarketingDbContext db, CampPatient p, CancellationToken ct)
        {
            var id = CampClientId(p.Id);
            var r = await db.Referrals.FirstOrDefaultAsync(x => x.ClientId == id, ct);
            if (!p.ReferToHospital)
            {
                if (r != null && r.Status == "pending" && r.ArrivedAt == null) db.Referrals.Remove(r);
                return;
            }
            // Already on the desk as a partner's patient (from the Leads inbox, before camps had their own): keep that one.
            var leadRef = p.LeadId == null ? null : "lead-" + p.LeadId.Value;
            if (r == null && leadRef != null && await db.Referrals.AnyAsync(x => x.ClientId == leadRef, ct)) return;
            var camp = await db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(c => c.Id == p.CampId, ct);
            var now = DateTime.UtcNow;
            var phone = p.Phone == null ? null : p.Phone.Length == 12 && p.Phone.StartsWith("91") ? p.Phone[2..] : p.Phone;
            if (r == null)
            {
                r = new PatientReferral
                {
                    ClientId = id, DeviceId = CampDevice, CampId = p.CampId,
                    ContactId = p.PartnerClientId ?? camp?.HostPartnerClientId ?? "", AgentId = "",
                    PatientName = p.Name, CreatedAt = now, ReferralDate = now, ServerReceivedAt = now, Status = "pending",
                };
                db.Referrals.Add(r);
            }
            // A health card given at the camp goes with them.
            if (r.HealthCardId == null)
                r.HealthCardId = await db.HealthCards.AsNoTracking().Where(c => c.CampPatientId == p.Id && c.Status != "cancelled").Select(c => (Guid?)c.Id).FirstOrDefaultAsync(ct);
            r.PatientName = p.Name;
            r.PatientAge = p.Age;
            r.PatientSex = p.Sex;
            r.ClientPhone = phone;
            r.Urgent = p.Urgent;
            r.Department = p.Department ?? CampBook.Codes(p.Conditions).Select(CampBook.DeptFor).FirstOrDefault() ?? "";
            var found = string.Join(", ", CampBook.Codes(p.Conditions).Select(CampBook.ConditionLabel));
            r.Notes = $"From the health camp {camp?.Title} ({camp?.Date:d MMM})" + (found.Length > 0 ? $": {found}" : p.Complaint != null ? $": {p.Complaint}" : "") + (p.Advice != null ? $". Advice: {p.Advice}" : "");
            r.UpdatedAt = now;
        }

        // ── The report ──────────────────────────────────────────────────────────

        public sealed record Bill(string ReferralClientId, string Kind, decimal Amount, decimal Collected);

        public sealed class Tally
        {
            public int Referred, Came, Opd, Admitted, Waiting, Lost, OutcomeOpen;
            public decimal Billed, Collected, OpdBilled, IpdBilled;
            public void Add(string outcome, decimal billed, decimal collected, decimal opd, decimal ipd)
            {
                Referred++;
                if (Came(outcome)) Came++;
                if (outcome == "opd") Opd++;
                if (outcome == "admitted") Admitted++;
                if (outcome == "came") OutcomeOpen++;
                if (outcome == "waiting") Waiting++;
                if (outcome == "lost") Lost++;
                Billed += billed; Collected += collected; OpdBilled += opd; IpdBilled += ipd;
            }
            public object Shape() => new
            {
                referred = Referred, came = Came, opd = Opd, admitted = Admitted, outcomeOpen = OutcomeOpen, waiting = Waiting, lost = Lost,
                cameRate = Referred == 0 ? 0 : (int)Math.Round(100.0 * Came / Referred),
                admittedRate = Came == 0 ? 0 : (int)Math.Round(100.0 * Admitted / Came),
                billed = Billed, collected = Collected, outstanding = Math.Max(0, Billed - Collected), opdBilled = OpdBilled, ipdBilled = IpdBilled,
                perPatient = Came == 0 ? 0 : Math.Round(Billed / Came),
            };
        }

        /// <summary>One line per patient with its outcome and money, for the report.</summary>
        public sealed record Line(PatientReferral R, string Origin, string Outcome, decimal Billed, decimal Collected, decimal OpdBilled, decimal IpdBilled);

        public static List<Line> Lines(IEnumerable<PatientReferral> referrals, IEnumerable<Bill> bills)
        {
            var byRef = bills.GroupBy(b => b.ReferralClientId).ToDictionary(g => g.Key, g => g.ToList());
            return referrals.Select(r =>
            {
                var mine = byRef.GetValueOrDefault(r.ClientId) ?? new List<Bill>();
                var outcome = Outcome(r, mine.Any(b => b.Kind == "opd"));
                var opd = mine.Where(b => b.Kind == "opd").Sum(b => b.Amount);
                return new Line(r, OriginOf(r), outcome, mine.Sum(b => b.Amount), mine.Sum(b => b.Collected), opd, mine.Sum(b => b.Amount) - opd);
            }).ToList();
        }

        public static Tally TallyOf(IEnumerable<Line> lines)
        {
            var t = new Tally();
            foreach (var l in lines) t.Add(l.Outcome, l.Billed, l.Collected, l.OpdBilled, l.IpdBilled);
            return t;
        }
    }
}
