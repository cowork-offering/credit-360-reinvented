# Brand Notes — the memo's re-skin seam

This memo is **bank-neutral by design**. The default persona is **"Acme Bank"** — a placeholder
for demos — on the Accenture-accelerator palette. Everything client-facing is driven from one
place so a real engagement re-skins in minutes, with no code changes.

## Where the brand lives

| Surface | Source of truth | How to re-skin |
|---|---|---|
| Memo colors / type | `assets/brand-tokens.css` (`--brand-*` tokens) | Edit the `--brand-primary` / `--brand-accent` / `--brand-tint` tokens + the font stack |
| Memo cover + widget logo | `assets/brand-mark.svg` (square mark), `assets/brand-horizontal.svg` (wordmark lockup) | Replace the two SVGs with the client's artwork (keep `fill="currentColor"` so they adopt the palette) |
| Bank display name | the rendered narrative + the Experience MCP `BANK_DISPLAY_NAME` config | Set the bank name per engagement |
| Builder mark | `--brand-accent` (#A100FF) + the "Credit Memo Reinvented" lockup | Fixed — this is the Accenture accelerator mark, not client-swappable |

## Defaults

- **Palette:** deep purple `#2E0A4F` (headings, banner, table headers) + `#A100FF` accent.
  Supporting tokens (green/amber/red compliance flags) follow standard credit-document convention.
- **Type:** DM Sans with a system sans-serif fallback stack. Swap in a licensed brand typeface
  per client if available.
- **Logos:** `brand-mark.svg` / `brand-horizontal.svg` are neutral placeholder marks (rounded-square
  badge + ascending bars). Replace with the client's official artwork for a real engagement.

Token **names** are generic (`--brand-*`) — nothing here carries a client identity. Only the values
and the two SVG assets change per engagement.
