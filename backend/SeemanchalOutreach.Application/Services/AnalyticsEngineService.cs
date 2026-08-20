using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using System.Text.Json;

namespace SeemanchalOutreach.Application.Services
{
    public class AnalyticsEngineService
    {
        private readonly IMarketingDbContext _context;

        public AnalyticsEngineService(IMarketingDbContext context)
        {
            _context = context;
        }

        public async Task<ExecutiveKpiDto> CalculateExecutiveKpisAsync(string? district, string? block)
        {
            // Note: Since survey responses contain AnswersJson, we fetch the relevant rows 
            // and parse them in-memory. For thousands of rows, this is extremely fast in .NET.
            var query = _context.SurveyResponses.AsNoTracking().AsQueryable();

            // District/Block filtering requires joining with Panchayat or extracting from JSON
            if (!string.IsNullOrEmpty(district) || !string.IsNullOrEmpty(block))
            {
                query = query.Where(r => 
                    _context.Panchayats.Any(p => p.PanchayatId == r.PanchayatId &&
                        (string.IsNullOrEmpty(district) || p.District == district) &&
                        (string.IsNullOrEmpty(block) || p.Block == block)
                    ));
            }

            var responses = await query.ToListAsync();
            var totalResponses = responses.Count;
            if (totalResponses == 0) return new ExecutiveKpiDto();

            int outflowCount = 0;
            int droppedOutCount = 0;
            int distressLoanCount = 0;
            int rmpTotal = 0;
            int rmpReady = 0;

            foreach (var r in responses)
            {
                if (string.IsNullOrEmpty(r.AnswersJson)) continue;

                try 
                {
                    var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(r.AnswersJson);
                    if (dict == null) continue;

                    // Outflow Leakage (treatment_destination)
                    if (dict.TryGetValue("treatment_destination", out var dest))
                    {
                        if (dest.Contains("Siliguri") || dest.Contains("Purnea") || dest.Contains("Patna") || dest.Contains("Kolkata"))
                            outflowCount++;
                        
                        if (dest.Contains("Kahin nahi jaate"))
                            droppedOutCount++;
                    }

                    // Distress Financing (payment_funding_source)
                    if (dict.TryGetValue("payment_funding_source", out var payment))
                    {
                        if (payment.Contains("Karz") || payment.Contains("Zameen"))
                            distressLoanCount++;
                    }

                    // RMP Tele-Triage Readiness
                    if (dict.TryGetValue("rmp_tele_triage_willingness", out var rmpTriage) && !string.IsNullOrEmpty(rmpTriage))
                    {
                        rmpTotal++;
                        if (rmpTriage.Contains("Haan, bilkul"))
                            rmpReady++;
                    }
                }
                catch { /* Ignore invalid JSON */ }
            }

            double outflowRate = (double)outflowCount / totalResponses;
            double abandonmentRate = (double)droppedOutCount / totalResponses;
            double distressFinancingIndex = (double)distressLoanCount / totalResponses;
            double rmpReadiness = rmpTotal > 0 ? (double)rmpReady / rmpTotal : 0.0;

            // Economic Leakage Math
            long estimatedCatchmentPop = 500000;
            double annualSurgicalIncidence = 0.012; // 1.2%
            double totalAnnualCases = estimatedCatchmentPop * annualSurgicalIncidence;
            double annualOutflowCases = totalAnnualCases * outflowRate;
            double estimatedAvgExpenditurePerTrip = 45000; // ₹45,000
            double totalLeakageCr = (annualOutflowCases * estimatedAvgExpenditurePerTrip) / 10000000.0; // ₹ Crores

            return new ExecutiveKpiDto
            {
                TotalSurveySample = totalResponses,
                OutflowLeakageRate = Math.Round(outflowRate * 100, 1),
                CareAbandonmentRate = Math.Round(abandonmentRate * 100, 1),
                DistressFinancingRate = Math.Round(distressFinancingIndex * 100, 1),
                RmpTeleTriageReadiness = Math.Round(rmpReadiness * 100, 1),
                AnnualEconomicLeakageCrores = Math.Round(totalLeakageCr, 2),
                EstimatedMonthlyOutflowCases = (int)Math.Round(annualOutflowCases / 12)
            };
        }

