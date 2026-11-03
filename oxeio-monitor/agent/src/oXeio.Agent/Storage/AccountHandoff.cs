using System.Runtime.Versioning;

namespace oXeio.Agent.Storage;

/// <summary>Durable account boundary, recovered before any capture or sync starts.</summary>
[SupportedOSPlatform("windows")]
internal static class AccountHandoff
{
    private static string Marker(OutboxPaths paths) => Path.Combine(paths.State, "account-handoff.pending");
    public static bool Pending(OutboxPaths paths) => File.Exists(Marker(paths));

    public static void Begin(OutboxPaths paths, int? deviceId = null)
    {
        Directory.CreateDirectory(paths.State);
        File.WriteAllText(Marker(paths), $"Previous device ID: {deviceId?.ToString() ?? "unknown"}. Restart before adopting another account.");
    }

    // The old process must have exited and released the liveness beacon first.
    // Retain unsent records for recovery; never submit them using the next token.
    public static string? Quarantine(OutboxPaths paths)
    {
        var files = new[] { paths.Database, paths.DatabaseWal, paths.DatabaseShm };
        if (!files.Any(File.Exists) && !Directory.Exists(paths.QueueRoot)) return null;
        var archive = Path.Combine(paths.Root, "account-history", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(archive);
        if (Pending(paths)) File.Copy(Marker(paths), Path.Combine(archive, "previous-account.txt"));
        foreach (var file in files)
            if (File.Exists(file)) File.Move(file, Path.Combine(archive, Path.GetFileName(file)));
        if (Directory.Exists(paths.QueueRoot))
            Directory.Move(paths.QueueRoot, Path.Combine(archive, "queue"));
        return archive;
    }

    public static void Complete(OutboxPaths paths)
    {
        if (File.Exists(Marker(paths))) File.Delete(Marker(paths));
    }
}
