[CmdletBinding()]
param([System.Net.IPAddress[]]$KnownAddress)
$ErrorActionPreference = 'Stop'
if ($KnownAddress) { $addresses = @($KnownAddress | ForEach-Object { $_.IPAddressToString }) }
else {
    $addresses = @(Get-NetNeighbor -AddressFamily IPv4 | Where-Object {
        $_.State -notin @('Unreachable', 'Incomplete') -and $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.IPAddress -notmatch '\.(0|255)$'
    } | Select-Object -ExpandProperty IPAddress -Unique | Select-Object -First 24)
}
& node (Join-Path $PSScriptRoot 'discover.js') @addresses
if ($LASTEXITCODE -ne 0) { throw 'Read-only TV discovery failed.' }
