# PULSE Edge UI — Style Guide

Design system reference for **Pulse.Edge.UI** (`src/Pulse.Edge.UI`). Use this document when building or reviewing any screen, component, or modal in the Edge dashboard.

This guide is derived from the shared **`@pulse/ui`** package (`packages/pulse-ui`) and Edge-local overrides (`OnboardingWizard.css`, `CustomSelect.css`). Cloud web (`apps/web`) imports the same package via `globals.css`.

---

## Shared design system (`@pulse/ui`)

| Layer | Path | Contents |
|-------|------|----------|
| Tokens | `packages/pulse-ui/src/tokens.css` | Canonical CSS variables (`--primary`, `--text`, …) + Edge legacy aliases |
| Layout shell | `layout.css` | Sidebar, topbar, content area, cards, tables |
| Components | `components.css` | `ui-*` classes shared by Cloud and Edge |
| Domain | `domain.css` | Edge-specific stream cards, toasts, filter bar |
| Entry | `index.css` | Barrel import of all layers |

**Rule:** Add new shared patterns to `@pulse/ui`, not duplicated in `apps/web` or Edge. Edge `src/index.css` only imports `@pulse/ui` plus local wizard/select styles.

---

## 1. Design Principles

| Principle | Meaning in Edge UI |
|-----------|-------------------|
| **Industrial clarity** | Operators configure edge nodes under pressure. Hierarchy, status, and actions must be scannable in seconds. |
| **Asset-spine consistency** | Edge UI is a sibling to the cloud web app. Same fonts, primary color, sidebar shell, and glassmorphic surfaces. |
| **Data-first typography** | Human labels in DM Sans; IDs, payloads, serial numbers, and metrics in Space Mono. |
| **Status is always visible** | Pulsing dots, color-coded badges, and topbar indicators communicate agent/cloud health without opening a tab. |
| **Progressive density** | Dashboard summary cards are compact; configuration panels and modals breathe with generous padding. |

---

## 2. Design Tokens

All tokens live in `packages/pulse-ui/src/tokens.css` (imported via `@pulse/ui`). Edge `src/index.css` re-exports them. **Never hardcode hex values** when a token exists.

### 2.1 Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--primary-color` | `#3ce8bd` | Primary actions, active accents, brand highlight in logo |
| `--primary-dark` | `#2bc59e` | Hover states, metric highlights, selected checkmarks |
| `--primary-glow` | `rgba(60, 232, 189, 0.2)` | Focus rings, button shadows, sidebar active background |
| `--bg-color` | `#f4f5f7` | Page background, input backgrounds, hover fills |
| `--surface-color` | `#ffffff` | Topbar, modal surfaces, card base |
| `--card-bg` | `rgba(255, 255, 255, 0.85)` | Glassmorphic cards and panels |
| `--sidebar-bg` | `#12131a` | Sidebar, primary button text on light buttons |
| `--sidebar-text` | `#a0aec0` | Sidebar inactive labels, onboarding secondary text |
| `--text-primary` | `#1a202c` | Headings, body text |
| `--text-secondary` | `#718096` | Descriptions, labels, placeholders |
| `--code-color` | `#4a5568` | Monospace payload text in tables |
| `--border-color` | `#e2e8f0` | Dividers, input borders, panel borders |
| `--success-color` | `#48bb78` | Online status, success badges |
| `--warning-color` | `#ecc94b` | Paused sync, pending approval, warning badges |
| `--danger-color` | `#f56565` | Errors, offline/revoked states |

**Sidebar internal borders:** `#1a1c23` (not `--border-color`).

### 2.2 Domain / Stream Type Colors

Use consistently across cards, template pickers, and summary icons:

| Stream type | Accent | Background tint | Badge class |
|-------------|--------|-----------------|-------------|
| **Production (OEE)** | `var(--primary-dark)` | `rgba(60, 232, 189, 0.08–0.15)` | `.badge.success` |
| **Energy** | `#dd6b20` | `rgba(237, 137, 54, 0.08)` | `.badge.warning` |
| **General** | `#3182ce` | `rgba(66, 153, 225, 0.08)` | `.badge.info` |
| **Custom template** | `#805ad5` | `rgba(128, 90, 213, 0.08)` | `.badge.warning` |
| **Disabled / paused** | `#cbd5e0` | `#fafbfc` surface | neutral text |

