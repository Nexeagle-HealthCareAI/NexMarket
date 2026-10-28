using System;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>
    /// One thing that just happened, pushed to everyone watching the dashboard.
    /// Kind: visit | referral | arrived | opd | admit | discharged | lost | partner | shift | call | payment | broadcast
    /// </summary>
    public class LiveEvent
    {
        public string Kind { get; set; } = string.Empty;
        public string Text { get; set; } = string.Empty;
        public DateTime At { get; set; } = DateTime.UtcNow;
        public string? RefId { get; set; }
    }

    /// <summary>An agent's newest GPS fix, pushed to the live map.</summary>
    public class LiveLocation
    {
        public string AgentId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public double Lat { get; set; }
        public double Lng { get; set; }
        public DateTime At { get; set; } = DateTime.UtcNow;
        public double? AccuracyM { get; set; }
    }

    public interface ILiveEvents
    {
        /// <summary>Never throws — a dashboard that can't be reached must not break the request that caused the event.</summary>
        Task PublishAsync(LiveEvent e);

        /// <summary>Never throws.</summary>
        Task PublishLocationAsync(LiveLocation location);
    }
}
