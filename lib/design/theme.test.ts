/**
 * The theme contract, pinned.
 *
 *   node lib/design/theme.test.ts
 *
 * Dark mode is the kind of feature that rots quietly: one screen keeps a
 * module-scope `StyleSheet.create` full of colours, nobody notices until
 * somebody opens that screen at night, and by then the pattern has spread.
 * Most of what follows is therefore a **source audit** — the palettes are
 * checked for meaning and contrast, and the codebase is checked for the shapes
 * that cannot follow a theme.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { darkColors, lightColors, moneyColors, PALETTES } from './colors.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name).split('\\').join('/');
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const APP_SOURCES = [...sourceFiles('app'), ...sourceFiles('components')];

// ── Contrast ────────────────────────────────────────────────────────────────

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? [...m].map((c) => c + c).join('') : m;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

it('body text is readable on its own surface, in both themes', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const surface of [p.surface.canvas, p.surface.card, p.surface.sunken]) {
      assert.ok(
        contrast(p.text.primary, surface) >= 7,
        `${name}: primary text on ${surface} is ${contrast(p.text.primary, surface).toFixed(2)}:1`,
      );
      // 4.5 is the ordinary body-text bar. Secondary text carries real
      // content — subtitles, timestamps on a receipt — so it has to clear it.
      assert.ok(
        contrast(p.text.secondary, surface) >= 4.5,
        `${name}: secondary text on ${surface} is ${contrast(p.text.secondary, surface).toFixed(2)}:1`,
      );
    }
  }
});

it('tertiary text clears the large-text bar on EVERY surface', () => {
  /*
    Labels and metadata. Never used for anything actionable, so 3:1 is the
    honest bar — but it must not be invisible either.

    Checked against the canvas as well as the card, deliberately. An earlier
    version only checked the card, passed, and shipped hint text at 2.9:1 on
    the canvas — where most of it actually sits.
  */
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const surface of [p.surface.canvas, p.surface.card, p.surface.sunken]) {
      assert.ok(
        contrast(p.text.tertiary, surface) >= 3,
        `${name}: tertiary on ${surface} is ${contrast(p.text.tertiary, surface).toFixed(2)}:1`,
      );
    }
  }
});

it('every intent reads against its own tint, in both themes', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const [intent, c] of Object.entries(p.intent)) {
      assert.ok(
        contrast(c.fg, c.bg) >= 4.5,
        `${name}/${intent}: fg on bg is ${contrast(c.fg, c.bg).toFixed(2)}:1`,
      );
      assert.ok(
        contrast(c.onSolid, c.solid) >= 4.5,
        `${name}/${intent}: onSolid on solid is ${contrast(c.onSolid, c.solid).toFixed(2)}:1`,
      );
    }
  }
});

it('the accent is legible on the canvas in both themes', () => {
  // Links and active states. brand[600] is muddy on near-black, which is why
  // the dark palette lifts it rather than reusing the light value.
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.ok(
      contrast(p.text.accent, p.surface.canvas) >= 4.5,
      `${name}: accent is ${contrast(p.text.accent, p.surface.canvas).toFixed(2)}:1`,
    );
  }
});

it('placeholder text is quiet but not invisible', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    const c = contrast(p.text.placeholder, p.surface.sunken);
    assert.ok(c >= 2.5, `${name}: placeholder is ${c.toFixed(2)}:1 — too faint`);
    assert.ok(c < 7, `${name}: placeholder is ${c.toFixed(2)}:1 — indistinguishable from real text`);
  }
});

// ── Meaning is preserved, not inverted ──────────────────────────────────────

it('dark mode is not an inversion — every role still exists', () => {
  const shape = (o: object, path = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? shape(v, `${path}${k}.`) : [`${path}${k}`],
    );
  assert.deepEqual(
    shape(darkColors).sort(),
    shape(lightColors).sort(),
    'the two palettes must offer exactly the same vocabulary',
  );
});

it('success stays green and danger stays red after dark', () => {
  /*
    The one thing an inversion would destroy. A shopkeeper who learned that
    green means paid must not have to relearn it at night.
  */
  const hue = (hex: string) => {
    const m = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
    return { r, g, b };
  };
  for (const p of [lightColors, darkColors]) {
    const ok = hue(p.intent.success.fg);
    assert.ok(ok.g > ok.r, 'success must read green');
    const bad = hue(p.intent.danger.fg);
    assert.ok(bad.r > bad.g, 'danger must read red');
    const warn = hue(p.intent.warning.fg);
    assert.ok(warn.r > warn.b && warn.g > warn.b, 'warning must read amber');
  }
});

