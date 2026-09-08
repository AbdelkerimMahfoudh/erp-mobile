# Parked during the SDK 54 → 57 migration

`expo-camera+17.0.10.patch` cannot apply past SDK 55, because SDK 55 synchronised
Expo package majors and `expo-camera` jumped **17.x → 55.x**. `patch-package`
keys on the exact version in the filename, so the patch is inert from the first
checkpoint onward.

It is parked here rather than deleted so the original stays reviewable while it
is rebased onto the SDK 57 source.

**Two things must be restored before this migration is finished:**

1. the patch, rebased onto the `expo-camera` version SDK 57 pins;
2. `package.json` → `"postinstall": "patch-package && node scripts/verify-native-patch.js"`,
   with `PATCHED_VERSION` in that script bumped to match.

Until both are done, an Android build scans but the visible frame is **not** the
detection boundary — and `ScannerSheet` will correctly decline to enforce a
strict region, because the `coordinateSpace` marker the patch emits is absent.
