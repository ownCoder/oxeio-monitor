namespace oXeio.Core.Apps;

/// <summary>
/// URL থেকে শুধু ডোমেইন, আর ব্যক্তিগত ব্রাউজিং চেনা ([ADR-013](../../../../docs/05-Options-Decisions.md))।
///
/// ⭐ <b>ফুল URL কখনো কোথাও জমা হয় না</b> — না ডিস্কে, না নেটওয়ার্কে।
/// <c>youtube.com</c> থেকে বোঝা যায় সময়টা কোথায় গেল; <c>/watch?v=…</c>
/// থেকে বোঝা যায় ঠিক কী দেখা হয়েছে। দ্বিতীয়টা জানার কোনো প্রয়োজন এই
/// সিস্টেমের নেই, আর একবার জমা হয়ে গেলে ফেরানোর উপায় থাকে না।
/// </summary>
public static class DomainParser
{
    private static readonly char[] PathStarters = ['/', '?', '#'];

    /// <summary>
    /// ব্রাউজারের ব্যক্তিগত মোডের চিহ্ন — উইন্ডো টাইটেলে যা দেখা যায়।
    ///
    /// ⚠️ এটা নিখুঁত নয় এবং হতেও পারে না; ব্রাউজার ভার্সনভেদে লেখা বদলায়।
    /// তাই ভুলটা <b>নিরাপদ দিকে</b> রাখা হয়েছে: সন্দেহ হলেই কিছু রেকর্ড
    /// করা হয় না। উল্টো দিকে ভুল করলে কারো ব্যক্তিগত ব্রাউজিং সার্ভারে
    /// জমা হয়ে যেত, আর সেটা ফেরানো যেত না।
    /// </summary>
    private static readonly string[] PrivateMarkers =
    [
        "incognito",        // Chrome (en)
        "inprivate",        // Edge
        "private browsing", // Firefox
        "private window",   // Safari-ধাঁচের
        "ছদ্মবেশী",          // Chrome (bn)
    ];

    /// <summary>
    /// ব্যক্তিগত ব্রাউজিং উইন্ডো কি না — টাইটেল দেখে।
    /// সত্যি হলে <b>টাইটেল বা ডোমেইন কিছুই</b> রেকর্ড করা হয় না; শুধু
    /// "ব্রাউজার ব্যবহার হয়েছে" টুকু থাকে।
    /// </summary>
    public static bool LooksPrivate(string? windowTitle)
    {
        if (string.IsNullOrWhiteSpace(windowTitle)) return false;

        var lower = windowTitle.ToLowerInvariant();
        foreach (var marker in PrivateMarkers)
        {
            if (lower.Contains(marker, StringComparison.Ordinal)) return true;
        }

        return false;
    }

    /// <summary>
    /// URL, host, বা address-bar-এ টাইপ করা যেকোনো লেখা → শুধু ডোমেইন।
    /// বুঝতে না পারলে <c>null</c> — আন্দাজ করার চেয়ে কিছু না রাখা ভালো।
    /// </summary>
    public static string? Extract(string? urlOrHost)
    {
        if (string.IsNullOrWhiteSpace(urlOrHost)) return null;

        var value = urlOrHost.Trim();

        // scheme ছেঁটে ফেলা — "https://", "http://", এমনকি "chrome://"
        var scheme = value.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0) value = value[(scheme + 3)..];

        // ⚠️ path/query/fragment এখানেই কাটা পড়ে। এই একটা লাইনই
        //    "/account/12345?token=…"-কে ডেটাবেসে পৌঁছাতে দেয় না।
        var path = value.IndexOfAny(PathStarters);
        if (path >= 0) value = value[..path];

        // user:pass@host — credential যেন কোনোভাবেই না যায়
        var at = value.LastIndexOf('@');
        if (at >= 0) value = value[(at + 1)..];

        // পোর্ট ছাঁটা। ⚠️ IPv6 ([::1]:8080) হাতে না দিয়ে — একাধিক ':'
        //    থাকলে ছোঁয়া হয় না, নইলে ঠিকানাটাই কেটে যেত।
        var colon = value.LastIndexOf(':');
        if (colon > 0 && value.IndexOf(':') == colon) value = value[..colon];

        value = value.Trim().TrimEnd('.').ToLowerInvariant();

        return IsPlausibleHost(value) ? value : null;
    }

    /// <summary>
    /// ⚠️ address bar-এ মানুষ যা খুশি টাইপ করে — সার্চ শব্দ, বাংলা বাক্য,
    /// ফাইলের পথ। সেগুলো "ডোমেইন" হিসেবে জমা হলে রিপোর্ট আবর্জনায় ভরে যেত,
    /// আর <b>সার্চ করা শব্দ সার্ভারে চলে যেত</b> — যা কার্যত কীলগিং।
    /// তাই ডোমেইনের মতো না দেখালে বাদ।
    /// </summary>
    private static bool IsPlausibleHost(string value)
    {
        if (value.Length is 0 or > 253) return false;
        if (value.Contains(' ', StringComparison.Ordinal)) return false;

        // localhost বা IPv6 বাদে একটা ডট থাকতেই হবে
        if (value is "localhost") return true;
        if (value.StartsWith('[') && value.EndsWith(']')) return true;

        var dot = value.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0 || dot == value.Length - 1) return false;

        foreach (var c in value)
        {
            var ok = char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_';
            if (!ok) return false;
        }

        return true;
    }
}
