using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>
    /// Private file storage (chat attachments). Files get a storage key, never a public link:
    /// they are only read back through the API after checking who is asking.
    /// </summary>
    public interface IFileStore
    {
        Task<string> SaveAsync(string folder, string fileName, Stream content, string contentType, CancellationToken ct = default);
        Task<(Stream Content, string ContentType)?> OpenAsync(string key, CancellationToken ct = default);
    }
}
