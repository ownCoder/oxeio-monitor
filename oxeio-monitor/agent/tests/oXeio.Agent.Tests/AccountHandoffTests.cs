using oXeio.Agent.Storage;

namespace oXeio.Agent.Tests;

public class AccountHandoffTests
{
    [Fact]
    public void RecoveryRetainsOldQueueAndDoesNotMoveCredentialsOrConfiguration()
    {
        var root = Path.Combine(Path.GetTempPath(), "oxeio-handoff-" + Guid.NewGuid().ToString("N"));
        var paths = OutboxPaths.ForRoot(root);
        try
        {
            paths.EnsureCreated();
            File.WriteAllText(paths.Database, "previous account rows");
            File.WriteAllText(paths.DatabaseWal, "pending writes");
            File.WriteAllText(Path.Combine(paths.ScreenshotQueue, "old.webp"), "old screenshot");
            var config = Path.Combine(root, "config.json");
            File.WriteAllText(config, "keep");
            AccountHandoff.Begin(paths, 42);
            Assert.True(AccountHandoff.Pending(paths));
            var archive = AccountHandoff.Quarantine(paths);
            Assert.NotNull(archive);
            Assert.Contains("42", File.ReadAllText(Path.Combine(archive!, "previous-account.txt")));
            Assert.False(File.Exists(paths.Database));
            Assert.False(Directory.Exists(paths.QueueRoot));
            Assert.Equal("previous account rows", File.ReadAllText(Path.Combine(archive!, "outbox.db")));
            Assert.Equal("pending writes", File.ReadAllText(Path.Combine(archive!, "outbox.db-wal")));
            Assert.True(File.Exists(Path.Combine(archive!, "queue", "screenshots", "old.webp")));
            Assert.Equal("keep", File.ReadAllText(config));
            Assert.True(AccountHandoff.Pending(paths));
            Assert.Null(AccountHandoff.Quarantine(paths));
            AccountHandoff.Complete(paths);
            Assert.False(AccountHandoff.Pending(paths));
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
