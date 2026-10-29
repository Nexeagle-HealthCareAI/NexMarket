using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
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

            // Who is acting: the API replaces this with the signed-in person; background jobs stay "System".
            services.TryAddScoped<IAuditActor, SystemAuditActor>();
            services.AddScoped<AuditSaveChangesInterceptor>();

            services.AddDbContext<MarketingDbContext>((sp, options) =>
                options.UseNpgsql(connectionString, npgsqlOptions =>
                {
                    npgsqlOptions.UseNetTopologySuite();
                    npgsqlOptions.MigrationsHistoryTable("__EFMigrationsHistory", "marketing");
                }).AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>()));

            services.AddScoped<IMarketingDbContext>(provider => provider.GetRequiredService<MarketingDbContext>());
            services.AddSingleton<IPhotoUploadService, S3PhotoUploadService>();

            services.AddMemoryCache();
            services.AddHttpClient("mapbox", client =>
            {
                client.Timeout = TimeSpan.FromSeconds(8);
            });
            services.AddSingleton<IDirectionsService, MapboxDirectionsService>();

            services.AddHttpClient("whatsapp", client =>
            {
                client.Timeout = TimeSpan.FromSeconds(15);
            });
            services.AddSingleton<IWhatsAppSender, WhatsAppCloudSender>();

            return services;
        }
    }
}
