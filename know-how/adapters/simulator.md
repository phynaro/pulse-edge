# Simulator Adapter Guide

The SIMULATOR adapter produces fake but believable readings, so you can demo the UI, test OEE and energy screens and develop cloud features without a real machine or PLC (programmable logic controller). It is always online with quality `"Good"` and needs no network.

---

## 1. Adapter Configuration

The adapter's `ConfigJson` picks a template:

```json
{ "Template": "energy" }
```

| Template | What it gives you |
|----------|-------------------|
| `energy` | One power meter: voltage, current, power, accumulated energy, power factor, frequency. |
| `production` | One machine on a repeating 5-minute cycle (4 min running, 40 s idle, 20 s faulted) with counters. |
| `scenario` | A whole fictional plant (125 units) that behaves like a real factory. See sections 3 and 4. |

If `Template` is missing, the simulator behaves as `energy`. There is no `hvac` template; older notes that mentioned one were wrong.

### Addresses for `energy` and `production`

* **energy:** `voltage` (`v`), `current` (`a`), `power` (`kw`, `active_power`), `energy` (`kwh`, `accumulated_energy`), `power_factor` (`pf`), `frequency` (`hz`).
* **production:** `state` (`running`, `status`; 1 = running), `total_count` (`count`), `reject_count` (`rejects`), `speed` (`rate`), `fault_code` (`fault`).

These two templates are plain formulas on the clock (sine waves plus a little noise). The accumulated energy and count restart from the last stored tag value, so they survive an agent restart.

---

## 2. How the simulator runs

The simulator runs inside the edge agent. On each polling tick it computes new values and writes them to the normal tag pipeline (the same path real adapters use), so tags, OEE channels, alarms and cloud upload behave exactly as with real devices.

---

## 3. Address scheme for the `scenario` template

Every tag address is `<unit>.<signal>`, for example `iws1.state` or `m_main.kw`. The tag browser in the UI lists all of them once you pick a scenario on the adapter.

