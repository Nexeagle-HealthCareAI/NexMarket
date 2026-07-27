using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    public interface IPhotoUploadService
    {
        Task<string> UploadPhotoAsync(string fileName, Stream content, string contentType, CancellationToken cancellationToken = default);
    }
}