        public async Task<List<PricingOptimizationPointDto>> CalculatePriceElasticityAsync()
        {
            var responses = await _context.SurveyResponses.AsNoTracking().ToListAsync();
            var total = responses.Count;
            if (total == 0) return new List<PricingOptimizationPointDto>();

            var bandCounts = new Dictionary<string, int>();

            foreach (var r in responses)
            {
                if (string.IsNullOrEmpty(r.AnswersJson)) continue;
                try
                {
                    var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(r.AnswersJson);
                    if (dict != null && dict.TryGetValue("affordable_surgical_budget", out var band) && !string.IsNullOrEmpty(band))
                    {
                        var cleanBand = band.Split('(')[0].Trim(); 
                        if (!bandCounts.ContainsKey(cleanBand)) bandCounts[cleanBand] = 0;
                        bandCounts[cleanBand]++;
                    }
                }
                catch { }
            }

            var priceTiers = new[]
            {
                new { Tier = "Tier 1: Economy", Price = 12000, BandKey = "₹8,000 – ₹14,000" },
                new { Tier = "Tier 2: Standard", Price = 20000, BandKey = "₹14,000 – ₹22,000" },
                new { Tier = "Tier 3: Mid-Daycare", Price = 28000, BandKey = "₹22,000 – ₹32,000" },
                new { Tier = "Tier 4: Tertiary", Price = 40000, BandKey = "₹32,000 – ₹45,000" }
            };

            int baseMonthlyCatchmentCases = 350;
            var result = new List<PricingOptimizationPointDto>();

            foreach (var tier in priceTiers)
            {
                var willingCount = bandCounts
                    .Where(b => GetPriceWeight(b.Key) >= GetPriceWeight(tier.BandKey))
                    .Sum(b => b.Value);

                double conversionRate = (double)willingCount / total;
                int monthlyPatients = (int)(baseMonthlyCatchmentCases * conversionRate);
                double projectedMonthlyRevenueLakhs = (monthlyPatients * tier.Price) / 100000.0;

                result.Add(new PricingOptimizationPointDto
                {
                    PackagePrice = tier.Price,
                    PriceTierName = tier.Tier,
                    ConversionRate = Math.Round(conversionRate * 100, 1),
                    EstimatedMonthlyPatients = monthlyPatients,
                    ProjectedMonthlyRevenueLakhs = Math.Round(projectedMonthlyRevenueLakhs, 2)
                });
            }

            return result;
        }

        private static int GetPriceWeight(string? band)
        {
            if (string.IsNullOrEmpty(band)) return 0;
            if (band.Contains("8,000")) return 1;
            if (band.Contains("14,000")) return 2;
            if (band.Contains("22,000")) return 3;
            if (band.Contains("32,000")) return 4;
            if (band.Contains("45,000")) return 5;
            return 0;
        }
    }

    public class ExecutiveKpiDto
    {
        public int TotalSurveySample { get; set; }
        public double OutflowLeakageRate { get; set; }
        public double CareAbandonmentRate { get; set; }
        public double DistressFinancingRate { get; set; }
        public double RmpTeleTriageReadiness { get; set; }
        public double AnnualEconomicLeakageCrores { get; set; }
        public int EstimatedMonthlyOutflowCases { get; set; }
    }

    public class PricingOptimizationPointDto
    {
        public int PackagePrice { get; set; }
        public string PriceTierName { get; set; } = string.Empty;
        public double ConversionRate { get; set; }
        public int EstimatedMonthlyPatients { get; set; }
        public double ProjectedMonthlyRevenueLakhs { get; set; }
    }
}
