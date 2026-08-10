/**
 * E10/E11-এর প্রতিটা পরিবর্তন `audit_log`-এ কীভাবে বসে, তার এক জায়গার নিয়ম।
 *
 * ⚠️ `AuditService`-এর `AuditAction` একটা বদ্ধ union, আর সেখানে
 * `create_employee` বা `update_work_policy` ধরনের আলাদা action নেই।
 * ইচ্ছে করে সেটা এড়িয়ে যাওয়া হয়নি — `src/audit/**` এই কাজের সীমার বাইরে।
 *
 * সৌভাগ্যক্রমে স্কিমা নিজেই পথটা দেখিয়ে দেয়: `audit_log.action`-এর কমেন্টে
 * owner-এর কনফিগ বদলের জন্য `change_setting` রাখা আছে, আর স্পেক § ৫-এ
 * "স্টাফ ও ডিভাইস ম্যানেজমেন্ট" Settings স্ক্রিনেরই অংশ। তাই বিস্তারিতটা
 * `targetType` + `meta.op`-এ যায়, action থাকে `change_setting`।
 *
 * ⭐ এর ফলে ফিল্টার করার মতো একটা স্থিতিশীল শব্দভাণ্ডার দাঁড়ায় —
 * `?targetType=employee_salary` দিলে বেতন বদলের সব ঘটনা এক জায়গায় আসে।
 */
export const ADMIN_TARGET = {
  employee: 'employee',
  /** ⭐ বেতন বদল আলাদা targetType — সবচেয়ে সংবেদনশীল লেখা, আলাদা করে খোঁজা যায় */
  employeeSalary: 'employee_salary',
  device: 'device',
  workPolicy: 'work_policy',
  holiday: 'holiday',
} as const;

export type AdminTarget = (typeof ADMIN_TARGET)[keyof typeof ADMIN_TARGET];
