namespace oXeio.Core.Agent;

/// <summary>
/// **I01** — সার্ভারের সার্টিফিকেট পিনিংয়ের সিদ্ধান্তটুকু।
///
/// ⭐ <b>এখানে কোনো X509, কোনো TLS, কোনো Win32 নেই</b> — শুধু "যা পাওয়া গেল
/// তা মেনে নেব কি না"। কারণ এই সিদ্ধান্তটাই একমাত্র জায়গা যেখানে ভুল হলে
/// <b>নীরবে</b> নিরাপত্তা উবে যায়, আর TLS হ্যান্ডলারের ভেতরে বসে থাকলে
/// সেটা যাচাই করতে সত্যিকারের সার্ট, সত্যিকারের MITM আর একটা টেস্ট
/// সার্ভার লাগত।
/// </summary>
public static class CertificatePin
{
    public enum Verdict
    {
        /// <summary>পিন বসানোই নেই — .NET-এর নিজের যাচাইটাই একমাত্র ভরসা।</summary>
        NoPinConfigured,

        /// <summary>পিন মিলেছে, আর চেইনও পরিষ্কার।</summary>
        Trusted,

        /// <summary>
        /// ⚠️ পিন বসানো আছে কিন্তু <b>মেলেনি</b> — অর্থাৎ তারের ওপাশে অন্য কেউ।
        /// এটাই পিনিংয়ের পুরো উদ্দেশ্য।
        /// </summary>
        PinMismatch,

        /// <summary>
        /// ⚠️⚠️ পিন মিলেছে, কিন্তু .NET-এর নিজের যাচাই ব্যর্থ (হোস্টনেম মেলেনি,
        /// মেয়াদ শেষ, চেইন ভাঙা)। <b>এটাও প্রত্যাখ্যান</b> — নিচের ডক দেখুন।
        /// </summary>
        ChainInvalid,

        /// <summary>সার্টই আসেনি — TLS হ্যান্ডশেকই ঠিকমতো হয়নি।</summary>
        NoCertificate,
    }

    /// <summary>
    /// ⭐⭐ <b>এই ফাংশনের সবচেয়ে জরুরি লাইনটা `chainOk` চেকটা।</b>
    ///
    /// ⚠️ .NET-এ <c>RemoteCertificateValidationCallback</c> বসানোর মানে তার
    /// <b>নিজের সব যাচাই বন্ধ হয়ে যাওয়া</b> — হোস্টনেম মেলানো, চেইন, মেয়াদ,
    /// সব। কলব্যাক যা বলবে তাই চূড়ান্ত। তাই পিন মিলে গেলেই
    /// <c>return true</c> লিখে দেওয়াটা সবচেয়ে সহজ ভুল, আর তাতে হোস্টনেম
    /// যাচাই ও মেয়াদ — দুটোই নীরবে চলে যেত।
    ///
    /// এখানে তাই <b>দুটোই</b> লাগে: পিন মিলতে হবে <b>এবং</b> .NET যা যা
    /// আপত্তি জানিয়েছে সেটা খালি হতে হবে।
    ///
    /// ⚠️ একাধিক পিন রাখা যায় ইচ্ছাকৃতভাবে — সার্ট নবায়নের দিন পুরোনো ও
    /// নতুন দুটোই কিছুক্ষণ বৈধ থাকা দরকার, নইলে নবায়নের মুহূর্তে ১৫টা
    /// এজেন্ট একসাথে সংযোগ হারাত (রানবুক § ৭.১)।
    /// </summary>
    /// <param name="pins">
    /// রেজিস্ট্রি থেকে পড়া, কমা দিয়ে ভাগ করা base64 SPKI হ্যাশ। খালি হলে
    /// <see cref="Verdict.NoPinConfigured"/>।
    /// </param>
    /// <param name="presentedSpkiHash">
    /// তারে আসা সার্টের SPKI-র sha256, base64। null = সার্ট আসেনি।
    /// </param>
    /// <param name="chainOk">.NET-এর নিজের যাচাই পরিষ্কার কি না।</param>
    public static Verdict Check(
        IReadOnlyCollection<string> pins,
        string? presentedSpkiHash,
        bool chainOk)
    {
        if (pins.Count == 0) return Verdict.NoPinConfigured;
        if (string.IsNullOrWhiteSpace(presentedSpkiHash)) return Verdict.NoCertificate;

        // ⚠️ ক্রমটা ইচ্ছাকৃত: **আগে পিন**, তারপর চেইন। উল্টো হলে ভুল
        //    সার্ভারের মেয়াদোত্তীর্ণ সার্ট পেলে লগে "মেয়াদ শেষ" লেখা হতো,
        //    অথচ আসল খবরটা অনেক বড় — ওটা আমাদের সার্ভারই নয়।
        var matched = false;
        foreach (var pin in pins)
        {
            if (string.Equals(pin, presentedSpkiHash, StringComparison.Ordinal))
            {
                matched = true;
                break;
            }
        }

        if (!matched) return Verdict.PinMismatch;

        return chainOk ? Verdict.Trusted : Verdict.ChainInvalid;
    }

    /// <summary>
    /// কনফিগের স্ট্রিং → পিনের তালিকা।
    ///
    /// ⚠️ ফাঁকা জায়গা ও খালি অংশ ছেঁকে ফেলা হয়: রেজিস্ট্রিতে হাতে বসানো
    /// মান প্রায়ই <c>"a=, b="</c> বা শেষে একটা কমা নিয়ে আসে, আর তখন একটা
    /// খালি স্ট্রিং পিন হিসেবে ঢুকে যেত — যা কোনোদিন কিছুর সাথেই মিলত না,
    /// কিন্তু তালিকাটাকে "অখালি" বানিয়ে রাখত।
    /// </summary>
    public static IReadOnlyList<string> Parse(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured)) return [];

        var parts = configured.Split(',', StringSplitOptions.RemoveEmptyEntries);
        var pins = new List<string>(parts.Length);

        foreach (var part in parts)
        {
            var trimmed = part.Trim();
            if (trimmed.Length > 0) pins.Add(trimmed);
        }

        return pins;
    }

    /// <summary>
    /// মানুষের পড়ার মতো কারণ — tray টুলটিপ ও লগে যায়।
    ///
    /// ⚠️ বার্তাগুলো <b>কী করতে হবে</b> বলে, শুধু কী ভুল তা নয়। ইনস্টলের
    /// দিনে অ্যাডমিন এই এক লাইনটুকুই পড়েন।
    /// </summary>
    public static string Explain(Verdict verdict) => verdict switch
    {
        Verdict.Trusted => "The server certificate matches the pin.",

        Verdict.PinMismatch =>
            "The server's certificate does not match SERVERPIN. Either the certificate was " +
            "replaced (add the new pin before swapping it) or something is intercepting the " +
            "connection. No data is sent until this matches.",

        Verdict.ChainInvalid =>
            "The pin matches but the certificate itself is not valid — wrong hostname, expired, " +
            "or the chain is broken. Check the certificate's SAN list and expiry date.",

        Verdict.NoCertificate =>
            "The server presented no certificate. Is SERVERURL pointing at an https:// address?",

        _ => "No certificate pin is configured, so only the operating system's own checks apply.",
    };
}
