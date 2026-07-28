using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
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
        app.Logger.LogWarning(
            "Seeded default Admin account — AgentId: '{AgentId}', Password: '{Password}'. " +
            "You will be required to change this password on first login.",
            AdminSeeder.DefaultAgentId, seededAdminPassword);
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseExceptionHandler();
app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<LocationHub>("/hubs/location");

// Deploy-pipeline health check — intentionally anonymous, no DB round-trip
// (keep it cheap so it can't false-negative on a slow query under load).
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.Run();
