/** The current Pool PM version. Written by `npm run version:bump`; a test keeps it equal to package.json. */
export const APP_VERSION = "0.1.1";

/**
 * Pool PM version numbers are three single digits, MAJOR.MINOR.PATCH, and
 * every release bumps the last one. A digit that would reach 10 rolls over
 * into the one before it, like an odometer:
 *
 *   0.0.3 → 0.0.4    0.0.9 → 0.1.0    0.9.9 → 1.0.0    1.9.9 → 2.0.0
 */
export function nextVersion(version: string): string {
  const m = /^(\d+)\.(\d)\.(\d)$/.exec(version.trim());
  if (!m) throw new Error(`Version "${version}" is not in MAJOR.MINOR.PATCH form with single-digit minor and patch`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}
