Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Cargo {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & cargo @Arguments
        $cargoExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($cargoExitCode -ne 0) {
        throw "cargo exited with code $cargoExitCode."
    }
}

function Invoke-CountedCargoTest {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments,

        [Parameter(Mandatory = $true)]
        [string] $SummaryPattern
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & cargo @Arguments 2>&1
        $cargoExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    foreach ($line in $output) {
        Write-Output ($line.ToString())
    }

    if ($cargoExitCode -ne 0) {
        throw "cargo test exited with code $cargoExitCode."
    }

    $summaryMatches = [regex]::Matches(
        ($output | Out-String),
        $SummaryPattern,
        [System.Text.RegularExpressions.RegexOptions]::Multiline
    )
    if ($summaryMatches.Count -ne 1) {
        throw "cargo test output did not contain exactly one expected summary: $SummaryPattern"
    }
}

$rustcOutput = & rustc --version --verbose 2>&1
$rustcExitCode = $LASTEXITCODE
foreach ($line in $rustcOutput) {
    Write-Output $line
}
if ($rustcExitCode -ne 0) {
    throw "rustc exited with code $rustcExitCode."
}

$rustcText = $rustcOutput | Out-String
if ($rustcText -notmatch '(?m)^release: 1\.97\.0\r?$') {
    throw 'rustc release must be exactly 1.97.0.'
}
if ($rustcText -notmatch '(?m)^host: x86_64-pc-windows-msvc\r?$') {
    throw 'rustc host must be exactly x86_64-pc-windows-msvc.'
}

Invoke-Cargo -Arguments @('--version', '--verbose')

$operatingSystem = Get-CimInstance Win32_OperatingSystem
Write-Output ("OS caption: {0}" -f $operatingSystem.Caption)
Write-Output ("OS version: {0}" -f $operatingSystem.Version)
Write-Output ("OS build: {0}" -f $operatingSystem.BuildNumber)

$portQueryErrors = @()
$listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort 17843 -ErrorAction SilentlyContinue -ErrorVariable portQueryErrors
)
$portQueryFailures = @(
    foreach ($portQueryError in $portQueryErrors) {
        $isNoListenerResult =
            $portQueryError.FullyQualifiedErrorId -eq 'CmdletizationQuery_NotFound,Get-NetTCPConnection' -and
            $portQueryError.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound -and
            $portQueryError.CategoryInfo.TargetName -eq 'MSFT_NetTCPConnection'
        if (-not $isNoListenerResult) {
            $portQueryError
        }
    }
)
if ($portQueryFailures.Count -gt 0) {
    throw 'TCP listener query failed.'
}
if ($listeners.Count -gt 0) {
    throw 'TCP port 17843 is already occupied.'
}

Invoke-CountedCargoTest -Arguments @(
    'test',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--locked',
    '--bin',
    'open-voice-companion',
    'windows_listener::tests::',
    '--',
    '--nocapture'
) -SummaryPattern '^test result: ok\. 2 passed; 0 failed; 0 ignored;'

Invoke-CountedCargoTest -Arguments @(
    'test',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--locked',
    '--bin',
    'open-voice-companion',
    'windows_listener::tests::c9_windows_exclusive_bind_blocks_both_directions_and_maps_both_codes',
    '--',
    '--exact',
    '--test-threads=1',
    '--nocapture'
) -SummaryPattern '^test result: ok\. 1 passed; 0 failed; 0 ignored;'

Invoke-CountedCargoTest -Arguments @(
    'test',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--locked',
    '--bin',
    'open-voice-companion',
    'windows_listener::tests::c9_windows_exclusive_rebind_cycles_and_full_server_shutdowns',
    '--',
    '--exact',
    '--test-threads=1',
    '--nocapture'
) -SummaryPattern '^test result: ok\. 1 passed; 0 failed; 0 ignored;'

Invoke-Cargo -Arguments @(
    'clippy',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--locked',
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings'
)

Invoke-Cargo -Arguments @(
    'check',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--release',
    '--locked',
    '--lib'
)

Invoke-Cargo -Arguments @(
    'test',
    '--manifest-path',
    'apps/companion/src-tauri/Cargo.toml',
    '--locked',
    '--all-targets',
    '--all-features',
    '--',
    '--test-threads=1'
)