| Unit kind | Signals |
|-----------|---------|
| machine | `state` (1 running, else 0), `fault` (1 when faulted), `fault_code`, `good_count`, `reject_count`, `speed` (units per minute while running) |
| analog | `value` (a process value that moves toward a target, e.g. a temperature) |
| ambient | `value` (a quiet background reading: motor current, vibration, room temperature, humidity, tank level, voltage) |
| meter | `kw`, `kwh` (cumulative), `pf` (power factor), `current` (amps, from the load: I = kW x 1000 / (sqrt(3) x V x pf), with V the centre of the meter's `<meter>_voltage` reading, 400 V when there is none) |

Adapter config for the plant:

```json
{ "Template": "scenario", "Scenario": "integra-dairy" }
```

### Machine modes

A machine is always in one of four modes. The tags show them like this:

| Mode | `state` | `fault` | Meaning |
|------|---------|---------|---------|
| Running | 1 | 0 | making product, counters rise |
| Idle | 0 | 0 | powered but not producing (a micro-stop) |
| Fault | 0 | 1 | broken down; `fault_code` shows the code |
| PlannedStop | 0 | 0 | outside the shift calendar, switched off |

Machines that follow shifts run Mon-Sat 06:00-14:00 and 14:00-22:00 (plant time, UTC+07:00) and sit in PlannedStop otherwise, including all of Sunday. The utilities (boiler, ammonia compressor, chiller, compressed air, wastewater) run around the clock.

### Power and PlannedStop

Meters add up the power of the machines they feed: a running machine draws its running kW, an idle or faulted one its idle kW, and **a machine in PlannedStop draws 0 kW**. Each meter also has a base load. So `m_main.kw` at night or on Sunday is roughly the 60 kW base load plus the always-on utilities (about 120 to 270 kW in total), not just 60 kW and not the full-plant figure (about 500 kW in a busy shift).

---

## 4. The Integra Dairy plant (`integra-dairy`)

Everything is a pure function of the clock and the plant name, plus counters saved to disk. Stop and restart the agent and you get the same plant, with `good_count`, `reject_count` and `kwh` continuing where they left off (they never go backwards). Breakdowns and noise are not different each run: the same instant always gives the same value.

| Group | Units |
|-------|-------|
| Process machines (9) | `sep1` (separator), `htst1` (pasteuriser), `vat1`, `vat2` (cheese vats), `prs1` (press), `grd1` (grinder), `bld1` (blender), `ckr1` (cooker), `cip1` (clean-in-place) |
| Packing machines (11) | `iws1`, `iws2` (flow wrappers), `fw1`, `fw2`, `cw1`, `cw2`, `md1`, `md2`, `ce1`, `cp1`, `pal1` (palletiser) |
| Utilities (5, run 24/7) | `blr1` (boiler), `nh3_1` (ammonia compressor), `chl1` (chiller), `ac1` (air compressor), `wwt1` (wastewater) |
| Analog process values (10) | `silo1_temp`, `silo2_temp`, `htst1_outlet`, `ckr1_temp`, `hld1_temp`, `cold1_temp`, `chl1_glycol`, `blr1_pressure`, `ac1_pressure`, `wwt1_flow` |
| Power meters (6) | `m_main` (whole plant), `m_boiler`, `m_refrig`, `m_iws1`, `m_iws2`, `m_air` |
| Ambient readings (84) | `<machine>_motor_current` and `<machine>_vibration` for each of the 25 machines, room temperature and humidity (`rcv_room_*`, `chs_room_*`, `prc_room_*`, `pkg_room_*`, `wh_dock_*`, `qa_lab_*`, `rip1_*`), tank levels, utility flows, and voltage per meter (a meter's current is its own `current` signal, which follows the load) |

That is 25 machines + 10 analogs + 6 meters + 84 ambient readings = 125 units. Analog and ambient values that belong to a machine fall to a stopped value when it is faulted or in PlannedStop (for example `htst1_outlet` cools to 20 C, `blr1_pressure` falls toward 0.3 bar, motor currents read 0). A micro-stop (Idle, 20 to 90 s) does not count as stopped: the pasteuriser stays at about 73 C and motor currents keep their running values.

Ambient readings are deliberately boring background. They stay in their normal band, so they never raise alarms on their own; only the events below disturb the plant.

### Events

Five events can disturb the plant. Each also fires by itself on a daily draw (a chance per day, at a fixed minute inside a working shift, never on Sunday), so a normal week shows several of each.

| Event | Unit | Effect | Lasts | Chance per day |
|-------|------|--------|-------|----------------|
| `htst_temp_drop` | `htst1_outlet` | outlet temperature drops 3.5 C | 8 min | 40% |
| `iws1_film_jam` | `iws1` | machine faults with code 11 | 15 min | 50% |
| `cold_store_drift` | `cold1_temp` | temperature creeps up 6 C over the period | 90 min | 30% |
| `boiler_trip` | `blr1` | boiler faults with code 101 (pressure and steam fall) | 20 min | 30% |
| `air_leak` | `ac1_pressure` | air pressure drops 1.2 bar | 45 min | 40% |

### Triggering an event by hand (presenter mode)

Only an Admin can trigger an event. In the UI, the Scenario panel on the adapter card has one button per event and shows the live mode of each unit.

Over the REST API you need the session cookie: log in once, save the cookie, and send it with each call. Replace `HOST:PORT` with your edge address.

```bash
# 1. Log in and save the session cookie
curl -s -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
  http://HOST:PORT/api/auth/login

# 2. List scenarios, their units and events
curl -s -b cookies.txt http://HOST:PORT/api/simulator/scenarios

# 3. See live modes and which events are active right now
curl -s -b cookies.txt http://HOST:PORT/api/simulator/scenarios/integra-dairy/status

# 4. Trigger an event now (Admin only; answers 202 Accepted)
curl -s -b cookies.txt -H "Content-Type: application/json" \
  -d '{"eventId":"iws1_film_jam"}' \
  http://HOST:PORT/api/simulator/scenarios/integra-dairy/events
```

Notes:

* The status call works in single-port mode only; in split mode it returns 503.
* The trigger is queued and picked up on the next simulator tick (about once a second). The Scenario panel shows "active until" straight away from the event's duration and then switches to the server's time. Triggering an event that is already active extends it; it does not stack.
* An unknown scenario or event id returns 404.

---

## 5. Where state is stored

Files live in `<dataDir>/simulator/`, where `<dataDir>` is the edge data directory (`PULSE_EDGE_DATA_DIR` when set):

| File | Content |
|------|---------|
| `<scenario>.state.json` | counters (`good_count`, `reject_count`, `kwh`), analog values, active events, last update time. Saved about every 30 s of plant time and on shutdown; written to a temp file, flushed to disk, then renamed, so a crash cannot leave half a file. |
| `<scenario>.state.json.bak` | the previous save, kept on every save. |
| `<scenario>.state.json.corrupt-<utc>` | a state file that could not be read (empty or not valid JSON), moved aside on start-up. The engine logs an error and resumes from the `.bak`; only when neither is usable does the plant start fresh. |
| `<scenario>.events.json` | the queue of events requested through the API, emptied by the simulator on its next tick. |

To reset the plant to its starting counters, stop the agent and delete `<scenario>.state.json` and `<scenario>.state.json.bak`.

### Downtime and clock changes

* The simulator does its work at most once per second, however often the agent polls.
* After the agent was stopped, the first update catches up the production and energy of the missed time, but at most the **last 7 days**. A longer gap logs a warning and the older days are skipped.
* If the clock goes backwards (for example an NTP correction), counters never go backwards: nothing is caught up, the counters stay, and machine modes follow the new clock.
* If the state file cannot be read because another program holds it, the error is logged and the next update tries again.

---

## 6. Binding OEE channels to a simulated machine

The existing OEE channel feature works unchanged; point each of its inputs at the machine's tags. For the flow wrapper `iws1`:

| OEE input | Tag |
|-----------|-----|
| Run state | `iws1.state` |
| Fault flag | `iws1.fault` |
| Fault code | `iws1.fault_code` |
| Good count | `iws1.good_count` |
| Reject count | `iws1.reject_count` |

Any other machine works the same way: replace `iws1` with its unit id. The counters rise only while the machine is Running, and the reject share is a fixed fraction per machine (1.5% for `iws1`), so OEE quality will sit near that figure.

---

## 7. Not built yet (follow-ups)

These parts of the scenario design are deferred (ruling R13) and not in the simulator today:

* **Time-of-day load shape beyond shifts.** Machines are either in a shift or not; there is no ramp-up at shift start, lunch dip or busier hours inside a shift.
* **CIP / cleaning windows.** `cip1` runs like any other machine; there are no scheduled cleaning windows that stop the lines it cleans.
* **Slowly varying reject fraction.** Each machine rejects a fixed share (for example 1.5% for `iws1`); it does not drift over hours or days.
