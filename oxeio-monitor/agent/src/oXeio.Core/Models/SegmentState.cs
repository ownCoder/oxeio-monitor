namespace oXeio.Core.Models;

/// <summary>
/// মাত্র তিনটি স্টেট — ADR-011d।
///
/// ❌ BREAK / LUNCH নেই — লাঞ্চে গেলে ১ মিনিট পর এমনিতেই <see cref="Idle"/>
/// ❌ MEETING নেই     — স্টাফের চাপার মতো কোনো বাটনই নেই
/// ❌ OFF_SHIFT নেই   — সময়ের কোনো বাঁধন নেই, ২৪ ঘণ্টাই গোনা হয়
///
/// শুধু <see cref="Active"/> কাজ হিসেবে গোনা হয়।
/// </summary>
public enum SegmentState
{
    Active,
    Idle,
    Locked,
}
