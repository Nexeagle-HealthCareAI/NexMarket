using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Disease data readings (BP, sugar, weight, height, SpO2, pulse, temperature) as typed from the printed sheet.</summary>
    public class DiseaseReadingsTests
    {
        private static (DiseaseRegister.Readings V, Dictionary<string, string> Bad) P(string? bp = null, string? sugar = null, string? weight = null,
            string? height = null, string? spo2 = null, string? pulse = null, string? temp = null) => DiseaseRegister.ParseReadings(bp, sugar, weight, height, spo2, pulse, temp);

        [Fact]
        public void Reads_values_with_units()
        {
            var (v, bad) = P("130/85 mmHg", "182 mg/dL", "62.5 kg", "160 cm", "96%", "78 bpm", "99.1");
            Assert.Empty(bad);
            Assert.Equal(130, v.BpSystolic); Assert.Equal(85, v.BpDiastolic);
            Assert.Equal(182, v.Sugar); Assert.Equal(62.5m, v.WeightKg); Assert.Equal(160m, v.HeightCm);
            Assert.Equal(96, v.Spo2); Assert.Equal(78, v.Pulse); Assert.Equal(99.1m, v.TempF);
            Assert.True(v.Any);
        }

        [Fact]
        public void Bp_can_be_written_several_ways()
        {
            Assert.Equal(140, P(bp: "140 - 90").V.BpSystolic);
            Assert.Equal(90, P(bp: "140 90").V.BpDiastolic);
            Assert.Contains("upper/lower", P(bp: "140").Bad["bp"]);
            Assert.Contains("upper number comes first", P(bp: "80/120").Bad["bp"]);
            Assert.Contains("can't be right", P(bp: "300/90").Bad["bp"]);
        }

        [Fact]
        public void Celsius_and_feet_are_converted()
        {
            Assert.Equal(100.4m, P(temp: "38").V.TempF);
            Assert.Equal(98.6m, P(temp: "37 °C").V.TempF);
            Assert.Equal(162.6m, P(height: "5'4\"").V.HeightCm);
            Assert.Equal(152.4m, P(height: "5 ft").V.HeightCm);
        }

        [Fact]
        public void Impossible_values_are_refused()
        {
            Assert.True(P(sugar: "1200").Bad.ContainsKey("sugar"));
            Assert.True(P(weight: "0").Bad.ContainsKey("weight"));
            Assert.True(P(spo2: "120").Bad.ContainsKey("spo2"));
            Assert.True(P(spo2: "96.5").Bad.ContainsKey("spo2"));
            Assert.True(P(pulse: "abc").Bad.ContainsKey("pulse"));
            Assert.True(P(temp: "120").Bad.ContainsKey("temp"));
            Assert.True(P(height: "300").Bad.ContainsKey("height"));
            var (v, bad) = P();
            Assert.Empty(bad);
            Assert.False(v.Any);
        }

        [Fact]
        public void Bmi_from_weight_and_height()
        {
            Assert.Equal(24.2m, DiseaseRegister.Bmi(62, 160));
            Assert.Null(DiseaseRegister.Bmi(62, null));
        }

        [Fact]
        public void Summary_counts_each_person_once_and_flags_high_readings()
        {
            var batch = Guid.NewGuid();
            var d = new DateOnly(2026, 11, 20);
            DiseaseRecord R(string disease, string age, int? sys, int? dia, int? sugar, int? spo2, decimal? kg = null, decimal? cm = null, decimal? temp = null, int count = 1) =>
                new() { Disease = disease, AgeBand = age, Sex = "F", Date = d, BatchId = batch, Block = "Baisi", Count = count, BpSystolic = sys, BpDiastolic = dia, Sugar = sugar, Spo2 = spo2, WeightKg = kg, HeightCm = cm, TempF = temp };
            var rows = new List<DiseaseRecord>
            {
                R("High BP", "45-59", 150, 95, 210, 96, 70, 160),
                R("Diabetes", "45-59", 150, 95, 210, 96, 70, 160),   // the same person, a second disease
                R("Fever", "6-14", null, null, null, 92, 25, 130, 101.2m),
                R("Cough", "60+", 120, 80, null, 98),
                R("Fever", "15-29", null, null, null, null, count: 5),  // a group: no readings
            };
            var o = System.Text.Json.JsonSerializer.Serialize(DiseaseRegister.ReadingsSummary(rows));
            Assert.Contains("\"people\":3", o);
            Assert.Contains("\"highBp\":1", o);
            Assert.Contains("\"highSugar\":1", o);
            Assert.Contains("\"lowSpo2\":1", o);
            Assert.Contains("\"fever\":1", o);
            Assert.Contains("\"overweight\":1", o);   // 70 kg, 160 cm → BMI 27.3
            Assert.Contains("\"underweight\":0", o);  // the child (BMI 14.8) is left out of the adult BMI groups
            Assert.Contains("\"bmi\":1", o);
        }
    }
}
