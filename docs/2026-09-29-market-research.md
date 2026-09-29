# Office management market research — 29 September 2026

Baseline: live **424 / e327e29**, canonical [current state](current-state.md). This is a recommendation, not approval to implement or deploy features. Official product pages were reviewed on 29 September; vendor descriptions establish capabilities, not independent evidence of performance or savings. No pricing comparison or Bangladesh payroll compliance claim is made.

## বাজার থেকে পাওয়া দিকনির্দেশ

| Product | Officially documented pattern | oXeio-এর জন্য অর্থ |
|---|---|---|
| [ClickUp Proofing](https://help.clickup.com/hc/en-us/articles/6325985679383-Annotate-images-videos-and-PDFs-with-Proofing) | File/image-এর নির্দিষ্ট জায়গায় comment | Design feedback design/version-এর সঙ্গে থাকা দরকার; local proofing implementation already exists but is unreleased |
| [ClickUp templates](https://help.clickup.com/hc/en-us/articles/6309918176535-Use-task-templates) ও [checklists](https://help.clickup.com/hc/en-us/articles/13455445264663-Create-checklist-templates) | Reusable tasks, fields, attachments and checklists | Reusable research brief ও design submission checklist |
| [ClickUp Automations](https://clickup.com/features/automations) | Trigger-based assignment/status/handoff automation | Existing notification infrastructure-এ actionable reminders; broad automation builder unnecessary initially |
| [Connecteam Operations](https://help.connecteam.com/en/articles/5951916-operations-hub-the-advanced-plan) | Time Clock, Job Schedule, Forms and Quick Tasks | কাজ আটকে গেলে structured issue form; tracking already exists |
| [Connecteam knowledge/skills](https://help.connecteam.com/en) ও [onboarding](https://help.connecteam.com/en/articles/12801593-starting-guide-to-the-onboarding-feature) | Knowledge Center, courses, quizzes; onboarding documents/tasks | Bengali SOP, examples, small onboarding checklist |
| [BambooHR platform](https://www.bamboohr.com/platform/) | Employee records, onboarding, performance, time/payroll | Employee lifecycle records and development notes; existing attendance/payroll should be extended rather than duplicated |
| [Hubstaff features](https://hubstaff.com/features) | Task/project time, budgets, reporting, capacity | Output quality ও business results-সহ reporting; activity alone should not rank design quality |

Priorities below are our judgment based on the office's design workflow, not vendor recommendations.

## আগে থেকে যা আছে

- Live: time/activity/screenshots, monthly/payroll calculations, leave ledger, security deposit, role access, target distribution, skip review, recorded skip insights/history, pool filters, selected personal target, external readiness monitoring.
- Implemented locally but full workspace unreleased: proofing/versioned previews, workload/priority/due dates, production quality reports, owner digest, sales CSV/results. এগুলো নতুন করে বানানোর proposal নয়; scoped review, acceptance and release দরকার। [Approved plan](production-expansion-plan.md).
- Physical-PC acceptance, alert-email receipt, specific offsite-upload approval remain pending. Feature research resolves none of these.
- Leave-request approval and manual time/meeting claims were previously rejected. This research does not reopen them. Uploaded/Live on Amazon controls removed at the owner's request must not return to Add design targets or Design Pool.

## নতুন additions: অগ্রাধিকার ও minimum scope

| Priority | Addition | প্রথম useful version | Benefit | Relative effort |
|---|---|---|---|---|
| 1 | Research/design brief template | Target-এ niche, intended audience, style, required text, reference note, expected output; reusable templates | Designer কম প্রশ্ন করবে, ভুল বোঝাবুঝি কমবে | Small–medium |
| 2 | Structured blocker/help request | Missing brief, broken link, tool issue বা technical problem; target-linked reason, owner, resolved state | সমস্যার জন্য Skip আর help request আলাদা; target assigned থাকবে, skip/pay/time rules বদলাবে না | Medium |
| 3 | Submission checklist ও file preflight | Owner-defined dimensions/format/naming/required files; selected technical checks, actionable warning; sample accepted output | Reviewer-এর repeated corrections কমানোর সম্ভাবনা | Medium |
| 4 | Role-specific Today panel | Designer: current work/fixes/help requests; manager: items needing action; owner: operational summary; direct links | Menu ঘুরে কাজ খোঁজার সময় কমবে; current My Data/Live Board extend করতে হবে | Small–medium |
| 5 | Bengali SOP ও example library | Searchable how-to, accepted/rejected examples with explanation, document version and read acknowledgement | নতুন staff training ও consistent standards | Medium |
| 6 | PC/equipment issue register | Existing Device records extend with company asset tag, assigned employee, issue/repair history, warranty date; accessory records as needed | PC problem follow-up এবং handover পরিষ্কার | Medium |
| 7 | Onboarding/offboarding checklist | Account, agent setup, SOP training, asset handover/return; explicit responsible person and completion record | New/joining/leaving staff-এর কাজ বাদ পড়বে না; existing account/device revocation reused | Medium |
| 8 | Skill ও coaching record | Manager-recorded typography/illustration/tool skills, examples, training goals and follow-up | উপযুক্ত কাজ ও targeted training; automatic disciplinary score নয় | Medium |

Effort is relative scope, not a delivery promise. Templates/SOP content need owner input. Attachments need private access, limits and retention. Blocker reporting must not create paid time or automatic skip exemption. Preflight checks cannot establish originality, trademark safety or subjective quality.

## Recommended sequence

1. Pilot **brief templates + blocker requests + submission checklist** with a small group; count clarification requests, blocker resolution time and avoidable returned designs before/after. No savings percentage is assumed.
2. Review and release existing **proofing + workload** in an isolated scope. Verify quality/first-pass reports use recorded reviewed samples, not all assignments or activity percentage.
3. Add Today panel and SOP library from actual pilot feedback; then assets/onboarding/coaching if needed.
4. Use existing digest/notification infrastructure with deduplication and direct links. Sales CSV/results can follow once product mapping and authorized source exports are accepted.

Do not build a generic chat app, CRM, enterprise recruitment suite or automatic AI employee punishment for this small design office. AI-assisted brief checking or Bengali summaries can be evaluated later with source-linked evidence and explicit data access decisions.

## Evidence and handoff

Read current-state, approved production plan, previous feature research, feature catalogue and clean deployed Prisma/UI source. Historical catalogue statements were cross-checked against current-state; no fresh full-system/physical audit is claimed. Report and current-state are saved locally and on VPS `/opt/oxeio/docs/`; application remains 424. No new SaaS connection, feature deployment or GitHub push.
