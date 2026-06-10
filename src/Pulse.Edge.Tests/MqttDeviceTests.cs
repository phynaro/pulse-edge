using System;
using System.Reflection;
using System.Text.Json;
using Xunit;
using Pulse.Edge.Agent;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Tests;

public class MqttDeviceTests
{
    [Fact]
    public void TestMqttTopicMatches_ExactMatch()
    {
        Assert.True(Worker.MqttTopicMatches("tele/device1/SENSOR", "tele/device1/SENSOR"));
        Assert.False(Worker.MqttTopicMatches("tele/device1/SENSOR", "tele/device2/SENSOR"));
    }

    [Fact]
    public void TestMqttTopicMatches_SingleLevelWildcard()
    {
        Assert.True(Worker.MqttTopicMatches("tele/+/SENSOR", "tele/device1/SENSOR"));
        Assert.True(Worker.MqttTopicMatches("tele/+/SENSOR", "tele/device2/SENSOR"));
        Assert.False(Worker.MqttTopicMatches("tele/+/SENSOR", "tele/device1/temp/SENSOR"));
    }

    [Fact]
    public void TestMqttTopicMatches_MultiLevelWildcard()
    {
        Assert.True(Worker.MqttTopicMatches("tele/device1/#", "tele/device1/SENSOR"));
        Assert.True(Worker.MqttTopicMatches("tele/device1/#", "tele/device1/temp/celsius"));
        Assert.True(Worker.MqttTopicMatches("#", "tele/device1/temp/celsius"));
        Assert.False(Worker.MqttTopicMatches("tele/device1/#", "tele/device2/SENSOR"));
    }

    [Theory]
    [InlineData("{\"temp\": 23.5}", "temp", "23.5")]
    [InlineData("{\"temp\": 23.5}", "$.temp", "23.5")]
    [InlineData("{\"sensors\": {\"temp\": 23.5}}", "sensors.temp", "23.5")]
    [InlineData("{\"sensors\": {\"temp\": 23.5}}", "$.sensors.temp", "23.5")]
    [InlineData("{\"array\": [10, 20, 30]}", "array[1]", "20")]
    [InlineData("{\"array\": [10, 20, 30]}", "$.array[2]", "30")]
    [InlineData("{\"status\": \"active\"}", "status", "active")]
    [InlineData("{\"nested\": {\"values\": [{\"val\": 1.2}, {\"val\": 3.4}]}}", "nested.values[1].val", "3.4")]
    public void TestGetJsonValueByPath(string json, string path, string expectedValue)
    {
        var method = typeof(Worker).GetMethod("GetJsonValueByPath", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        var result = method.Invoke(null, new object[] { json, path }) as string;
        Assert.Equal(expectedValue, result);
    }

    [Fact]
    public void TestGetJsonValueByPath_InvalidPaths()
    {
        var method = typeof(Worker).GetMethod("GetJsonValueByPath", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        // Path not found
        var resultNotFound = method.Invoke(null, new object[] { "{\"temp\": 23.5}", "humidity" }) as string;
        Assert.Null(resultNotFound);

        // Invalid JSON
        var resultInvalidJson = method.Invoke(null, new object[] { "{invalid json}", "temp" }) as string;
        Assert.Null(resultInvalidJson);

        // Index out of bounds
        var resultOutOfBounds = method.Invoke(null, new object[] { "{\"array\": [10, 20]}", "array[5]" }) as string;
        Assert.Null(resultOutOfBounds);
    }

    [Fact]
    public void TestMqttDeviceModel_Defaults()
    {
        var dev = new MqttDevice
        {
            Id = "test-device",
            AdapterId = "adp-mqtt-1",
            Name = "Test Packer",
            TopicSubscription = "tele/packer/SENSOR"
        };

        Assert.Equal("JSON", dev.MqttParseMode);
        Assert.True(dev.IsEnabled);
        Assert.Equal("Online", dev.LwtOnlinePayload);
        Assert.Equal("Offline", dev.LwtOfflinePayload);
        Assert.Equal("Disconnected", dev.Status);
        Assert.Null(dev.LastError);
        Assert.Equal(0, dev.ConsecutiveFailures);
    }

    [Fact]
    public void TestDataPointModel_MqttFields()
    {
        var dp = new DataPoint
        {
            Id = "dp-1",
            AdapterId = "adp-mqtt-1",
            Address = "tele/packer/SENSOR",
            DataType = "Float"
        };

        Assert.Null(dp.MqttDeviceId);
        Assert.Equal("Plaintext", dp.MqttParseMode);
        Assert.Null(dp.MqttJsonPath);
    }
}
