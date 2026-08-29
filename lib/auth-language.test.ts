/**
 * Language, before you can sign in.
 *
 *   node lib/auth-language.test.ts
 *
 * The settings screen has had a language row for a long time, and it is behind
 * the sign-in screen. Somebody handed a phone showing a language they cannot
 * read could not sign in to change the language, and could not change the
 * language without signing in. These pin the way out of that.
 *
 * Source-level, like the other drift tests here: what matters is that the
 * control is ON the screens somebody meets first, reads the same store the
 * settings row does, and cannot regress into flags or a second catalogue.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

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

const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SWITCH = 'components/ui/AuthLanguageSwitch.tsx';
const LOGIN = 'app/(auth)/login.tsx';
const REGISTER = 'app/(auth)/register.tsx';
const VERIFY = 'app/(auth)/verify.tsx';

const keysOf = (file: string): string[] =>
  [...source(file).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);

// ── Where it is ───────────────────────────────────────────────────────────

it('the login screen carries a language switcher', () => {
  const code = withoutComments(source(LOGIN));
  assert.match(code, /<AuthLanguageSwitch/);
  assert.match(code, /import \{[^}]*AuthLanguageSwitch[^}]*\} from '\.\.\/\.\.\/components\/ui'/);
});

it('the account-creation screen carries one too', () => {
  const code = withoutComments(source(REGISTER));
  assert.match(code, /<AuthLanguageSwitch/);
});

it('the verification screen inherits the choice, and can still correct it', () => {
  /*
    Inheritance is not a prop here: `useI18n` is a module-level store, so the
    verify screen renders in whatever language was chosen a screen earlier
    without being told. The control is present in its compact form only so an
    accidental selection is not a trap.
  */
  const code = withoutComments(source(VERIFY));
  assert.match(code, /<AuthLanguageSwitch compact/);
  assert.ok(!/language=\{/.test(code), 'language must not be threaded as a prop');
});

// ── What it is ────────────────────────────────────────────────────────────

it('uses the existing i18n system, and no second source of translations', () => {
  const code = withoutComments(source(SWITCH));
  assert.match(code, /from '\.\.\/\.\.\/lib\/i18n'/);
  assert.match(code, /LANGUAGE_LABELS/);
  assert.match(code, /useI18n/);
  // No inline catalogue, no hardcoded translated copy.
  assert.ok(!/'English'|'Français'|'العربية'/.test(code), 'labels come from the catalogue');
});

it('offers exactly English, Arabic and French', () => {
  const i18n = source('lib/i18n/index.ts');
  assert.match(i18n, /export const LANGUAGES: readonly Language\[\] = \['en', 'fr', 'ar'\]/);
  assert.match(i18n, /en: 'English'/);
  assert.match(i18n, /ar: 'العربية'/);
  assert.match(i18n, /fr: 'Français'/);
});

it('shows no flags', () => {
  /*
    A flag is a country, not a language. Arabic is not one country's, and a
    French flag on a screen in Nouakchott says something nobody meant to say.
  */
  const flags = /[\u{1F1E6}-\u{1F1FF}]{2}|🏳|🇫🇷|🇬🇧|🇸🇦/u;
  for (const f of [SWITCH, LOGIN, REGISTER, VERIFY, 'lib/i18n/index.ts']) {
    assert.ok(!flags.test(source(f)), `${f} must not use a flag for a language`);
  }
});

it('uses design tokens, never a raw colour', () => {
  const code = withoutComments(source(SWITCH));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(code), 'no hex colours');
  assert.ok(!/rgba?\(/.test(code), 'no raw rgb colours');
});

it('is a real control for a screen reader, not a row of taps', () => {
  // `SegmentedControl` is the shared primitive: it declares `tablist`, sizes to
  // the minimum touch target, and marks selection with more than colour.
  const code = withoutComments(source(SWITCH));
  assert.match(code, /SegmentedControl/);
  const primitive = withoutComments(source('components/ui/SegmentedControl.tsx'));
  assert.match(primitive, /accessibilityRole="tablist"/);
  assert.match(primitive, /touch\.min/);
});