it('money follows the palette rather than being captured once', () => {
  assert.notEqual(moneyColors(lightColors).positive, moneyColors(darkColors).positive);
  assert.equal(moneyColors(darkColors).positive, darkColors.intent.success.fg);
  assert.equal(moneyColors(darkColors).neutral, darkColors.text.primary);
});

it('dark surfaces get lighter as they get closer', () => {
  // Elevation in the dark is lightness, not shadow — a shadow on near-black is
  // invisible. Canvas must be darkest, then card.
  assert.ok(luminance(darkColors.surface.card) > luminance(darkColors.surface.canvas));
  assert.ok(luminance(lightColors.surface.card) > luminance(lightColors.surface.canvas));
});

it('dark text is not pure white', () => {
  // #FFF on near-black glares and smears on OLED.
  assert.notEqual(darkColors.text.primary.toUpperCase(), '#FFFFFF');
});

// ── The codebase cannot drift back ──────────────────────────────────────────

it('no screen builds colours in a module-scope StyleSheet', () => {
  /*
    THE regression this whole layer exists to prevent. A module-scope
    `StyleSheet.create` reads the palette once, at import, and keeps it — so
    the screen silently stays light forever, with no error to notice.
  */
  const offenders: string[] = [];
  for (const file of APP_SOURCES) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    const m = code.match(/StyleSheet\.create\(\{[\s\S]*?\n\}\)/);
    if (m && /\bcolors\./.test(m[0])) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'these must use makeStyles: ' + offenders.join(', '));
});

it('no screen imports the frozen palette for its values', () => {
  // Type-only imports are fine — a type carries no colour.
  const offenders: string[] = [];
  for (const file of APP_SOURCES) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*design\/colors'/g)) {
      const names = m[1].split(',').map((s) => s.trim());
      if (names.some((n) => n === 'colors' || n === 'money')) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], 'these capture a static palette: ' + offenders.join(', '));
});

it('no colour utility class survives, even inside a conditional', () => {
  /*
    `className="text-slate-900"` was caught by an earlier sweep. This catches
    the shape that sweep missed — a class chosen at runtime:

        className={selected ? 'bg-brand-100' : 'bg-white'}

    Tailwind colour utilities are fixed light values. They ignore the theme
    entirely, so on a dark canvas they glow.
  */
  const COLOUR_CLASS =
    /\b(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand|white|black)(-\d{2,3})?\b/;
  const offenders: string[] = [];
  for (const file of APP_SOURCES) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    // Any string literal that sits in a className position, quoted or braced.
    for (const m of code.matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)) {
      const chunk = m[0];
      const hit = chunk.match(COLOUR_CLASS);
      if (hit) offenders.push(`${file}: ${hit[0]}`);
    }
  }
  assert.deepEqual(offenders, [], 'colour utility classes: ' + offenders.join(' | '));
});

it('no raw colour is written outside the token layer', () => {
  const offenders: string[] = [];
  for (const file of APP_SOURCES) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      offenders.push(`${file}: ${m[0]}`);
    }
    // `rgba(...)` is the same problem wearing a different hat.
    for (const m of code.matchAll(/rgba?\(\s*\d+\s*,/g)) {
      offenders.push(`${file}: ${m[0]}…`);
    }
  }
  assert.deepEqual(offenders, [], 'raw colours: ' + offenders.join(' | '));
});

