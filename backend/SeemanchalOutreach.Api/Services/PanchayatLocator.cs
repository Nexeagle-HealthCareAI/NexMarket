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
    /// <summary>Where a panchayat is on the map, and how sure we are.</summary>
    public record PanchayatSpot(double? Lat, double? Lng, string Source, int FieldCheckIns)
    {
        /// <summary>manual or field or villages — good enough to guide an agent to the door.</summary>
        public bool Precise => Source is "manual" or "field" or "villages" or "hq-village";
    }

    /// <summary>
    /// Picks the best known location for each panchayat:
    ///   1. a pin an admin placed by hand;
    ///   2. where agents actually checked in — used when the census estimate is only the
    ///      block centre (one check-in is enough), or when 3+ check-ins agree on a spot more
    ///      than 2 km from the census estimate;
    ///   3. the census estimate (matched villages, or the panchayat's own village);
    ///   4. the block centre.
    /// Check-ins far from everything else (over 25 km) are ignored as GPS noise.
    /// </summary>
    public static class PanchayatLocator
    {
        public static async Task<Dictionary<string, List<(double Lat, double Lng)>>> CheckInsAsync(
            IMarketingDbContext db, IReadOnlyCollection<string>? panchayatIds, CancellationToken ct)
        {
            var q = db.Visits.AsNoTracking().Where(v => v.CheckInLat != 0 && v.CheckInLng != 0);
            if (panchayatIds != null) q = q.Where(v => panchayatIds.Contains(v.PanchayatId));
            var rows = await q.OrderByDescending(v => v.CheckInAt).Take(20000)
                .Select(v => new { v.PanchayatId, v.CheckInLat, v.CheckInLng }).ToListAsync(ct);
            return rows.GroupBy(r => r.PanchayatId)
                .ToDictionary(g => g.Key, g => g.Select(r => (r.CheckInLat, r.CheckInLng)).ToList());
        }

        public static PanchayatSpot Resolve(Panchayat p, IReadOnlyList<(double Lat, double Lng)>? checkIns)
        {
            if (p.ManualLat is double ml && p.ManualLng is double mn)
                return new PanchayatSpot(ml, mn, "manual", checkIns?.Count ?? 0);

            var source = string.IsNullOrWhiteSpace(p.LocationSource) ? "block" : p.LocationSource;
            var census = (p.CentroidLat, p.CentroidLng);
            var pts = (checkIns ?? Array.Empty<(double, double)>()).ToList();
            if (pts.Count > 0)
            {
                var median = Median(pts);
                // Drop GPS outliers, then re-centre.
                pts = pts.Where(x => Km(x, median) <= 25).ToList();
                if (pts.Count > 0)
                {
                    median = Median(pts);
                    bool censusWeak = source == "block" || census.CentroidLat == null;
                    bool fieldDisagrees = pts.Count >= 3 && census.CentroidLat != null
                        && Km(median, (census.CentroidLat!.Value, census.CentroidLng!.Value)) > 2;
                    if (censusWeak || fieldDisagrees)
                        return new PanchayatSpot(Math.Round(median.Lat, 6), Math.Round(median.Lng, 6), "field", pts.Count);
                }
            }
            return new PanchayatSpot(p.CentroidLat, p.CentroidLng, source, pts.Count);
        }

        public static (double Lat, double Lng) Median(List<(double Lat, double Lng)> pts)
        {
            var lats = pts.Select(x => x.Lat).OrderBy(x => x).ToList();
            var lngs = pts.Select(x => x.Lng).OrderBy(x => x).ToList();
            return (lats[lats.Count / 2], lngs[lngs.Count / 2]);
        }

        public static double Km((double Lat, double Lng) a, (double Lat, double Lng) b)
        {
            const double r = Math.PI / 180;
            double h = Math.Pow(Math.Sin((b.Lat - a.Lat) * r / 2), 2)
                       + Math.Cos(a.Lat * r) * Math.Cos(b.Lat * r) * Math.Pow(Math.Sin((b.Lng - a.Lng) * r / 2), 2);
            return 12742 * Math.Asin(Math.Sqrt(h));
        }
    }
}
