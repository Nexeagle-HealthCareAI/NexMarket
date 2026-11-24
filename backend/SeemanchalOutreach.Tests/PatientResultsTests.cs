using System;
using System.Collections.Generic;
using System.Linq;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;
using Xunit;

namespace SeemanchalOutreach.Tests
{
    public class PatientResultsTests
    {
        private static PatientReferral R(string id, string status, string device = "app", Guid? camp = null, bool arrived = false, bool admitted = false) =>
            new() { ClientId = id, Status = status, DeviceId = device, CampId = camp, AgentId = device == "crm-camp" ? "" : "MKT-1001",
                ArrivedAt = arrived ? DateTime.UtcNow : null, AdmittedAt = admitted ? DateTime.UtcNow : null };

        [Fact]
        public void Where_a_patient_came_from()
        {
            Assert.Equal("camp", PatientResults.OriginOf(R("camp-1", "pending", "crm-camp", Guid.NewGuid())));
            Assert.Equal("partner", PatientResults.OriginOf(R("lead-1", "pending", "crm-leads")));
            Assert.Equal("agent", PatientResults.OriginOf(R("a1", "pending", "dev-123")));
            Assert.Equal("agent", PatientResults.OriginOf(R("a2", "pending", "crm")));
        }

        [Fact]
        public void What_became_of_them()
        {
            Assert.Equal("waiting", PatientResults.Outcome(R("1", "pending")));
            Assert.Equal("lost", PatientResults.Outcome(R("1", "lost")));
            Assert.Equal("came", PatientResults.Outcome(R("1", "arrived", arrived: true)));
            Assert.Equal("opd", PatientResults.Outcome(R("1", "arrived", arrived: true), hasOpdBill: true));
            Assert.Equal("opd", PatientResults.Outcome(R("1", "opd")));
            Assert.Equal("admitted", PatientResults.Outcome(R("1", "converted")));
            Assert.Equal("admitted", PatientResults.Outcome(R("1", "discharged")));
            // Admitted once stays admitted even if the stage moved on.
            Assert.Equal("admitted", PatientResults.Outcome(R("1", "lost", admitted: true)));
        }

        [Fact]
        public void The_tally_adds_people_and_money()
        {
            var camp = Guid.NewGuid();
            var refs = new[]
            {
                R("camp-a", "admitted", "crm-camp", camp), R("camp-b", "opd", "crm-camp", camp), R("camp-c", "pending", "crm-camp", camp),
                R("x1", "arrived", arrived: true), R("x2", "lost"),
            };
            var bills = new[]
            {
                new PatientResults.Bill("camp-a", "ipd", 40000m, 30000m), new PatientResults.Bill("camp-a", "pharmacy", 5000m, 5000m),
                new PatientResults.Bill("camp-b", "opd", 500m, 500m), new PatientResults.Bill("x1", "opd", 300m, 300m),
            };
            var lines = PatientResults.Lines(refs, bills);
            var all = PatientResults.TallyOf(lines);
            Assert.Equal(5, all.Referred);
            Assert.Equal(3, all.Came);
            Assert.Equal(2, all.Opd);          // camp-b, and x1 through its OPD bill
            Assert.Equal(1, all.Admitted);
            Assert.Equal(1, all.Waiting);
            Assert.Equal(1, all.Lost);
            Assert.Equal(45800m, all.Billed);
            Assert.Equal(35800m, all.Collected);
            Assert.Equal(800m, all.OpdBilled);
            var camps = PatientResults.TallyOf(lines.Where(l => l.Origin == "camp"));
            Assert.Equal(3, camps.Referred);
            Assert.Equal(45500m, camps.Billed);
        }
    }
}