it('no screen branches on the theme itself', () => {
  /*
    `isDark ? x : y` scattered through screens is how a semantic layer dies:
    the decision moves out of the palette and into 40 different files, and the
    next colour added is inconsistent by default.

    The root layout is exempt for the status bar, which is genuinely a
    per-theme system setting rather than a colour.
  */
  const offenders: string[] = [];
  for (const file of APP_SOURCES) {
    if (file === 'app/_layout.tsx') continue;
    const code = withoutComments(readFileSync(file, 'utf8'));
    if (/\bisDark\s*\?/.test(code)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'these branch on the theme: ' + offenders.join(', '));
});

it('no raw ramp step is used as a surface', () => {
  /*
    `colors.brand[50]` is the SAME pale tint in both palettes — the ramps are
    fixed, and only the semantic roles above them flip. Used as a background it
    therefore stays light after dark, which is how a selected row ended up
    glowing white on a near-black screen. `intent.info.bg` is the theme-aware
    way to say the same thing.
  */
  const offenders: string[] = [];
  // `background:` and `pressedBackground:` too — the variant tables in Button
  // and IconButton name their fills that way, and the first version of this
  // rule only looked for `backgroundColor:`, so it missed them.
  const RAMP_SURFACE =
    /(backgroundColor|borderColor|pressedBackground|background)\s*:\s*[^,;\n]*colors\.(brand|neutral)\[/g;
  for (const file of APP_SOURCES) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(RAMP_SURFACE)) {
      offenders.push(`${file}: ${m[0]}…`);
    }
  }
  assert.deepEqual(offenders, [], 'ramp steps used as surfaces: ' + offenders.join(' | '));
});

// ── The preference itself ───────────────────────────────────────────────────

it('light is the default, and it is stored on the device', () => {
  const code = readFileSync('lib/design/theme.tsx', 'utf8');
  assert.match(code, /useState<ThemeName>\('light'\)/, 'existing users must not change appearance');
  assert.match(code, /const STORAGE_KEY = 'erp\.theme'/);
  // Uses the storage the app already has; no dependency was added for this.
  assert.match(code, /from '\.\.\/storage'/);
});

it('the app waits for the stored theme before painting', () => {
  // Otherwise a dark user sees a light frame first — the flash.
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  assert.match(layout, /preventAutoHideAsync/);
  assert.match(layout, /ready && themeReady/);
  assert.match(layout, /hideAsync/);
});

it('the status bar follows the theme', () => {
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  assert.match(layout, /StatusBar style=\{isDark \? 'light' : 'dark'\}/);
});

it('signing out leaves the theme alone', () => {
  /*
    A shared counter phone: the person who set the screen readable for that
    shop's lighting did not set it for themselves. The theme is also not
    sensitive — it reveals nothing about the account — so clearing it on sign
    out would cost something and protect nothing.
  */
  const auth = withoutComments(readFileSync('hooks/useAuth.tsx', 'utf8'));
  assert.ok(!/erp\.theme/.test(auth), 'sign-out must not touch the theme preference');
});

// ── Appearance & language ───────────────────────────────────────────────────

it('the language selector lives in Appearance & language, and only there', () => {
  const users = APP_SOURCES.filter((f) => {
    if (f.endsWith('components/navigation/LanguageRow.tsx')) return false;
    return /<LanguageRow\b/.test(withoutComments(readFileSync(f, 'utf8')));
  });
  assert.deepEqual(users, ['app/appearance.tsx'], 'exactly one screen may render it');
});

it('the screen carries the dark switch and the language row together', () => {
  const code = withoutComments(readFileSync('app/appearance.tsx', 'utf8'));
  assert.match(code, /<Toggle/);
  assert.match(code, /appearance\.darkMode/);
  assert.match(code, /<LanguageRow \/>/);
});

it('there is no two-step-verification switch anywhere', () => {
  /*
    Deliberate. Nothing delivers a code, nothing expires one, nothing handles
    recovery — a switch that saved a preference and protected nothing would be
    worse than the honest absence, because somebody would trust it.
  */
  const offenders = APP_SOURCES.filter((f) =>
    /two.?factor|twoFactor|\b2FA\b|twoStep|two.?step/i.test(withoutComments(readFileSync(f, 'utf8'))),
  );
  assert.deepEqual(offenders, [], 'no 2FA UI may ship until it is real: ' + offenders.join(', '));
});

it('theme and language are independent settings', () => {
  // Changing one must not reset the other, so they must not share a key.
  const theme = readFileSync('lib/design/theme.tsx', 'utf8');
  const i18n = readFileSync('lib/i18n/index.ts', 'utf8');
  const themeKey = theme.match(/const STORAGE_KEY = '([^']+)'/)?.[1];
  const langKey = i18n.match(/LANGUAGE_STORAGE_KEY = '([^']+)'/)?.[1];
  assert.ok(themeKey && langKey);
  assert.notEqual(themeKey, langKey);
});

