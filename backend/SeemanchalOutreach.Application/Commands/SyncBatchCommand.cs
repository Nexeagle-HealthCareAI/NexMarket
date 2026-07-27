using System;
using System.Collections.Generic;
using MediatR;

namespace SeemanchalOutreach.Application.Commands
{
    public class OutboxItemDto
    {
        public string Id { get; set; } = string.Empty;
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string AgentId { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty; // shift_start, shift_end, visit_checkin, visit_checkout, contact_new, contact_update, referral_new, trajectory_batch
        public string Payload { get; set; } = "{}"; // JSON payload
        public string Timestamp { get; set; } = string.Empty;
    }

    public class SyncResultDto
    {
        public string ClientId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public string ServerId { get; set; } = string.Empty;
        public string SyncedAt { get; set; } = string.Empty;
        public string Status { get; set; } = "error"; // created | already_exists | conflict | error
        public string? ErrorMessage { get; set; }
    }

    public class SyncBatchResponse
    {
        public List<SyncResultDto> Results { get; set; } = new();
        public List<DuplicateWarningDto> DuplicateWarnings { get; set; } = new();
    }

    public class DuplicateWarningDto
    {
        public string ClientId { get; set; } = string.Empty;
        public string PotentialDuplicateOf { get; set; } = string.Empty;
        public string Reason { get; set; } = string.Empty;
        public int MatchScore { get; set; }
    }

    public class SyncBatchCommand : IRequest<SyncBatchResponse>
    {
        public string AgentId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public List<OutboxItemDto> Items { get; set; } = new();
    }
}
