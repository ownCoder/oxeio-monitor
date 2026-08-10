using System.Runtime.Versioning;
using System.Windows.Forms;

namespace oXeio.Agent.Ui;

/// <summary>
/// ব্যাকগ্রাউন্ড থ্রেড থেকে UI থ্রেডে কাজ পাঠানোর একমাত্র পথ।
///
/// <b>কেন <c>SynchronizationContext.Current</c> ব্যবহার করা হয়নি:</b> সেটা null হয়
/// যতক্ষণ না WinForms-এর কোনো Control তৈরি হয়েছে, আর <c>Application.Run</c> চালু
/// হওয়ার আগে ও পরে দুই রকম হতে পারে। tray তৈরি হয় প্রক্রিয়ার একদম শুরুতে, তাই
/// "যা আছে তা ধরে নিই" চললে অর্ধেক ক্ষেত্রে কাজ চুপচাপ ভুল থ্রেডে চলত — আর ভুল
/// থ্রেডে NotifyIcon ছোঁয়ার শাস্তি সাথে সাথে আসে না, সপ্তাহ দুয়েক পর একবার আসে।
///
/// এখানে বরং একটা নিজস্ব <see cref="Control"/> বানিয়ে <b>তখনই</b> তার হ্যান্ডেল
/// তৈরি করে নেওয়া হয়। প্যারেন্টহীন Control-এর হ্যান্ডেল WinForms নিজের parking
/// উইন্ডোতে ঝুলিয়ে রাখে, আর যে থ্রেডে হ্যান্ডেল তৈরি হয়েছে সেই থ্রেডেই
/// <c>BeginInvoke</c>-এর কাজ চলে। অর্থাৎ "UI থ্রেড" মানে এখানে নির্দিষ্টভাবে
/// যে থ্রেডে এই অবজেক্ট তৈরি হয়েছিল।
///
/// ⚠️ তাই <see cref="UiDispatcher"/> (এবং <see cref="TrayIcon"/>) অবশ্যই সেই থ্রেডে
/// তৈরি করতে হবে যেটা পরে <c>Application.Run()</c> ডাকবে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class UiDispatcher : IDisposable
{
    private readonly Control _marshaller;
    private readonly Action<Exception>? _onError;
    private volatile bool _disposed;

    public UiDispatcher(Action<Exception>? onError = null)
    {
        _onError = onError;
        _marshaller = new Control();

        // ⚠️ হ্যান্ডেল আগেভাগে বানিয়ে নেওয়া। না বানালে প্রথম BeginInvoke
        //    InvalidOperationException ছুড়ত ("Invoke or BeginInvoke cannot be
        //    called on a control until the window handle has been created"),
        //    আর সেটা ঘটত প্রথম স্ট্যাটাস আপডেটে — অর্থাৎ ট্র্যাকিং থ্রেডে।
        _ = _marshaller.Handle;
    }

    /// <summary>মেনু ও ফন্টের মাপ ঠিক করতে লাগে।</summary>
    public int Dpi
    {
        get
        {
            try { return _marshaller.DeviceDpi; }
            catch (ObjectDisposedException) { return 96; }
        }
    }

    /// <summary>
    /// UI থ্রেডে কাজটা চালায়। ইতিমধ্যেই UI থ্রেডে থাকলে সরাসরি, নইলে সারিতে।
    ///
    /// ⚠️ কখনো ব্লক করে না — <c>Invoke</c> (সিঙ্ক্রোনাস) ইচ্ছাকৃতভাবে নেই। UI থ্রেড
    /// যদি একটা মডাল ডায়ালগে আটকে থাকে আর ট্র্যাকিং থ্রেড তার জন্য অপেক্ষা করে,
    /// তাহলে ঘণ্টা গোনা থেমে যায় — অর্থাৎ tray-র দোষে বেতনের হিসাব থামে।
    /// ⚠️ কখনো এক্সসেপশনও ছোড়ে না (<see cref="oXeio.Core.Agent.IAgentStatusSink"/>-এর শর্ত)।
    /// </summary>
    public void Post(Action action)
    {
        if (action is null || _disposed) return;

        try
        {
            if (!_marshaller.IsHandleCreated) return;

            if (!_marshaller.InvokeRequired)
            {
                Run(action);
                return;
            }

            _marshaller.BeginInvoke(new Action(() => Run(action)));
        }
        catch (ObjectDisposedException)
        {
            // বন্ধ হওয়ার মাঝপথে — আঁকার আর কিছু নেই
        }
        catch (InvalidOperationException)
        {
            // হ্যান্ডেল ইতিমধ্যেই ধ্বংস
        }
    }

    private void Run(Action action)
    {
        try
        {
            action();
        }
        catch (Exception ex)
        {
            // ⚠️ UI থ্রেডে ছুটে যাওয়া এক্সসেপশন মানে পুরো প্রক্রিয়া বন্ধ, অর্থাৎ
            //    ট্র্যাকিংও বন্ধ। তাই এখানে গিলে ফেলা হয় — কিন্তু নীরবে নয়,
            //    কলার লগার দিলে সেখানে যায়।
            try { _onError?.Invoke(ex); } catch { /* লগারও ভাঙলে কিছু করার নেই */ }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try { _marshaller.Dispose(); }
        catch (ObjectDisposedException) { }
    }
}
