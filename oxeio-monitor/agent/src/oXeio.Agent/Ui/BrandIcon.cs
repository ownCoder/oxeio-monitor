using System.Drawing;
using System.Runtime.Versioning;

namespace oXeio.Agent.Ui;

/// <summary>
/// ⭐⭐ <b>এজেন্টের মুখ</b> — ওয়েবের সেই লাল টাইল ও সাদা X
/// (<c>web/public/favicon.svg</c>), exe-তে এমবেড করা।
///
/// ⚠️⚠️ <b>জানালার আইকন আর exe-র আইকন এক জিনিস নয়।</b> csproj-এর
/// <c>ApplicationIcon</c> ঠিক করে Explorer, alt-tab আর "Add or remove
/// programs" — কিন্তু <b>টাস্কবারের বোতামে</b> WinForms দেখায়
/// <c>Form.Icon</c>, আর সেটা না দিলে নিজের ডিফল্টটাই বসায়। তাই এখানে
/// আলাদা করে লাগে।
///
/// ⚠️ <b>একটাই জায়গা</b>, কারণ জানালা দুই রকম: <see cref="OwnerDrawnForm"/>
/// (Today · About) আর <see cref="SignInForm"/> — দ্বিতীয়টা প্রথমটার
/// উত্তরাধিকারী নয়। প্রথমে শুধু বেস ক্লাসে বসিয়ে ভাবা হয়েছিল কাজ শেষ,
/// অথচ ইনস্টলের পর স্টাফ যে জানালাটা <b>প্রথম</b> দেখেন সেটাই বাদ পড়েছিল।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class BrandIcon
{
    /// <summary>⚠️ csproj-এর <c>LogicalName</c>-এর সাথে হুবহু মিলতে হবে</summary>
    private const string ResourceName = "oXeio.Agent.brand.ico";

    /**
     * একবার পড়া হয়, সব জানালা ভাগ করে নেয়।
     *
     * ⚠️⚠️ ব্যর্থ হলে <c>null</c>, ব্যতিক্রম নয়। আইকন না পাওয়ার সবচেয়ে
     * খারাপ ফল হলো টাস্কবারে পুরোনো চেহারা — কিন্তু ছুড়ে দিলে
     * <b>সাইন-ইন জানালাটাই খুলত না</b>, আর কর্মী কাজই শুরু করতে পারতেন না।
     */
    public static Icon? Value => Lazy.Value;

    private static readonly Lazy<Icon?> Lazy = new(() =>
    {
        try
        {
            using var stream = typeof(BrandIcon).Assembly
                .GetManifestResourceStream(ResourceName);

            return stream is null ? null : new Icon(stream);
        }
        catch (Exception)
        {
            return null;
        }
    });
}
