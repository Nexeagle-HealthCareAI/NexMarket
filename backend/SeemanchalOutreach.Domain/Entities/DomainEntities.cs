using System;
using System.Collections.Generic;

namespace SeemanchalOutreach.Domain.Entities
{
    public class FieldAgent
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string Role { get; set; } = "field_rep";
        public string PasswordHash { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class Panchayat
    {
        public string PanchayatId { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int Population { get; set; }
    }

    public class FieldShift
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public DateTime StartTime { get; set; }
        public DateTime? EndTime { get; set; }
        public double StartLat { get; set; }
        public double StartLng { get; set; }
        public double? EndLat { get; set; }
        public double? EndLng { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
    }

    public class FieldVisit
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public string PanchayatId { get; set; } = string.Empty;
        public DateTime CheckInAt { get; set; }
        public DateTime? CheckOutAt { get; set; }
        public double CheckInLat { get; set; }
        public double CheckInLng { get; set; }
        public double? CheckOutLat { get; set; }
        public double? CheckOutLng { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
    }

    public class OutreachContact
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public string PanchayatId { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty; // asha_worker, rmp_doctor, ward_member, medicine_shop
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public bool WhatsappAdded { get; set; }
        public bool CardGiven { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;

        // Duplicate resolution properties
        public string? PotentialDuplicateOf { get; set; } // JSON array or comma separated string of clientIds
        public bool IsMerged { get; set; } = false;
        public string? MergedIntoClientId { get; set; }
    }

    public class PatientReferral
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string ContactId { get; set; } = string.Empty; // client_id of contact
        public string AgentId { get; set; } = string.Empty;
        public string PatientName { get; set; } = string.Empty;
        public string Department { get; set; } = string.Empty;
        public string? Notes { get; set; }
        public string Status { get; set; } = "pending"; // pending, converted, lost
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
    }

    public class TrajectoryPoint
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public double Lat { get; set; }
        public double Lng { get; set; }
        public DateTime RecordedAt { get; set; }
        public double? AccuracyM { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
    }
}
