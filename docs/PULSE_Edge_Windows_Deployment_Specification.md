# Single-Port Deployment Consideration for PULSE Edge

For simplified customer deployments and easier IT approval, the deployment team should consider supporting a single externally exposed TCP port. In this mode, the Web UI, REST API, and WebSocket traffic can be routed through a unified endpoint (for example, via an embedded reverse proxy), reducing the number of firewall exceptions and network configuration steps required at customer sites. Internal services may continue to use separate ports if necessary, but only one inbound port should need to be opened by the customer network administrator.

# PULSE Edge

## Windows Deployment & Installation Specification

**Version:** 1.0
**Target OS:** Windows 10/11 Pro, Windows Server 2019/2022
**Target User:** Factory Technicians, Maintenance Engineers, Automation Engineers

---

# 1. Design Goals

The installation process must:

* Require minimal IT knowledge.
* Guide users through all required setup steps.
* Automatically detect common configuration issues.
* Avoid network port conflicts.
* Configure the Windows Firewall automatically.
* Register and start the Windows Service automatically.
* Verify the installation before completion.
* Require valid digital code signing for `PulseEdgeSetup-x.x.x.exe` and all installed executable binaries.
* Verify the integrity and authenticity of installer packages, configuration files, and downloaded components before execution or use.
* Enforce least-privilege execution by using dedicated service accounts with only the permissions required for operation instead of broad built-in accounts where appropriate.
* Validate configuration data and update artifacts using cryptographic checks to prevent tampering.

A technician should be able to install PULSE Edge by simply clicking:

```
Next -> Next -> Install -> Finish
```

without manually creating services or opening firewall ports.

---

# 2. Installer Package

Single installer executable:

```
PulseEdgeSetup-x.x.x.exe
```

The installer executable must be digitally code signed using a trusted certificate. Before execution, Windows Authenticode signature validation must succeed, and the installer must verify the integrity and signature status of all embedded payloads.

Internally installs:

| Component                   | Purpose                       |
| --------------------------- | ----------------------------- |
| PulseEdge.Service.exe       | Main Windows Service          |
| Web UI (React Static Files) | Local configuration interface |
| SQLite Database             | Store-and-forward buffer      |
| Default Configuration       | Initial settings              |
| Logging Folder              | Runtime logs                  |
| Service Registration        | Windows SCM                   |
| Firewall Rules              | Allow inbound local access    |

All installed executable binaries, libraries, and service components must also be digitally signed and validated during installation. Any downloaded updates or optional components must be authenticated and integrity checked before installation.

---

# 3. Installation Directory Structure

## Program Files

```
C:\Program Files\PULSE Edge\
    PulseEdge.Service.exe
    ui\
    drivers\
    version.json
```

## ProgramData

```
C:\ProgramData\PULSE Edge\
    config.json
    edge.db
    logs\
    backups\
```

This separation allows software upgrades without overwriting customer configuration. Configuration files stored under `ProgramData` must be validated for integrity before being loaded by the application, and unauthorized modifications should be detected and reported.

---

# 4. Installation Wizard Flow

## Step 1 — Welcome

```
Welcome to PULSE Edge Setup

This wizard will install PULSE Edge on your computer.

[Next]
```

---

## Step 2 — System Validation

Automatically check:

| Item                         | Result |
| ---------------------------- | ------ |
| Windows Version              | PASS   |
| Administrator Rights         | PASS   |
| Available Disk Space (>1GB)  | PASS   |
| Write Permission             | PASS   |
| Installer Digital Signature  | PASS   |
| Embedded Component Integrity | PASS   |

If any check fails:

```
❌ Installation cannot continue.

Reason:
Administrator privileges are required.
```

or

```
❌ Installation cannot continue.

Reason:
Installer signature or component integrity validation failed.
```

---

## Step 3 — Select Installation Folder

Default:

```
C:\Program Files\PULSE Edge
```

User may change location.

---

# 5. Network Port Configuration

## Default Ports

| Service                | Default |
| ---------------------- | ------- |
| Local Web UI           | 5000    |
| REST API               | 5001    |
| WebSocket              | 5002    |
| MQTT Broker (optional) | 1883    |

---

## Automatic Port Conflict Detection

Installer scans active TCP listeners.

Example:

```
Checking network ports...

✓ Port 5000 Available
✓ Port 5001 Available
✗ Port 5002 Already In Use

Detected Process:
node.exe
PID: 4216

Please select another port.
```

User sees:

| Service   | Default | New Value |
| --------- | ------- | --------- |
| Web UI    | 5000    | 5000      |
| API       | 5001    | 5001      |
| WebSocket | 5002    | [ 6002 ]  |

Buttons:

```
[Auto Assign Free Ports]

or

[Use My Values]
```

---

## Auto Assign Algorithm

For each required port:

```
Try configured port
    ↓
If occupied:
    Increment by 1
    Check again
    Repeat until free
```

Example:

```
5002 occupied
5003 occupied
5004 free

Assigned:
WebSocket = 5004
```

Configuration is automatically written into:

