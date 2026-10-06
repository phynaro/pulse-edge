using System.Text.RegularExpressions;
using Pulse.Edge.Api.Security;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class RecoveryCodeServiceTests
{
    private readonly RecoveryCodeService _codes = new(new PasswordService());

    [Fact]
    public void Generate_produces_five_dash_separated_groups_of_crockford_base32()
    {
        var code = _codes.Generate();
        Assert.Matches(new Regex("^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$"), code);
        Assert.NotEqual(code, _codes.Generate());
    }

    [Fact]
    public void Normalize_strips_separators_uppercases_and_maps_look_alikes()
    {
        Assert.Equal("ABCD011", RecoveryCodeService.Normalize("ab-cd o il"));
        Assert.Equal("", RecoveryCodeService.Normalize(null));
    }

    [Fact]
    public void Verify_accepts_the_issued_code_in_any_casing_or_grouping()
    {
        var code = _codes.Generate();
        var hash = _codes.Hash(code);
        Assert.True(_codes.Verify(code, hash));
        Assert.True(_codes.Verify(code.Replace("-", "").ToLowerInvariant(), hash));
        Assert.True(_codes.Verify(" " + code.Replace("-", " ") + " ", hash));
    }

    [Fact]
    public void Verify_rejects_wrong_code_and_missing_hash()
    {
        var hash = _codes.Hash(_codes.Generate());
        Assert.False(_codes.Verify(_codes.Generate(), hash));
        Assert.False(_codes.Verify(_codes.Generate(), ""));
        Assert.False(_codes.Verify(null, hash));
    }
}
