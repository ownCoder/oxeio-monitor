using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-র নিজের P/Invoke।
///
/// <c>Native/User32.cs</c>-এ না রেখে এখানে রাখা হয়েছে কারণ ওই ফাইলটা ট্র্যাকিং ও
/// ক্যাপচারের মডিউলের — এক ফাংশনের জন্য অন্য মডিউলের ফাইল ছোঁয়ার দরকার নেই।
/// নাম আলাদা রাখা হয়েছে যাতে দুটো <c>partial class User32</c> একই সদস্য নিয়ে
/// সংঘাত না বাধায়।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class TrayNative
{
    /// <summary>
    /// <see cref="System.Drawing.Bitmap.GetHicon"/> যে HICON দেয় সেটা <b>আমাদের</b>
    /// সম্পত্তি — GDI নিজে থেকে ছাড়ে না।
    ///
    /// ⚠️ <c>Icon.FromHandle</c> হ্যান্ডেলের মালিকানা নেয় না, আর তার
    /// <c>Dispose()</c> হ্যান্ডেলটা ধ্বংসও করে না। তাই প্রতিটা তৈরি করা HICON-এর
    /// বিপরীতে ঠিক একবার এই কলটা লাগবে, নইলে প্রতি আইকনে একটা করে GDI হ্যান্ডেল
    /// জমতে থাকবে — সপ্তাহের পর সপ্তাহ চলা মেশিনে যেটা ১০,০০০-এর সীমা ছোঁয়ার
    /// পর প্রক্রিয়াটা আর কোনো উইন্ডোই আঁকতে পারে না।
    /// </summary>
    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool DestroyIcon(nint hIcon);

    /// <summary>
    /// টাইটেল বার গাঢ় করা (<c>DWMWA_USE_IMMERSIVE_DARK_MODE</c>)।
    ///
    /// ⚠️ জানালার শরীর আমরা নিজেরা আঁকি, কিন্তু <b>টাইটেল বার আঁকে Windows</b>।
    /// Midnight-এ আঁকা কালো জানালার মাথায় একটা সাদা পটি বসলে সেটা ডিজাইন নয়,
    /// ভাঙা জিনিস মনে হয় — আর স্টাফ ভাবে এজেন্টে গোলমাল।
    /// </summary>
    [LibraryImport("dwmapi.dll")]
    internal static partial int DwmSetWindowAttribute(
        nint hwnd, int attribute, ref int value, int size);

    /// <summary>Windows 10 2004+ ও 11-এ এই নম্বরটাই।</summary>
    private const int UseImmersiveDarkMode = 20;

    /// <summary>
    /// ⚠️ 1809–1903-এ অ্যাট্রিবিউটের নম্বর ছিল <b>19</b>, পরে বদলে ২০ হয়। কোন
    /// বিল্ড কোনটা চেনে সেটা যাচাই করার সস্তা উপায় নেই, তাই দুটোই চেষ্টা করা
    /// হয় — অচেনা নম্বরে DWM শুধু একটা HRESULT ফেরত দেয়, কিছু ভাঙে না।
    /// আমাদের সর্বনিম্ন লক্ষ্য 1809, তাই দুটোই দরকার।
    /// </summary>
    private const int UseImmersiveDarkModeLegacy = 19;

    /// <summary>ব্যর্থ হলে চুপচাপ — টাইটেল বার হালকা থাকবে, জানালা তবু চলবে।</summary>
    internal static void TryUseDarkTitleBar(nint hwnd)
    {
        if (hwnd == 0) return;

        var on = 1;

        try
        {
            if (DwmSetWindowAttribute(hwnd, UseImmersiveDarkMode, ref on, sizeof(int)) != 0)
            {
                DwmSetWindowAttribute(hwnd, UseImmersiveDarkModeLegacy, ref on, sizeof(int));
            }
        }
        catch (DllNotFoundException)
        {
            // dwmapi.dll নেই — Server Core-এ হতে পারে
        }
        catch (EntryPointNotFoundException)
        {
        }
    }
}
