using System;
using System.Collections.Concurrent;
using System.Linq;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Agent;

public class SimulatorState
{
    public double Voltage { get; set; } = 220.0;
    public double Current { get; set; } = 10.0;
    public double Power { get; set; } = 2.2; // kW
    public double AccumulatedEnergy { get; set; } = 1000.0; // kWh
    public double PowerFactor { get; set; } = 0.92;
    public double Frequency { get; set; } = 50.0;

    public bool Running { get; set; } = true;
    public bool Idle { get; set; } = false;
    public bool Faulted { get; set; } = false;
    public double Speed { get; set; } = 50.0; // pcs/min
    public double AccumulatedCount { get; set; } = 10000.0;
    public double AccumulatedReject { get; set; } = 200.0;
    public int FaultCode { get; set; } = 0;

    public DateTime LastUpdate { get; set; } = DateTime.MinValue;
    public bool IsInitialized { get; set; } = false;
}

public class SimulatorDriver
{
    private readonly ConcurrentDictionary<string, SimulatorState> _states = new();

    public void UpdateState(string adapterId, string template, DateTime now, QueueDbContext db)
    {
        var state = _states.GetOrAdd(adapterId, _ => new SimulatorState());

        lock (state)
        {
            if (!state.IsInitialized)
            {
                // Try to initialize from the latest value in database to prevent resets on restart
                if (template == "energy")
                {
                    var dp = db.DataPoints.FirstOrDefault(x => x.AdapterId == adapterId && 
                        (x.Address == "energy" || x.Address == "kwh" || x.Address == "accumulated_energy"));
                    if (dp != null && double.TryParse(dp.LastValue, out double val))
                    {
                        state.AccumulatedEnergy = val;
                    }
                }
                else if (template == "production")
                {
                    var dp = db.DataPoints.FirstOrDefault(x => x.AdapterId == adapterId && 
                        (x.Address == "total_count" || x.Address == "count" || x.Address == "totalcount"));
                    if (dp != null && double.TryParse(dp.LastValue, out double val))
                    {
                        state.AccumulatedCount = val;
                    }
                }
                state.IsInitialized = true;
                state.LastUpdate = now;
            }

            double seconds = (now - state.LastUpdate).TotalSeconds;
            if (seconds > 0)
            {
                double hash = Math.Abs(adapterId.GetHashCode());
                double t = now.Ticks / 10000000.0;

                // 1. Energy template calculations
                double baseV = 220.0 + (hash % 10 - 5);
                state.Voltage = baseV + 2.0 * Math.Sin(t * (2 * Math.PI / 60.0)) + 0.5 * Math.Sin(t * (2 * Math.PI / 5.0));

                double baseA = 12.0 + (hash % 6 - 3);
                double currentVar = baseA + 4.0 * Math.Sin(t * (2 * Math.PI / 300.0)) + 1.0 * Math.Sin(t * (2 * Math.PI / 12.0));
                state.Current = currentVar < 0.1 ? 0.1 : currentVar;

                double pfVar = 0.90 + 0.04 * Math.Sin(t * (2 * Math.PI / 120.0)) + 0.01 * Math.Sin(t * (2 * Math.PI / 8.0));
                state.PowerFactor = pfVar > 1.0 ? 1.0 : (pfVar < 0.5 ? 0.5 : pfVar);

                // Relate: kW = V * A * PF / 1000.0
                state.Power = (state.Voltage * state.Current * state.PowerFactor) / 1000.0;
                state.Frequency = 50.0 + 0.05 * Math.Sin(t * (2 * Math.PI / 10.0)) + 0.01 * Math.Sin(t * (2 * Math.PI / 2.0));

                // Accumulate energy: kWh += kW * (seconds / 3600)
                state.AccumulatedEnergy += (state.Power * seconds) / 3600.0;

                // 2. Production template calculations
                // 300s cycle: 240s running, 40s idle, 20s faulted
                double cycleTime = t % 300.0;
                state.Running = cycleTime < 240.0;
                state.Idle = cycleTime >= 240.0 && cycleTime < 280.0;
                state.Faulted = cycleTime >= 280.0;

                if (state.Running)
                {
                    double speedVar = 50.0 + 5.0 * Math.Sin(t * (2 * Math.PI / 30.0)) + (hash % 10 - 5);
                    state.Speed = speedVar < 10.0 ? 10.0 : speedVar;
                    state.AccumulatedCount += (state.Speed / 60.0) * seconds;
                    state.AccumulatedReject += (state.Speed / 60.0) * seconds * 0.02;
                    state.FaultCode = 0;
                }
                else
                {
                    state.Speed = 0.0;
                    state.FaultCode = state.Faulted ? ((int)(hash % 3) + 1) : 0;
                }

                state.LastUpdate = now;
            }
        }
    }

    public double ReadValue(string adapterId, string address)
    {
        var state = _states.GetOrAdd(adapterId, _ => new SimulatorState());

        string addr = address.ToLowerInvariant().Trim();

        // Energy Addresses
        if (addr == "voltage" || addr == "v") return state.Voltage;
        if (addr == "current" || addr == "a") return state.Current;
        if (addr == "power" || addr == "kw" || addr == "active_power") return state.Power;
        if (addr == "energy" || addr == "kwh" || addr == "accumulated_energy") return state.AccumulatedEnergy;
        if (addr == "power_factor" || addr == "pf") return state.PowerFactor;
        if (addr == "frequency" || addr == "hz") return state.Frequency;

        // Production Addresses
        if (addr == "running" || addr == "state" || addr == "status") return state.Running ? 1.0 : 0.0;
        if (addr == "total_count" || addr == "count" || addr == "totalcount") return Math.Floor(state.AccumulatedCount);
        if (addr == "reject_count" || addr == "rejects" || addr == "rejectcount") return Math.Floor(state.AccumulatedReject);
        if (addr == "speed" || addr == "rate" || addr == "speed_rate") return state.Speed;
        if (addr == "fault_code" || addr == "fault" || addr == "faultcode") return state.FaultCode;

        return 0.0;
    }
}
