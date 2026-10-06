// The app's configuration is `app.json`; this file only adds the build identifier.
//
// `extra.build` names the exact source Metro bundled: the commit, its branch, whether the
// working tree carried uncommitted changes, and when the configuration was read. It is
// evaluated by `expo start`, `expo export` and the native build (prebuild / EAS), so the
// value a phone shows is the value of the checkout that served it — not the one that was
// pushed. A JavaScript bundle served by a Metro that was not restarted after a pull keeps
// the stamp of the start, which is precisely what the diagnostic is there to expose.
//
// Development surface only: the Devices screen shows it under "This device" when the app
// runs in development (`__DEV__`), never in a release build.
const { execSync } = require('node:child_process');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
  } catch {
    return null;
  }
}

const commit = git('rev-parse --short=7 HEAD');
const build = {
  commit: commit ?? 'unknown',
  branch: git('rev-parse --abbrev-ref HEAD') ?? 'unknown',
  // True when any tracked file differed from the commit when Metro started.
  dirty: commit ? git('status --porcelain --untracked-files=no') !== '' : false,
  readAt: new Date().toISOString(),
};

module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, build },
});
