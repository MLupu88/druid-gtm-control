# DRUID Design System Extract

Inferred from `artifacts/druid-calculator/` — the visual source of truth for all DRUID product apps.

---

## 1. Color Palette

### Dark Mode (Default)

| Role | CSS Variable | Hex | Notes |
|---|---|---|---|
| Page background | `--background` | `#0a0f0d` | Very dark, slightly warm |
| Card / surface | `--card` | `#111816` | 1–2 stops lighter than bg |
| Card border | `--card-border` | `#1f2924` | Subtle green-tinted dark |
| Default border | `--border` | `#1f2924` | Same as card-border |
| Input background | `--input` | `#1a2220` | Between bg and card |
| Primary green | `--primary` | `#00e676` | Brand CTA color |
| Primary hover | — | `#00c853` | 10% darker green |
| Primary foreground | `--primary-foreground` | `#0a0f0d` | Dark text on green bg |
| Body text | `--foreground` | `#ffffff` | Pure white |
| Muted text | `--muted-foreground` | `#9ca3af` | Tailwind gray-400 |
| Muted surface | `--muted` | `#1a2220` | |
| Secondary surface | `--secondary` | `#1f2924` | |
| Destructive | `--destructive` | `#ef4444` | |
| Focus ring | `--ring` | `#00e676` | Matches primary |

### Light Mode (`[data-theme="light"]` overrides)

| Role | Hex |
|---|---|
| Page background | `#f5f7f6` |
| Card background | `#ffffff` |
| Card/default border | `#dde0e6` |
| Body text | `#1a1a1a` |
| Muted text | `#6b7280` |
| Primary green | `#00c158` (slightly deeper for contrast) |
| Muted surface | `#f3f4f6` |

### Semantic / Status Colors

Used as Tailwind opacity-variant combos — never as solid fills:

```
Exceptional: bg-emerald-500/20  text-emerald-400  border-emerald-500/30
Strong:      bg-blue-500/20     text-blue-400     border-blue-500/30
Good:        bg-teal-500/20     text-teal-400     border-teal-500/30
Moderate:    bg-yellow-500/20   text-yellow-400   border-yellow-500/30
Low/Warn:    bg-orange-500/20   text-orange-400   border-orange-500/30
Error:       bg-red-500/20      text-red-400      border-red-500/30
Success:     bg-[#00e676]/20    text-[#00e676]    border-[#00e676]/50
```

### Raw Hex Quick Reference

```
#0a0f0d   page background
#111816   card background
#1f2924   card border, secondary surface
#1a2220   input background, muted surface
#00e676   primary green (CTAs, active states)
#00c853   primary hover
#9ca3af   muted text (Tailwind gray-400)
#6b7280   muted text light mode (Tailwind gray-500)
#f5f7f6   page background light mode
#dde0e6   card border light mode
#1a1a1a   body text light mode
#ef4444   destructive / error (Tailwind red-500)
```

---

## 2. Typography

### Font Stack

```css
--font-sans:    'Inter', sans-serif;              /* weights: 400, 500, 600 */
--font-display: 'Plus Jakarta Sans', sans-serif;  /* weights: 500, 600, 700, 800 */
```

Google Fonts URL:
```
https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800
```

### Type Scale

| Tailwind | px | Use cases |
|---|---|---|
| `text-[11px]` | 11 | Helper text below inputs, footer micro labels |
| `text-xs` | 12 | Badge/chip labels, code/monospace, section headers (uppercase) |
| `text-sm` | 14 | Default body, form labels, most UI copy |
| `text-base` | 16 | Card descriptions, highlighted body text |
| `text-lg` | 18 | Featured input values |
| `text-xl` | 20 | Card titles (`CardTitle`) |
| `text-2xl` | 24 | Section headings (`h2`) |
| `text-3xl+` | 30+ | Hero headings only |

### Typographic Rules