Top accent bar on stream cards: `4px solid {themeColor}` when enabled; `#cbd5e0` when paused.

### 2.3 Typography

| Role | Font | Weight | Size | Notes |
|------|------|--------|------|-------|
| Base | `--font-body` (DM Sans) | 400 | 15px root | `-webkit-font-smoothing: antialiased` |
| Sidebar logo | DM Sans | 800 | 20px | `letter-spacing: 1.5px`; "EDGE" in primary |
| Topbar title | DM Sans | 700 | 18px | — |
| Page title | DM Sans | 800 | 24px | `letter-spacing: -0.5px` |
| Page description | DM Sans | 400 | 13px | `line-height: 1.5`, max-width 600px |
| Panel title | DM Sans | 700 | 16px | — |
| Card label | DM Sans | 600 | 13px | `uppercase`, `letter-spacing: 0.5px` |
| Card value | Space Mono | 700 | 28px | Stats and KPI numbers |
| Form label | DM Sans | 600–700 | 13px | — |
| Form input | DM Sans | 400 | 14px | — |
| Table header | DM Sans | 600 | 12px | `uppercase` |
| Table cell | DM Sans | 400 | 14px | — |
| Badge | DM Sans | 700 | 11px | `uppercase` |
| Sidebar footer / node badge | Space Mono | 600 | 10–11px | Version, serial, DB status |
| Code / payload | Space Mono | 400–600 | 11–13px | JSON, paths, IDs |

**Font loading:** Google Fonts link in `index.html` — DM Sans (variable) + Space Mono (400/700).

### 2.4 Spacing Scale

Use multiples of **4px**. Common values in the codebase:

| Token | px | Usage |
|-------|-----|-------|
| xs | 4 | Badge padding, tight gaps |
| sm | 8 | Icon gaps, filter chip gaps |
| md | 12 | Menu item padding, form label margin |
| base | 16 | Panel internal gaps, grid gaps (cards) |
| lg | 20 | Form group margin, panel header padding |
| xl | 24 | Card/panel padding, section gaps, stats grid gap |
| 2xl | 32 | Content area padding, page header margin-bottom |
| 3xl | 40 | Empty state padding, onboarding card padding |

**Layout constants (locked):**

- Sidebar width: **240px**
- Topbar height: **60px**
- Content area padding: **32px**

### 2.5 Border Radius

| Size | px | Usage |
|------|-----|-------|
| sm | 4–6 | Inputs, small buttons, error boxes |
| md | 8 | Menu items, buttons, info boxes, banners |
| lg | 10–12 | Cards, panels, filter bar, modals (inner) |
| xl | 16 | Modal shells, onboarding card |
| pill | 20 | Topbar node badge, filter chips |

### 2.6 Shadows & Glass

```css
/* Card default */
box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);

/* Card hover */
box-shadow: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04);
transform: translateY(-2px);

/* Panel (subtle) */
box-shadow: 0 1px 3px rgba(0,0,0,0.05);

/* Modal */
box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);

/* Primary button */
box-shadow: 0 4px 14px var(--primary-glow);
```

Glass surfaces use `backdrop-filter: blur(8px)` on cards/panels; onboarding and toasts use `blur(20px)`.

### 2.7 Z-Index Stack

| Layer | z-index |
|-------|---------|
| Sidebar | 100 |
| Topbar | 99 |
| Modal overlay | 1000 |
| CustomSelect dropdown | 1050 |
| Toast container | 9999 |

---

## 3. Layout Architecture

