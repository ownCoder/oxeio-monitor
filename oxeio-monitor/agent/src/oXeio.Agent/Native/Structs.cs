using System.Runtime.InteropServices;

namespace oXeio.Agent.Native;

/// <summary>
/// ⚠️ <c>cbSize</c> সত্যিই যাচাই করা হয় — ভুল মান দিলে কল ব্যর্থ হয় (error 87) আর
/// <c>dwTime</c> শূন্যই থেকে যায়। ফেরত মান না দেখে ব্যবহার করলে নিষ্ক্রিয়তা
/// "PC চালু হওয়ার পর থেকে এখন পর্যন্ত" হিসেব হবে।
/// ৮ বাইট: uint + uint।
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal struct LASTINPUTINFO
{
    internal uint cbSize;
    internal uint dwTime;
}

[StructLayout(LayoutKind.Sequential)]
internal struct POWERBROADCAST_SETTING
{
    internal Guid PowerSetting;
    internal uint DataLength;
    /// <summary>প্রথম বাইট; বাকিটা এর পরে থাকে। ডিসপ্লে স্ট্যাটাসের জন্য ৪ বাইটের DWORD।</summary>
    internal byte Data;
}

/// <summary>
/// ⚠️ <c>ByValTStr</c> থাকায় এটা blittable নয়, তাই source-generated marshalling-এ
/// দেওয়া যায় না — <c>Marshal.PtrToStructure</c> দিয়ে পড়তে হয়।
/// ⚠️ <c>Pack = 1</c> দেওয়া যাবে না; ডিফল্ট alignment-ই নেটিভ লেআউটের সাথে মেলে।
/// </summary>
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct WTSINFOEX_LEVEL1_W
{
    internal uint SessionId;
    internal int SessionState;

    /// <summary>0 = LOCK · 1 = UNLOCK · -1 = UNKNOWN</summary>
    internal int SessionFlags;

    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 33)] internal string WinStationName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] internal string UserName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 18)] internal string DomainName;

    internal long LogonTime;
    internal long ConnectTime;
    internal long DisconnectTime;
    internal long LastInputTime;
    internal long CurrentTime;

    internal uint IncomingBytes;
    internal uint OutgoingBytes;
    internal uint IncomingFrames;
    internal uint OutgoingFrames;
    internal uint IncomingCompressedBytes;
    internal uint OutgoingCompressedBytes;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct WTSINFOEXW
{
    internal uint Level;
    internal WTSINFOEX_LEVEL1_W Data;
}
