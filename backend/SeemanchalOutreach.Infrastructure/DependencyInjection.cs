using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Infrastructure.Persistence;
using SeemanchalOutreach.Infrastructure.Services;

namespace SeemanchalOutreach.Infrastructure
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            string connectionString = configuration.GetConnectionString("DefaultConnection") 
                ?? "Host=localhost;Database=nexmarket;Username=postgres;Password=postgres";

            services.AddDbContext<MarketingDbContext>(options =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.UseNetTopologySuite();
                    npgsqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "marketing");
                }));

            services.AddScoped<IMarketingDbContext>(provider => provider.GetRequiredService<MarketingDbContext>());
            services.AddSingleton<IPhotoUploadService, S3PhotoUploadService>();

            return services;
        }
    }
}
