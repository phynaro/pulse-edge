using System;
using System.Linq;
using System.Threading.Tasks;
using Xunit;
using Pulse.Edge.Storage;
using Microsoft.EntityFrameworkCore;

namespace Pulse.Edge.Tests;

public class PowerMeterOnboardingTests
{
    [Fact]
    public void TestTemplatesCatalog_ContainsSchneiderPM5350()
    {
        var templates = PowerMeterTemplatesCatalog.Templates;
        Assert.NotEmpty(templates);

        var pm5350 = templates.FirstOrDefault(t => t.Id == "schneider_pm5350");
        Assert.NotNull(pm5350);
        Assert.Equal("Schneider Electric PM5350", pm5350.Name);
        Assert.Equal("MODBUS_TCP", pm5350.Protocol);
        Assert.Equal(43, pm5350.Metrics.Count);

        var voltage = pm5350.Metrics.FirstOrDefault(m => m.Metric == "voltage_v");
        Assert.NotNull(voltage);
        Assert.Equal("50030", voltage.Address);
        Assert.Equal("Float", voltage.DataType);
        Assert.Equal("ABCD", voltage.ByteOrder);
    }

    [Fact]
    public async Task TestPowerMeterCreationLogicAsync()
    {
        using var db = new QueueDbContext();
        
        var adapterName = "Test Power Meter " + Guid.NewGuid().ToString("N");
        var host = "192.168.1.100";
        var port = 502;
        var slaveId = 2;
        var scanInterval = 5000;
        var templateId = "schneider_pm5350";
        var dataSourceName = "Test Power Meter Stream " + Guid.NewGuid().ToString("N");

        using var transaction = await db.Database.BeginTransactionAsync();

        try
        {
            // 1. Create Adapter
            var adapterId = Guid.NewGuid().ToString();
            var configJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                UnitId = slaveId,
                TimeoutMs = 5000,
                Retries = 3
            });

            var adapter = new Pulse.Edge.Storage.Models.DriverAdapter
            {
                Id = adapterId,
                Name = adapterName,
                Protocol = "MODBUS_TCP",
                Host = host,
                Port = port,
                ConfigJson = configJson,
                IsEnabled = true,
                Status = "Offline"
            };
            db.DriverAdapters.Add(adapter);

            // 2. Create DataSource
            var dataSourceId = Guid.NewGuid().ToString();
            var dataSource = new Pulse.Edge.Storage.Models.DataSource
            {
                Id = dataSourceId,
                Name = dataSourceName,
                Type = "Energy",
                Description = "Auto-created from test",
                IsEnabled = true
            };
            db.DataSources.Add(dataSource);

            // 3. Create DataPoints
            var template = PowerMeterTemplatesCatalog.Templates.First(t => t.Id == templateId);
            foreach (var metric in template.Metrics)
            {
                var dataPoint = new Pulse.Edge.Storage.Models.DataPoint
                {
                    Id = Guid.NewGuid().ToString(),
                    AdapterId = adapterId,
                    DataSourceId = dataSourceId,
                    Metric = metric.Metric,
                    Address = metric.Address,
                    DataType = metric.DataType,
                    ScanIntervalMs = scanInterval,
                    ScaleFactor = metric.ScaleFactor,
                    Offset = 0.0,
                    IsEnabled = true,
                    ByteOrder = metric.ByteOrder,
                    MqttParseMode = "Plaintext"
                };
                db.DataPoints.Add(dataPoint);
            }

            await db.SaveChangesAsync();

            // Verify db state
            var savedAdapter = await db.DriverAdapters.FirstOrDefaultAsync(a => a.Id == adapterId);
            Assert.NotNull(savedAdapter);
            Assert.Equal(adapterName, savedAdapter.Name);

            var savedDataSource = await db.DataSources.FirstOrDefaultAsync(ds => ds.Id == dataSourceId);
            Assert.NotNull(savedDataSource);
            Assert.Equal(dataSourceName, savedDataSource.Name);

            var savedPoints = await db.DataPoints.Where(dp => dp.AdapterId == adapterId).ToListAsync();
            Assert.Equal(43, savedPoints.Count);
            Assert.Contains(savedPoints, dp => dp.Metric == "voltage_v" && dp.Address == "50030");
            Assert.Contains(savedPoints, dp => dp.Metric == "energy_kwh" && dp.Address == "50068" && dp.ScaleFactor == 0.001);
        }
        finally
        {
            // Roll back changes so database remains clean
            await transaction.RollbackAsync();
        }
    }
}
