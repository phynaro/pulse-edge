namespace Pulse.Edge.Agent.Simulation;

/// <summary>A complete simulated plant: shift calendar, units, and triggerable events.</summary>
public sealed record ScenarioDefinition(
    string Id,
    string Name,
    string UtcOffset,
    ShiftCalendar Shifts,
    IReadOnlyList<UnitDefinition> Units,
    IReadOnlyList<EventDefinition> Events);

public sealed record ShiftCalendar(IReadOnlyList<ShiftWindow> Windows);

/// <summary>Weekdays use 0 = Sunday; Start/End are local "HH:mm".</summary>
public sealed record ShiftWindow(int[] Weekdays, string Start, string End);

/// <summary>One simulated unit. Kind is machine, analog, meter or ambient; exactly the matching params are set.</summary>
public sealed record UnitDefinition(
    string Id,
    string Kind,
    MachineParams? Machine,
    AnalogParams? Analog,
    MeterParams? Meter,
    AmbientParams? Ambient);

/// <summary>A value that only drifts gently around Center; never abnormal, never targeted by events.</summary>
public sealed record AmbientParams(
    double Center,
    double Amplitude,
    double PeriodMinutes,
    double NoiseSd,
    string? FollowsUnit,
    double? StoppedValue,
    string Unit);

public sealed record MachineParams(
    double RatePerMin,
    double RejectFraction,
    double MtbfMinutes,
    double MttrMinutes,
    double MicroStopsPerHour,
    int[] FaultCodes,
    bool FollowsShifts,
    double RunningKw,
    double IdleKw);

/// <summary>Min, when set, is a hard floor on the reported value (flows, levels and pressures cannot go negative).</summary>
public sealed record AnalogParams(
    double Setpoint,
    double TauSeconds,
    double NoiseSd,
    string? FollowsUnit,
    double? StoppedValue,
    string Unit,
    double? Min = null);

/// <summary>KwNoisePct (a fraction of kW) and PfNoiseSd make the reported kW and pf wobble while the
/// load is steady; kWh integrates the noise-free load, so totals and catch-up are unaffected.</summary>
public sealed record MeterParams(
    double BaseKw,
    string[] Feeds,
    double PfAtFullLoad,
    double PfAtLowLoad,
    double StartKwh,
    double KwNoisePct = 0.01,
    double PfNoiseSd = 0.003);

/// <summary>Effect is force_fault, offset or ramp.</summary>
public sealed record EventDefinition(
    string Id,
    string Unit,
    string Effect,
    double Magnitude,
    int DurationMinutes,
    int? FaultCode,
    double DailyProbability);
