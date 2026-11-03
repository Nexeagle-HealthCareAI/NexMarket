using System.Collections.Generic;

namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>
    /// Something a person should hear about. <see cref="To"/> are agentIds; <see cref="ToOffice"/> adds every
    /// office user (admins, marketing managers, and dashboard roles that can open the field pages).
    /// </summary>
    public class NotifyJob
    {
        public List<string> To { get; set; } = new();
        public bool ToOffice { get; set; }
        /// <summary>chat | team_chat | escalation | assignment | task | leave | referral | note</summary>
        public string Kind { get; set; } = "note";
        public string Title { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        /// <summary>Where a tap opens: chat:{threadId} | partner:{clientId} | referral:{clientId} | leave | tasks | assignments</summary>
        public string? Link { get; set; }
        public string? RefId { get; set; }
        /// <summary>Never notify this person (whoever caused it).</summary>
        public string? Except { get; set; }
    }

    /// <summary>
    /// Notifications: written to each person's inbox, pushed live to the CRM, and sent to their phone.
    /// Queued and delivered in the background, so a request never waits for (or fails because of) delivery.
    /// </summary>
    public interface INotifier
    {
        /// <summary>Never throws.</summary>
        void Notify(NotifyJob job);
    }
}
