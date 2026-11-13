using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Infrastructure.Services
{
    /// <summary>
    /// Chat attachments in the same object-storage bucket as agent photos, but private: no
    /// pre-signed links are handed out; the API streams a file only to someone allowed to see it.
    /// Without bucket settings (a developer's machine) files go to a local folder instead.
    /// </summary>
    public class PrivateFileStore : IFileStore
    {
        private readonly IAmazonS3? _s3;
        private readonly string _bucket;
        private readonly string _localRoot;
        private readonly ILogger<PrivateFileStore> _logger;

        public PrivateFileStore(IConfiguration config, ILogger<PrivateFileStore> logger)
        {
            _logger = logger;
            var serviceUrl = config["S3:ServiceUrl"] ?? "";
            var accessKey = config["S3:AccessKey"] ?? "";
            var secretKey = config["S3:SecretKey"] ?? "";
            _bucket = config["S3:BucketName"] ?? "";
            _localRoot = config["Files:LocalPath"] ?? Path.Combine(AppContext.BaseDirectory, "data", "files");
            if (new[] { serviceUrl, accessKey, secretKey, _bucket }.All(s => !string.IsNullOrWhiteSpace(s)))
            {
                var forcePathStyle = !bool.TryParse(config["S3:ForcePathStyle"], out var fps) || fps;
                try
                {
                    var u = new Uri(serviceUrl);
                    if (u.Host.StartsWith(_bucket + ".", StringComparison.OrdinalIgnoreCase))
                    {
                        serviceUrl = $"{u.Scheme}://{u.Host[(_bucket.Length + 1)..]}";
                        forcePathStyle = false;
                    }
                }
                catch (UriFormatException) { /* use as given */ }
                _s3 = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), new AmazonS3Config
                {
                    ServiceURL = serviceUrl,
                    ForcePathStyle = forcePathStyle,
                    AuthenticationRegion = config["S3:Region"] ?? "ap-south-1",
                });
            }
        }

        public async Task<string> SaveAsync(string folder, string fileName, Stream content, string contentType, CancellationToken ct = default)
        {
            var ext = new string(Path.GetExtension(fileName).Where(c => char.IsLetterOrDigit(c) || c == '.').ToArray());
            if (ext.Length > 10) ext = "";
            var key = OrgKeys.FileKey($"{folder.Trim('/')}/{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid():N}{ext.ToLowerInvariant()}");
            if (_s3 != null)
            {
                await _s3.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = _bucket, Key = key, InputStream = content, ContentType = contentType, AutoCloseStream = false,
                    CannedACL = S3CannedACL.Private,
                }, ct);
                return key;
            }
            var path = Path.Combine(_localRoot, key.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var f = File.Create(path);
            await content.CopyToAsync(f, ct);
            return key;
        }

        public async Task<(Stream Content, string ContentType)?> OpenAsync(string key, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Contains("..")) return null;
            // A file can only be opened by the organisation it was saved for.
            if (!OrgKeys.OwnsFile(key)) return null;
            if (_s3 != null)
            {
                try
                {
                    var o = await _s3.GetObjectAsync(_bucket, key, ct);
                    return (o.ResponseStream, o.Headers.ContentType ?? "application/octet-stream");
                }
                catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    _logger.LogWarning("Chat file {Key} not found in storage", key);
                    return null;
                }
            }
            var path = Path.Combine(_localRoot, key.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path)) return null;
            return (File.OpenRead(path), "application/octet-stream");
        }

        public async Task<(Stream Content, string ContentType, long? Length)?> OpenReleaseAsync(string key, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Contains("..") || !key.StartsWith("app-releases/", StringComparison.Ordinal)) return null;
            if (_s3 != null)
            {
                try
                {
                    var o = await _s3.GetObjectAsync(_bucket, key, ct);
                    return (o.ResponseStream, o.Headers.ContentType ?? "application/octet-stream", o.ContentLength);
                }
                catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
                {
                    return null;
                }
            }
            var path = Path.Combine(_localRoot, key.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(path)) return null;
            return (File.OpenRead(path), "application/octet-stream", new FileInfo(path).Length);
        }

        public async Task<bool> DeleteAsync(string key, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Contains("..") || !OrgKeys.OwnsFile(key)) return false;
            try
            {
                if (_s3 != null) { await _s3.DeleteObjectAsync(_bucket, key, ct); return true; }
                var path = Path.Combine(_localRoot, key.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(path)) File.Delete(path);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not delete stored file {Key}", key);
                return false;
            }
        }
    }
}
