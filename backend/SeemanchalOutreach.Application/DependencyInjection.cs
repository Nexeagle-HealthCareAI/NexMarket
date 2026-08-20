using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using SeemanchalOutreach.Application.Services;

namespace SeemanchalOutreach.Application
{
    public static class DependencyInjection
    {
        public static IServiceCollection AddApplication(this IServiceCollection services)
        {
            services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(Assembly.GetExecutingAssembly()));
            services.AddScoped<AnalyticsEngineService>();
            return services;
        }
    }
}
