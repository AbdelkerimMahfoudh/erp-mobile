// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    /*
     * The React Compiler rules, demoted to warnings — deliberately, and
     * temporarily.
     *
     * SDK 56 promoted these from off to ERROR in `eslint-config-expo`. They
     * fire 32 times here, and every one of them is a pre-existing pattern that
     * was written, reviewed and verified on a physical device long before the
     * rule existed. Nothing regressed; the rule arrived.
     *
     * They are demoted rather than silenced because the advice is sound and the
     * warnings should stay visible. They are not FIXED here because this is an
     * infrastructure migration: rewriting eighteen `setState`-in-effect sites
     * across the scanner, the keyboard handling and the catalogue selectors —
     * the exact code whose behaviour was confirmed by hand on an iPhone — would
     * risk the thing the upgrade is supposed to preserve, to satisfy a linter.
     *
     * Doing it properly is its own task, with device retesting, and it is
     * recorded as follow-up work rather than smuggled into a dependency bump.
     */
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
