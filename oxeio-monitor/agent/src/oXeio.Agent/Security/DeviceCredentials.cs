using System.Runtime.Versioning;

using oXeio.Agent.Sync;
using oXeio.Core.Agent;

namespace oXeio.Agent.Security;

/// <summary>
/// <see cref="IDeviceCredentials"/>-এর একমাত্র ইমপ্লিমেন্টেশন —
/// <see cref="DeviceTokenStore"/> (ডিস্ক) আর <see cref="MachineIdentity"/> (মেশিন)
/// দুটোকে এক জায়গায় এনে বাকি এজেন্টকে দেয়।
///
/// ⚠️ পুরো অবস্থাটা একটা <c>lock</c>-এর নিচে। enroll (স্টার্টআপ থ্রেড),
/// পড়া (সিঙ্ক ওয়ার্কার) আর revoke (heartbeat-এর উত্তর) — তিনটে থ্রেড একই
/// ফিল্ডগুলো ছোঁয়। <c>volatile</c> দিয়ে চালানো যেত না, কারণ টোকেন আর deviceId
/// একসাথে বদলাতে হয়; আলাদা আলাদা বদলালে এক মুহূর্তের জন্য নতুন টোকেন আর পুরোনো
/// deviceId মিলে যেত।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class DeviceCredentials : IDeviceCredentials, IDeviceTokenSource
{
    private readonly object _gate = new();
    private readonly DeviceTokenStore _store;
    private readonly Action<string>? _log;

    private DeviceCredentialRecord? _record;
    private CredentialLoadStatus _status = CredentialLoadStatus.NotEnrolled;
    private string? _detail;
    private bool _revoked;

    private DeviceCredentials(DeviceTokenStore store, MachineIdentity identity, Action<string>? log)
    {
        _store = store;
        Identity = identity;
        _log = log;
    }

    /// <summary>স্টার্টআপে একবার। ⚠️ throw করে না — ডিস্ক নষ্ট থাকলেও এজেন্ট চালু হবে।</summary>
    public static DeviceCredentials Open(
        DeviceTokenStore store, MachineIdentity identity, Action<string>? log = null)
    {
        var credentials = new DeviceCredentials(store, identity, log);
        credentials.Reload();
        return credentials;
    }

    public MachineIdentity Identity { get; }

    public event Action<IDeviceCredentials>? Changed;

    public bool IsEnrolled
    {
        get { lock (_gate) return !_revoked && _record is not null; }
    }

    public bool IsRevoked
    {
        get { lock (_gate) return _revoked; }
    }

    public bool NeedsEnrollment
    {
        get { lock (_gate) return !_revoked && _record is null && Identity.UsableForEnrollment; }
    }

    public int? DeviceId
    {
        get { lock (_gate) return _record?.DeviceId; }
    }

    public EnrolledEmployee? Employee
    {
        get { lock (_gate) return _record?.Employee; }
    }

    public string? TokenFingerprint
    {
        get { lock (_gate) return _record?.Token.Fingerprint; }
    }

    public CredentialLoadStatus Status
    {
        get { lock (_gate) return _status; }
    }

    public string? Detail
    {
        get { lock (_gate) return _detail; }
    }

    /// <summary>
    /// টোকেনটা <see cref="ISyncClient"/>-এর ভেতরে ঠেলে দেয়। মাঝপথে কোনো
    /// ভেরিয়েবলে, লগে বা রিটার্ন ভ্যালুতে থামে না —
    /// <see cref="SecretText.Reveal"/>-এর অনুমোদিত চারটে কল-সাইটের একটা।
    /// </summary>
    public void ApplyTo(ISyncClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        string? token;
        lock (_gate)
        {
            token = _revoked ? null : _record?.Token.Reveal();
        }

        client.SetDeviceToken(token);
    }

    /// <summary>
    /// <see cref="HttpSyncClient"/>-এর পছন্দের সংযোগ: প্রতি রিকোয়েস্টে সে
    /// নিজেই এখান থেকে টোকেন তুলে নেয়, তাই enroll বা revoke-এর পর কাউকে
    /// আলাদা করে ঠেলে দিতে হয় না।
    ///
    /// ⚠️ explicit ইমপ্লিমেন্টেশন — <see cref="DeviceCredentials"/>-এর সাধারণ
    /// সারফেসে একটা <c>string? CurrentToken</c> ঝুলে থাকলে সেটাই একদিন
    /// লগে চলে যেত। <see cref="IDeviceTokenSource"/> হিসেবে না ধরলে এটা
    /// চোখেই পড়ে না।
    ///
    /// ⚠️ ডিস্ক পড়া হয় না, DPAPI চলে না — শুধু lock নিয়ে ক্যাশ করা মান।
    /// ওদের চুক্তিতে এটা স্পষ্ট বলা আছে, আর প্রতি রিকোয়েস্টে DPAPI ডাকলে
    /// আপলোড লুপ CPU খেয়ে ফেলত।
    /// </summary>
    string? IDeviceTokenSource.CurrentToken
    {
        get { lock (_gate) return _revoked ? null : _record?.Token.Reveal(); }
    }

    public bool Reload()
    {
        bool changed;
        CredentialLoadStatus status;
        string? detail;

        lock (_gate)
        {
            // ⚠️ revoke হয়ে যাওয়া ডিভাইসে ডিস্ক আবার পড়া হয় না। পড়লে —
            //    আর কেউ যদি পুরোনো device.dat ফিরিয়ে আনত — বাতিল ডিভাইস
            //    চুপচাপ আবার ট্র্যাকিং শুরু করে দিত, যেটা H06-এর উল্টো।
            if (_revoked) return false;

            var load = _store.Load(Identity);
            var previousFingerprint = _record?.Token.Fingerprint;

            _status = load.Status;
            _detail = load.Detail;
            _record = load.Status == CredentialLoadStatus.Loaded ? load.Record : null;

            changed = previousFingerprint != _record?.Token.Fingerprint;
            status = _status;
            detail = _detail;
        }

        if (status is CredentialLoadStatus.Unreadable or CredentialLoadStatus.BindingMismatch)
            _log?.Invoke($"⚠️ ক্রেডেনশিয়াল: {status} — {detail}");

        if (changed) RaiseChanged();
        return changed;
    }

    /// <summary>
    /// enroll সফল হয়ে ডিস্কে লেখা হয়ে যাওয়ার <b>পরে</b> ডাকা হয়।
    /// ⚠️ ক্রম উল্টে গেলে (আগে মেমরিতে, পরে ডিস্কে) ডিস্কে লেখা ব্যর্থ হলেও
    /// এজেন্ট দিব্যি চলত, আর রিবুটের পর টোকেন উধাও — অথচ ততক্ষণে সেই একবারের
    /// টোকেনটা সার্ভারও ভুলে গেছে।
    /// </summary>
    internal void Adopt(DeviceCredentialRecord record)
    {
        lock (_gate)
        {
            _record = record;
            _status = CredentialLoadStatus.Loaded;
            _detail = null;
            _revoked = false;
        }

        RaiseChanged();
    }

    public void Revoke(string reason)
    {
        lock (_gate)
        {
            if (_revoked) return;

            _revoked = true;
            _record = null;
            _status = CredentialLoadStatus.NotEnrolled;
            _detail = "ডিভাইস বাতিল করা হয়েছে: " + reason;
        }

        _store.TryDelete("revoke — " + reason);
        _log?.Invoke($"⛔ ডিভাইস বাতিল: {reason}। ট্র্যাকিং স্থায়ীভাবে বন্ধ।");

        RaiseChanged();
    }

    /// <summary>
    /// ⚠️ হ্যান্ডলারের এক্সসেপশন গিলে ফেলা হয়। সিঙ্ক মডিউলের একটা ভাঙা
    /// সাবস্ক্রাইবার যেন enroll বা revoke-এর পথ আটকে না দেয় — revoke আটকে গেলে
    /// বাতিল ডিভাইস ট্র্যাকিং চালিয়েই যেত।
    /// </summary>
    private void RaiseChanged()
    {
        var handlers = Changed;
        if (handlers is null) return;

        foreach (var handler in handlers.GetInvocationList().Cast<Action<IDeviceCredentials>>())
        {
            try
            {
                handler(this);
            }
            catch (Exception ex)
            {
                _log?.Invoke($"⚠️ credentials Changed হ্যান্ডলার ব্যর্থ: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }

    /// <summary>ট্রে/লগে দেখানোর এক লাইন — গোপন কিছু নেই।</summary>
    public string Describe()
    {
        lock (_gate)
        {
            if (_revoked) return "বাতিল (revoked)";
            if (_record is null) return $"enroll করা হয়নি — {_status}{(_detail is null ? "" : ": " + _detail)}";

            return $"device #{_record.DeviceId} · {_record.Employee.EmpCode} " +
                   $"({_record.Employee.FullName}) · token {_record.Token.Fingerprint}";
        }
    }
}