```
┌─────────────────────────────────────────────────────────┐
│ app-container (100vh, flex, overflow hidden)          │
│ ┌──────────┐ ┌──────────────────────────────────────┐  │
│ │ sidebar  │ │ main-content                          │  │
│ │ 240px    │ │ ┌──────────────────────────────────┐  │  │
│ │          │ │ │ topbar (60px, sticky)            │  │  │
│ │ brand    │ │ └──────────────────────────────────┘  │  │
│ │ menu     │ │ ┌──────────────────────────────────┐  │  │
│ │ footer   │ │ │ content-area (scroll, 32px pad)  │  │  │
│ └──────────┘ │ └──────────────────────────────────┘  │  │
│              └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- `body { overflow: hidden }` — only `.content-area` scrolls.
- Each tab wraps content in a column with `gap: 24px`.
- Settings uses a two-column grid: `1.2fr 1fr`.

### 3.1 Sidebar

- Background: `--sidebar-bg`
- Brand row: 60px height, bottom border `#1a1c23`
- Menu: 24px vertical padding, 6px gap between items
- **Menu item:** 12px 16px padding, 8px radius, icon 18px (lucide-react)
- **Active item:** left 3px primary border, `rgba(60,232,189,0.15)` background, white text
- **Hover:** `rgba(255,255,255,0.05)` background

### 3.2 Topbar

- White surface, bottom border
- Left: node/site badges (mono labels)
- Right: status indicators + refresh button
- Status separated by `border-left: 1px solid var(--border-color)` + 20px left padding

### 3.3 Page Header

Every tab opens with `.page-header`:

```html
<div class="page-header">
  <div class="page-header-info">
    <h2 class="page-header-title">
      <Icon size={24} style={{ color: 'var(--primary-color)' }} />
      Title Here
    </h2>
    <p class="page-header-desc">One-line description.</p>
  </div>
  <div class="page-header-actions"><!-- optional buttons --></div>
</div>
```

Page title icons use primary color and get a playful hover (`scale(1.15) rotate(5deg)`).

---

## 4. Components

### 4.1 Cards (`.card`)

- Use in **stats grids** and **summary rows**
- Default grid: `repeat(auto-fit, minmax(220px, 1fr))`, gap 24px
- Summary row variant: `minmax(200px, 1fr)`, gap 16px, horizontal icon + metric layout
- Icon container: 10px padding, 10px radius, 10% tint of domain color

### 4.2 Panels (`.panel`)

- Primary container for forms, tables, and card-style content blocks
- Header: flex space-between, bottom border, 16px padding-bottom
- Use for filter bars with reduced padding (`16px 20px`) when inline

### 4.3 Buttons

#### Primary (CTA)

```css
background: var(--primary-color);
color: var(--sidebar-bg);
border: none;
padding: 10px 20px;        /* header actions */
padding: 12px 16px;        /* modal submit */
border-radius: 8px;
font-weight: 700;
box-shadow: 0 4px 14px var(--primary-glow);
/* hover: translateY(-1px), stronger glow */
```

Always pair with lucide icon at **18px** in header actions, **14px** in compact contexts.

#### Secondary / Outline

```css
background: transparent;
color: var(--text-primary);   /* or var(--text-secondary) in modals */
border: 1px solid var(--border-color);
padding: 10px 20px;
border-radius: 8px;
font-weight: 700;
/* hover: background var(--bg-color), optional primary border */
```

#### Ghost / Icon

- Transparent background, no border
- Close buttons: 28×28px circle, `×` at 22px, hover `--bg-color`
- Destructive icon buttons: use `--danger-color` sparingly

#### Toggle / State buttons (e.g. sync pause)

- Filled tint matching state: primary 15% or warning 15%
- Border 1px at 30% opacity of state color
- Full width inside stat cards, 12px font, bold

#### Modal footer layout

- Flex row, gap 12px
- Primary submit: `flex: 2`
- Cancel: `flex: 1`

#### Onboarding buttons (dark surface)

See §5 — use `.onboarding-btn-*` classes only inside onboarding.

### 4.4 Form Controls

