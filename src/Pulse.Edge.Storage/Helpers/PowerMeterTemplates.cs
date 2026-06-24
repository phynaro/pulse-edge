using System;
using System.Collections.Generic;

namespace Pulse.Edge.Storage;

public record PowerMeterTemplate(
    string Id,
    string Name,
    string Protocol,
    string Description,
    List<PowerMeterMetricTemplate> Metrics
);

public record PowerMeterMetricTemplate(
    string Metric,
    string Name,
    string Address,
    string DataType,
    string ByteOrder,
    double ScaleFactor = 1.0
);

public static class PowerMeterTemplatesCatalog
{
    public static readonly List<PowerMeterTemplate> Templates = new()
    {
        new PowerMeterTemplate(
            "schneider_pm5350",
            "Schneider Electric PM5350",
            "MODBUS_TCP",
            "Modbus Compatible Power Meter template containing current, voltage, power, power factor, energy, demand, and alarm metrics.",
            new List<PowerMeterMetricTemplate>
            {
                new("current_phase_a", "Current A", "50000", "Float", "ABCD", 1.0),
                new("current_phase_b", "Current B", "50002", "Float", "ABCD", 1.0),
                new("current_phase_c", "Current C", "50004", "Float", "ABCD", 1.0),
                new("current_phase_n", "Current N", "50006", "Float", "ABCD", 1.0),
                new("current_a", "Current Avg", "50008", "Float", "ABCD", 1.0),
                new("current_unbalance_a", "Current Unbalance A", "50010", "Float", "ABCD", 1.0),
                new("current_unbalance_b", "Current Unbalance B", "50012", "Float", "ABCD", 1.0),
                new("current_unbalance_c", "Current Unbalance C", "50014", "Float", "ABCD", 1.0),
                new("voltage_a_b", "Voltage A-B", "50016", "Float", "ABCD", 1.0),
                new("voltage_b_c", "Voltage B-C", "50018", "Float", "ABCD", 1.0),
                new("voltage_c_a", "Voltage C-A", "50020", "Float", "ABCD", 1.0),
                new("voltage_a_n", "Voltage A-N", "50022", "Float", "ABCD", 1.0),
                new("voltage_b_n", "Voltage B-N", "50024", "Float", "ABCD", 1.0),
                new("voltage_c_n", "Voltage C-N", "50026", "Float", "ABCD", 1.0),
                new("voltage_l_l_avg", "Voltage L-L Avg", "50028", "Float", "ABCD", 1.0),
                new("voltage_v", "Voltage L-N Avg", "50030", "Float", "ABCD", 1.0),
                new("active_power_a", "Active Power A", "50032", "Float", "ABCD", 1.0),
                new("active_power_b", "Active Power B", "50034", "Float", "ABCD", 1.0),
                new("active_power_c", "Active Power C", "50036", "Float", "ABCD", 1.0),
                new("power_kw", "Active Power Total", "50038", "Float", "ABCD", 1.0),
                new("reactive_power_a", "Reactive Power A", "50040", "Float", "ABCD", 1.0),
                new("reactive_power_b", "Reactive Power B", "50042", "Float", "ABCD", 1.0),
                new("reactive_power_c", "Reactive Power C", "50044", "Float", "ABCD", 1.0),
                new("reactive_power_total", "Reactive Power Total", "50046", "Float", "ABCD", 1.0),
                new("power_factor_a", "Power Factor A", "50048", "Float", "ABCD", 1.0),
                new("power_factor_b", "Power Factor B", "50050", "Float", "ABCD", 1.0),
                new("power_factor_c", "Power Factor C", "50052", "Float", "ABCD", 1.0),
                new("power_factor_total", "Power Factor Total", "50054", "Float", "ABCD", 1.0),
                new("active_energy_delivered_a", "Active Energy Delivered Phase A", "50056", "Int64", "ABCD", 0.001),
                new("active_energy_delivered_b", "Active Energy Delivered Phase B", "50060", "Int64", "ABCD", 0.001),
                new("active_energy_delivered_c", "Active Energy Delivered Phase C", "50064", "Int64", "ABCD", 0.001),
                new("energy_kwh", "Active Energy Delivered (Into Load)", "50068", "Int64", "ABCD", 0.001),
                new("reactive_energy_delivered_a", "Reactive Energy Delivered Phase A", "50072", "Int64", "ABCD", 0.001),
                new("reactive_energy_delivered_b", "Reactive Energy Delivered Phase B", "50076", "Int64", "ABCD", 0.001),
                new("reactive_energy_delivered_c", "Reactive Energy Delivered Phase C", "50080", "Int64", "ABCD", 0.001),
                new("reactive_energy_delivered", "Reactive Energy Delivered", "50084", "Int64", "ABCD", 0.001),
                new("active_power_dmd_a", "Active Power Dmd Phase A", "50088", "Float", "ABCD", 1.0),
                new("active_power_dmd_b", "Active Power Dmd Phase B", "50090", "Float", "ABCD", 1.0),
                new("active_power_dmd_c", "Active Power Dmd Phase C", "50092", "Float", "ABCD", 1.0),
                new("active_power_dmd_total", "Active Power Dmd Total", "50094", "Float", "ABCD", 1.0),
                new("alarm_flags_a_ab", "Alarm flags phase A/AB", "50096", "UInt16", "ABCD", 1.0),
                new("alarm_flags_b_bc", "Alarm flags phase B/BC", "50097", "UInt16", "ABCD", 1.0),
                new("alarm_flags_c_ca", "Alarm flags phase C/CA", "50098", "UInt16", "ABCD", 1.0)
            }
        )
    };
}
