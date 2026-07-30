using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SeemanchalOutreach.Domain.Entities
{
    public class SurveyResponse
    {
        [Key]
        public Guid Id { get; set; } = Guid.NewGuid();

        // Idempotency: clientId + deviceId ensures same survey isn't inserted twice if sync retries
        [Required]
        [MaxLength(50)]
        public string ClientId { get; set; } = null!;

        [Required]
        [MaxLength(100)]
        public string DeviceId { get; set; } = null!;

        [Required]
        public string AgentId { get; set; } = string.Empty;

        public string? ContactId { get; set; }

        public string? PanchayatId { get; set; }

        public bool IsSkipped { get; set; } = false;

        public string? SkipReason { get; set; }

        // Store answers as a flexible JSON string (can be queried via PostgreSQL JSONB)
        [Column(TypeName = "jsonb")]
        public string AnswersJson { get; set; } = "{}";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime SyncedAt { get; set; } = DateTime.UtcNow;
    }
}
