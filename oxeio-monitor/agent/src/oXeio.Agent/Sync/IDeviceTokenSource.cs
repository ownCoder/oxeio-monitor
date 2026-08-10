namespace oXeio.Agent.Sync;

/// <summary>
/// টোকেন কোথা থেকে আসবে — শুধু এইটুকুই সিঙ্ক ক্লায়েন্ট জানে।
///
/// ⚠️ এখানে ডিস্ক পড়া হয় না, DPAPI নেই, ফাইলের পাথ নেই। টোকেন জমানোর মালিক
/// secrets মডিউল; সিঙ্ক ক্লায়েন্ট শুধু "এখনকার টোকেনটা দাও" বলে। দুই জায়গায়
/// দুরকম করে টোকেন পড়লে rotate করার দিন একজন পুরোনোটা নিয়ে চলত আর
/// প্রতিটা আপলোড ৪০১ খেত — অথচ ৪০১ Transient, তাই কেউ টেরও পেত না।
/// </summary>
internal interface IDeviceTokenSource
{
    /// <summary>
    /// এখনকার device token, না থাকলে null (তখন enroll ছাড়া সব কল ৪০১ পাবে)।
    ///
    /// ⚠️ এটা প্রতিটা রিকোয়েস্টে ডাকা হয়, তাই সস্তা হতে হবে —
    /// ভেতরে ডিস্ক পড়া বা DPAPI decrypt চলবে না, ক্যাশ করা মান ফেরাতে হবে।
    /// থ্রেড-নিরাপদ হতে হবে; সিঙ্ক লুপ আর tray একই সময়ে ডাকতে পারে।
    /// </summary>
    string? CurrentToken { get; }
}

/// <summary>
/// secrets মডিউল আসার আগ পর্যন্ত (এবং টেস্টে) কাজ চালানোর মতো সরল উৎস।
/// </summary>
internal sealed class InMemoryDeviceTokenSource : IDeviceTokenSource
{
    private string? _token;

    public InMemoryDeviceTokenSource(string? token = null) => _token = Normalize(token);

    public string? CurrentToken => Volatile.Read(ref _token);

    public void Set(string? token) => Volatile.Write(ref _token, Normalize(token));

    /// <summary>ফাঁকা স্ট্রিং আর null একই জিনিস — নইলে <c>Bearer </c> হেডার যেত।</summary>
    private static string? Normalize(string? token) =>
        string.IsNullOrWhiteSpace(token) ? null : token.Trim();
}
