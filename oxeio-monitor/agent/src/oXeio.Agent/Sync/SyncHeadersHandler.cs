using System.Globalization;
using System.Net.Http.Headers;

using oXeio.Core.Agent;

namespace oXeio.Agent.Sync;

/// <summary>
/// প্রতিটা রিকোয়েস্টে <c>x-client-time</c> ও <c>Authorization</c> বসায়।
///
/// ⭐ <b>কেন হ্যান্ডলারে, প্রতিটা মেথডে হাতে নয়:</b> নয়টা মেথডের একটাতে হেডার
/// বসাতে ভুলে গেলে সেটা কম্পাইল হয়, চলে, আর নীরবে ভুল করে — GET-গুলোতে
/// ভুলে যাওয়াটাই সবচেয়ে স্বাভাবিক। এখানে বসালে ভুলে যাওয়ার পথই নেই।
/// </summary>
internal sealed class SyncHeadersHandler : DelegatingHandler
{
    /// <summary>
    /// একমাত্র <c>POST /agent/enroll</c>-এ টোকেন যায় না (তখন টোকেন থাকেই না)।
    /// </summary>
    internal static readonly HttpRequestOptionsKey<bool> Anonymous = new("oXeio.sync.anonymous");

    private readonly Func<string?> _token;

    internal SyncHeadersHandler(Func<string?> tokenAccessor, HttpMessageHandler inner)
        : base(inner)
        => _token = tokenAccessor;

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // ⭐ ইচ্ছাকৃতভাবে wall-clock (UtcNow), monotonic নয়। সার্ভার এখান থেকেই
        //    ডিভাইসের ঘড়ির drift মাপে — অর্থাৎ মাপার বস্তুটাই PC-র ভুল ঘড়ি।
        //    monotonic ঘড়ি দিলে drift সবসময় শূন্য দেখাত আর ঘড়ি এগিয়ে-পিছিয়ে
        //    থাকা মেশিন কোনোদিন ধরা পড়ত না।
        //
        // ⚠️ Remove আগে — redirect বা রিট্রাইয়ে একই বার্তা দুবার গেলে দুটো হেডার
        //    যেত আর সার্ভার প্রথমটা পড়ে ভুল drift হিসাব করত।
        request.Headers.Remove(SyncLimits.ClientTimeHeader);
        request.Headers.TryAddWithoutValidation(
            SyncLimits.ClientTimeHeader,
            DateTimeOffset.UtcNow.ToString(SyncLimits.ClientTimeFormat, CultureInfo.InvariantCulture));

        var anonymous = request.Options.TryGetValue(Anonymous, out var flag) && flag;
        if (!anonymous && request.Headers.Authorization is null)
        {
            var token = _token();
            if (!string.IsNullOrEmpty(token))
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return base.SendAsync(request, cancellationToken);
    }
}
