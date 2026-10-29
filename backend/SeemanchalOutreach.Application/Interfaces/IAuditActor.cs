namespace SeemanchalOutreach.Application.Interfaces
{
    /// <summary>Who is making the current change (the signed-in person and their device), for the activity log.</summary>
    public interface IAuditActor
    {
        string ActorId { get; }
        string? ActorName { get; }
        string? ActorRole { get; }
        string Source { get; }       // crm | app | system
        string? DeviceId { get; }
        string? DeviceType { get; }
        string? Ip { get; }
        string? Request { get; }
    }

    /// <summary>Used when there is no signed-in person (background jobs, seeding).</summary>
    public sealed class SystemAuditActor : IAuditActor
    {
        public string ActorId => "system";
        public string? ActorName => "System";
        public string? ActorRole => null;
        public string Source => "system";
        public string? DeviceId => null;
        public string? DeviceType => null;
        public string? Ip => null;
        public string? Request => null;
    }
}
