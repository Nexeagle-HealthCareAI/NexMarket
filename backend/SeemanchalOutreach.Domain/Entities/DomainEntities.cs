using System;
using System.Collections.Generic;

namespace SeemanchalOutreach.Domain.Entities
{
    public class FieldAgent
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string? Email { get; set; }
        public string Name { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string Role { get; set; } = "field_rep";
        public string PasswordHash { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;

        // True for the seeded default admin and every onboarded agent (both start
        // on a system-issued password) — cleared once they successfully change it.
        public bool MustChangePassword { get; set; } = false;

        public string? PhotoUrl { get; set; }
        public string? Education { get; set; } // "Education Qualification"
        public string? PersonalDetails { get; set; } // free-text "about me" bio, distinct from the structured fields below
        public bool ProfileCompleted { get; set; } = false;

        // Structured identity/profile fields (admin-collected at onboarding, editable later
        // by the agent or an admin). Name stays the source of truth for display/JWT — kept in
        // sync from First/Middle/Last whenever they're set.
        public string? FirstName { get; set; }
        public string? MiddleName { get; set; }
        public string? LastName { get; set; }
        public DateTime? DateOfBirth { get; set; } // Age is derived from this, not stored
        public string? Gender { get; set; }
        public string? Address { get; set; }
        public string? Pincode { get; set; }
        public string? WorkExperience { get; set; } // "Prior Work Experience"
        public string? EmergencyContactName { get; set; }
        public string? EmergencyContactPhone { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    // One row per (AgentId, DeviceId) — lets an agent stay logged in on more than
    // one device at once. Token is stored hashed and rotated on every refresh, so
    // a stolen DB row alone can't be replayed as a live session token. A password
    // change deletes every row for the agent, revoking all devices at once.
    public class AgentRefreshToken
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string TokenHash { get; set; } = string.Empty;
        public DateTime ExpiresAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class Panchayat
    {
        public string PanchayatId { get; set; } = string.Empty; // UUID string — matches LocalPanchayat.id on the client
        public string LgdCode { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string State { get; set; } = "Bihar";
        public string Name { get; set; } = string.Empty;
        public double? CentroidLat { get; set; }
        public double? CentroidLng { get; set; }
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
        
        public string Status { get; set; } = "Lead"; // Lead, Contacted, FollowUp, Converted, Closed
        public DateTime? FollowUpDate { get; set; }
        public string? Comments { get; set; }

        // Admin CRM engagement tracking (set from the contact profile page, not mobile sync)
        public string? Relation { get; set; } // Unknown, Supporter, Neutral, Opponent, Core Member
        public string? Complaints { get; set; }
        public string? Conflicts { get; set; }

        public DateTime CreatedAt { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;

        // Duplicate resolution properties
        public string? PotentialDuplicateOf { get; set; } // clientId of the contact this one was flagged against
        public bool IsMerged { get; set; } = false;
        public string? MergedIntoClientId { get; set; }
        public DateTime? DuplicateReviewedAt { get; set; } // set when dismissed as "not a duplicate"; left null while merged (IsMerged carries that state)
    }

    // Audit trail for OutreachContact.Status/Comments changes — written on every
    // create/update, from both the admin CRM pipeline and the field agent's mobile
    // sync. Referenced by OutreachContact.ClientId (not Id), matching how the rest
    // of the sync layer identifies contacts.
    public class ContactHistoryEntry
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ContactClientId { get; set; } = string.Empty;
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public string UpdatedBy { get; set; } = string.Empty;
        public string PreviousStatus { get; set; } = string.Empty;
        public string NewStatus { get; set; } = string.Empty;
        public string? Comments { get; set; }
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

    // A block-level task handed to a field agent — "go cover Kasba block". Kept as its own
    // history (rather than just overwriting FieldAgent.District/Block) so admins can see past
    // assignments, not just the current one. Progress (visited vs total panchayats) is derived
    // at read time from FieldVisit + Panchayat, not stored here.
    public class BlockAssignment
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string Status { get; set; } = "Active"; // Active | Completed | Cancelled
        public string? AssignedByAgentId { get; set; }
        public string? Notes { get; set; }
        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public DateTime? CompletedAt { get; set; }
    }
}