```
config.json
```

The generated configuration must be validated before being committed to disk, and the application must verify its integrity before loading it at runtime.

---

# 6. Firewall Configuration

Installer automatically creates Windows Firewall rules.

Allow:

```
PulseEdge.Service.exe
```

Protocols:

* TCP
* Local Network Only

Optional checkbox:

```
☑ Allow remote access from other computers
```

If unchecked:

Only localhost connections allowed.

---

# 7. Windows Service Installation

Installer performs:

```
sc create PulseEdgeService
sc failure PulseEdgeService
sc start PulseEdgeService
```

Service properties:

| Property      | Value                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Startup Type  | Automatic                                                                                                                              |
| Delayed Start | Enabled                                                                                                                                |
| Recovery      | Restart                                                                                                                                |
| Run As        | Dedicated least-privilege service account (preferred) or the most restrictive built-in account that satisfies operational requirements |

The installer must create or configure a dedicated service account with only the permissions necessary to access application files, configuration, logs, and network resources. Use of `LocalService` or more privileged accounts should occur only when technically required and must be explicitly justified.

---

## Failure Recovery

| Failure | Action               |
| ------- | -------------------- |
| First   | Restart after 5 sec  |
| Second  | Restart after 5 sec  |
| Third   | Restart after 30 sec |

---

# 8. Configuration Summary

Before installation:

```
------------------------------------

PULSE Edge Configuration

Install Folder:
C:\Program Files\PULSE Edge

Web UI:
http://localhost:5000

REST API:
5001

WebSocket:
5004

Store Database:
C:\ProgramData\PULSE Edge\edge.db

Windows Service:
PulseEdgeService

------------------------------------

[Install]
```

---

# 9. Post Installation Verification

Installer performs health checks.

## Service Running

```
✓ Windows Service Started
```

## HTTP API

```
GET http://localhost:5001/health

Response:
{
    "status":"healthy"
}

✓ PASS
```

## SQLite

```
✓ Database Created
```

## Logging

```
✓ Log Folder Writable
```

## Firewall

```
✓ Firewall Rule Installed
```

## Security Validation

```
✓ Installed Binary Signatures Verified
✓ Configuration Integrity Verified
✓ Downloaded Components Authenticated
```

---

# 10. Installation Complete

```
✓ PULSE Edge Installed Successfully

Web UI:
http://localhost:5000

Service:
Running

Version:
1.0.0
```

Options:

```
☑ Open Configuration UI

☑ Create Desktop Shortcut

[Finish]
```

---

# 11. Uninstall

Removing PULSE Edge should:

* Stop service
* Remove service registration
* Remove firewall rules
* Remove application files

User option:

```
☑ Remove configuration and database

(Default: unchecked)
```

This prevents accidental data loss.

---

# 12. Upgrade Behavior

When installing a newer version:

```
Existing installation detected.

Version:
1.0.2

New Version:
1.1.0

Configuration and database will be preserved.

[Upgrade]
```

Upgrade process:

```
Stop Service
↓
Verify package signature and integrity
↓
Replace binaries
↓
Run database migration
↓
Validate configuration
↓
Start Service
↓
Health Check
```

All upgrade packages and downloaded components must be digitally signed and cryptographically verified before installation proceeds.

---

# 13. Recommended Technical Implementation

## Installer Framework

Recommended:

**Inno Setup**

Reasons:

* Free
* Single EXE output
* Can execute PowerShell
* Can check ports
* Can modify JSON config
* Can register Windows Services
* Widely used and easy to maintain
* Supports integration with code-signing workflows

All release artifacts should be signed as part of the build pipeline, and installer logic should validate signatures and checksums before executing embedded or downloaded content.

---

## Port Detection Script

Installer executes:

```powershell
Get-NetTCPConnection -State Listen |
Select LocalPort,OwningProcess
```

or internally:

```csharp
IPGlobalProperties.GetIPGlobalProperties()
    .GetActiveTcpListeners();
```

---

# 14. Future Enhancement (Recommended)

Add a pre-install diagnostics page:

```
--------------------------------
PULSE Edge System Check
--------------------------------

✓ Windows Supported
✓ Administrator Rights
✓ .NET Runtime Ready
✓ Ports Available
✓ Firewall Accessible
✓ SQLite Writable
✓ Internet Connection
✓ Installer Signature Valid
✓ Component Integrity Verified

Overall Status:

READY TO INSTALL

--------------------------------
```

This gives non-IT technicians confidence that the system is correctly configured before installation begins.

---

# 15. Overall User Experience Goal

The installer should feel similar to installing software like:

* Kepware KEPServerEX
* FactoryTalk Linx
* Ignition Edge
* Node-RED Desktop

where the user never needs to manually:

* create Windows services,
* edit firewall rules,
* resolve port conflicts,
* create folders,
* configure startup behavior,
* or edit configuration files.

At the same time, the installation process must transparently enforce modern security controls, including digital code signing, integrity verification, least-privilege service execution, and secure validation of configuration and downloaded components to prevent tampering.
