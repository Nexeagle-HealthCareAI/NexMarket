using System;
using SeemanchalOutreach.Api.Controllers;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    /// <summary>Field agents booking people into health camps, and marking them arrived on the day.</summary>
    public class CampAgentBookingTests
    {
        [Fact]
        public void A_booking_keeps_place_vitals_and_sugar_test()
        {
            var p = new CampPatient { Source = "agent", Status = "booked" };
            var err = CampsController.ApplyPatient(p, new CampPatientDto
            {
                Name = " Rafiya Khatoon ", Age = 52, Sex = "F", Phone = "98765 43210", Village = "Gerwa", PanchayatId = "p-1",
                BpSystolic = 158, BpDiastolic = 96, Pulse = 88, TempF = 99.1m, Sugar = 212, SugarKind = "fasting",
            });
            Assert.Null(err);
            Assert.Equal("Rafiya Khatoon", p.Name);
            Assert.Equal("919876543210", p.Phone);
            Assert.Equal("p-1", p.PanchayatId);
            Assert.Equal("fasting", p.SugarKind);
            Assert.Equal(88, p.Pulse);
        }

        [Fact]
        public void Wrong_readings_are_refused()
        {
            Assert.NotNull(CampsController.ApplyPatient(new CampPatient(), new CampPatientDto { Pulse = 400 }));
            Assert.NotNull(CampsController.ApplyPatient(new CampPatient(), new CampPatientDto { TempF = 37 }));
            Assert.NotNull(CampsController.ApplyPatient(new CampPatient(), new CampPatientDto { SugarKind = "after tea" }));
        }

        [Fact]
        public void Arrived_then_undone_clears_the_time_and_keeps_who_marked_it()
        {
            var p = new CampPatient { Status = "booked" };
            CampsController.ApplyPatient(p, new CampPatientDto { Status = "attended" });
            CampDesk.Marked(p, "MKT-1001", "app");
            Assert.NotNull(p.ArrivedAt);
            Assert.Equal("app", p.StatusVia);
            CampsController.ApplyPatient(p, new CampPatientDto { Status = "booked" });
            CampDesk.Marked(p, "ADMIN", "crm");
            Assert.Null(p.ArrivedAt);
            Assert.Equal("ADMIN", p.StatusBy);
            Assert.Equal("crm", p.StatusVia);
        }

        [Fact]
        public void The_token_message_names_the_place_and_time()
        {
            var c = new HealthCamp { Title = "Bone camp", Date = new DateOnly(2026, 11, 29), StartTime = "09:00", EndTime = "14:00", Venue = "Panchayat bhawan", Block = "Kasba" };
            Assert.Equal("29 Nov, 09:00–14:00", CampDesk.When(c));
            Assert.Equal("Panchayat bhawan, Kasba", CampDesk.Place(c));
            Assert.Equal("Purnia", CampDesk.Place(new HealthCamp { District = "Purnia" }));
        }
    }
}