```
h1–h6:        font-display + tracking-tight
body:         font-sans + antialiased
CardTitle:    text-xl font-semibold leading-none tracking-tight font-display
Section label: text-xs font-semibold uppercase tracking-wider text-primary
Helper text:  text-[11px] text-muted-foreground mt-1
```

---

## 3. Spacing Scale

Tailwind 4px grid. Dominant values:

| Gap / Padding | px | Context |
|---|---|---|
| `gap-1` / `p-1` | 4 | Icon-text micro gaps |
| `gap-1.5` | 6 | Compact inline pairs |
| `gap-2` / `p-2` | 8 | Icon + label |
| `gap-3` / `p-3` | 12 | Button groups, tight sections |
| `gap-4` / `space-y-4` | 16 | Form field stacks |
| `gap-6` / `space-y-6` | 24 | Standard card grid gap, section stacks |
| `p-5` | 20 | Dense card content (results cards) |
| `p-6` | 24 | Standard card header/content (canonical) |
| `px-6` | 24 | Navbar / page-level horizontal padding |
| `py-2.5` | 10 | Metric rows, dense list items |
| `py-3.5` | 14 | Accordion/expandable button rows |

---

## 4. Border Radius

Base: `--radius: 0.75rem` (12px)

| Use | Value |
|---|---|
| Skeleton, micro elements | 4px |
| Compact badge | `rounded-md` ≈ 6px |
| **Button, Input, Select, small card** | `rounded-lg` = 12px |
| **Card, Panel (standard)** | `rounded-xl` = 12px (same in Tailwind) |
| **Modal, Drawer** | `rounded-2xl` = 16px |
| **Pill, Badge, Tag** | `rounded-full` |
| Chatbot launcher | 18px (inline style — intentional deviation) |
| Chatbot window | 20px (inline style — intentional deviation) |

---

## 5. Shadows

### Dark Mode

```css
shadow-2xs: 0 1px 2px 0 rgb(0 0 0 / 0.5);
shadow-xs:  0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5);
shadow-sm:  0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5);
shadow:     0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.5);
shadow-md:  0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5);
shadow-lg:  0 25px 50px -12px rgb(0 0 0 / 0.75);
```

### Light Mode

Same structure with opacity `0.08`–`0.15` instead of `0.5`.

### Brand Glow (green)

```css
/* Primary button glow */
box-shadow: 0 4px 12px rgba(0,230,118,.25);

/* Active chatbot glow */
box-shadow: 0 6px 28px rgba(0,230,118,.35), 0 10px 50px rgba(0,0,0,.25);
```

---

## 6. Card Styles

### Base Card (UI primitive)

```
rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-hidden
```

Structure:
```
CardHeader     → p-6 space-y-1.5
CardTitle      → text-xl font-semibold leading-none tracking-tight font-display
CardDescription→ text-sm text-muted-foreground
CardContent    → p-6 pt-0
CardFooter     → flex items-center p-6 pt-0
```

### Variants

| Variant | Class additions |
|---|---|
| Primary accent stripe | `border-l-4 border-l-primary` |
| Dense results card | Use `<div className="p-5">` instead of `<CardContent>` |
| Section-divided card | Internal `<div className="p-5 border-b border-border">` + `<div className="p-5">` |

---

## 7. Button Hierarchy

```tsx
// 1. Primary CTA (solid green)
<Button>
  → bg-primary text-primary-foreground hover:bg-[#00c853]
  → shadow-lg shadow-primary/20
  → h-11 px-6 rounded-lg font-semibold active:scale-[0.98]

// 2. Outlined (border only, no fill)
<Button variant="outline">
  → border-2 border-border bg-transparent
  → hover:border-primary hover:text-primary
  → h-11 px-6 rounded-lg

// 3. Secondary (dark surface)
<Button variant="secondary">
  → bg-secondary text-secondary-foreground hover:bg-secondary/80

// 4. Ghost (transparent, accent hover)
<Button variant="ghost">
  → hover:bg-accent/10 hover:text-accent

// 5. Link (text only)
<Button variant="link">
  → text-primary underline-offset-4 hover:underline

// 6. Destructive text action (custom)
<button className="text-xs text-muted-foreground hover:text-destructive transition-colors">
```

