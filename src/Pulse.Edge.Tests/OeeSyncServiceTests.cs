using System.Collections.Generic;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Cloud.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public class OeeSyncServiceTests
{
    [Fact]
    public void Classify_AllAccepted_IncludingDuplicates()
    {
        var outcome = OeeSyncService.ClassifyResponse(3, new CloudClient.OeeEventsResponse
        {
            Accepted = 3, Rejected = 0, Duplicates = 2,
        });
        Assert.Equal(new List<int> { 0, 1, 2 }, outcome.AcceptedIndexes);
        Assert.Empty(outcome.InvalidIndexes);
        Assert.Empty(outcome.UnknownChannelIndexes);
    }

    [Fact]
    public void Classify_SplitsInvalidAndUnknownChannel()
    {
        var outcome = OeeSyncService.ClassifyResponse(4, new CloudClient.OeeEventsResponse
        {
            Accepted = 2, Rejected = 2,
            Errors = new List<CloudClient.OeeEventsResponseError>
            {
                new() { Index = 1, Reason = "invalid message" },
                new() { Index = 3, Reason = "unknown channel 'ghost.channel'" },
            },
        });
        Assert.Equal(new List<int> { 0, 2 }, outcome.AcceptedIndexes);
        Assert.Equal(new List<int> { 1 }, outcome.InvalidIndexes);   // terminal: drop + diagnostic
        Assert.Equal(new List<int> { 3 }, outcome.UnknownChannelIndexes); // release + re-declare
    }

    [Fact]
    public void Classify_NullResponse_TreatsNothingAsAccepted()
    {
        var outcome = OeeSyncService.ClassifyResponse(2, null);
        Assert.Empty(outcome.AcceptedIndexes);
        Assert.Empty(outcome.InvalidIndexes);
        Assert.Empty(outcome.UnknownChannelIndexes);
    }
}