// ── What it must not disturb ──────────────────────────────────────────────

it('writes the preference to ordinary storage, never the secure store', () => {
  const i18n = source('lib/i18n/index.ts');
  assert.match(i18n, /LANGUAGE_STORAGE_KEY = 'erp\.language'/);
  assert.match(i18n, /from '\.\.\/storage'/);
  // The same key the settings row writes — one preference, not two.
  assert.match(source('components/navigation/LanguageRow.tsx'), /useI18n/);
});

it('changing language cannot submit the form', () => {
  /*
    The one failure that would matter on these screens: a language tap that
    also counts as a sign-in or a registration. The control calls `setLanguage`
    and nothing else, and it is rendered outside every submit handler.
  */
  const code = withoutComments(source(SWITCH));
  assert.match(code, /setSwitched\(true\);/);
  assert.match(code, /void setLanguage\(lang\);/);
  assert.ok(!/submit|onPress=\{.*submit/i.test(code), 'the switcher submits nothing');
  assert.ok(!/idempotencyKey/.test(code), 'the switcher touches no registration attempt');
});

it('changes the words without remounting the screen that holds the fields', () => {
  /*
    `setLanguage` sets state in a store and writes a preference. It does not
    navigate, does not reset a form and does not clear a session — which is why
    a language change cannot cost somebody the longest form in the product.
  */
  const i18n = withoutComments(source('lib/i18n/index.ts'));
  const setLang = i18n.slice(i18n.indexOf('setLanguage: async'));
  assert.ok(!/router|replace\(|navigate/.test(setLang.slice(0, 600)), 'no navigation');
  assert.ok(!/signOut|clearTokens|deleteItem/.test(setLang.slice(0, 600)), 'no session change');
});

it('Arabic turns the layout right-to-left, and English and French turn it back', () => {
  const i18n = withoutComments(source('lib/i18n/index.ts'));
  assert.match(i18n, /RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>\(\['ar'\]\)/);
  // Direction follows the language both ways, rather than being latched on.
  assert.match(i18n, /const wantsRtl = isRtlLanguage\(lang\)/);
  assert.match(i18n, /I18nManager\.forceRTL\(wantsRtl\)/);
  // And the screen says so, because React Native applies it at startup.
  assert.match(withoutComments(source(SWITCH)), /restartRequired/);
});

it('the preference survives navigation and a restart', () => {
  const i18n = withoutComments(source('lib/i18n/index.ts'));
  // Written on change…
  assert.match(i18n, /await setItem\(LANGUAGE_STORAGE_KEY, lang\)/);
  // …and read back on the next launch, before the device default is consulted.
  assert.match(i18n, /const stored = await getItem\(LANGUAGE_STORAGE_KEY\)/);
  assert.match(i18n, /isSupported\(stored\) \? stored : deviceLanguage\(\)/);
});

it('EN, AR and FR carry exactly the same keys', () => {
  const en = keysOf('lib/i18n/en.ts');
  const ar = keysOf('lib/i18n/ar.ts');
  const fr = keysOf('lib/i18n/fr.ts');
  assert.equal(ar.length, en.length);
  assert.equal(fr.length, en.length);
  assert.deepEqual(ar, en);
  assert.deepEqual(fr, en);
  // The keys this control reads exist in all three.
  for (const key of ['settings.language', 'settings.language.restartTitle', 'settings.language.restartBody']) {
    assert.ok(en.includes(key), `en is missing ${key}`);
  }
});

it('the switcher exists as a component, so it cannot drift per screen', () => {
  assert.ok(existsSync(SWITCH));
  assert.match(source('components/ui/index.ts'), /AuthLanguageSwitch/);
});

console.log(`authentication language switcher: ${passed} passed`);
