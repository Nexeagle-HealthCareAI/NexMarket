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

        /// <summary>Removes a stored file for good. Only for a file of the organisation in charge. False when it could not be removed.</summary>
        Task<bool> DeleteAsync(string key, CancellationToken ct = default);

        /// <summary>
        /// A published app build under "app-releases/" (put there by the Android build, shared by every organisation).
        /// Null when it isn't there or the key is outside that folder.
        /// </summary>
        Task<(Stream Content, string ContentType, long? Length)?> OpenReleaseAsync(string key, CancellationToken ct = default);
    }
}
