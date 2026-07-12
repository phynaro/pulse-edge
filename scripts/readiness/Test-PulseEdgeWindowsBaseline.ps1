[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) ("pulse-edge-g0-" + (Get-Date -Format "yyyyMMdd-HHmmss")))
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$isWindowsPlatform = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
    $IsWindows
} else {
    $env:OS -eq "Windows_NT"
}

function Invoke-EvidenceCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [switch]$NonBlocking
    )

    "COMMAND: $Command $($Arguments -join ' ')" | Set-Content -Path $LogPath -Encoding utf8
    & $Command @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append | Out-Host
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $NonBlocking) {
        throw "$Name failed with exit code $exitCode. See $LogPath"
    }

    return $exitCode
}

$scriptPath = $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path (Split-Path -Parent $scriptPath) "../..")).Path
$solutionPath = Join-Path $repoRoot "Pulse.Edge.slnx"
$uiPath = Join-Path $repoRoot "src/Pulse.Edge.UI"

if (-not $isWindowsPlatform) {
    throw "This validation must run on Windows. Current platform: $([System.Environment]::OSVersion.Platform)"
}

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "G0 requires a Windows x64 environment. This operating system is not 64-bit."
}

foreach ($tool in @("git", "dotnet", "node", "pnpm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Required tool '$tool' was not found on PATH."
    }
}

if (-not (Test-Path $solutionPath)) { throw "Solution not found at $solutionPath" }
if (-not (Test-Path (Join-Path $uiPath "package.json"))) { throw "Frontend package not found at $uiPath" }

Push-Location $repoRoot
try {
    $dirty = & git status --porcelain=v1 --untracked-files=all
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Git status." }
    if ($dirty) {
        throw "The checkout is not clean. Commit or remove all changes before collecting G0 evidence."
    }

    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Unable to resolve the current commit." }

    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $OutputDirectory = (Resolve-Path $OutputDirectory).Path

    $dotnetVersion = (& dotnet --version).Trim()
    $nodeVersion = (& node --version).Trim()
    $pnpmVersion = (& pnpm --version).Trim()
    $os = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $systemDriveName = $env:SystemDrive.TrimEnd(':')
    $systemDrive = Get-PSDrive -Name $systemDriveName
    $capturedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $cleanExit = Invoke-EvidenceCommand -Name "Solution clean" -Command "dotnet" -Arguments @("clean", "Pulse.Edge.slnx", "--nologo") -LogPath (Join-Path $OutputDirectory "01-dotnet-clean.log")
    $restoreExit = Invoke-EvidenceCommand -Name "Solution restore" -Command "dotnet" -Arguments @("restore", "Pulse.Edge.slnx", "--nologo") -LogPath (Join-Path $OutputDirectory "02-dotnet-restore.log")
    $buildExit = Invoke-EvidenceCommand -Name "Solution build" -Command "dotnet" -Arguments @("build", "Pulse.Edge.slnx", "--no-restore", "--nologo") -LogPath (Join-Path $OutputDirectory "03-dotnet-build.log")
    $testExit = Invoke-EvidenceCommand -Name "Backend tests" -Command "dotnet" -Arguments @("test", "src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj", "--no-build", "--no-restore", "--nologo") -LogPath (Join-Path $OutputDirectory "04-dotnet-test.log")
    $auditExit = Invoke-EvidenceCommand -Name "NuGet vulnerability audit" -Command "dotnet" -Arguments @("list", "Pulse.Edge.slnx", "package", "--vulnerable", "--include-transitive") -LogPath (Join-Path $OutputDirectory "05-dotnet-vulnerabilities.log")

    $auditText = Get-Content (Join-Path $OutputDirectory "05-dotnet-vulnerabilities.log") -Raw
    if ($auditText -match "has the following vulnerable packages") {
        throw "The NuGet audit reported vulnerable packages. Review 05-dotnet-vulnerabilities.log."
    }

    $installExit = Invoke-EvidenceCommand -Name "Frozen frontend install" -Command "pnpm" -Arguments @("install", "--frozen-lockfile") -LogPath (Join-Path $OutputDirectory "06-pnpm-install.log")
    $frontendBuildExit = Invoke-EvidenceCommand -Name "Frontend build" -Command "pnpm" -Arguments @("--filter", "pulse-edge-ui", "build") -LogPath (Join-Path $OutputDirectory "07-frontend-build.log")
    $lintExit = Invoke-EvidenceCommand -Name "Frontend lint baseline" -Command "pnpm" -Arguments @("--filter", "pulse-edge-ui", "lint") -LogPath (Join-Path $OutputDirectory "08-frontend-lint.log") -NonBlocking

    $testText = Get-Content (Join-Path $OutputDirectory "04-dotnet-test.log") -Raw
    $testSummary = if ($testText -match "Passed!\s+- Failed:\s+(\d+), Passed:\s+(\d+), Skipped:\s+(\d+), Total:\s+(\d+)") {
        "Failed $($Matches[1]), passed $($Matches[2]), skipped $($Matches[3]), total $($Matches[4])"
    } else {
        "See 04-dotnet-test.log"
    }

    $reportPath = Join-Path $OutputDirectory "G0-Windows-validation.md"
    @"
# PULSE Edge G0 Windows Validation

- Captured UTC: $capturedAt
- Commit: ``$commit``
- Checkout clean before validation: yes
- Operating system: $($os.Caption) $($os.Version)
- OS architecture: $($os.OSArchitecture)
- Logical processors: $($computer.NumberOfLogicalProcessors)
- Total physical memory: $([math]::Round($computer.TotalPhysicalMemory / 1GB, 2)) GiB
- System-drive free space: $([math]::Round($systemDrive.Free / 1GB, 2)) GiB
- .NET SDK: ``$dotnetVersion``
- Node: ``$nodeVersion``
- pnpm: ``$pnpmVersion``

## Required G0 results

| Check | Exit code | Result |
|---|---:|---|
| Solution clean | $cleanExit | Passed |
| Solution restore | $restoreExit | Passed |
| Solution build | $buildExit | Passed |
| Backend tests | $testExit | $testSummary |
| NuGet vulnerability audit | $auditExit | No vulnerable package marker detected |
| Frozen frontend install | $installExit | Passed |
| Frontend production build | $frontendBuildExit | Passed |

## Non-blocking Phase 1 baseline

| Check | Exit code | Interpretation |
|---|---:|---|
| Frontend lint | $lintExit | ``0`` is clean; non-zero remains tracked under R-003/G1 |

## Evidence files

- ``01-dotnet-clean.log``
- ``02-dotnet-restore.log``
- ``03-dotnet-build.log``
- ``04-dotnet-test.log``
- ``05-dotnet-vulnerabilities.log``
- ``06-pnpm-install.log``
- ``07-frontend-build.log``
- ``08-frontend-lint.log``

This report proves clean-checkout build behavior on the recorded Windows environment. It does not by itself certify installer, Windows Service, firewall, protocol-device interoperability, capacity, or update behavior.
"@ | Set-Content -Path $reportPath -Encoding utf8

    Write-Host "G0 Windows validation passed. Evidence: $reportPath"
}
finally {
    Pop-Location
}
