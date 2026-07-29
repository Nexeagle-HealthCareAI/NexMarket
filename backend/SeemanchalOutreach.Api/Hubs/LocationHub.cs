using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace SeemanchalOutreach.Api.Hubs
{
    public class LocationUpdateDto
    {
        public double Lat { get; set; }
        public double Lng { get; set; }
        public string Status { get; set; } = "online";
        public string Timestamp { get; set; } = string.Empty;
    }

    // Requires a valid JWT — without this, anyone (no login needed, WebSocket
    // connections aren't subject to browser CORS) could connect and both read
    // every agent's live GPS/sync telemetry and inject fake location updates.
    [Authorize]
    public class LocationHub : Hub
    {
        public async Task BroadcastLocation(LocationUpdateDto update)
        {
            // AgentId/AgentName come from the caller's own JWT, never from the
            // payload — otherwise any connected agent could spoof another
            // agent's identity in the admin dashboard's live map.
            var agentId = Context.User?.FindFirst("agentId")?.Value;
            var agentName = Context.User?.FindFirst(ClaimTypes.Name)?.Value;
            if (string.IsNullOrEmpty(agentId)) return;

            await Clients.All.SendAsync("ReceiveLocationUpdate", new
            {
                AgentId = agentId,
                AgentName = agentName,
                update.Lat,
                update.Lng,
                update.Status,
                update.Timestamp,
            });
        }
    }
}
