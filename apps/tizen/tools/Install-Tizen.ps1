[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][System.Net.IPAddress]$TvAddress,
    [Parameter(Mandatory = $true)][string]$Widget,
    [string]$SdkPath,
    [switch]$Launch
)
. (Join-Path $PSScriptRoot 'Tizen-Common.ps1')
if ($TvAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use the TV IPv4 address on the same local network.' }
$sdk = Resolve-TunerTizenSdk $SdkPath
$widgetPath = (Resolve-Path -LiteralPath $Widget).Path
if ([System.IO.Path]::GetFileName($widgetPath) -match 'UNSIGNED') { throw 'Unsigned staging widgets cannot be installed. Package with a Samsung TV certificate first.' }
Invoke-TunerNative 'node' @((Join-Path $PSScriptRoot 'check.js'), '--signed', $widgetPath)
$client = [System.Net.Sockets.TcpClient]::new()
try {
    $connected = $false
    try {
        $connect = $client.ConnectAsync($TvAddress, 26101)
        $connected = $connect.Wait(2000) -and $client.Connected
    } catch { $connected = $false }
    if (-not $connected) { throw 'TV developer port is closed. Enable Developer Mode, set this PC IPv4 address and restart the TV.' }
} finally { $client.Dispose() }
$serial = "$($TvAddress.IPAddressToString):26101"
Invoke-TunerNative $sdk.Sdb @('connect', $serial)
Invoke-TunerNative $sdk.Cli @('install', '-s', $serial, '--name', [System.IO.Path]::GetFileName($widgetPath), '--', [System.IO.Path]::GetDirectoryName($widgetPath))
if ($Launch) { Invoke-TunerNative $sdk.Cli @('run', '-s', $serial, '-p', 'TunerTv001.Tuner') }
Write-Output 'Samsung CLI installation completed. Verify playback and remote navigation on the TV.'
