# PULSE Edge

## Migration Plan: Multi-Port Architecture → Single-Port Architecture

**Author:** Architecture Team

**Objective:**

Simplify deployment, installation, firewall configuration, and long-term maintenance by exposing only a single TCP port to the outside world while keeping all internal services private.

---

# 1. Current Architecture

Current deployment exposes multiple ports:

| Component              | Port |
| ---------------------- | ---- |
| React UI               | 3000 |
| REST API               | 5001 |
| WebSocket              | 5002 |
| MQTT Broker (optional) | 1883 |
| Future services        | TBD  |

Example:

```
Browser
   |
   +----> localhost:3000
   |
   +----> localhost:5001
   |
   +----> localhost:5002
```

Problems:

* Multiple firewall rules
* Multiple port conflict checks
* CORS configuration required
* Hardcoded frontend URLs
* More difficult installation experience
* Harder future migration to Linux/Docker

---

# 2. Target Architecture

```
                Browser
                    │
            http://localhost:5000
                    │
                    ▼
        PulseEdge.Service.exe
        (ASP.NET Core / Kestrel)
                    │
     ┌──────────────┼──────────────┐
     │              │              │
 React UI      REST API      WebSocket
    /           /api/*          /ws
     │              │              │
     └──────────────┼──────────────┘
                    │
            Internal Services
                    │
     ┌──────────────┼──────────────┐
     │              │              │
 AssetMgr     DriverMgr      UploadMgr
     │              │              │
 SQLite      Modbus/MQTT      Cloud
```

Only one TCP listener:

```
localhost:5000
```

---

# 3. Guiding Principles

## 3.1 Browser communicates only through HTTP/WebSocket.

The browser must never communicate directly with:

* SQLite
* Modbus Driver
* MQTT Engine
* Upload Engine
* Store & Forward Engine

---

## 3.2 Internal modules communicate via C# interfaces.

Preferred:

```csharp
assetService.GetAssets();

driverManager.GetStatus();

uploadManager.StartUpload();
```

Avoid:

```text
HTTP -> localhost:6001
HTTP -> localhost:6002
HTTP -> localhost:6003
```

Internal localhost APIs should only exist when absolutely necessary.

---

## 3.3 Single External Port

Default:

```
5000
```

Installer only validates this single port.

---

# 4. Migration Work Packages

---

## WP-1 Remove Hardcoded API URLs

Current:

```javascript
fetch("http://localhost:5001/api/assets")
```

Replace with:

```javascript
fetch("/api/assets")
```

Applies to:

* REST API
* Authentication
* Configuration
* Status pages

---

## WP-2 WebSocket Migration

Current:

```javascript
ws://localhost:5002/ws
```

Replace with:

```javascript
const protocol =
    window.location.protocol === "https:"
        ? "wss:"
        : "ws:";

const socket =
    new WebSocket(
        `${protocol}//${window.location.host}/ws`
    );
```

---

## WP-3 Embed React Build

Current:

```
React Dev Server
```

Target:

```
wwwroot/

    index.html
    assets/
    css/
    js/
```

ASP.NET Core:

```csharp
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();
app.MapFallbackToFile("index.html");
```

---

## WP-4 Consolidate API

All controllers hosted inside the main service.

Example:

```
/api/assets

/api/drivers

/api/config

/api/status

/api/history
```

Remove any standalone API executable.

---

## WP-5 Internal Service Refactoring

Current:

```
Controller
     │
 HTTP localhost:6001
     │
 Driver Service
```

Target:

```
Controller
     │
DriverManager.GetStatus()
```

Introduce dependency injection.

Example:

```csharp
services.AddSingleton<IDriverManager, DriverManager>();
services.AddSingleton<IAssetService, AssetService>();
services.AddSingleton<IUploadManager, UploadManager>();
```

---

## WP-6 Shared Memory Cache

Create a singleton cache service.

```
TelemetryCache

    CurrentValues

    DeviceStatus

    AssetState
```

Background polling updates cache.

Controllers and WebSocket read cache.

Avoid polling devices directly from API requests.

---

## WP-7 Installer Simplification

Remove:

* API port selection
* WebSocket port selection
* CORS configuration

Installer checks only:

```
Port 5000
```

If occupied:

```
Automatically assign next available port.

5001
5002
5003
...
```

Store selected value in:

```
config.json
```

---

## WP-8 Firewall Simplification

Before:

```
Allow:
3000
5001
5002
```

After:

```
Allow:
5000
```

Internal modules never require firewall rules.

---

# 5. Development Environment

Development remains unchanged.

```
Vite
localhost:5173

.NET
localhost:5000
```

Configure Vite proxy:

```javascript
proxy:
{
    "/api":
    {
        target:
        "http://localhost:5000"
    },

    "/ws":
    {
        target:
        "ws://localhost:5000",
        ws: true
    }
}
```

React code always uses:

```javascript
fetch("/api/...")

new WebSocket("/ws")
```

No environment-specific URLs.

---

# 6. Future OS Compatibility

This architecture supports:

| Platform    | Host            |
| ----------- | --------------- |
| Windows     | Windows Service |
| Linux       | systemd         |
| Docker      | Container       |
| ARM Gateway | Native Binary   |

No application-layer changes required.

---

# 7. Success Criteria

Migration is complete when:

✓ Browser connects to only one TCP port.

✓ React contains zero hardcoded ports.

✓ No CORS configuration required.

✓ Internal services communicate through interfaces.

✓ Installer checks only one port.

✓ Single firewall rule.

✓ Same codebase deploys to Windows and Linux.

---

# 8. Recommended Implementation Order

Phase 1

* Remove hardcoded frontend URLs.
* Add Vite proxy.

Phase 2

* Embed React into ASP.NET Core.

Phase 3

* Merge WebSocket endpoint.

Phase 4

* Refactor internal HTTP calls into interfaces.

Phase 5

* Add shared telemetry cache.

Phase 6

* Simplify installer and firewall rules.

---

# 9. Long-Term Vision

PULSE Edge should behave as an industrial appliance.

```
Install
    ↓
Service Starts
    ↓
Open Browser
    ↓
http://localhost:5000
```

Everything else is an implementation detail hidden from the user.

Do not remove the existing multi-port code immediately.

Introduce a configuration flag:

{
  "hostingMode": "SinglePort"
}

During development you can still run separate React and API servers, while production builds always package everything into the single-port architecture. This makes the migration much lower risk and allows gradual refactoring.