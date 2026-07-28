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
        /// <summary>
        /// Syncs the panchayats table to SeedData/panchayats.json on every startup: upserts
        /// records present in the file, and removes rows whose PanchayatId is no longer present
        /// (e.g. superseded placeholder data). Contacts reference panchayats by a loose string
        /// PanchayatId (no FK), so removing a stale panchayat never fails — it just leaves any
        /// contact created against that old ID with an unresolved location going forward.
        /// </summary>
        public static async Task SyncAsync(MarketingDbContext db, string contentRootPath)
        {
            string path = Path.Combine(contentRootPath, "SeedData", "panchayats.json");
            if (!File.Exists(path)) return;

            var json = await File.ReadAllTextAsync(path);
            var records = JsonSerializer.Deserialize<PanchayatSeedRecord[]>(json) ?? Array.Empty<PanchayatSeedRecord>();
            var validRecords = records.Where(r => !string.IsNullOrWhiteSpace(r.Id) && !string.IsNullOrWhiteSpace(r.Name)).ToList();
            var sourceIds = validRecords.Select(r => r.Id).ToHashSet();

            var existing = await db.Panchayats.ToDictionaryAsync(p => p.PanchayatId);

            foreach (var kvp in existing)
            {
                if (!sourceIds.Contains(kvp.Key))
                {
                    db.Panchayats.Remove(kvp.Value);
                }
            }

            foreach (var r in validRecords)
            {
                var state = string.IsNullOrWhiteSpace(r.State) ? "Bihar" : r.State;
                if (existing.TryGetValue(r.Id, out var p))
                {
                    p.LgdCode = r.LgdCode;
                    p.Name = r.Name;
                    p.Block = r.Block;
                    p.District = r.District;
                    p.State = state;
                    p.CentroidLat = r.CentroidLat;
                    p.CentroidLng = r.CentroidLng;
                }
                else
                {
                    db.Panchayats.Add(new Panchayat
                    {
                        PanchayatId = r.Id,
                        LgdCode = r.LgdCode,
                        Name = r.Name,
                        Block = r.Block,
                        District = r.District,
                        State = state,
                        CentroidLat = r.CentroidLat,
                        CentroidLng = r.CentroidLng,
                    });
                }
            }

            await db.SaveChangesAsync();
        }
    }
}
