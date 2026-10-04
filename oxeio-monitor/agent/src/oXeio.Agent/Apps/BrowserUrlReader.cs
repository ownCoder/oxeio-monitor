using System.Diagnostics;
using System.Runtime.Versioning;
using System.Windows.Automation;

using oXeio.Core.Apps;

namespace oXeio.Agent.Apps;

/// <summary>
/// ব্রাউজারের address bar থেকে ঠিকানা পড়া (D03, [ADR-013](../../../../docs/05-Options-Decisions.md))।
///
/// ⭐ <b>যা পড়া হয় তার ডোমেইনটুকুই টেকে</b> — <see cref="oXeio.Core.Apps.DomainParser"/>
/// path, query আর credential ছেঁটে ফেলে। এখান থেকে ফুল URL বেরোলেও সেটা
/// কোথাও জমা হয় না।
///
/// <b>কেন এক্সটেনশন নয়:</b> তিনটে ব্রাউজারে আলাদা এক্সটেনশন বানানো ও
/// মেইনটেইন করা, আর প্রতিটা PC-তে বসানো — অনেক বেশি খরচ। UI Automation
/// Windows-এরই অংশ, কিছু বসাতে হয় না।
///
/// ⚠️ <b>এটা ব্যর্থ হতে পারে, আর সেটা স্বাভাবিক।</b> address bar-এর
/// AutomationId ব্রাউজারের ভার্সনভেদে বদলায়। ব্যর্থ হলে <c>null</c> ফেরে
/// আর ওই ব্যবহারটা ডোমেইন ছাড়াই রেকর্ড হয় — অর্থাৎ "Chrome ২০ মিনিট"
/// জানা যায়, কোন সাইট তা নয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class BrowserUrlReader
{
    /// <summary>
    /// ⚠️ কড়া সীমা। UI Automation ব্যস্ত বা আটকে থাকা অ্যাপে
    /// <b>কয়েক সেকেন্ড পর্যন্ত ঝুলে থাকতে পারে</b>। ট্র্যাকিং লুপ ওই
    /// সময়টা অপেক্ষা করলে সেকেন্ডের হিসাব পিছিয়ে যেত।
    /// </summary>
    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(400);

    private int _consecutiveFailures;

    /// <summary>
    /// টানা এতবার ব্যর্থ হলে আর চেষ্টা করা হয় না। এই মেশিনে UI Automation
    /// কাজ করছে না (accessibility বন্ধ, বা নীতিতে আটকানো) — প্রতি উইন্ডো
    /// বদলে ৪০০ মি.সে. করে নষ্ট করার মানে নেই।
    /// </summary>
    private const int GiveUpAfter = 20;

    public bool Disabled => _consecutiveFailures >= GiveUpAfter;

    /// <summary>ব্যর্থ হলে <c>null</c> — ব্যতিক্রম কখনো বাইরে যায় না।</summary>
    public string? TryRead(nint hwnd)
    {
        if (hwnd == 0 || Disabled) return null;

        try
        {
            // ⚠️ আলাদা টাস্কে, কড়া টাইমআউটসহ। UIA আটকে গেলে সেটা যেন
            //    কলারকে টেনে না ধরে।
            var task = Task.Run(() => ReadAddressBar(hwnd));

            if (!task.Wait(Timeout))
            {
                // ⚠️ টাস্কটা ছেড়ে দেওয়া হচ্ছে, থামানো যাচ্ছে না — UIA কল
                //    বাতিলযোগ্য নয়। সে নিজের সময়ে শেষ হবে, ফল ফেলে দেওয়া হবে।
                Fail();
                return null;
            }

            var url = task.Result;
            if (string.IsNullOrWhiteSpace(url)) { Fail(); return null; }

            _consecutiveFailures = 0;
            return url;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            Debug.WriteLine($"could not read the address bar: {ex.Message}");
            Fail();
            return null;
        }
    }

    private void Fail()
    {
        if (_consecutiveFailures < GiveUpAfter) _consecutiveFailures++;
    }

    private static string? ReadAddressBar(nint hwnd)
    {
        var window = AutomationElement.FromHandle(hwnd);
        if (window is null) return null;

        var edits = window.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));

        if (edits.Count == 0) return null;

        var index = AddressBarMatcher.Pick(
            edits.Count,
            i => edits[i].Current.ClassName,
            i => edits[i].Current.AutomationId,
            i => edits[i].Current.Name);
        return index is { } i ? ValueOf(edits[i]) : null;
    }

    private static string? ValueOf(AutomationElement element)
    {
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)) return null;

        return (pattern as ValuePattern)?.Current.Value;
    }
}
