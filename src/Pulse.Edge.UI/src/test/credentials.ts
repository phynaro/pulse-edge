// Fake credentials used only by the UI test suite. These are NOT real secrets —
// they are arbitrary inputs that assert the login form and auth provider pass
// through whatever the user types. Values can be overridden from the
// environment (e.g. GitHub Actions job env) for teams that prefer to keep even
// placeholder values out of source; the fallbacks are obvious non-secrets so
// the suite runs with no setup and secret scanners have nothing to match.
// Read process.env via globalThis so this compiles under the app tsconfig,
// which intentionally excludes Node types. Under Vitest (Node) the overrides
// resolve; in the browser build there is no process and the fallbacks apply.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const testCredentials = {
  operatorUsername: env.PULSE_TEST_USERNAME ?? 'test-operator',
  operatorPassword: env.PULSE_TEST_PASSWORD ?? 'not-a-real-password',
  adminUsername: env.PULSE_TEST_ADMIN_USERNAME ?? 'test-admin',
  adminPassword: env.PULSE_TEST_ADMIN_PASSWORD ?? 'not-a-real-password',
};
