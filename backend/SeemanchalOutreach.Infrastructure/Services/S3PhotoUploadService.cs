using System;
using System.IO;
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
    /// S3-compatible object storage for agent onboarding photos, backed by an E2E Networks
    /// Object Storage bucket (same provider/pattern as easyHMSAPI's S3StorageService).
    ///
    /// Objects are written under a single key prefix (S3:Prefix, default "agent-photos") inside
    /// the shared bucket (S3:BucketName). The bucket is pre-created out of band — this service
    /// never creates buckets.
    /// </summary>
    public class S3PhotoUploadService : IPhotoUploadService
    {
        private readonly IAmazonS3 _client;
        private readonly string _bucketName;
        private readonly string _prefix;
        private readonly TimeSpan _urlExpiry;
        private readonly bool _isConfigured;
        private readonly ILogger<S3PhotoUploadService> _logger;

        public S3PhotoUploadService(IConfiguration configuration, ILogger<S3PhotoUploadService> logger)
        {
            _logger = logger;

            var serviceUrl = configuration["S3:ServiceUrl"] ?? string.Empty;
            var accessKey = configuration["S3:AccessKey"] ?? string.Empty;
            var secretKey = configuration["S3:SecretKey"] ?? string.Empty;
            var region = configuration["S3:Region"] ?? "ap-south-1"; // E2E Mumbai region for Bihar latency
            var forcePathStyle = !bool.TryParse(configuration["S3:ForcePathStyle"], out var fps) || fps;
            _bucketName = configuration["S3:BucketName"] ?? string.Empty;
            _prefix = (configuration["S3:Prefix"] ?? "agent-photos").Trim().Trim('/');
            // Default to the SigV4 max (7 days) since agent photos are displayed indefinitely on
            // the admin dashboard, not just read once right after upload.
            _urlExpiry = TimeSpan.FromHours(double.TryParse(configuration["S3:UrlExpiryHours"], out var h) && h > 0 ? h : 168);
            _isConfigured = !string.IsNullOrWhiteSpace(serviceUrl) && !string.IsNullOrWhiteSpace(accessKey)
                && !string.IsNullOrWhiteSpace(secretKey) && !string.IsNullOrWhiteSpace(_bucketName);

            // Auto-detect bucket-specific virtual-hosted endpoint. E2E Networks gives a
            // per-bucket URL like https://<bucket>.in-south1-objectstore.e2enetworks.net — if the
            // configured ServiceUrl already includes the bucket subdomain, strip it and switch to
            // virtual-hosted style so the AWS SDK re-prepends the bucket correctly.
            if (!string.IsNullOrWhiteSpace(serviceUrl) && !string.IsNullOrWhiteSpace(_bucketName))
            {
                try
                {
                    var serviceUri = new Uri(serviceUrl);
                    var bucketPrefix = _bucketName + ".";
                    if (serviceUri.Host.StartsWith(bucketPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        var baseHost = serviceUri.Host.Substring(bucketPrefix.Length);
                        serviceUrl = $"{serviceUri.Scheme}://{baseHost}";
                        forcePathStyle = false;
                    }
                }
                catch { /* malformed URL — fall through with original config */ }
            }

            var s3Config = new AmazonS3Config
            {
                ServiceURL = serviceUrl,
                ForcePathStyle = forcePathStyle,
                AuthenticationRegion = region,
            };
            _client = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), s3Config);
        }

        public async Task<string> UploadPhotoAsync(string fileName, Stream content, string contentType, CancellationToken cancellationToken = default)
        {
            if (!_isConfigured)
                throw new InvalidOperationException("Photo storage is not configured on this environment (S3:ServiceUrl/AccessKey/SecretKey/BucketName). Contact an administrator.");

            var extension = Path.GetExtension(fileName);
            var safeExtension = string.Concat(extension.Split(Path.GetInvalidFileNameChars()));
            var key = $"{_prefix}/{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid()}{safeExtension}";

            try
            {
                var request = new PutObjectRequest
                {
                    BucketName = _bucketName,
                    Key = key,
                    InputStream = content,
                    ContentType = contentType,
                    AutoCloseStream = false,
                };
                await _client.PutObjectAsync(request, cancellationToken);

                var urlRequest = new GetPreSignedUrlRequest
                {
                    BucketName = _bucketName,
                    Key = key,
                    Verb = HttpVerb.GET,
                    Expires = DateTime.UtcNow.Add(_urlExpiry),
                };
                return await _client.GetPreSignedURLAsync(urlRequest);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to upload photo {FileName} to S3 bucket {Bucket}", fileName, _bucketName);
                throw;
            }
        }
    }
}
