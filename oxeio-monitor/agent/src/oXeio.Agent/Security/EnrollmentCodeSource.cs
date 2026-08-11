using System.Text;

namespace oXeio.Agent.Security;

/// <summary>কোডটা কোথা থেকে এল — লগে দেখানোর জন্য।</summary>
internal enum EnrollmentCodeOrigin
{
    None,
    Argument,
    DropFile,
    Environment,
    Prompt,
}

/// <summary>
/// ⚠️ <c>record struct</c> হলেও নিরাপদ: <see cref="Code"/> একটা
/// <see cref="SecretText"/>, তাই জেনারেটেড <c>ToString</c>-ও শুধু
/// fingerprint ছাপে।
/// </summary>
internal readonly record struct EnrollmentCodeLookup(
    SecretText? Code,
    EnrollmentCodeOrigin Origin,
    string? Detail)
{
    public bool Found => Code is not null && !Code.IsBlank;
}

/// <summary>
/// enrollment code চারটে জায়গার যেকোনোটা থেকে আসতে পারে। অগ্রাধিকার:
/// আর্গুমেন্ট → ড্রপ-ফাইল → এনভায়রনমেন্ট → ইন্টারঅ্যাক্টিভ প্রম্পট।
///
/// <b>⚠️ কমান্ড লাইনে কোড দেওয়াটা সবচেয়ে বাজে উপায়, তবু প্রথমে রাখা হয়েছে —</b>
/// কারণ অ্যাডমিন নিজে হাতে দিলে সেটাই তার ইচ্ছা, আর সেটাকে অগ্রাহ্য করলে
/// "কেন আমার দেওয়া কোড কাজ করছে না" বলে সময় নষ্ট হতো।
/// কিন্তু কমান্ড লাইন <c>Get-Process</c>/Task Manager-এ দেখা যায় এবং Task
/// Scheduler-এর XML-এ প্লেইন টেক্সটে জমা থাকে — অর্থাৎ কোডটা ওখানে থেকে যায়।
/// তাই ইনস্টলারের জন্য <b>ড্রপ-ফাইলই</b> সুপারিশ:
/// %ProgramData%\oXeio\enroll.code — পড়ামাত্র মুছে ফেলা হয়।
/// </summary>
internal static class EnrollmentCodeSource
{
    public const string EnvironmentVariableName = "OXEIO_ENROLLMENT_CODE";

    /// <summary>ইনস্টলার এখানে কোডটা রেখে যায়; প্রথম পাঠেই মুছে যায়।</summary>
    public const string DropFileName = "enroll.code";

    /// <summary>
    /// ⚠️ কখনো throw করে না — কোড না পাওয়া মানে এজেন্ট বন্ধ হওয়া নয়,
    /// শুধু enroll না-হওয়া অবস্থায় ট্র্যাকিং চালিয়ে যাওয়া।
    /// </summary>
    /// <param name="allowPrompt">
    /// কনসোলে জিজ্ঞেস করা যাবে কি না। ⚠️ সার্ভিস/লগঅন-টাস্ক হিসেবে চললে
    /// এটা false রাখতেই হবে, নইলে কোনো কনসোল ছাড়া প্রসেসটা চিরকাল
    /// ইনপুটের অপেক্ষায় ঝুলে থাকত — আর কেউ টেরও পেত না।
    /// </param>
    public static EnrollmentCodeLookup Resolve(
        string dataDirectory,
        string? explicitCode = null,
        bool allowPrompt = false,
        Action<string>? log = null)
    {
        if (Clean(explicitCode) is { } fromArgument)
        {
            log?.Invoke(
                "⚠️ The enrolment code was taken from the command line — it stays visible in the " +
                "process list and in Task Scheduler's XML. Use " + DropFileName + " in the installer.");

            return new EnrollmentCodeLookup(
                new SecretText(fromArgument), EnrollmentCodeOrigin.Argument, "command line");
        }

        var dropFile = Path.Combine(dataDirectory, DropFileName);
        if (TryReadDropFile(dropFile, log) is { } fromFile)
            return new EnrollmentCodeLookup(new SecretText(fromFile), EnrollmentCodeOrigin.DropFile, dropFile);

        if (Clean(SafeEnvironment(EnvironmentVariableName)) is { } fromEnv)
        {
            return new EnrollmentCodeLookup(
                new SecretText(fromEnv), EnrollmentCodeOrigin.Environment, EnvironmentVariableName);
        }

        if (allowPrompt && Prompt() is { } typed)
            return new EnrollmentCodeLookup(new SecretText(typed), EnrollmentCodeOrigin.Prompt, "console");

        return new EnrollmentCodeLookup(
            null, EnrollmentCodeOrigin.None,
            $"No enrolment code found anywhere ({DropFileName} / {EnvironmentVariableName} / argument)");
    }

