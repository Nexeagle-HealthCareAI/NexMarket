using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Domain.Entities;
using SeemanchalOutreach.Infrastructure.Persistence;

namespace SeemanchalOutreach.Api.SeedData
{
    public class PanchayatSeedRecord
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("lgdCode")]
        public string LgdCode { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("block")]
        public string Block { get; set; } = string.Empty;

        [JsonPropertyName("district")]
        public string District { get; set; } = string.Empty;

        [JsonPropertyName("state")]
        public string State { get; set; } = "Bihar";

        [JsonPropertyName("centroidLat")]
        public double? CentroidLat { get; set; }

        [JsonPropertyName("centroidLng")]
        public double? CentroidLng { get; set; }
    }

    public static class PanchayatSeeder
    {
        public static async Task SeedIfEmptyAsync(MarketingDbContext db, string contentRootPath)
        {
            if (await db.Panchayats.AnyAsync()) return;

            string path = Path.Combine(contentRootPath, "SeedData", "panchayats.json");
            if (!File.Exists(path)) return;

            var json = await File.ReadAllTextAsync(path);
            var records = JsonSerializer.Deserialize<PanchayatSeedRecord[]>(json) ?? Array.Empty<PanchayatSeedRecord>();

            foreach (var r in records)
            {
                if (string.IsNullOrWhiteSpace(r.Id) || string.IsNullOrWhiteSpace(r.Name)) continue;

                db.Panchayats.Add(new Panchayat
                {
                    PanchayatId = r.Id,
                    LgdCode = r.LgdCode,
                    Name = r.Name,
                    Block = r.Block,
                    District = r.District,
                    State = string.IsNullOrWhiteSpace(r.State) ? "Bihar" : r.State,
                    CentroidLat = r.CentroidLat,
                    CentroidLng = r.CentroidLng,
                });
            }

            await db.SaveChangesAsync();
        }
    }
}