| Element | Class | Spec |
|---------|-------|------|
| Group | `.form-group` | `margin-bottom: 20px` |
| Label | `.form-label` | 13px, semibold, secondary color (white on dark) |
| Text input | `.form-input` | 10px 14px padding, 6px radius, bg `--bg-color` |
| Focus | — | `border-color: primary`, `box-shadow: 0 0 0 3px var(--primary-glow)` |
| Readonly | — | `#edf2f7` background, not-allowed cursor |
| Textarea | `.form-input` | `min-height: 80px`, vertical resize |
| Select | `CustomSelect` | 34px min-height, 12px semibold text |

**Search input pattern:** icon absolutely positioned at `left: 12px`, input `padding-left: 36px`, height 40px.

**ID fields:** `font-family: var(--font-mono)`, bold, uppercase.

### 4.5 CustomSelect

- Trigger matches form aesthetic but compact (12px font, 600 weight)
- Dropdown: white surface, 6px radius, shadow, max-height 200px
- Selected option: `--bg-color` fill + primary checkmark
- z-index: 1050

### 4.6 Tables (`.data-table`)

- Full width, collapsed borders
- Header: 12px uppercase secondary
- Row hover: `#f8fafc`
- Monospace for payloads, IDs, timestamps
- Scroll container: `overflow-x: auto`, optional `max-height: 420px`

### 4.7 Badges (`.badge`)

Base: `padding: 4px 8px`, `border-radius: 12px`, 11px bold uppercase.

| Modifier | Background | Text |
|----------|------------|------|
| `.success` | `#c6f6d5` | `#22543d` |
| `.warning` | `#feebc8` | `#744210` |
| `.info` | `rgba(66,153,225,0.12)` | `#2b6cb0` |
| `.primary` | `rgba(60,232,189,0.15)` | `#2bc59e` |
| `.neutral` | `rgba(74,85,104,0.08)` | `#4a5568` |

Small inline badges: 10px font, `text-transform: none`, `padding: 3px 6px`.

### 4.8 Status Indicators

**Pulse dot** (`.pulse-dot`): 8×8px circle, animated ring.

| Class | Color | Meaning |
|-------|-------|---------|
| (default) | success green | Online / connected |
| `.warning` / `.pending` | warning yellow | Paused / awaiting approval |
| `.error` | danger red | Disconnected |
| `.revoked` | `#ed8936` | API key revoked |

Animation: 1.6s infinite scale + expanding shadow (`pulse`, `pulse-warn`, `pulse-danger`).

### 4.9 Banners & Alert Boxes

**Warning banner (light theme):**

```css
background: #feebc8;
border: 1px solid #ecc94b;
color: #744210;
padding: 16px 24px;
border-radius: 8px;
font-size: 14px;
font-weight: 500;
```

**Info callout (protocols tab):** `rgba(66,153,225,0.08)` background, `#3182ce` border tint.

**Onboarding error/success boxes:** see §5 (dark translucent variants).

### 4.10 Modals

**Overlay:**

```css
position: fixed; inset: 0;
background: rgba(10, 11, 15, 0.4);
backdrop-filter: blur(10px);
display: flex; align-items: center; justify-content: center;
z-index: 1000;
```

**Dialog shell:** `.panel` with overrides:

- Width: 520px (`max-width: 90%`)
- Padding: 28px 36px
- Border-radius: 16px
- White background, elevated shadow

**Header:** title 18px/800 + subtitle 12px secondary + circular close button.

### 4.11 Toasts (`ToastContainer`)

- Fixed bottom-right (24px inset), column, gap 8px
- Dark glass: `rgba(15,15,25,0.92)`, blur 20px
- Left accent bar 3px in semantic color
- Slide-in from right with spring easing
- Auto-dismiss progress bar 2px at bottom
- Default duration: 4000ms
- Respect `prefers-reduced-motion`

Toast semantic colors (slightly different from main tokens — intentional for dark surface):

| Type | Icon / accent |
|------|---------------|
| success | `#10b981` |
| error | `#ef4444` |
| warning | `#f59e0b` |
| info | `#6366f1` |

### 4.12 Empty States

- Centered in panel, dashed 2px border, 50% white background
- Large emoji or icon (32px), bold title, 13px helper text
- Padding: 60px 40px (lists) or 48px (panels)