**Sizes:**
- `sm`: h-9 rounded-md px-4
- `default`: h-11 px-6 rounded-lg
- `lg`: h-14 px-8 rounded-lg text-lg
- `icon`: h-11 w-11

**All buttons share:**
```
inline-flex items-center justify-center whitespace-nowrap font-semibold transition-all duration-200
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]
```

---

## 8. Chips / Pills / Tags

### Scenario / Toggle Pill

```tsx
<button className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all capitalize ${
  active === value
    ? "bg-primary text-black"
    : "bg-white/5 text-muted-foreground hover:bg-white/10"
}`}>
```

### Badge Component

```tsx
<Badge variant="default">      // bg-primary text-dark, rounded-full px-2.5 py-0.5 text-xs font-semibold
<Badge variant="success">      // bg-green/20 text-green border-green/50
<Badge variant="warning">      // bg-yellow/20 text-yellow border-yellow/50
<Badge variant="destructive">  // bg-red/20 text-red border-red/50
<Badge variant="secondary">    // bg-secondary text-secondary-foreground
<Badge variant="outline">      // text-foreground border-border
```

### LIVE Badge (chatbot header)

```css
background: rgba(0,230,118,.15);
border: 1px solid rgba(0,230,118,.25);
border-radius: 20px;
padding: 1px 7px;
font-size: 10px;
color: #00e676;
font-weight: 600;
letter-spacing: 0.04em;
```

### Compliance / Security Tag (footer)

```css
background: rgba(255,255,255,0.04);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 6px;
padding: 4px 10px;
font-size: 11px;
color: #9ca3af;
/* hover: background rgba(255,255,255,0.08), color #e5e7eb, border rgba(0,230,118,0.2) */
```

---

## 9. Form Field Styling

### Input

```
h-12 w-full rounded-lg border border-border bg-input px-4 py-2 text-sm
placeholder:text-muted-foreground
focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary
disabled:cursor-not-allowed disabled:opacity-50
```

Error state additions: `border-red-500/60 bg-red-500/10`

### Label

```tsx
<Label>       // text-sm font-medium text-foreground
              // mb-1.5 (implied by spacing)
```

### Helper / error text

```tsx
// Error
<p className="text-xs text-destructive mt-1">…</p>

// Warning (amber)  
<p className="flex items-center gap-1.5 text-xs text-yellow-400 mt-1">
  <AlertCircle className="w-3.5 h-3.5 shrink-0" />…
</p>

// Neutral helper
<p className="text-[11px] text-muted-foreground mt-1">…</p>
```

### Select

Same size as Input (`h-12`). Uses `<Select>` UI primitive with matching border/bg tokens.

### Checkbox (custom)

```tsx
<div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
  checked ? "bg-primary border-primary"
  : error  ? "border-red-500 bg-red-500/10"
  :          "border-gray-600 bg-white/5"
}`}>
  {checked && <Check className="w-3 h-3 text-black" />}
</div>
```

### Textarea (chatbot)

```css
field-sizing: content;
max-height: 100px;
border-radius: 12px;
background: rgba(255,255,255,.05);
border: 1px solid rgba(255,255,255,.08);
```

---

## 10. Modal / Drawer / Panel Behavior

### Modal

```
Backdrop:  fixed inset-0 z-50 bg rgba(0,0,0,0.7) backdropFilter blur(4px)
           click-outside to close
Container: w-full max-w-md rounded-2xl shadow-2xl border overflow-hidden
           background: hsl(var(--background))  ← use variable, not hardcoded hex
           border-color: hsl(var(--card-border))
Header:    px-6 pt-6 pb-4 border-b
           Close button: p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white
Body:      px-6 py-5
```

