# Build context is the `backend/` directory (docker build -f SeemanchalOutreach.Api/Dockerfile backend/)
# so that all four project references resolve.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy csproj files first so `dotnet restore` layer-caches across source-only changes.
COPY SeemanchalOutreach.Domain/SeemanchalOutreach.Domain.csproj SeemanchalOutreach.Domain/
COPY SeemanchalOutreach.Application/SeemanchalOutreach.Application.csproj SeemanchalOutreach.Application/
COPY SeemanchalOutreach.Infrastructure/SeemanchalOutreach.Infrastructure.csproj SeemanchalOutreach.Infrastructure/
COPY SeemanchalOutreach.Api/SeemanchalOutreach.Api.csproj SeemanchalOutreach.Api/
RUN dotnet restore SeemanchalOutreach.Api/SeemanchalOutreach.Api.csproj

COPY . .
RUN dotnet publish SeemanchalOutreach.Api/SeemanchalOutreach.Api.csproj \
    -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "SeemanchalOutreach.Api.dll"]
