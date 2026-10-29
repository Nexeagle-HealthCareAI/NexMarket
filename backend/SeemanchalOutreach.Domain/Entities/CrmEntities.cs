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

    /// <summary>
    /// A field agent's leave request. Urgent = today/tomorrow, for emergencies; holiday = planned.
    /// Both come out of one yearly allowance (Leave:YearlyAllowance, 24 days by default).
    /// Approved by an Admin or Marketing manager on the CRM.
    /// </summary>
    public class LeaveRequest
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string Type { get; set; } = "holiday";        // urgent | holiday
        public DateOnly FromDate { get; set; }
        public DateOnly ToDate { get; set; }
        public bool HalfDay { get; set; }
        public decimal Days { get; set; }                     // working days, Sundays and holidays excluded
        public string Reason { get; set; } = string.Empty;
        public string Status { get; set; } = "pending";      // pending | approved | rejected | cancelled
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? DecidedBy { get; set; }
        public DateTime? DecidedAt { get; set; }
        public string? DecisionNote { get; set; }
        public int FollowUpsMoved { get; set; }
    }

    /// <summary>A dated note on a partner, written by an agent in the app (or on the CRM).</summary>
    public class ContactNote
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;  // idempotency key from the device
        public string ContactClientId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public string Source { get; set; } = "note";          // note | visit | call
        public DateTime CreatedAt { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One run of the AI analyst: what it was shown, what it said, and how it went.</summary>
    public class AiBriefing
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string CreatedBy { get; set; } = string.Empty;    // AgentId, or "auto" for the daily run
        public string Scope { get; set; } = "business";          // business | surveys
        public DateTime PeriodFrom { get; set; }
        public DateTime PeriodTo { get; set; }
        public string Model { get; set; } = string.Empty;
        public string Status { get; set; } = "running";           // running | ok | failed
        public string? Error { get; set; }
        public string? Health { get; set; }                       // good | watch | bad
        public string? Summary { get; set; }
        public string? ResultJson { get; set; }                   // the analyst's full answer
        public string? DataJson { get; set; }                     // the figures it was given
        public int ToolCalls { get; set; }
        public int TokensUsed { get; set; }
        public DateTime? FinishedAt { get; set; }
    }

    /// <summary>An issue, opportunity or planned action the analyst raised, tracked until someone closes it.</summary>
    public class AiItem
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Key { get; set; } = string.Empty;           // stable slug so the same issue isn't raised twice
        public string Kind { get; set; } = "issue";               // issue | opportunity | plan
        public string Scope { get; set; } = "business";          // business | surveys
        public string Title { get; set; } = string.Empty;
        public string Detail { get; set; } = string.Empty;
        public string? Area { get; set; }                         // e.g. "Thakurganj block", "ASHA workers", "Gynae"
        public string? Metric { get; set; }                       // the number it's watching, as text
        public string Severity { get; set; } = "medium";          // high | medium | low
        public string Status { get; set; } = "open";              // open | in_progress | done | dismissed
        public string? Owner { get; set; }                        // free text: a person or a role
        public DateOnly? DueDate { get; set; }
        public string? Trend { get; set; }                        // the analyst's latest read: better | same | worse | resolved
        public string? TrendNote { get; set; }
        public string? Note { get; set; }                         // the team's own note
        public Guid FirstBriefingId { get; set; }
        public Guid LastBriefingId { get; set; }
        public int TimesRaised { get; set; } = 1;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public string? UpdatedBy { get; set; }
        public DateTime? ClosedAt { get; set; }
    }

    /// <summary>A change an admin made to a survey response (an edit, or the copy kept when one is deleted).</summary>
    public class SurveyEdit
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ResponseId { get; set; }
        public string Action { get; set; } = "edit";              // edit | delete
        public string ChangedBy { get; set; } = string.Empty;
        public DateTime ChangedAt { get; set; } = DateTime.UtcNow;
        public string BeforeJson { get; set; } = "{}";            // answers before (for delete: the whole response)
        public string? AfterJson { get; set; }
        public string? Summary { get; set; }                      // e.g. "Where patients go today: Purnea → Siliguri"
    }
}
