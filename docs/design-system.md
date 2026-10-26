# Design system: "Lagoon & Limestone"

Pool PM's look is its own. It borrows proven ideas from three sibling projects:
- **Mindful Money Management:** a palette tied to the logo, a branded boot gate and sign-in, a time-of-day greeting, hero summary cards and inviting empty states.
- **DFS Riches:** the inverted "hero" card with stat tiles, uppercase kickers, a first-run tour plus a "Start here" checklist, and tinted status chips.
- **The Riches Digital Ventures site:** a serif display face for headlines and big figures, a single accent used as soft light, expo-out reveals and press micro-interactions.

Sources of truth:

| What | Where |
|---|---|
| Color, spacing, radius, type and motion tokens | `packages/ui/src/index.ts` |
| NativeWind theme and component vocabulary | `apps/mobile/global.css` (`packages/ui/test/sync-css.test.ts` fails if the colors drift from the tokens) |
| Brand mark | `apps/mobile/assets/brand/mark.svg` → `node apps/mobile/scripts/generate-brand-assets.mjs` regenerates the icon, adaptive icon, splash and favicon. `src/components/brand.tsx` draws the same mark in-app. |
| Motion primitives | `apps/mobile/src/components/ui/motion.tsx` |

## Color

Warm limestone neutrals (the coping stone), deep-water ink, lagoon teal for brand and primary actions, and sun amber used only for highlights. Dark mode is "night swim": deep water with a glowing pool-light teal.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | #f5f2ec | #071319 | Screen |
| `card` / `surface` / `muted` | #ffffff / #faf8f4 / #ece7de | #0e1f27 / #12262f / #183139 | Surfaces, insets, tracks |
| `foreground` / `muted-foreground` | #0a2230 / #54636b | #e8f1f2 / #97adb4 | Text |
| `primary` | #0a6c78 | #3ccfdb | Brand, primary buttons, links |
| `accent` / `accent-ink` | #f2a93b / #8f5300 | #f7b955 | Highlights; `accent-ink` when amber is used as text (kickers) |
| `hero` / `hero-foreground` / `hero-muted` | #0a2230 / #f5f2ec / #a7bcc3 | #0b2c38 / … | Inverted summary cards, tab bar |
| `glow` | #2bd4e3 | #3ccfdb | Pool light: hero kickers, active tab pill, progress rings, soft glows |
| `success` / `warning` / `destructive` / `info` (+ `-soft`) | | | Status. Always a tinted fill with full-strength text. |

Unit tests enforce these contrast minimums in both themes:

| Pairing | Minimum ratio |
|---|---|
| Body text on surfaces | 7:1 |
| Secondary text | 4.5:1 |
| Every status badge | 4.5:1 |
| Hero text | 7:1 |

## Type

| Role | Face | Class |
|---|---|---|
| Screen titles, hero titles, big figures | **Fraunces** 600/700 (display serif) | `h1`, `display`, `hero-title`, `stat-value` |
| Interface: body, labels, buttons | **Manrope** 300–800 | `body`, `h2`, `h3`, `caption`, `label` |
| Kickers above titles | Manrope ExtraBold, 11px, uppercase, 1.6px tracking | `kicker`, `hero-kicker` |

Figures use tabular numerals (`Text variant="stat" | "mono"`), so amounts and dates line up. Body text is 16px minimum and scales with Dynamic Type up to 1.6×.

## Components (vocabulary in `global.css`)

| Class or component | Use |
|---|---|
| `card` (rounded-3xl, hairline border) | Standard surface. `Card onPress` adds press-scale. |
| `HeroCard` + `HeroStat` | The one most important summary per screen: Today on site, a project's status, the client's build. Deep water with a glow. |
| `Stat` (`tile`) | Secondary KPIs in a 2-up grid. Uppercase label, serif figure, coloured dot for tone. |
| `QuickAction` | The 2–4 most common jobs on a screen, as big, labelled targets. |
| `SectionHeader kicker title` + "See all ›" | Section rhythm. |
| `Chips` | Horizontally scrolling filters; the active chip uses the hero ink. |
| `EmptyState` | Teal icon tile, a friendly title, what to do next, and a primary action. |
| `ProgressRing` | Completion that sweeps in (hero cards). |

## Motion

| Pattern | Spec |
|---|---|
| Press | Spring to 0.97 scale (`PressableScale`), with a light haptic on primary actions and a selection tick on tabs and chips |
| Reveal | Sections fade and rise 14px with expo-out over 520ms, staggered 45ms (capped at 8). Native uses Reanimated; web uses CSS keyframes. |
| Rings | Sweep 900ms expo-out |
| Reduced motion | When the OS setting is on, everything is instant |

## Intuitive by default

- **First run:** a three-page, role-aware welcome tour (office, field or client). It is shown once and can be replayed from Settings → Help.
- **Getting started:** admins and PMs see a checklist on Home (create a project, invite the crew, turn on two-step verification). It can be dismissed and brought back from Settings.
- **Hierarchy:** every main screen leads with a single hero answering "what matters now?". Quick actions come next, then detail.
- **Sync status:** shown as a quiet cloud icon when everything is fine. It grows into a labelled pill only when something needs attention (offline, waiting or conflicts).
- **Copy:** plain-language and verb-first ("Set up your company — free", "Approve with a signature"), with kickers that give context ("Crew plan", "Action needed").
