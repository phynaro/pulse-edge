using System;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using MQTTnet;

namespace Pulse.Edge.Protocols.MqttProtocol;

public class MqttDriver
{
    private readonly ILogger<MqttDriver> _logger;
    private IMqttClient? _mqttClient;

    // Asynchronous event callback invoked when a subscribed topic receives a payload
    public event Func<string, string, Task>? MessageReceivedAsync;

    public MqttDriver(ILogger<MqttDriver> logger)
    {
        _logger = logger;
    }

    // Connects to the target MQTT Broker and subscribes to a topic channel
    public async Task ConnectAndSubscribeAsync(string brokerUrl, int port, string topic)
    {
        // Instantiate the MqttFactory using the fully qualified global namespace path
        var factory = new MqttClientFactory();
        _mqttClient = factory.CreateMqttClient();

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(brokerUrl, port)
            .WithCleanSession()
            .Build();

        // Register incoming message event handler
        _mqttClient.ApplicationMessageReceivedAsync += async e =>
        {
            string topicReceived = e.ApplicationMessage.Topic;
            string payload = e.ApplicationMessage.ConvertPayloadToString();
            _logger.LogInformation("[MQTT Client] Received MQTT message on topic '{Topic}': {Payload}", topicReceived, payload);

            if (MessageReceivedAsync != null)
            {
                try
                {
                    // Trigger the event handler to process the message (e.g. write it to SQLite)
                    await MessageReceivedAsync.Invoke(topicReceived, payload);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing MQTT callback event for topic {Topic}", topicReceived);
                }
            }
        };

        _logger.LogInformation("[MQTT Client] Connecting to MQTT Broker at {Broker}:{Port}...", brokerUrl, port);
        await _mqttClient.ConnectAsync(options);
        _logger.LogInformation("[MQTT Client] Connected successfully.");

        _logger.LogInformation("[MQTT Client] Subscribing to topic filter: {Topic}...", topic);
        await _mqttClient.SubscribeAsync(new MqttTopicFilterBuilder().WithTopic(topic).Build());
        _logger.LogInformation("[MQTT Client] Subscription active.");
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
            await _mqttClient.DisconnectAsync();
            _logger.LogInformation("[MQTT Client] Disconnected.");
        }
    }
}
