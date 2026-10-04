using System.Runtime.Versioning;
using System.Text;

using oXeio.Core.Time;

namespace oXeio.Agent.Storage;

/// <summary>
/// The last work-day zone the server sent — one line on disk
/// (<c>America/Sao_Paulo|-180</c>), read at startup.
///
/// ⚠️ Without it, a PC that boots while the server is unreachable would count
/// in Asia/Dhaka until the first config arrives, and on a non-Dhaka server
/// every segment of that morning would land on the wrong work date. The first
/// boot ever still starts on Dhaka, which is also the server's default.
///
/// ⚠️ Never throws, like <c>MilestoneMemory</c>: a file that cannot be read or
/// written only means the next boot starts on the default zone, and an
/// exception here would stop the agent — that is, stop counting hours.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class WorkZoneMemory
{
    private const string FileName = "work-zone.txt";

    /// <summary>An IANA name plus an offset never comes near this.</summary>
    private const int MaxLineLength = 80;

    private readonly string _path;

    public WorkZoneMemory(string directory)
    {
        _path = Path.Combine(directory, FileName);
    }

    /// <summary>Applies the remembered zone; <c>false</c> when there is none.</summary>
    public bool TryRestore()
    {
        try
        {
            if (!File.Exists(_path)) return false;

            var line = File.ReadAllText(_path, Encoding.UTF8).Trim();
            return line.Length <= MaxLineLength && DhakaTime.TryRestore(line);
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Keeps the zone currently in <see cref="DhakaTime"/>.</summary>
    public void Remember()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path, DhakaTime.ToMemoryLine(), Encoding.UTF8);
        }
        catch (Exception)
        {
            // next boot without network starts on the default zone — logged by the caller
        }
    }
}
