using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The incentive rule for field agents (employees): a fixed amount when a patient they referred arrives and/or is
    /// admitted. 0 switches a step off. Each incentive still waits for an admin's approval before it can be paid.
    /// </summary>
    public class IncentiveRule
    {
        public const string Key = "payments.incentives";
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        public decimal PerArrival { get; set; }
        public decimal PerAdmission { get; set; }

        public static IncentiveRule Load(IAppSettings settings)
        {
            var raw = settings.Get(Key);
            if (string.IsNullOrWhiteSpace(raw)) return new IncentiveRule();
            try { return JsonSerializer.Deserialize<IncentiveRule>(raw, Json) ?? new IncentiveRule(); }
            catch (JsonException) { return new IncentiveRule(); }
        }

        public Task SaveAsync(IAppSettings settings, string by, CancellationToken ct) =>
            settings.SetAsync(new Dictionary<string, string?> { [Key] = JsonSerializer.Serialize(this, Json) }, Array.Empty<string>(), by, ct);
    }

    /// <summary>Money tied to referred patients: bills, partner service payments and agent incentives.</summary>
    public static class PatientMoney
    {
        /// <summary>What a partner may be paid for: services, never a fee for the referral itself or a share of the bill.</summary>
        public static readonly string[] ServicePurposes =
        {
            "Travel with patient", "Ambulance coordination", "Patient escort", "Sample pickup service",
            "Health camp support", "Camp venue", "Banner and display space", "Other service",
        };

        public static readonly string[] BillKinds = { "opd", "ipd", "procedure", "pharmacy", "lab", "other" };
        public static readonly string[] Schemes = { "cash", "ayushman", "insurance", "govt_scheme", "other" };

        public const string ArrivalReason = "Patient arrived at the hospital";
        public const string AdmissionReason = "Patient admitted";

        /// <summary>
        /// When a patient first reaches "arrived" or "admitted", adds the agent's incentive under the rule (once per
        /// patient and step). The caller saves. Returns what was added.
        /// </summary>
        public static async Task<List<AgentIncentive>> ApplyRuleAsync(IMarketingDbContext db, IAppSettings settings, PatientReferral r,
            bool arrivedNow, bool admittedNow, string by, CancellationToken ct)
        {
            var added = new List<AgentIncentive>();
            if (string.IsNullOrEmpty(r.AgentId) || (!arrivedNow && !admittedNow)) return added;
            var rule = IncentiveRule.Load(settings);
            async Task Add(decimal amount, string reason)
            {
                if (amount <= 0) return;
                if (await db.AgentIncentives.AnyAsync(i => i.ReferralClientId == r.ClientId && i.Auto && i.Reason == reason, ct)) return;
                var inc = new AgentIncentive
                {
                    AgentId = r.AgentId, ReferralClientId = r.ClientId, Amount = Math.Round(amount, 2), Reason = reason, Auto = true,
                    CreatedBy = by, Notes = r.PatientName,
                };
                db.AgentIncentives.Add(inc);
                added.Add(inc);
            }
            if (arrivedNow) await Add(rule.PerArrival, ArrivalReason);
            if (admittedNow) await Add(rule.PerAdmission, AdmissionReason);
            return added;
        }

        public sealed record Totals(decimal Billed, decimal Collected, decimal PayoutsPaid, decimal PayoutsOpen, int PayoutsCount, decimal IncentivesPaid, decimal IncentivesOpen);

        /// <summary>Money totals per referral (bills, partner payments linked to it, agent incentives for it).</summary>
        public static async Task<Dictionary<string, Totals>> TotalsAsync(IMarketingDbContext db, List<string> referralIds, CancellationToken ct)
        {
            if (referralIds.Count == 0) return new();
            var bills = await db.ReferralBills.AsNoTracking().Where(b => referralIds.Contains(b.ReferralClientId) && b.Status == "active")
                .GroupBy(b => b.ReferralClientId).Select(g => new { Id = g.Key, Billed = g.Sum(b => b.Amount), Collected = g.Sum(b => b.Collected) })
                .ToDictionaryAsync(x => x.Id, ct);
            var pays = await db.PartnerPayments.AsNoTracking().Where(p => p.ReferralClientId != null && referralIds.Contains(p.ReferralClientId) && p.Status != "rejected")
                .Select(p => new { Id = p.ReferralClientId!, p.Status, p.Amount }).ToListAsync(ct);
            var incs = await db.AgentIncentives.AsNoTracking().Where(i => i.ReferralClientId != null && referralIds.Contains(i.ReferralClientId) && i.Status != "rejected")
                .Select(i => new { Id = i.ReferralClientId!, i.Status, i.Amount }).ToListAsync(ct);
            var result = new Dictionary<string, Totals>();
            foreach (var id in referralIds)
            {
                var b = bills.GetValueOrDefault(id);
                var p = pays.Where(x => x.Id == id).ToList();
                var i = incs.Where(x => x.Id == id).ToList();
                if (b == null && p.Count == 0 && i.Count == 0) continue;
                result[id] = new Totals(b?.Billed ?? 0, b?.Collected ?? 0,
                    p.Where(x => x.Status == "paid").Sum(x => x.Amount), p.Where(x => x.Status != "paid").Sum(x => x.Amount), p.Count,
                    i.Where(x => x.Status == "paid").Sum(x => x.Amount), i.Where(x => x.Status != "paid").Sum(x => x.Amount));
            }
            return result;
        }

        public static string KindLabel(string k) => k switch
        {
            "opd" => "OPD", "ipd" => "Admission (IPD)", "procedure" => "Procedure / surgery", "pharmacy" => "Pharmacy", "lab" => "Lab / tests", _ => "Other",
        };

        public static string SchemeLabel(string s) => s switch
        {
            "cash" => "Cash / UPI", "ayushman" => "Ayushman Bharat", "insurance" => "Insurance", "govt_scheme" => "Other government scheme", _ => "Other",
        };
    }
}
