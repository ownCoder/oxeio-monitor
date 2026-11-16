# D05 table controls — Monday evidence refresh

Date: 16 November 2026

Official TimoDesk documentation was rechecked against the active D05 scope after release 526. The evidence supports continuing the existing roadmap rather than adding another view system.

## Worthwhile patterns

1. **Account-scoped visible columns with a reset default.** TimoDesk's redesigned tables let each user hide/show columns, show the visible count, and reset to the product default; a user's choice does not affect colleagues. This matches oXeio's new account preference store and is the next small D05 slice. Source: [TimoDesk redesign](https://timodesk.com/blog/why-we-redesigned-timodesk).
2. **Applied-filter chips and one clear action.** Each active filter stays visible as a chip and Clear all returns the full list. The task board also shows how many filters are active and retains filters while switching views. oXeio should reuse its current Pool/Review filter state and add a consistent presentation, not a parallel filter engine. Sources: [TimoDesk redesign](https://timodesk.com/blog/why-we-redesigned-timodesk), [task board docs](https://timodesk.com/docs/task-board).
3. **Export follows the visible filter context.** TimoDesk's report export follows the selected dates, member filter and grouping. oXeio's current Pool CSV exports only the visible page, so the label must stay honest until a server-side filtered export is deliberately built. Source: [Time & Activity docs](https://timodesk.com/docs/time-and-activity).

## Decision

Continue D05 in this order: shared account-scoped column preferences for Pool/Review, then consistent active-filter chips/reset, then extend the same interaction to Screenshots and appropriate reports. Do not build a general custom report builder; TimoDesk explicitly avoids one, and oXeio already has purpose-built reports. No new roadmap item is required from this refresh.