    /// <summary>
    /// ⚠️ পড়ার সাথে সাথেই মোছা হয়। না মুছলে একবার-ব্যবহার্য কোডটা
    /// %ProgramData%-তে বছরের পর বছর পড়ে থাকত, আর ওই ফোল্ডার সব ইউজার পড়তে পারে।
    /// মোছা ব্যর্থ হলে সেটা জোরে জানানো হয় — চুপ করে থাকা যাবে না।
    /// </summary>
    private static string? TryReadDropFile(string path, Action<string>? log)
    {
        try
        {
            if (!File.Exists(path)) return null;

            var code = Clean(File.ReadAllText(path));

            try
            {
                File.Delete(path);
            }
            catch (Exception ex)
            {
                log?.Invoke($"⚠️ Could not delete {path} ({ex.GetType().Name}) — the code is still on disk, delete it by hand.");
            }

            return code;
        }
        catch (Exception ex)
        {
            log?.Invoke($"⚠️ Could not read {path}: {ex.GetType().Name}");
            return null;
        }
    }

    private static string? SafeEnvironment(string name)
    {
        try
        {
            return Environment.GetEnvironmentVariable(name);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// ⚠️ ইনপুট echo করা হয় না। কোডটা পর্দায় থাকলে কনসোলের স্ক্রলব্যাকে
    /// থেকে যেত — আর এই এজেন্টই সেই পর্দার স্ক্রিনশট তোলে।
    /// stdin রিডাইরেক্ট করা থাকলে <c>ReadKey</c> ছোড়ে, তাই আগেই যাচাই।
    /// </summary>
    private static string? Prompt()
    {
        try
        {
            Console.Write("enrolment code: ");

            if (Console.IsInputRedirected)
            {
                var piped = Clean(Console.ReadLine());
                Console.WriteLine();
                return piped;
            }

            var builder = new StringBuilder(32);
            while (true)
            {
                var key = Console.ReadKey(intercept: true);

                if (key.Key == ConsoleKey.Enter)
                {
                    Console.WriteLine();
                    break;
                }

                if (key.Key == ConsoleKey.Escape)
                {
                    Console.WriteLine();
                    return null;
                }

                if (key.Key == ConsoleKey.Backspace)
                {
                    if (builder.Length > 0) builder.Length--;
                    continue;
                }

                // কন্ট্রোল ক্যারেক্টার বাদ — নইলে তীর-চিহ্ন চাপলে আবর্জনা ঢুকত
                if (!char.IsControl(key.KeyChar)) builder.Append(key.KeyChar);
            }

            return Clean(builder.ToString());
        }
        catch (Exception)
        {
            // কনসোল নেই (WinExe হিসেবে চললে) — প্রম্পট বাদ, ক্র্যাশ নয়।
            return null;
        }
    }

    /// <summary>
    /// ফাঁকা বাদ। ⚠️ এর বেশি কিছু করা হয় না — ড্যাশ বা কেস "ঠিক" করতে গেলে
    /// সার্ভারের কোডের সাথে আর মিলত না, আর ব্যবহারকারী দেখত "কোড ভুল"।
    /// </summary>
    private static string? Clean(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }
}
