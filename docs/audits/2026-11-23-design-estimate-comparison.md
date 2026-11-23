# Design estimate comparison — 23 November 2026

Release **540 / `66a71cb762e1e62998c717548912cca94d2b089d`** is live at `https://hub.oxeio.com` as the second D06 slice.

## Delivered

- Owner/manager **Quality & flow** now compares completed planned designs by controlled work type.
- Each row shows the visible sample count, median planned minutes, median matched Illustrator/Photoshop foreground minutes, median variance and how many matched designs exceeded plan.
- Planned designs without matching observed file activity are reported separately and excluded from medians. A 50,000-trace safety limit is disclosed if reached.
- This is planning evidence, not payroll credit, attendance or a quality score. No production data, estimate or work type was inferred or rewritten.

## Verification and recovery

- API typecheck/lint and exact production build passed. An isolated PostgreSQL 16 database applied all 48 migrations; focused estimate/production tests passed **15/15**. The disposable database/network were removed.
- Web typecheck/lint and the full frontend suite passed **313/313**.
- Live health reports build 540 and the exact commit. Anonymous Quality access returns 401, the public JS asset matches the container, and PostgreSQL remained `cab5ab...2821`.
- Rollback images: `oxeio-api:before-estimate-comparison-20261123` and `oxeio-web:before-estimate-comparison-20261123`. Exact release source/evidence: `/opt/oxeio-releases/design-estimate-comparison-20261123`.
- Disposable validation images and build cache older than 24 hours were removed; rollback images and data were preserved. Disk returned from 96% to 93%, with 5.4 GiB free.

## Monday research decision

Official product guidance supports presenting estimates beside tracked time and keeping sample context visible: [TimoDesk Tasks](https://timodesk.com/docs/tasks), [TimoDesk Task Board](https://timodesk.com/docs/task-board), [ClickUp time estimates](https://help.clickup.com/hc/en-us/articles/7255526314391-Set-time-estimates), [ClickUp Workload view](https://help.clickup.com/hc/en-us/articles/30799933602327-Customize-your-Workload-view), and [Asana time tracking](https://help.asana.com/s/article/time-tracking-in-asana?language=en_US). oXeio uses per-type medians and explicit sample counts rather than gamified scoring because its observed value is inferred file foreground time, not a manual task timer.

D06 remains `in_progress`. Next slice: checklist/subtasks and mentions inside the existing target workspace.
