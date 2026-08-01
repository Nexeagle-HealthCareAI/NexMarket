using System.Net;
using System.Text;
using System.Threading.RateLimiting;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Hubs;
using SeemanchalOutreach.Api.SeedData;
using SeemanchalOutreach.Application;
using SeemanchalOutreach.Infrastructure;
using SeemanchalOutreach.Infrastructure.Persistence;

var builder = WebApplication.CreateBuilder(args);

// Add Clean Architecture layers
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Add Controllers & SignalR
builder.Services.AddControllers();
builder.Services.AddSignalR();

// Consistent JSON error shape for both validation failures ([ApiController]'s
// automatic 400s) and unhandled exceptions (via UseExceptionHandler below) —
// without this, an unhandled exception returns an empty 500 with no body.
builder.Services.AddProblemDetails();

// JWT auth — issued by AuthController, required by SyncController
var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new InvalidOperationException("Jwt:Key is not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidateAudience = true,
            ValidAudience = builder.Configuration["Jwt:Audience"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),
        };

        // Browsers can't attach an Authorization header to the WebSocket upgrade
        // request SignalR uses, so the JS client sends the token as a query-string
        // parameter instead — accept it there, but only for the hub path (never
        // widen this to accept query-string tokens on ordinary REST endpoints).
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

// Configure CORS for offline-first PWA frontend.
// Cors:AllowedOrigins is a comma-separated list (env var override: Cors__AllowedOrigins)
// so the deployed UI origin can be injected per-environment without a code change.
var configuredOrigins = builder.Configuration["Cors:AllowedOrigins"];
var allowedOrigins = string.IsNullOrWhiteSpace(configuredOrigins)
    ? new[] { "http://localhost:3000", "http://localhost:3001", "http://localhost:3002" }
    : configuredOrigins.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Configure Swagger / OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "NexMarket Outreach API", Version = "v1" });
});

// Caddy fronts this app on the same host (--network host) and terminates TLS,
// so without this, every request's RemoteIpAddress is Caddy's own loopback
// address rather than the real client — which would make the rate limiter
// below key off "everyone" as a single bucket instead of per-client.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownProxies.Add(IPAddress.Loopback);
    options.KnownProxies.Add(IPAddress.IPv6Loopback);
});

// Login/refresh/change-password have no other brute-force protection (BCrypt
// slows a single guess, not a flood of them) — cap attempts per client IP.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 8,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));
});

var app = builder.Build();

// Auto-apply EF Core migrations on boot. Fine for this dev-stage deployment
// (single instance, no concurrent-migration risk); revisit with an explicit
// migration step in the deploy pipeline before this ever runs multi-instance
// or against a production database.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MarketingDbContext>();
    db.Database.Migrate();

    // Real LGD panchayat data (Bihar + bordering Uttar Dinajpur) — synced from
    // SeedData/panchayats.json on every startup so updates to the file (new/
    // corrected panchayats) reach the DB without a manual migration.
    await PanchayatSeeder.SyncAsync(db, app.Environment.ContentRootPath);

    // First-run bootstrap: create the one real Admin account so there is always
    // a way to log in on a fresh database — no demo credentials in the app itself.
    var seededAdminPassword = await AdminSeeder.SeedIfEmptyAsync(db, app.Configuration);
    if (seededAdminPassword != null)
    {
        // The password itself must never go through the structured logger — logs are
        // routinely shipped to aggregators/dashboards with far broader read access
        // than "whoever is watching this deploy's console output". Console.WriteLine
        // keeps the one-time credential out of that persisted, widely-readable sink.
        app.Logger.LogWarning(
            "Seeded default Admin account — AgentId: '{AgentId}'. Password was printed to " +
            "console output only. You will be required to change it on first login.",
            AdminSeeder.DefaultAgentId);
        Console.WriteLine(
            $"[first-run] Seeded Admin account '{AdminSeeder.DefaultAgentId}' with password: {seededAdminPassword}");
    }
}

// Gated on an explicit config flag, not IsDevelopment() — the Dev VM deployment
// runs with ASPNETCORE_ENVIRONMENT=Development (it's the "Dev" environment, not
// a local machine), which made this true there too and left the full API schema
// publicly browsable at /swagger with no auth. appsettings.Development.json (the
// only place this defaults to true) is excluded from the Docker image, so it
// only turns on for a real local `dotnet run`.
if (app.Configuration.GetValue<bool>("Swagger:Enabled"))
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseCors("AllowFrontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<LocationHub>("/hubs/location").RequireAuthorization();

// Deploy-pipeline health check — intentionally anonymous, no DB round-trip
// (keep it cheap so it can't false-negative on a slow query under load).
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.Run();
