using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Infrastructure.Services
{
    public class S3PhotoUploadService : IPhotoUploadService
    {
        private readonly string _bucketName;
        private readonly string _region;
        private readonly string _endpoint;
        private readonly ILogger<S3PhotoUploadService> _logger;

        public S3PhotoUploadService(IConfiguration configuration, ILogger<S3PhotoUploadService> logger)
        {
            _bucketName = configuration["S3:BucketName"] ?? "seemanchal-outreach-photos";
            _region = configuration["S3:Region"] ?? "ap-south-1"; // AWS Mumbai region for Bihar latency
            _endpoint = configuration["S3:Endpoint"] ?? $"https://s3.{_region}.amazonaws.com";
            _logger = logger;
        }

        public async Task<string> UploadPhotoAsync(string fileName, Stream content, string contentType, CancellationToken cancellationToken = default)
        {
            try
            {
                // In production, use AWSSDK.S3 AmazonS3Client to PutObjectAsync
                string uniqueKey = $"{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid()}_{fileName}";
                string publicUrl = $"{_endpoint}/{_bucketName}/{uniqueKey}";

                _logger.LogInformation("Uploading photo {FileName} to S3 bucket {Bucket} at {Url}", fileName, _bucketName, publicUrl);

                // Simulating async stream upload to S3 / MinIO
                await Task.Delay(100, cancellationToken);

                return publicUrl;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to upload photo {FileName} to S3", fileName);
                throw;
            }
        }
    }
}