**Note**: Current modal implementation uses `#0a0f0d`/`#1f2937` hardcoded — a known inconsistency. Future modals should use CSS variables.

### Sidebar / Panel

Right-side sticky panel. No fixed width breakpoint defined — uses grid allocation (`~340px`).

### Accordion / Expandable

```
Trigger:  w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium
          hover:bg-white/[0.03] transition-colors
          ChevronUp/Down icon on right
Content:  px-5 pb-5 border-t border-border
Animation: height 0→auto + opacity 0→1, 0.25s (Framer Motion)
```

---

## 11. Table / List Styling

### Metric Row (key/value pair in cards)

```tsx
<div className="flex items-start justify-between py-2.5 border-b border-white/5 last:border-0">
  <span className="text-sm text-muted-foreground">{label}</span>
  <span className={`text-sm font-semibold ${accent ? "text-primary text-base" : "text-foreground"}`}>
    {value}
  </span>
</div>
```

The separator `border-white/5` is extremely subtle (5% opacity) — use this instead of the full `border-border` for dense lists inside cards.

### Impact / Check List

```tsx
<div className="flex items-start gap-2 py-1.5">
  <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
  <span className="text-sm">{text}</span>
</div>
```

### Module Breakdown Table (full-width in card)

```
Header row: bg-white/5, px-5 py-3, text-xs font-semibold text-muted-foreground uppercase tracking-wide
Data rows:  px-5 py-3.5 border-b border-border/60
Last row:   border-0
Accent value: font-semibold text-primary
```

---

## 12. States

### Hover

- Buttons: `hover:bg-[#00c853]` (primary), `hover:border-primary hover:text-primary` (outline)
- Nav items: `hover:text-primary transition-colors`
- Text links: `hover:text-primary/80 transition-colors`
- Ghost actions: `hover:bg-white/[0.03]` to `hover:bg-white/10` (context-dependent)
- Cards/rows: no default hover bg on cards; use explicit `hover:bg-white/[0.03]` when clickable

### Selected / Active

- Toggle pills: `bg-primary text-black`
- Nav active underline: `border-b-2 border-primary`
- Checkbox: `bg-primary border-primary` + white check icon

### Disabled

```
disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed
```

### Error

- Input: `border-red-500/60 bg-red-500/10`
- Error text: `text-xs text-destructive`
- Checkbox: `border-red-500 bg-red-500/10`

### Warning (soft, dismissible)

```tsx
<div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
  <div className="text-sm text-amber-300">…</div>
  <button onClick={dismiss} className="ml-auto text-amber-400 hover:text-amber-200">
    <X className="w-3.5 h-3.5" />
  </button>
</div>
```

### Loading / Skeleton

```tsx
<div className="animate-pulse bg-white/5 rounded h-4 w-full" />
```

### Success

```tsx
<div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
  <Check className="w-6 h-6 text-primary" />
</div>
```

---

## 13. Layout Widths & Container Rules

```
Max content width: 1280px  (footer: max-w-[1280px] mx-auto)
Standard horizontal padding: px-6 (24px each side)
Navbar height: 56px (top tier) + 48px (bottom tier) = 104px total
Navbar: sticky top-0 z-50 w-full
```

**Grid patterns:**
```
2-column responsive:      grid-cols-1 lg:grid-cols-2 gap-6
Main + sidebar:           grid-cols-1 lg:grid-cols-[1fr_340px] gap-6
Form 2-up:                grid-cols-2 gap-4
Dense data 3-column:      grid-cols-3 gap-3
```

**Mobile overrides:** chatbot window goes full-screen `100vw × 100dvh` at `max-width: 639px`.

---

## 14. Known Inconsistencies

