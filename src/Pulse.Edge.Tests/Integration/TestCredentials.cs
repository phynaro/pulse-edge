namespace Pulse.Edge.Tests.Integration;

/// <summary>
/// Test-only credentials and fixtures for the integration suite, sourced from environment
/// variables with deliberately non-secret fallbacks so secret scanners (e.g. GitGuardian) do
/// not flag literal passwords in the test code. Mirrors the frontend convention in
/// <c>src/Pulse.Edge.UI/src/test/credentials.ts</c>.
///
/// Seeded users authenticate through the real login pipeline; <c>PasswordService</c> complexity
/// validation is only applied when a user is created via the API, not on a direct DB seed, so
/// the fallback password need not satisfy the production password policy.
/// </summary>
internal static class TestCredentials
{
    public static string Password =>
        Environment.GetEnvironmentVariable("PULSE_TEST_PASSWORD") ?? "not-a-real-password";

    public const string AdminUsername = "test-admin";
    public const string ReadOnlyUsername = "test-readonly";

    /// <summary>A username that is never seeded — used to exercise the unknown-user login path.</summary>
    public const string NonexistentUsername = "no-such-user";

    /// <summary>A non-secret placeholder value for a device pairing token in fixtures.</summary>
    public const string SamplePairingToken = "sample-pairing-token-1234";
}
