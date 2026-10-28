using System;

namespace SeemanchalOutreach.Domain.Entities
{
    /// <summary>
    /// Page-level access for a dashboard role (Marketing manager, Hospital representative).
    /// Admin is never stored here — Admin always has full control.
    /// Level: 0 = no access, 1 = can view, 2 = can edit.
    /// </summary>
    public class RolePermission
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Role { get; set; } = string.Empty;
        public string PageKey { get; set; } = string.Empty;
        public int Level { get; set; }
        public string? UpdatedBy { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A calling cycle: every partner is called once between StartDate and EndDate.</summary>
    public class CallCycle
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public int Number { get; set; }
        public DateTime StartDate { get; set; }   // UTC instant of the first day's start (IST midnight)
        public DateTime EndDate { get; set; }     // UTC instant of the last day's start (IST midnight)
        public DateTime? ClosedAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One phone call made by the marketing team to a partner.</summary>
    public class CallLog
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ContactClientId { get; set; } = string.Empty;
        public int CycleNumber { get; set; }
        public string CalledBy { get; set; } = string.Empty;        // AgentId of the caller
        public string Outcome { get; set; } = string.Empty;         // connected | no_answer | call_later | wrong_number
        public string? Responses { get; set; }                      // comma-separated response keys
        public string? Note { get; set; }
        public int Attempt { get; set; }
        public DateTime? CallBackAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>An amount the hospital owes a partner (camp support, travel, services).</summary>
    public class PartnerPayment
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ContactClientId { get; set; } = string.Empty;
        public string Purpose { get; set; } = string.Empty;
        public string? Period { get; set; }
        public decimal Amount { get; set; }
        public string Status { get; set; } = "pending_approval";   // pending_approval | approved | paid | rejected
        public DateTime? DueDate { get; set; }
        public string? Notes { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? PaidBy { get; set; }
        public DateTime? PaidAt { get; set; }
        public string? PaymentReference { get; set; }
    }

    public class Department
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public int Order { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public class Doctor
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public Guid? DepartmentId { get; set; }
        public string? Qualification { get; set; }
        public string? OpdDays { get; set; }       // e.g. "Mon, Wed, Fri"
        public string? OpdTimings { get; set; }    // e.g. "10 am – 2 pm"
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>Every stage change of a referral (who marked it, when).</summary>
    public class ReferralStatusEntry
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ReferralClientId { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string? Note { get; set; }
        public string ChangedBy { get; set; } = string.Empty;
        public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A WhatsApp message sent to many contacts at once.</summary>
    public class Broadcast
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Kind { get; set; } = "general_update";  // doctor_availability | schedule_change | camp_invite | general_update
        public string Title { get; set; } = string.Empty;
        public string Language { get; set; } = "hi";
        public string ParamsJson { get; set; } = "{}";
        public string AudienceJson { get; set; } = "{}";
        public string PreviewText { get; set; } = string.Empty;
        public int RecipientCount { get; set; }
        public DateTime? ScheduledAt { get; set; }
        public string Status { get; set; } = "scheduled";   // scheduled | sending | sent | failed | cancelled
        public string? Error { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? SentAt { get; set; }
        public int SentCount { get; set; }
        public int DeliveredCount { get; set; }
        public int ReadCount { get; set; }
        public int ReplyCount { get; set; }
        public int FailedCount { get; set; }
    }

    public class BroadcastRecipient
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid BroadcastId { get; set; }
        public string ContactClientId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Status { get; set; } = "queued";      // queued | sent | delivered | read | failed
        public string? ProviderMessageId { get; set; }
        public string? Error { get; set; }
        public DateTime? SentAt { get; set; }
        public DateTime? DeliveredAt { get; set; }
        public DateTime? ReadAt { get; set; }
        public DateTime? RepliedAt { get; set; }
    }
}