// ── the refresh vocabulary ────────────────────────────────────────────────
//
// These names are aliases onto the palette above, which is exactly why they
// need pinning: an alias can quietly drift into being a second opinion.

const SEMANTIC_KEYS = [
  'primary', 'primaryPressed', 'primarySoft', 'onPrimary',
  'background', 'surface', 'surfaceRaised',
  'border', 'divider',
  'text', 'textMuted',
  'success', 'warning', 'danger', 'info', 'disabled',
] as const;

it('both themes define every semantic token', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const key of SEMANTIC_KEYS) {
      const value = (p.semantic as Record<string, string>)[key];
      assert.ok(value, `${name} is missing semantic.${key}`);
      assert.match(value, /^#|^rgba?\(/, `${name}.semantic.${key} is not a colour`);
    }
  }
});

it('the approved indigo is what light mode actually uses', () => {
  assert.equal(lightColors.semantic.primary, '#5146D9');
  assert.equal(lightColors.semantic.primarySoft, '#EEECFC');
  assert.equal(lightColors.semantic.background, '#F7F8FB');
  assert.equal(lightColors.semantic.text, '#172033');
  assert.equal(lightColors.semantic.surface, '#FFFFFF');
});

it('dark mode is not the light palette on a dark background', () => {
  // The specific failure this catches: copying `primarySoft` across, which
  // would paint a near-white wash behind a selected row at night.
  for (const key of SEMANTIC_KEYS) {
    if (key === 'onPrimary') continue; // white on a solid fill in both themes
    assert.notEqual(
      darkColors.semantic[key],
      lightColors.semantic[key],
      `dark reuses the light value for ${key}`,
    );
  }
});

it('a primary action is readable in both themes', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.ok(
      contrast(p.semantic.primary, p.semantic.surface) >= 4.5,
      `${name}: primary on surface is ${contrast(p.semantic.primary, p.semantic.surface).toFixed(2)}:1`,
    );
    assert.ok(
      contrast(p.semantic.primary, p.semantic.background) >= 4.5,
      `${name}: primary on background is ${contrast(p.semantic.primary, p.semantic.background).toFixed(2)}:1`,
    );
  }
});

it('a selected row reads as selected, in both themes', () => {
  // The checkmark and label sit on the pale wash. If this fails, "selected"
  // becomes a colour you have to look for rather than one you see.
  for (const [name, p] of Object.entries(PALETTES)) {
    const c = contrast(p.semantic.primary, p.semantic.primarySoft);
    assert.ok(c >= 4.5, `${name}: primary on primarySoft is ${c.toFixed(2)}:1`);
  }
});

it('pressed is darker than resting, in both themes', () => {
  // Never lighter. A button that brightens under the thumb reads as releasing.
  for (const [name, p] of Object.entries(PALETTES)) {
    const rest = luminance(p.intent.info.solid);
    const pressed = luminance(p.intent.info.solidPressed);
    assert.ok(pressed < rest, `${name}: pressed fill is not darker than resting`);
  }
});

it('body text and muted text stay readable on every semantic surface', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    for (const surface of [p.semantic.background, p.semantic.surface, p.semantic.surfaceRaised]) {
      assert.ok(contrast(p.semantic.text, surface) >= 7, `${name}: text on ${surface}`);
      assert.ok(contrast(p.semantic.textMuted, surface) >= 4.5, `${name}: textMuted on ${surface}`);
    }
  }
});

it('status colours keep their meaning across themes', () => {
  // Success must never become the accent, and danger must never become warning.
  for (const [name, p] of Object.entries(PALETTES)) {
    const { success, warning, danger, primary } = p.semantic;
    assert.notEqual(success, primary, `${name}: success collided with primary`);
    assert.notEqual(warning, danger, `${name}: warning collided with danger`);
    assert.notEqual(success, warning, `${name}: success collided with warning`);
  }
});

it('a divider is quieter than a border', () => {
  // Rows separated by full-strength borders read as a spreadsheet grid, which
  // is the look the flatter list direction exists to get away from.
  for (const [name, p] of Object.entries(PALETTES)) {
    const onSurface = (c: string) => Math.abs(luminance(c) - luminance(p.semantic.surface));
    assert.ok(
      onSurface(p.semantic.divider) < onSurface(p.semantic.border),
      `${name}: divider is not quieter than border`,
    );
  }
});


console.log(`theme, contrast and preferences: ${passed} passed`);
