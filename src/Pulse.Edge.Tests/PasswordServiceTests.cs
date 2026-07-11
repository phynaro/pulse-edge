using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public class PasswordServiceTests
{
    [Fact]
    public void Hash_RoundTrips_WithoutStoringPlaintext()
    {
        var service = new PasswordService();
        const string password = "Machine!Safe42";
        var hash = service.Hash(password);

        Assert.DoesNotContain(password, hash);
        Assert.True(service.Verify(password, hash));
        Assert.False(service.Verify("wrong-password", hash));
    }

    [Theory]
    [InlineData("short1!A")]
    [InlineData("alllowercase1!")]
    [InlineData("ALLUPPERCASE1!")]
    [InlineData("NoNumbersHere!")]
    [InlineData("NoSpecial123A")]
    public void Validate_RejectsWeakPasswords(string password)
    {
        Assert.NotNull(PasswordService.Validate(password));
    }

    [Fact]
    public void Validate_AcceptsStrongPassword()
    {
        Assert.Null(PasswordService.Validate("Machine!Safe42"));
    }
}
