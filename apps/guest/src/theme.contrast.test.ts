// WCAG AA contrast, enforced against the real stylesheet.
//
// Mirrors apps/admin/src/theme.contrast.test.ts — the guest app declares the
// same neutral-token contract, so it needs the same guard.
//
// The tokens are read out of index.css rather than duplicated here, so this
// fails if someone lightens a colour for looks and drops it below the legible
// threshold. `--c-faint` was originally 2.5:1 on a white card — technically
// invisible to a chunk of users, and it carried the 11px labels and timestamps
// where contrast matters most.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type RGB = [number, number, number];

function relativeLuminance([r, g, b]: RGB): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

/**
 * Pulls the token block for one theme. `:root` holds light, `.dark` holds dark;
 * both are inside `@layer base`, so the search is scoped to the first block
 * following the selector.
 */
function tokens(selector: ':root' | '.dark'): Record<string, RGB> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block not found in index.css`).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf('}', start));

  const out: Record<string, RGB> = {};
  for (const m of block.matchAll(/--c-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const BACKGROUNDS = ['canvas', 'surface', 'elevated'] as const;
const FOREGROUNDS = ['ink', 'muted', 'faint'] as const;

// 4.5:1 is the AA threshold for normal-size text. Every one of these tokens is
// used for body or label text somewhere, so none of them get the 3:1 large-text
// allowance.
const AA_NORMAL_TEXT = 4.5;

describe.each([
  ['light', ':root' as const],
  ['dark', '.dark' as const]
])('%s theme contrast', (_name, selector) => {
  const t = tokens(selector);

  it('defines every neutral token', () => {
    for (const key of [...BACKGROUNDS, ...FOREGROUNDS]) {
      expect(t[key], `--c-${key} missing`).toBeDefined();
    }
  });

  it.each(
    FOREGROUNDS.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const))
  )('%s on %s meets WCAG AA for normal text', (fg, bg) => {
    const ratio = contrast(t[fg], t[bg]);
    expect(
      ratio,
      `--c-${fg} on --c-${bg} is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 AA threshold`
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('keeps the ink > muted > faint hierarchy distinct', () => {
    // Passing contrast is not enough on its own: if the three tokens converge
    // the visual hierarchy they exist to express disappears.
    const against = t.surface;
    const ink = contrast(t.ink, against);
    const muted = contrast(t.muted, against);
    const faint = contrast(t.faint, against);
    expect(ink).toBeGreaterThan(muted);
    expect(muted).toBeGreaterThan(faint);
  });
});
