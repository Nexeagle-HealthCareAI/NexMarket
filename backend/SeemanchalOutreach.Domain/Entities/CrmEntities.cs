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
        /// <summary>The referred patient this service was for (travel with them, ambulance…), when it was for one.</summary>
        public string? ReferralClientId { get; set; }

        // Proof of payment, so nobody can dispute it: a UPI/bank screenshot from the office, or, for cash handed over by
        // the field agent, a photo with the person taken in the app (time and place recorded).
        public string? Method { get; set; }              // upi | bank | cash | cheque
        public string? ProofKey { get; set; }            // private file storage key
        public string? ProofMime { get; set; }
        public string? ProofKind { get; set; }           // screenshot | cash_photo | receipt
        public DateTime? ProofAt { get; set; }           // when the photo was taken / the proof added
        public double? ProofLat { get; set; }
        public double? ProofLng { get; set; }
        public string? ProofBy { get; set; }
        /// <summary>The field agent asked to hand this over in cash (they record it with a photo in the app).</summary>
        public string? CashAgentId { get; set; }
        /// <summary>The partner confirmed they got the money (recorded by their agent or the office).</summary>
        public DateTime? ReceivedConfirmedAt { get; set; }
        public string? ReceivedConfirmedBy { get; set; }
    }

    /// <summary>
    /// One amount the hospital billed a referred patient (OPD, admission, procedure, pharmacy, lab…) and what was
    /// collected, entered by the referral desk. Never deleted: a wrong entry is voided with a reason.
    /// </summary>
    public class ReferralBill
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ReferralClientId { get; set; } = string.Empty;
        public string Kind { get; set; } = "ipd";            // opd | ipd | procedure | pharmacy | lab | other
        public decimal Amount { get; set; }                  // billed
        public decimal Collected { get; set; }               // received so far
        public string Scheme { get; set; } = "cash";         // cash | ayushman | insurance | govt_scheme | other
        public string? BillNumber { get; set; }
        public string? Note { get; set; }
        public DateTime BilledOn { get; set; } = DateTime.UtcNow;
        public string Status { get; set; } = "active";       // active | void
        public string? VoidReason { get; set; }
        public string? VoidedBy { get; set; }
        public DateTime? VoidedAt { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// What a field agent (an employee) earns for a referred patient, e.g. a fixed amount when the patient is admitted.
    /// Waits for an admin's approval, then is marked paid with a reference, like partner payments.
    /// </summary>
    public class AgentIncentive
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string AgentId { get; set; } = string.Empty;
        public string? ReferralClientId { get; set; }
        public decimal Amount { get; set; }
        public string Reason { get; set; } = string.Empty;
        public bool Auto { get; set; }                        // added by the incentive rule, not by hand
        public string Status { get; set; } = "pending_approval"; // pending_approval | approved | paid | rejected
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? PaidBy { get; set; }
        public DateTime? PaidAt { get; set; }
        public string? PaymentReference { get; set; }
        public string? Notes { get; set; }
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
        public string Source { get; set; } = "note";          // note | visit | revisit | call
        public DateTime CreatedAt { get; set; }
        /// <summary>Where the agent was when they wrote it (visits and revisits), from the phone's GPS.</summary>
        public double? Lat { get; set; }
        public double? Lng { get; set; }
        public double? AccuracyM { get; set; }
        public DateTime ServerReceivedAt { get; set; } = DateTime.UtcNow;
        /// <summary>When the agent last changed the comment from the app; the first wording is kept in <see cref="OriginalText"/>.</summary>
        public DateTime? EditedAt { get; set; }
        public string? OriginalText { get; set; }
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

    /// <summary>
    /// A job given to a field agent from Block assignments ("Visit these 3 panchayats and drop referral kits").
    /// One row per agent; tasks given to several agents at once share a GroupId.
    /// </summary>
    public class AgentTask
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid GroupId { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string? Detail { get; set; }
        public string Priority { get; set; } = "normal";          // high | normal | low
        public DateOnly? DueDate { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public string? PanchayatIdsJson { get; set; }             // ["pid", …] — optional, panchayats in that block
        public string? ContactClientId { get; set; }              // optional partner
        public Guid? AiItemId { get; set; }                       // when made from an AI analyst action
        public string Status { get; set; } = "open";              // open | done | cancelled
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? SeenAt { get; set; }                     // first time the agent's app loaded it
        public DateTime? DoneAt { get; set; }
        public string? DoneNote { get; set; }
    }

    /// <summary>
    /// One change to one record (or a sign-in): who did it, from which device, and what changed.
    /// Written automatically when changes are saved; never edited.
    /// </summary>
    public class AuditLog
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateTime At { get; set; } = DateTime.UtcNow;
        public string ActorId { get; set; } = "system";      // agentId of the person, or "system"
        public string? ActorName { get; set; }
        public string? ActorRole { get; set; }
        public string Source { get; set; } = "system";       // crm | app | system
        public string? DeviceId { get; set; }
        public string? DeviceType { get; set; }              // desktop | tablet | phone
        public string? Ip { get; set; }
        public string? Request { get; set; }                 // e.g. "PUT /api/v1/partners/…/priority"
        public string Action { get; set; } = "update";       // create | update | delete | sign_in | sign_out | session_replaced | password_reset
        public string Entity { get; set; } = string.Empty;   // e.g. Partner, Referral, Visit
        public string? EntityId { get; set; }
        public string? Summary { get; set; }                 // a readable name: partner name, patient name, task title…
        public string? ChangesJson { get; set; }             // {"Priority":{"from":"normal","to":"high"}}
    }

    /// <summary>
    /// A chat: one per field agent with the office ("agent"), plus the whole-team group ("team").
    /// </summary>
    public class ChatThread
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Kind { get; set; } = "agent";          // agent | team | direct | merged (an old duplicate, kept but unused)
        public string? AgentId { get; set; }                 // Kind = agent: the agent; Kind = direct: one of the two people
        public string? PeerId { get; set; }                  // Kind = direct: the other person (AgentId < PeerId)
        public string? StartedBy { get; set; }               // Kind = direct: who opened it (an empty chat shows only to them)
        public string Title { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;
        public string? LastPreview { get; set; }
    }

    /// <summary>One chat message: text, an optional file, and an optional tagged partner. Never edited or removed.</summary>
    public class ChatMessage
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;  // idempotency key from the sender's device
        public Guid ThreadId { get; set; }
        public string SenderId { get; set; } = string.Empty;  // agentId of the person
        public string SenderName { get; set; } = string.Empty;
        public bool FromOffice { get; set; }                  // sent from the CRM
        public string? Text { get; set; }
        public string? ContactClientId { get; set; }          // tagged partner
        public string? ContactName { get; set; }
        public string? FileKey { get; set; }                  // private storage key; served only through the API
        public string? FileName { get; set; }
        public string? FileMime { get; set; }
        public long? FileSize { get; set; }
        public double? Lat { get; set; }
        public double? Lng { get; set; }
        public Guid? ReplyToId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One person's emoji reaction to a chat message (👍, ✅, 🙏…). One row per person and emoji.</summary>
    public class ChatReaction
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ThreadId { get; set; }
        public Guid MessageId { get; set; }
        public string UserId { get; set; } = string.Empty;
        public string UserName { get; set; } = string.Empty;
        public string Emoji { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>The message pinned at the top of a chat (at most one per chat), e.g. this week's targets.</summary>
    public class ChatPin
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ThreadId { get; set; }
        public Guid MessageId { get; set; }
        public string PinnedBy { get; set; } = string.Empty;
        public string PinnedByName { get; set; } = string.Empty;
        public DateTime PinnedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// A voice or video call started from a chat (one-to-one, an agent's office chat, or a Field team huddle). The audio and
    /// video go through the hospital's own LiveKit server; only who, when and how long is kept here. Never recorded.
    /// </summary>
    public class CallSession
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ThreadId { get; set; }
        public string Kind { get; set; } = "call";            // call (rings people) | huddle (Field team, people join)
        public bool Video { get; set; }
        public string Status { get; set; } = "ringing";       // ringing | active | ended | missed | declined
        public string StartedBy { get; set; } = string.Empty;
        public string StartedByName { get; set; } = string.Empty;
        public DateTime StartedAt { get; set; } = DateTime.UtcNow;
        public DateTime? AnsweredAt { get; set; }
        public DateTime? EndedAt { get; set; }
    }

    /// <summary>Someone invited to, or in, a call: when they were rung, joined and left.</summary>
    public class CallParticipant
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid CallId { get; set; }
        public string UserId { get; set; } = string.Empty;
        public string UserName { get; set; } = string.Empty;
        public DateTime InvitedAt { get; set; } = DateTime.UtcNow;
        public DateTime? JoinedAt { get; set; }
        public DateTime? LeftAt { get; set; }
        public bool Declined { get; set; }
    }

    /// <summary>How far each person has read a chat (for unread counts and the blue ticks).</summary>
    public class ChatRead
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ThreadId { get; set; }
        public string UserId { get; set; } = string.Empty;
        public bool IsOffice { get; set; }
        public DateTime LastReadAt { get; set; }
        public DateTime? LastSeenAt { get; set; }            // delivered: their app fetched messages up to here
    }

    /// <summary>
    /// One notification for one person: a chat message, an escalation, a new block, a task… Shown in the
    /// CRM bell and the app's inbox, and pushed to their phone. Never deleted; read when they open it.
    /// </summary>
    public class Notification
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string UserId { get; set; } = string.Empty;   // agentId of the person it is for
        public string Kind { get; set; } = "update";         // chat | team_chat | escalation | assignment | task | leave | referral | note
        public string Title { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        public string? Link { get; set; }                    // chat:{threadId} | partner:{clientId} | referral:{clientId} | leave | tasks | assignments
        public string? RefId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? ReadAt { get; set; }
    }

    /// <summary>A phone that can receive push notifications (Firebase Cloud Messaging token).</summary>
    public class PushDevice
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string UserId { get; set; } = string.Empty;
        public string Token { get; set; } = string.Empty;
        public string Platform { get; set; } = "android";
        public string? DeviceId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;
        public bool Enabled { get; set; } = true;
    }

    /// <summary>Which kinds of notification a person has turned off (they still land in the inbox, just without a push or sound).</summary>
    public class NotificationSetting
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string UserId { get; set; } = string.Empty;
        public string MutedKinds { get; set; } = string.Empty; // comma-separated kinds
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A field job title (Marketing executive, Field officer…) that people can be onboarded with.</summary>
    public class FieldRole
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? CreatedBy { get; set; }
    }

    /// <summary>
    /// Someone who might become a patient: a WhatsApp message to the hospital, a scan of a partner's QR code,
    /// a camp sign-up, a phone call to the desk… One lead per phone number; a later enquiry reopens it.
    /// </summary>
    public class Lead
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;          // 91XXXXXXXXXX
        public string Source { get; set; } = "whatsapp";           // whatsapp | partner_qr | partner | ad | camp | missed_call | walk_in | desk | agent | web
        public string? SourceRef { get; set; }                     // the ad, camp name or referral code it came from
        public string? PartnerClientId { get; set; }               // the partner who sent them (QR code or a partner's own message)
        public string? Department { get; set; }
        public string Status { get; set; } = "new";                // new | contacted | appointment | arrived | admitted | lost
        public string? LostReason { get; set; }
        public string? OwnerId { get; set; }                       // agentId of the person handling it
        public string? Note { get; set; }                          // first message or what the caller asked for
        public string? LastMessage { get; set; }
        public int Unread { get; set; }
        public bool OptOut { get; set; }                           // asked not to be messaged
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? CreatedBy { get; set; }
        public DateTime? FirstResponseAt { get; set; }
        public DateTime LastActivityAt { get; set; } = DateTime.UtcNow;
        public DateTime? LastInboundAt { get; set; }               // WhatsApp free replies are allowed for 24h after this
        public DateTime? ClosedAt { get; set; }
    }

    /// <summary>What happened to a lead: status and owner changes, notes, calls. WhatsApp messages are in <see cref="WaMessage"/>.</summary>
    public class LeadActivity
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid LeadId { get; set; }
        public string Kind { get; set; } = "note";                 // created | status | owner | note | call | reopened | source
        public string Text { get; set; } = string.Empty;
        public string? By { get; set; }                            // agentId; null = system
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One WhatsApp message to or from a person (not broadcasts, which are in BroadcastRecipient).</summary>
    public class WaMessage
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Phone { get; set; } = string.Empty;          // 91XXXXXXXXXX
        public Guid? LeadId { get; set; }
        public string Direction { get; set; } = "in";              // in | out
        public string Type { get; set; } = "text";                 // text | template | image | audio | document | location | button | other
        public string Text { get; set; } = string.Empty;
        public string? WaMessageId { get; set; }
        public string Status { get; set; } = "received";           // received | sent | delivered | read | failed
        public string? Error { get; set; }
        public string? SentBy { get; set; }                        // agentId for outgoing
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        /// <summary>What sent it: in | inbox | lead | auto | rule:{id} | followup | broadcast | test | resend</summary>
        public string Source { get; set; } = "in";
        public string? TemplateName { get; set; }
        public string? TemplateLanguage { get; set; }
        public string? ParamsJson { get; set; }                    // template values, so a failed one can be sent again
        public Guid? BroadcastId { get; set; }
    }

    /// <summary>
    /// One WhatsApp conversation per phone number: patients, partners, anyone who writes to (or gets a message from)
    /// the hospital's number. The WhatsApp inbox in the CRM lists these.
    /// </summary>
    public class WaConversation
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Phone { get; set; } = string.Empty;          // 91XXXXXXXXXX
        public string Name { get; set; } = string.Empty;
        public Guid? LeadId { get; set; }
        public string? PartnerClientId { get; set; }
        public string? AssignedTo { get; set; }                    // agentId
        public string Status { get; set; } = "open";               // open | done
        public int Unread { get; set; }
        public bool OptOut { get; set; }
        public string? LastMessage { get; set; }
        public string? LastDirection { get; set; }                 // in | out
        public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;
        public DateTime? LastInboundAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// A setting an admin changes from the CRM (WhatsApp connection, templates, messages…), so each hospital can set
    /// itself up without touching the server. Secrets (access token, app secret) are stored encrypted.
    /// A setting left empty here falls back to the server's configuration.
    /// </summary>
    public class AppSetting
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Key { get; set; } = string.Empty;           // e.g. whatsapp.phoneNumberId
        public string Value { get; set; } = string.Empty;         // "" = not set; secrets are "enc:v1:…"
        public bool IsSecret { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public string? UpdatedBy { get; set; }
    }

    /// <summary>A health camp the hospital runs in a village or town: the plan, who comes, and what was found.</summary>
    public class HealthCamp
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Title { get; set; } = string.Empty;
        /// <summary>Short code people send on WhatsApp ("Camp: KSB12") to book, and that is printed on the QR poster.</summary>
        public string Code { get; set; } = string.Empty;
        public string CampType { get; set; } = "general";      // general | eye | bone_joint | women | diabetes_bp | child | dental | heart | other
        public string? Departments { get; set; }               // comma-separated department names
        public string? Doctors { get; set; }                   // comma-separated doctor names
        public DateOnly Date { get; set; }
        public string StartTime { get; set; } = "09:00";
        public string EndTime { get; set; } = "14:00";
        public string? District { get; set; }
        public string? Block { get; set; }
        public string? PanchayatId { get; set; }
        public string? Venue { get; set; }
        public string? HostPartnerClientId { get; set; }       // the local partner hosting it (mukhiya, ASHA, school…)
        public string Status { get; set; } = "planned";        // planned | confirmed | done | cancelled
        public int Capacity { get; set; } = 150;               // pre-booking slots
        public int TargetRegistrations { get; set; } = 100;
        public int TargetReferrals { get; set; } = 15;
        public decimal Budget { get; set; }
        public decimal Spent { get; set; }
        public string? ChecklistJson { get; set; }             // the marketing plan: [{ "id", "phase", "text", "done", "doneBy", "doneAt" }]
        public string? Notes { get; set; }
        public string? Outcome { get; set; }                   // what went well / what to change, written after the camp
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One person at a health camp: booked beforehand or walked in, what they came with, and what the doctor found.</summary>
    public class CampPatient
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid CampId { get; set; }
        public int Token { get; set; }                         // queue number on the day
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }                     // 91XXXXXXXXXX
        public int? Age { get; set; }
        public string? Sex { get; set; }                       // M | F | O
        public string? Village { get; set; }
        public string Source { get; set; } = "walk_in";        // prebooked | whatsapp | partner | agent | walk_in
        public string? PartnerClientId { get; set; }           // who brought or booked them
        public string? Slot { get; set; }                      // booked time, e.g. "10:30"
        public string Status { get; set; } = "booked";         // booked | attended | no_show | cancelled
        public DateTime? ArrivedAt { get; set; }
        public string? Complaint { get; set; }                 // in their words
        public string? Symptoms { get; set; }                  // comma-separated codes
        public string? Conditions { get; set; }                // suspected, comma-separated codes
        public int? BpSystolic { get; set; }
        public int? BpDiastolic { get; set; }
        public int? Sugar { get; set; }                        // random blood sugar, mg/dL
        public decimal? WeightKg { get; set; }
        public int? Spo2 { get; set; }
        public string? Advice { get; set; }
        public bool ReferToHospital { get; set; }
        public string? Department { get; set; }
        public bool Urgent { get; set; }
        public Guid? LeadId { get; set; }                      // the follow-up lead in the Leads inbox
        public bool Consent { get; set; }                      // agreed to their details being kept and to be contacted
        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// One line of the disease register: how many people of one age group and gender, from one place, were seen with one
    /// disease or complaint on one day (at a health camp or elsewhere). No names or phone numbers: it is for spotting patterns.
    /// </summary>
    public class DiseaseRecord
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateOnly Date { get; set; }
        public string? ConditionCode { get; set; }             // a CampBook condition code when the disease matches one
        public string Disease { get; set; } = string.Empty;    // as shown: the condition's name, or what was typed
        public string AgeBand { get; set; } = "unknown";       // 0-5 | 6-14 | 15-29 | 30-44 | 45-59 | 60+ | unknown
        public string Sex { get; set; } = "U";                 // M | F | O | U (not recorded)
        public string? District { get; set; }
        public string? Block { get; set; }
        public string? PanchayatId { get; set; }
        public string? Panchayat { get; set; }                 // the name as entered when it didn't match a known panchayat
        public int Count { get; set; } = 1;
        public Guid? CampId { get; set; }
        public string Source { get; set; } = "grid";           // grid | upload
        public Guid? BatchId { get; set; }                     // rows saved together (one upload or one Save)
        public string Status { get; set; } = "active";         // active | removed
        public string? RemovedBy { get; set; }
        public DateTime? RemovedAt { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// A post the hospital put out: fetched from the Facebook Page and Instagram account (with reach and engagement), or
    /// logged by hand for WhatsApp Status, Channel or groups, which Meta does not let software read.
    /// </summary>
    public class SocialPost
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Channel { get; set; } = "facebook";       // facebook | instagram | whatsapp_status | whatsapp_channel | whatsapp_group | other
        public string? ExternalId { get; set; }                 // Meta's post / media id (null for posts logged by hand)
        public string Source { get; set; } = "synced";          // synced | manual
        public string? Text { get; set; }
        public string? MediaType { get; set; }                  // photo | video | reel | carousel | text | link | story
        public string? Permalink { get; set; }
        public string? ThumbnailUrl { get; set; }
        public DateTime PostedAt { get; set; }
        public int? Reach { get; set; }
        public int? Views { get; set; }
        public int? Likes { get; set; }
        public int? Comments { get; set; }
        public int? Shares { get; set; }
        public int? Saves { get; set; }
        public int? Clicks { get; set; }
        public DateTime? MetricsAt { get; set; }
        public string? Topic { get; set; }                      // a department or theme, for "which topics work"
        public string? Note { get; set; }
        public string Status { get; set; } = "active";         // active | removed
        public string? CreatedBy { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// One number for one day from one of the hospital's Google accounts, fetched by NexMarket itself: Business Profile
    /// (calls, direction requests, views), Search Console, GA4, YouTube or Google Ads. Totals only, never people.
    /// </summary>
    public class ChannelMetric
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public DateOnly Date { get; set; }
        public string Source { get; set; } = "gbp";              // gbp | gsc | ga4 | youtube | google_ads
        public string Account { get; set; } = "";                // location, property, site, channel or customer id
        public string Dimension { get; set; } = "";              // "" = the day's total; "channel:Organic Search", "campaign:123", "query:…", "keyword:…"
        public string? Label { get; set; }                       // what to show for the dimension (campaign name, …)
        public string Metric { get; set; } = "";                 // calls | directions | website_clicks | views | sessions | clicks | impressions | cost | …
        public decimal Value { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A review left on the hospital's Google Business Profile, with the hospital's reply (written in Google or from the CRM).</summary>
    public class GoogleReview
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ReviewName { get; set; } = "";             // accounts/…/locations/…/reviews/… (Google's id)
        public string Location { get; set; } = "";               // locations/…
        public string? ReviewerName { get; set; }
        public int Stars { get; set; }
        public string? Comment { get; set; }
        public DateTime PostedAt { get; set; }
        public DateTime? ReviewUpdatedAt { get; set; }
        public string? ReplyText { get; set; }
        public DateTime? RepliedAt { get; set; }
        public string? RepliedBy { get; set; }                   // CRM user who replied from NexMarket (null = replied in Google)
        public DateTime SyncedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// An occasional field survey: an area drawn on the map in the CRM, given to chosen people (agents, HR, anyone), who walk
    /// or ride it in the app, trace the route (coloured by road type) and mark spots (chowks, crossroads, banner places…),
    /// and answer a separate set of questions.
    /// </summary>
    public class FieldSurvey
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Title { get; set; } = string.Empty;
        public string? Instructions { get; set; }
        public string AreaJson { get; set; } = "[]";              // [[lng,lat], …] ring of the drawn area
        public string SpotTypesJson { get; set; } = "[]";         // ["Chowk", "Crossroad", …]
        public string RoadTypesJson { get; set; } = "[]";         // ["Village main road", …]
        public string QuestionsJson { get; set; } = "[]";         // [{ id, text, type: text|number|yesno|choice|multi, options, required }]
        public string Status { get; set; } = "active";            // draft | active | closed
        public DateOnly? DueDate { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? ClosedAt { get; set; }
    }

    /// <summary>One person given a field survey, their progress, and their answers to its questions.</summary>
    public class FieldSurveyAssignee
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid SurveyId { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string Status { get; set; } = "assigned";           // assigned | started | submitted
        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public DateTime? StartedAt { get; set; }
        public DateTime? SubmittedAt { get; set; }
        public DateTime? LastSyncAt { get; set; }
        public string? AnswersJson { get; set; }                   // { questionId: answer }
        public DateTime? AnswersAt { get; set; }
    }

    /// <summary>A stretch of route traced in the app on one road type (a new stretch starts when the road type changes or after a pause).</summary>
    public class FieldSurveyTrack
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public Guid SurveyId { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string? RoadType { get; set; }
        public string PointsJson { get; set; } = "[]";            // [[lat,lng,accuracyM,unixMs], …]
        public int PointCount { get; set; }
        public double DistanceM { get; set; }
        public DateTime StartedAt { get; set; }
        public DateTime? EndedAt { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A place marked on the map during a field survey: a chowk, crossroad, banner place… with its name, road type, note and photo.</summary>
    public class FieldSurveySpot
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string ClientId { get; set; } = string.Empty;
        public Guid SurveyId { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string Type { get; set; } = "Other";
        public string? Name { get; set; }
        public string? RoadType { get; set; }
        public double Lat { get; set; }
        public double Lng { get; set; }
        public double? AccuracyM { get; set; }
        public string? Note { get; set; }
        public string? PhotoKey { get; set; }
        public string? PhotoMime { get; set; }
        public DateTime TakenAt { get; set; }
        public bool Removed { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A card on the team board: a piece of work the office team plans, does and finishes.</summary>
    public class WorkCard
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public int Number { get; set; }                            // #12, easy to say out loud
        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string Status { get; set; } = "todo";              // idea | todo | doing | review | done
        public double Order { get; set; }                          // position inside its column
        public string Priority { get; set; } = "normal";          // urgent | high | normal | low
        public DateOnly? DueDate { get; set; }
        public string AssigneesJson { get; set; } = "[]";          // ["agentId", …]
        public string LabelsJson { get; set; } = "[]";             // ["camp", "social", …]
        public string? Project { get; set; }                       // a bigger piece of work the card belongs to
        public string ChecklistJson { get; set; } = "[]";          // [{ id, text, done }]
        public string? Link { get; set; }
        public string Repeat { get; set; } = "none";              // none | daily | weekdays | weekly | monthly
        public Guid? RepeatOf { get; set; }                        // the card this one was made from
        public Guid? ParentId { get; set; }                        // a sub-task's parent card (one level only)
        public int CommentCount { get; set; }
        public bool Archived { get; set; }
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? StartedAt { get; set; }
        public DateTime? DoneAt { get; set; }
        public string? DoneBy { get; set; }
    }

    /// <summary>A comment on a team-board card, or a line of its history (moved, assigned, due date changed…).</summary>
    /// <summary>A plan or document written on the Team board (rich text, saved as the editor's JSON).</summary>
    public class WorkDoc
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Title { get; set; } = string.Empty;
        public string Kind { get; set; } = "plan";                // plan | doc | notes
        public string ContentJson { get; set; } = "{}";           // the editor's document (Tiptap / ProseMirror JSON)
        public string PlainText { get; set; } = string.Empty;     // for search and previews
        public string? Project { get; set; }
        public Guid? CardId { get; set; }                          // the card it plans, if any
        public bool Pinned { get; set; }
        public bool Archived { get; set; }
        public int Version { get; set; } = 1;                      // goes up on every save; stops two people overwriting each other
        public string CreatedBy { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string UpdatedBy { get; set; } = string.Empty;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>An earlier version of a plan, kept when it is saved again, so nothing written is ever lost.</summary>
    public class WorkDocRevision
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid DocId { get; set; }
        public int Version { get; set; }
        public string Title { get; set; } = string.Empty;
        public string ContentJson { get; set; } = "{}";
        public string SavedBy { get; set; } = string.Empty;
        public DateTime SavedAt { get; set; }
    }

    public class WorkNote
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid CardId { get; set; }
        public string Kind { get; set; } = "comment";             // comment | activity
        public string AgentId { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A Facebook Messenger or Instagram Direct conversation with one person, on the hospital's Page or account.</summary>
    public class SocialConversation
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Channel { get; set; } = "messenger";         // messenger | instagram
        public string ExternalId { get; set; } = string.Empty;     // the person's ID for this Page/account (PSID / IGSID)
        public string? PageId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Username { get; set; }                      // Instagram handle
        public string? Phone { get; set; }                         // 91XXXXXXXXXX, once they share it
        public Guid? LeadId { get; set; }
        public string? AssignedTo { get; set; }                    // agentId
        public string Status { get; set; } = "open";               // open | done
        public int Unread { get; set; }
        public string? LastMessage { get; set; }
        public string? LastDirection { get; set; }                 // in | out
        public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;
        public DateTime? LastInboundAt { get; set; }               // replies are allowed for 24 hours after this
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>One message in a <see cref="SocialConversation"/>.</summary>
    public class SocialMessage
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid ConversationId { get; set; }
        public string Direction { get; set; } = "in";              // in | out
        public string Type { get; set; } = "text";                 // text | image | video | audio | file | sticker | story_reply | other
        public string? Text { get; set; }
        public string? ExternalId { get; set; }                    // Meta's message id (mid)
        public string Status { get; set; } = "received";           // received | sent | failed
        public string? Error { get; set; }
        public string? SentBy { get; set; }                        // agentId; null = from Meta's own inbox or automatic
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Someone who filled a Facebook or Instagram Lead Ads form: the answers as Meta sent them and the ad they came
    /// from (for cost per lead). The person is also a <see cref="Lead"/> when they gave a phone number.
    /// </summary>
    public class AdLead
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string LeadgenId { get; set; } = string.Empty;
        public string Platform { get; set; } = "fb";               // fb | ig
        public string? PageId { get; set; }
        public string? FormId { get; set; }
        public string? FormName { get; set; }
        public string? AdId { get; set; }
        public string? AdName { get; set; }
        public string? AdsetName { get; set; }
        public string? CampaignId { get; set; }
        public string? CampaignName { get; set; }
        public bool IsOrganic { get; set; }
        public string? FieldsJson { get; set; }                    // [{ "name": "full_name", "values": ["…"] }, …]
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public Guid? LeadId { get; set; }
        public string? Error { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow; // when they filled it (Meta's time)
        public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;
        /// <summary>The last lead stage reported back to Meta (Contacted, Appointment booked, Arrived, Admitted), so ads learn who becomes a patient.</summary>
        public string? StageSent { get; set; }
        /// <summary>When it was sent, or when sending last failed.</summary>
        public DateTime? StageSentAt { get; set; }
        public string? StageError { get; set; }
    }

    /// <summary>
    /// A place for a NexEagle banner or hoarding. A field agent suggests it from the app (photo + GPS), the office approves
    /// it with the rent, the agent marks it rented and then "banner up" with a photo. Rent is filled in and seen only in the CRM.
    /// </summary>
    public class Hoarding
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        /// <summary>The phone's own id for this place, so sending it twice makes one row.</summary>
        public string ClientId { get; set; } = Guid.NewGuid().ToString("N");
        public string Place { get; set; } = string.Empty;
        public string? Landmark { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public double Lat { get; set; }
        public double Lng { get; set; }
        public double? Accuracy { get; set; }
        public string Kind { get; set; } = "hoarding";            // hoarding | wall | shop | pole | gate | other
        public string? Size { get; set; }                          // as written: "20 x 10 ft"
        public string Status { get; set; } = "suggested";         // suggested | approved | rented | live | ended | rejected
        public string SuggestedBy { get; set; } = string.Empty;   // agentId (or the office user who added it)
        public string SuggestedByName { get; set; } = string.Empty;
        public string? AgentNote { get; set; }
        public string? OfficeNote { get; set; }
        public Guid? OwnerId { get; set; }
        public decimal? MonthlyRent { get; set; }
        public DateOnly? RentStart { get; set; }
        public DateOnly? RentEnd { get; set; }
        /// <summary>The end date the office was last reminded about (one reminder per end date).</summary>
        public DateOnly? RemindedFor { get; set; }
        public string? DecidedBy { get; set; }
        public DateTime? DecidedAt { get; set; }
        public string? RejectReason { get; set; }
        public DateTime? RentedAt { get; set; }
        public DateTime? LiveAt { get; set; }
        public DateTime? EndedAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>Who a hoarding place is rented from. One owner can have several places.</summary>
    public class HoardingOwner
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string? Address { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>A photo of a hoarding place: the empty site, or the banner once it is up. Kept in private storage.</summary>
    public class HoardingPhoto
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid HoardingId { get; set; }
        public string Kind { get; set; } = "site";                // site | banner
        public string FileKey { get; set; } = string.Empty;
        public string Mime { get; set; } = "image/jpeg";
        public string By { get; set; } = string.Empty;
        public DateTime At { get; set; } = DateTime.UtcNow;
    }
}
