using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-র নিজের একটিমাত্র P/Invoke।
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
}
