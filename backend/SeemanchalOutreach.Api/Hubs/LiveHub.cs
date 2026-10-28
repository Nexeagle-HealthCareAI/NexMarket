using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Hubs
{
    /// <summary>
    /// Live dashboard feed. Only dashboard users (Admin, Marketing manager, Hospital
    /// representative) join the group that receives events; field agents can connect
    /// but receive nothing.
    /// </summary>
    [Authorize]
    public class LiveHub : Hub
    {
        public override async Task OnConnectedAsync()
        {
            if (Context.User.IsDashboardUser())
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, RoleChecks.DashboardGroup);
            }
            await base.OnConnectedAsync();
        }
    }

    public class LiveEventPublisher : ILiveEvents
    {
        private readonly IHubContext<LiveHub> _hub;
        private readonly ILogger<LiveEventPublisher> _logger;

        public LiveEventPublisher(IHubContext<LiveHub> hub, ILogger<LiveEventPublisher> logger)
        {
            _hub = hub;
            _logger = logger;
        }

        public async Task PublishAsync(LiveEvent e)
        {
            try
            {
                await _hub.Clients.Group(RoleChecks.DashboardGroup).SendAsync("event", new
                {
                    kind = e.Kind,
                    text = e.Text,
                    at = e.At,
                    refId = e.RefId,
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not publish live event {Kind}", e.Kind);
            }
        }

        public async Task PublishLocationAsync(LiveLocation l)
        {
            try
            {
                await _hub.Clients.Group(RoleChecks.DashboardGroup).SendAsync("location", new
                {
                    agentId = l.AgentId,
                    name = l.Name,
                    lat = l.Lat,
                    lng = l.Lng,
                    at = l.At,
                    accuracyM = l.AccuracyM,
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not publish live location for {AgentId}", l.AgentId);
            }
        }
    }
}
