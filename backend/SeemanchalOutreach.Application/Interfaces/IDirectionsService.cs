using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    public record RouteResult(
        double DistanceMeters,
        double DurationSeconds,
        IReadOnlyList<(double Lng, double Lat)> Geometry
    );

    public interface IDirectionsService
    {
        /// <returns>Null if no route could be found (unreachable, provider error, etc.) — callers fall back to a straight-line estimate.</returns>
        Task<RouteResult?> GetRouteAsync(double fromLat, double fromLng, double toLat, double toLng, CancellationToken cancellationToken = default);
    }
}