| # | Issue | Dominant Pattern to Use |
|---|---|---|
| 1 | **p-5 vs p-6 in cards** — results cards use `p-5` for density; canonical CardContent is `p-6 pt-0`. | Use `p-6` unless you need density, then use `p-5`. |
| 2 | **Modal uses hardcoded hex** (`#0a0f0d`, `#1f2937`) instead of CSS vars. Breaks light mode. | Always use `hsl(var(--background))` and `hsl(var(--card-border))` in new modals. |
| 3 | **Chatbot border-radius deviates** (18px launcher, 20px window vs theme's 12px base). | This is intentional. Do not normalize these. |
| 4 | **Footer inline styles** — Footer uses many inline `style={{}}` objects instead of Tailwind. | Use Tailwind classes in new components. Inline styles in Footer are a legacy artifact. |

---

## 15. How to Reuse This in a New App

### Step 1: Bootstrap the Tailwind config

Copy the CSS variables from `artifacts/druid-calculator/src/index.css` into your app's `index.css`:

```css
/* Paste the :root block and [data-theme="light"] block */
/* Paste the @theme inline block */
/* Keep the @layer base block */
/* Include the theme transition rules */
```

### Step 2: Add the fonts

In your HTML `<head>` or CSS:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
```

### Step 3: Copy the UI primitives

Copy from `artifacts/druid-calculator/src/components/ui/`:
- `button.tsx` — Button component with all variants
- `card.tsx` — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- `input.tsx` — Input with icon support
- `badge.tsx` — Badge with success/warning/destructive variants
- `label.tsx` — Label

### Step 4: Apply the theme toggle pattern

```typescript
// In your root layout or Navbar component
function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("druid-theme") as "dark" | "light") ?? "dark"
  })
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
    localStorage.setItem("druid-theme", theme)
  }, [theme])
  return { theme, toggle: () => setTheme(t => t === "dark" ? "light" : "dark") }
}
```

### Step 5: Use the logo correctly

```tsx
import logoWhite from "@assets/new_logo_white_1773760010871.png"
import logoBlack from "@assets/new-druid-logo-black_1773760032332.png"

// In JSX:
<div style={{ minWidth: 140, lineHeight: 0 }}>
  <img src={logoWhite} className="logo-white" alt="DRUID Logo" style={{ height: 30, width: "auto" }} />
  <img src={logoBlack} className="logo-black" alt="DRUID Logo" style={{ height: 30, width: "auto" }} />
</div>

// In CSS (copy from index.css):
.logo-white { display: inline; }
.logo-black { display: none; }
[data-theme="light"] .logo-white { display: none; }
[data-theme="light"] .logo-black { display: inline; }
[data-theme="dark"]  .logo-white { display: inline; }
[data-theme="dark"]  .logo-black { display: none; }
```

### Step 6: Build your layout

```tsx
// Standard app shell
<div data-theme="dark">           // ← set default theme on root
  <Navbar />                      // sticky, 104px total
  <main className="min-h-screen bg-background">
    <div className="max-w-[1280px] mx-auto px-6 py-8">
      {/* your content */}
    </div>
  </main>
  <footer data-theme="dark">     // ← footer always dark
    <Footer />
  </footer>
</div>
```

### Step 7: Checklist before shipping

- [ ] Dark mode works and is the default
- [ ] Light mode toggle works and persists to `localStorage`
- [ ] Logos swap correctly via `.logo-white` / `.logo-black`
- [ ] Footer has `data-theme="dark"` forced
- [ ] All modals use `hsl(var(--background))` not hardcoded hex
- [ ] Primary green (`#00e676`) is used only for CTAs and active states
- [ ] All buttons have `disabled:opacity-50 disabled:pointer-events-none`
- [ ] Inputs have error state styling (`border-red-500/60 bg-red-500/10`)
- [ ] Cards use `rounded-xl border border-border bg-card shadow-sm`
- [ ] `focus-visible:ring-primary` is on all interactive elements