### 4.13 Template / Category Picker

Grid of selectable tiles: `repeat(auto-fill, minmax(130px, 1fr))`, gap 10px.

- Unselected: white bg, `--border-color` 2px border
- Selected: domain color border + 8% tint background
- Icon 16px, title 12px/700, subtitle 9px

### 4.14 Filter Chips

- Pill shape: `border-radius: 20px`
- Active: `--sidebar-bg` fill, white text
- Inactive: white fill, secondary text, border

---

## 5. Onboarding Wizard (Dark Theme)

Separate stylesheet: `OnboardingWizard.css`. Full-viewport dark experience before main shell loads.

| Element | Treatment |
|---------|-----------|
| Background | `--sidebar-bg` with decorative blur spheres |
| Card | Glass: `rgba(255,255,255,0.03)`, 16px radius, blur 20px |
| Title | 28px gradient text (white → sidebar-text) |
| Inputs | Dark fill `rgba(0,0,0,0.25)`, white text, light border |
| Primary CTA | Full-width, primary fill, glow shadow |
| Stepper | Circles 24px; active = primary tint; completed = primary fill |
| Info box | Dashed primary border, 4% primary background |

Reuse `.form-input` / `.form-label` — onboarding CSS overrides colors for dark context.

---

## 6. Icons

- **Library:** `lucide-react` (stroke icons, consistent with modern industrial UI)
- **Standard sizes:**

| Context | Size |
|---------|------|
| Sidebar menu | 18px |
| Page header | 24px |
| Header action buttons | 18px |
| Inline / table actions | 14–16px |
| Summary card icons | 20px |
| CustomSelect chevron | 14px |
| Toast icons | 18px (inline SVG in ToastContainer) |

- **Color:** inherit or explicit `var(--primary-color)` for branded headers
- **Dynamic icons:** `ICON_MAP` in `DataSourcesTab/utils.tsx` — extend when adding template types

---

## 7. Motion & Animation

| Name | Duration | Easing | Usage |
|------|----------|--------|-------|
| Default transition | 0.2s | ease | hovers, borders, colors |
| Button hover lift | 0.2s | ease | `translateY(-1px)` |
| Card hover | 0.2s | ease | `-2px` lift + shadow |
| Page title icon | 0.3s | cubic-bezier(0.34, 1.56, 0.64, 1) | scale + rotate |
| Modal / onboarding enter | 0.3–0.4s | cubic-bezier(0.16, 1, 0.3, 1) | slideUp / fadeIn |
| Toast enter | 0.3s | spring cubic-bezier | slide from right |
| Pulse dot | 1.6s | infinite | status rings |
| Spin | 1s linear infinite | `.spin` on refresh icon when loading |

Always honor `@media (prefers-reduced-motion: reduce)` for toast animations.

---

## 8. Cross-Project Alignment (Edge ↔ Cloud Web)

Edge UI tokens map to `apps/web/src/styles/globals.css`:

| Edge token | Cloud token |
|------------|-------------|
| `--primary-color` | `--primary` |
| `--primary-dark` | `--primary-dark` |
| `--primary-glow` | `--primary-glow` |
| `--bg-color` | `--bg` |
| `--surface-color` | `--surface` |
| `--sidebar-bg` | `--sidebar-bg` |
| `--text-primary` | `--text` |
| `--text-secondary` | `--text-muted` |
| `--border-color` | `--border` |
| `--font-body` | `--font-body` |
| `--font-mono` | `--font-mono` |

Cloud web adds Tailwind utility classes (`.ui-panel`, `.ui-input`, etc.). When porting components between projects, translate class names but keep visual values identical.

---

## 9. Implementation Rules

### Do

