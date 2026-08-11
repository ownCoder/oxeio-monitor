using oXeio.Agent.Storage;
using oXeio.Core.Agent;

namespace oXeio.Agent.Sync;

/// <summary>
/// H04 — নতুন ভার্সন খোঁজা, নামানো, যাচাই করা। <b>বসানো নয়।</b>
///
/// কেন বসানো নয় তার কারণ <see cref="UpdateStage"/>-এ লেখা আছে —
/// সংক্ষেপে: [G58](../../../../docs/08-Gap-Analysis.md)। খারাপ MSI একবার
/// চললে নতুন MSI দিয়ে ফেরানো যায় না, হাতে যেতে হয়।
/// </summary>
internal sealed class UpdateStager(
    ISyncClient sync,
    OutboxPaths paths,
    string currentVersion,
    ISyncLog log)
{
    /// <summary>
    /// ⚠️ ঘন ঘন নয়। আপডেট রোজকার ঘটনা নয়, আর প্রতিটা চেক একটা নেটওয়ার্ক
    /// কল — ১৫টা PC × দিনে বহুবার মানে অকারণ ভিড়। ৬ ঘণ্টায় একবারই যথেষ্ট,
    /// কারণ বসানোটা এমনিতেও মানুষের হাতে।
    /// </summary>
    public static readonly TimeSpan CheckEvery = TimeSpan.FromHours(6);

    private UpdateStatus _status = UpdateStatus.Idle;

    public UpdateStatus Status => _status;

    /// <summary>
    /// একবার দেখা। ব্যতিক্রম কখনো বাইরে যায় না — আপডেট না পাওয়া
    /// অসুবিধা, কিন্তু ট্র্যাকিং থামার কারণ নয়।
    /// </summary>
    public async Task CheckOnceAsync(CancellationToken ct)
    {
        try
        {
            var result = await sync.CheckUpdateAsync(currentVersion, ct).ConfigureAwait(false);

            // ⚠️ ব্যর্থ হলে আগের অবস্থাটা **মুছে ফেলা হয় না**। সার্ভার এক
            //    ঘণ্টা বন্ধ থাকলে ইতিমধ্যে যাচাই হওয়া MSI-টা "নেই" হয়ে যেত,
            //    আর মালিক দেখতেন আপডেটটা উধাও।
            if (!result.IsSuccess || result.Value is not { } offer) return;

            if (string.IsNullOrWhiteSpace(offer.Version)) return;

            // ইতিমধ্যেই এই ভার্সনটা যাচাই হয়ে বসে আছে — আবার নামানোর মানে নেই
            if (_status.Stage == UpdateStage.Verified && _status.Version == offer.Version)
                return;

            await StageAsync(offer, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            log.Error("Could not check for updates — it will be retried later", ex);
        }
    }

    private async Task StageAsync(UpdateOffer offer, CancellationToken ct)
    {
        _status = new UpdateStatus
        {
            Stage = UpdateStage.Offered,
            Version = offer.Version,
            Mandatory = offer.Mandatory,
        };

        Directory.CreateDirectory(paths.Updates);
        var destination = Path.Combine(paths.Updates, $"oXeioAgent-{offer.Version}.msi");

        var download = await sync.DownloadUpdateAsync(offer.Version, destination, ct)
                                 .ConfigureAwait(false);

        if (!download.IsSuccess || download.Value is not { } file)
        {
            log.Warn($"Could not download update {offer.Version}: {download.Detail}");
            _status = _status with { Stage = UpdateStage.Offered, Detail = download.Detail };
            return;
        }

        _status = _status with { Stage = UpdateStage.Downloaded, MsiPath = file.SavedPath };

        // ⭐ এখানেই একমাত্র প্রকৃত নিরাপত্তা-যাচাই। সার্ভার কী বলেছিল আর
        //    ডিস্কে কী এল — দুটো না মিললে ফাইলটা **চালানো তো দূর, রেখে
        //    দেওয়াও চলবে না**, নইলে পরে কেউ ওটাকে ভালো ভেবে বসিয়ে দিত।
        if (!string.Equals(file.Sha256, offer.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            log.Error(
                $"⛔ The hash of update {offer.Version} does not match — " +
                $"expected {offer.Sha256}, got {file.Sha256}. The file is being deleted.");

            TryDelete(file.SavedPath);

            _status = _status with
            {
                Stage = UpdateStage.Corrupt,
                MsiPath = null,
                Detail = "sha256 mismatch",
            };
            return;
        }

        _status = _status with { Stage = UpdateStage.Verified };
        log.Info($"✅ Update {offer.Version} verified — waiting to be installed: {file.SavedPath}");

        // পুরোনো ভার্সনের নামানো MSI আর দরকার নেই
        CleanOldMsi(file.SavedPath);
    }

    private void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log.Warn($"Could not delete the corrupt MSI — {path}: {ex.Message}");
        }
    }

    /// <summary>
    /// ⚠️ প্রতিটা ভার্সনের MSI ~৬২ MB। না মুছলে বছরখানেকে কয়েক গিগাবাইট
    /// জমত, আর ডিস্ক ভরলে স্ক্রিনশট ইনজেস্টই থেমে যায়।
    /// </summary>
    private void CleanOldMsi(string keep)
    {
        try
        {
            foreach (var old in Directory.EnumerateFiles(paths.Updates, "oXeioAgent-*.msi"))
            {
                if (!string.Equals(old, keep, StringComparison.OrdinalIgnoreCase))
                    TryDelete(old);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            log.Warn($"Could not remove the old MSI: {ex.Message}");
        }
    }
}
