using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using MQTTnet;

namespace Pulse.Edge.Protocols.MqttProtocol;

public class MqttDriver
{
    private readonly ILogger<MqttDriver> _logger;
    private IMqttClient? _mqttClient;

    public bool IsConnected => _mqttClient != null && _mqttClient.IsConnected;

    // Asynchronous event callback invoked when a subscribed topic receives a payload.
    // Subscribed exactly ONCE by the Worker — the handler is registered on the driver,
    // not on each IMqttClient instance, so reconnects never accumulate duplicates.
    public event Func<string, string, Task>? MessageReceivedAsync;

    public MqttDriver(ILogger<MqttDriver> logger)
    {
        _logger = logger;
    }

    // Connects to the target MQTT Broker and subscribes to a topic channel list
    public async Task ConnectAndSubscribeAsync(string brokerUrl, int port, IEnumerable<string> topics)
    {
        // Dispose the previous client completely before creating a new one.
        // Without this, the old client stays alive, keeps its ApplicationMessageReceivedAsync
        // handler registered, and continues delivering duplicate messages.
        if (_mqttClient != null)
        {
            try
            {
                _mqttClient.ApplicationMessageReceivedAsync -= OnApplicationMessageReceived;
                if (_mqttClient.IsConnected)
                    await _mqttClient.DisconnectAsync();
            }
            catch { /* best-effort cleanup */ }
            finally
            {
                _mqttClient.Dispose();
                _mqttClient = null;
            }
        }

        var factory = new MqttClientFactory();
        _mqttClient = factory.CreateMqttClient();

        // Register the handler on the new client instance
        _mqttClient.ApplicationMessageReceivedAsync += OnApplicationMessageReceived;

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(brokerUrl, port)
            .WithCleanSession()
            .WithTimeout(TimeSpan.FromSeconds(5))
            .Build();

        _logger.LogInformation("[MQTT Client] Connecting to MQTT Broker at {Broker}:{Port}...", brokerUrl, port);
        await _mqttClient.ConnectAsync(options);
        _logger.LogInformation("[MQTT Client] Connected successfully.");

        foreach (var topic in topics)
        {
            if (string.IsNullOrWhiteSpace(topic)) continue;
            _logger.LogInformation("[MQTT Client] Subscribing to topic filter: {Topic}...", topic);
            await _mqttClient.SubscribeAsync(new MqttTopicFilterBuilder().WithTopic(topic).Build());
        }
        _logger.LogInformation("[MQTT Client] All topic subscriptions active.");
    }

    // Single named handler — registered/unregistered cleanly on each client instance
    private async Task OnApplicationMessageReceived(MqttApplicationMessageReceivedEventArgs e)
    {
        string topicReceived = e.ApplicationMessage.Topic;
        string payload = e.ApplicationMessage.ConvertPayloadToString();
        _logger.LogInformation("[MQTT Client] Received MQTT message on topic '{Topic}': {Payload}", topicReceived, payload);

        if (MessageReceivedAsync != null)
        {
            try
            {
                await MessageReceivedAsync.Invoke(topicReceived, payload);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing MQTT callback event for topic {Topic}", topicReceived);
            }
        }
    }

    // Subscribes dynamically to a single topic filter
    public async Task SubscribeAsync(string topic)
    {
        if (_mqttClient != null && _mqttClient.IsConnected)
        {
            if (string.IsNullOrWhiteSpace(topic)) return;
            _logger.LogInformation("[MQTT Client] Subscribing to topic filter: {Topic}...", topic);
            await _mqttClient.SubscribeAsync(new MqttTopicFilterBuilder().WithTopic(topic).Build());
        }
    }

    // Unsubscribes dynamically from a single topic filter
    public async Task UnsubscribeAsync(string topic)
    {
        if (_mqttClient != null && _mqttClient.IsConnected)
        {
            if (string.IsNullOrWhiteSpace(topic)) return;
            _logger.LogInformation("[MQTT Client] Unsubscribing from topic: {Topic}...", topic);
            await _mqttClient.UnsubscribeAsync(topic);
        }
    }

    // Publishes a JSON payload to a target topic
    public async Task PublishAsync(string topic, string payload)
    {
        if (_mqttClient != null && _mqttClient.IsConnected)
        {
            var message = new MqttApplicationMessageBuilder()
                .WithTopic(topic)
                .WithPayload(payload)
                .Build();

            await _mqttClient.PublishAsync(message);
            _logger.LogInformation("[MQTT Client] Published message to topic '{Topic}': {Payload}", topic, payload);
        }
    }

    // Disconnect method for graceful shutdown
    public async Task DisconnectAsync()
    {
        if (_mqttClient != null && _mqttClient.IsConnected)
        {
            _logger.LogInformation("[MQTT Client] Disconnecting from MQTT broker...");
            _mqttClient.ApplicationMessageReceivedAsync -= OnApplicationMessageReceived;
            await _mqttClient.DisconnectAsync();
            _logger.LogInformation("[MQTT Client] Disconnected.");
        }
    }
}