1. **Use CSS classes from `@pulse/ui`** for layout, cards, panels, forms, tables, and badges.
2. **Use CSS variables** for all colors, fonts, and glow effects.
3. **Use Space Mono** for anything a developer would copy-paste (serials, JSON, IDs, ports).
4. **Follow the page-header → content → panel hierarchy** on every new tab.
5. **Match modal structure** (overlay + panel + header + form + footer buttons) for all dialogs.
6. **Use `CustomSelect`** instead of native `<select>` for visual consistency.
7. **Use `useToast` + `ToastContainer`** for operational feedback; avoid `window.alert` except destructive confirms.
8. **Use `ModalShell`** for all modals — pass `size` (`default`, `wide`, `tall`, `md`, `lg`, `xl`, `browser`) and optional `bodyClassName`.
9. **Prefer CSS `:hover` states** over `onMouseEnter` / `onMouseLeave` DOM style mutations.

### Don't

1. **Don't introduce new font families** — stick to DM Sans + Space Mono.
2. **Don't use purple gradients on white** or other generic AI aesthetics.
3. **Don't hardcode spacing outside the 4px scale** without reason.
4. **Don't create one-off modal widths** — stay at 520px unless content truly requires more (use `ModalShell` size variants).
5. **Don't mix Bootstrap/MUI/other libraries** — the design system is self-contained CSS.
6. **Don't scroll the whole page** — scroll inside `.content-area` or table containers only.
7. **Don't use inline `style={{}}`** — extract patterns into `@pulse/ui` utility classes. Dynamic theme accents use CSS variables (e.g. `--ds-accent` on `.ds-card.theme-*`, `--node-depth` on tree rows).

---

## 10. Accessibility Checklist

- [ ] Icon-only buttons have `title` or `aria-label` (close, refresh, save)
- [ ] Toasts use `role="alert"` and `aria-live="assertive"`
- [ ] Toast region has `aria-label="Notifications"`
- [ ] Form inputs have associated `<label class="form-label">`
- [ ] Focus states use visible primary glow (not removed)
- [ ] Color is not the only status indicator (pair dot + text label)
- [ ] Disabled buttons use `opacity: 0.5–0.6` and `cursor: not-allowed`
- [ ] Modal close is keyboard reachable

---

## 11. File Reference

| File | Responsibility |
|------|----------------|
| `packages/pulse-ui/src/*.css` | **Source of truth** — tokens, layout, components, domain |
| `src/index.css` | Imports `@pulse/ui` + Edge-only overrides |
| `src/components/ModalShell.tsx` | Reusable modal overlay + dialog shell |
| `src/components/OnboardingWizard.css` | Dark onboarding-only overrides |
| `src/components/CustomSelect.tsx` | Styled dropdown control |
| `src/components/ToastContainer.tsx` | Notification stack + animations |
| `index.html` | Font loading, page title |
| `apps/web/src/styles/globals.css` | Cloud entry — imports `@pulse/ui` + Tailwind bridge |

---

## 12. Quick Copy Templates

### New tab skeleton

```tsx
<div className="tab-stack">
  <div className="page-header">
    <div className="page-header-info">
      <h2 className="page-header-title">
        <MyIcon size={24} className="page-header-icon" />
        Tab Title
      </h2>
      <p className="page-header-desc">Short description of this view.</p>
    </div>
    <div className="page-header-actions">
      <button type="button" className="btn-primary">
        <Plus size={18} />
        Action Label
      </button>
    </div>
  </div>

  <div className="panel">
    <div className="panel-header">
      <h2 className="panel-title">Section Title</h2>
    </div>
    {/* content */}
  </div>
</div>
```

### Modal (via ModalShell)

```tsx
<ModalShell
  title="Dialog Title"
  subtitle="Optional context line"
  size="default"
  onClose={handleClose}
>
  <form className="modal-form" onSubmit={handleSubmit}>
    <div className="form-group">
      <label className="form-label">Field Label</label>
      <input className="form-input" />
    </div>
    <div className="modal-footer">
      <button type="button" className="btn-secondary btn-flex-1" onClick={handleClose}>Cancel</button>
      <button type="submit" className="btn-primary btn-flex-2">Save</button>
    </div>
  </form>
</ModalShell>
```

### Primary button

```tsx
<button type="button" className="btn-primary">
  <Plus size={18} />
  Action Label
</button>
```

---

*Last updated from codebase audit: Pulse.Edge.UI, June 2026.*
