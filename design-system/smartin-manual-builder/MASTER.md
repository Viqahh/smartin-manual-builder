# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/smartin-manual-builder/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Smartin Manual Builder
**Generated:** 2026-08-28
**Category:** Enterprise documentation builder / fintech developer tool
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 8/10 (Dense / Dashboard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#0F172A` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#1E293B` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#22C55E` | `--color-accent` |
| On Accent/CTA | `#0F172A` | `--color-on-accent` |
| Background | `#F6F8FB` | `--color-background` |
| Foreground | `#0F172A` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#0F172A` | `--color-card-foreground` |
| Muted | `#EEF2F6` | `--color-muted` |
| Muted Foreground | `#475569` | `--color-muted-foreground` |
| Border | `#CBD5E1` | `--color-border` |
| Blue accent | `#2563EB` | `--color-info` |
| Destructive | `#B42318` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Warning | `#B54708` | `--color-warning` |
| Ring | `#2563EB` | `--color-ring` |

**Color Notes:** Light work surfaces, navy application structure, blue for navigation/information, and Smartin green for the single primary action. Status meaning always includes icon and text.

### Typography

- **Heading Font:** IBM Plex Sans
- **Body Font:** IBM Plex Sans
- **Data/technical Font:** JetBrains Mono
- **Mood:** professional, technical, calm, precise
- **Google Fonts:** [JetBrains Mono + IBM Plex Sans](https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #22C55E;
  color: #0F172A;
  padding: 10px 16px;
  min-height: 44px;
  border-radius: 6px;
  font-weight: 600;
  transition: background-color 160ms ease, box-shadow 160ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.16);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #0F172A;
  border: 1px solid #CBD5E1;
  padding: 10px 16px;
  min-height: 44px;
  border-radius: 6px;
  font-weight: 600;
  transition: background-color 160ms ease, border-color 160ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.card[data-interactive="true"]:hover {
  border-color: #94A3B8;
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  min-height: 44px;
  border-radius: 6px;
  font-size: 16px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.input:focus {
  border-color: #0F172A;
  outline: 2px solid transparent;
  box-shadow: 0 0 0 3px #2563EB33;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle 120–200ms state transitions, thin borders, restrained shadows, clear type hierarchy, and no decorative motion.

### Application layout

- Desktop uses a navy 248px sidebar, a restrained top header, and high-density work surfaces.
- The manual builder uses chapters / editor / inspector at 280px / minmax(560px, 1fr) / 320px.
- Below 1024px, chapters and inspector become labeled drawers; the editor remains primary.
- Tables become semantic card rows below 768px rather than forcing horizontal page scrolling.
- Long-form manual text stays within a 65–75 character measure; A4 preview retains real page proportions.
- Radius scale is 4 / 6 / 8px. Large rounded marketing cards are prohibited.

---

## Motion

- Use CSS transitions only for hover, focus, drawer, sheet, and save-status continuity.
- Duration tokens: 120ms feedback, 160ms standard, 200ms panel transition.
- Animate opacity and transform only; never delay access to content.
- `prefers-reduced-motion: reduce` removes non-essential transitions.

---

## Anti-Patterns (Do NOT Use)

- ❌ Marketing-style hero sections inside the workspace
- ❌ Regulatory approval language without verified approval data
- ❌ Color-only completion/review states
- ❌ Nested scroll regions in the builder center column

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Decorative animation** — Motion must explain state or spatial continuity
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states use shared 120–200ms transition tokens
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
