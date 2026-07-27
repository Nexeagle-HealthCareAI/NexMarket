using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

namespace SeemanchalOutreach.Api.Hubs
{
    public class LocationUpdateDto
    {
        public string AgentId { get; set; } = string.Empty;
        public string AgentName { get; set; } = string.Empty;
        public double Lat { get; set; }
        public double Lng { get; set; }
        public string Status { get; set; } = "online";
        public string Timestamp { get; set; } = string.Empty;
    }

    public class LocationHub : Hub
    {
        public async Task BroadcastLocation(LocationUpdateDto update)
        {
            // Broadcasts live telemetry to all connected admin dashboard clients
            await Clients.All.SendAsync("ReceiveLocationUpdate", update);
        }

        public override async Task OnConnectedAsync()
        {
            await base.OnConnectedAsync();
        }
    }
}
