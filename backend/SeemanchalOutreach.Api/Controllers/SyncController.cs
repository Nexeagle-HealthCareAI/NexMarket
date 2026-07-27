using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SeemanchalOutreach.Api.Hubs;
using SeemanchalOutreach.Application.Commands;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class SyncController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly IPhotoUploadService _photoUploadService;
        private readonly IHubContext<LocationHub> _locationHub;

        public SyncController(IMediator mediator, IPhotoUploadService photoUploadService, IHubContext<LocationHub> locationHub)
        {
            _mediator = mediator;
            _photoUploadService = photoUploadService;
            _locationHub = locationHub;
        }

        [HttpPost("batch")]
        public async Task<ActionResult<SyncBatchResponse>> SyncBatch([FromBody] SyncBatchCommand command, CancellationToken cancellationToken)
        {
            if (command == null || command.Items == null)
            {
                return BadRequest("Invalid sync batch payload.");
            }

            var response = await _mediator.Send(command, cancellationToken);

            int syncedCount = response.Results.Count(r => r.Status == "created" || r.Status == "already_exists");

            // Notify real-time admin dashboard if any items processed successfully
            if (syncedCount > 0)
            {
                await _locationHub.Clients.All.SendAsync("ReceiveSyncNotification", new
                {
                    AgentId = command.AgentId,
                    DeviceId = command.DeviceId,
                    SyncedCount = syncedCount,
                    DuplicateFlags = response.DuplicateWarnings.Count
                }, cancellationToken);
            }

            return Ok(response);
        }

        [HttpPost("photo")]
        public async Task<ActionResult<object>> UploadPhoto([FromForm] IFormFile file, CancellationToken cancellationToken)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest("No photo file uploaded.");
            }

            using var stream = file.OpenReadStream();
            string url = await _photoUploadService.UploadPhotoAsync(file.FileName, stream, file.ContentType, cancellationToken);

            return Ok(new { url, fileName = file.FileName });
        }
    }
}
