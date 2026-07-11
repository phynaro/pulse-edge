# PULSE Edge Environment and Hosting Configuration Guide

This document describes how the **PULSE Edge** application manages environment execution modes (Development vs. Production) and hosting modes (Single-Port vs. Multi-Port).

---

## 1. Execution Environments

PULSE Edge relies on the standard .NET environment configuration mechanism, controlled by the `ASPNETCORE_ENVIRONMENT` environment variable.

| Environment | Primary Use Case | Configuration Loaded | Default Hosting Mode |
| ----------- | ---------------- | -------------------- | -------------------- |
| **Development** | Local coding, UI hot-reloading (HMR), process debugging | `appsettings.json` + `appsettings.Development.json` | **Multi-Port** |
| **Production** | Distributed standalone binaries installed on target gates | `appsettings.json` only | **Single-Port** |

---

## 2. Hosting Modes (`hostingMode` Flag)

The application behaves differently depending on the `"hostingMode"` value specified in the configuration files:

### 2.1 `"hostingMode": "SinglePort"` (Production / Default)
* **Description**: Consolidates Kestrel Web API, background protocol engines, and the React UI frontend into a single OS process.
* **Ports**: Exposes **only a single TCP port** (defaults to `5288`).
* **UI Hosting**: React dashboard static assets are served directly from Kestrel via embedded resources (`ManifestEmbeddedFileProvider`).
* **Background Workers**: Spawns and manages protocol sync services (`CloudClient`, `SyncService`, `OpcUaDriver`, `MqttDriver`, `ModbusDriver`, and the hosted `Worker` service) in the same thread pool.

### 2.2 `"hostingMode": "MultiPort"` (Legacy / Development)
* **Description**: Splits the architecture into separate processes for developer convenience.
* **Ports**:
  * React UI (Vite dev server) -> Port `8080` (proxies `/api/*` requests to port `5288`).
  * Web API (Kestrel) -> Port `5288` (API only, does not host background workers or static UI files).
  * Agent Daemon (Background worker) -> Starts as a separate executable daemon with no listening port.

---

## 3. Configuration Management

Hosting configuration settings are managed via JSON files inside the [Pulse.Edge.Api](file:///Users/jirawuth/Projects/pulse-edge/src/Pulse.Edge.Api) folder:

### 3.1 Production Settings: `appsettings.json`
Acts as the global baseline config. It defaults to the unified single-port architecture:
```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "hostingMode": "SinglePort"
}
```

### 3.2 Development Settings: `appsettings.Development.json`
Overrides production settings locally on developer machines:
```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "hostingMode": "MultiPort"
}
```

---

## 4. Run Scripts Behavior

Our local launch utilities automatically read these settings and spin up the processes accordingly:

* **[start-edge.sh](file:///Users/jirawuth/Projects/pulse-edge/start-edge.sh) (macOS/Linux)** & **[start-edge.bat](file:///Users/jirawuth/Projects/pulse-edge/start-edge.bat) (Windows)**:
  1. Inspect the `hostingMode` key in `appsettings.Development.json` (falling back to `appsettings.json`).
  2. If `MultiPort` (default in dev), the script launches the API, the separate Agent daemon, and the Vite UI dev server.
  3. If `SinglePort`, the script launches only the API (which automatically runs the embedded background worker) and the Vite UI dev server.

---

## 5. Overriding the Environment Manually

To force a compiled production binary (`Pulse.Edge.exe`) to execute in a specific environment mode, set the `ASPNETCORE_ENVIRONMENT` variable in your terminal before launching the application:

### 5.1 Windows Command Prompt (CMD)
```cmd
:: Set to Development mode (runs as Multi-Port API-only server)
set ASPNETCORE_ENVIRONMENT=Development
Pulse.Edge.exe

:: Revert back to default Production mode
set ASPNETCORE_ENVIRONMENT=Production
Pulse.Edge.exe
```

### 5.2 Windows PowerShell
```powershell
:: Set to Development mode
$env:ASPNETCORE_ENVIRONMENT="Development"
.\Pulse.Edge.exe

:: Revert back to Production mode
$env:ASPNETCORE_ENVIRONMENT="Production"
.\Pulse.Edge.exe
```

### 5.3 Linux / Ubuntu Terminal
```bash
# Start in Development mode
ASPNETCORE_ENVIRONMENT=Development ./Pulse.Edge

# Start in Production mode (default)
./Pulse.Edge
```
