[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$CertificateProfile,
    [string]$ProfilesFile,
    [string]$SdkPath,
    [string]$OutputDirectory
)
. (Join-Path $PSScriptRoot 'Tizen-Common.ps1')
$sdk = Resolve-TunerTizenSdk $SdkPath
$output = Get-TunerOutputDirectory $OutputDirectory
if (-not $ProfilesFile) { $ProfilesFile = $env:TUNER_TIZEN_PROFILES }
if (-not $ProfilesFile) { $ProfilesFile = Join-Path (Get-TunerPrivateSigningDirectory) 'profiles.xml' }
$profilesPath = [System.IO.Path]::GetFullPath($ProfilesFile)
if (-not (Test-Path -LiteralPath $profilesPath -PathType Leaf)) { throw 'Samsung certificate profiles are missing. Create the TV certificate profile first; keep profiles and certificates outside source.' }
[xml]$profiles = [System.IO.File]::ReadAllText($profilesPath)
$matches = @($profiles.SelectNodes("//*[local-name()='profile']") | Where-Object { $_.GetAttribute('name') -eq $CertificateProfile })
if ($matches.Count -ne 1) { throw 'The requested certificate profile does not exist in the private profiles file.' }
Invoke-TunerNative 'node' @((Join-Path $PSScriptRoot 'build.js'), $output)
$build = Get-Content -LiteralPath (Join-Path $output 'build.json') -Raw | ConvertFrom-Json
# Samsung's Windows batch wrapper requires a quoted key=value argument even without spaces.
Invoke-TunerNative $sdk.Cli @('cli-config', '-g', ('"default.profiles.path=' + $profilesPath + '"'))
$signedDirectory = Join-Path $output ('signed-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $signedDirectory | Out-Null
Invoke-TunerNative $sdk.Cli @('package', '-t', 'wgt', '-s', $CertificateProfile, '-o', $signedDirectory, '--', $build.staging)
$packages = @(Get-ChildItem -LiteralPath $signedDirectory -File -Filter '*.wgt')
if ($packages.Count -ne 1) { throw 'Samsung CLI did not produce exactly one signed widget.' }
$signedWidget = Join-Path $output ('Tuner-' + $build.version + '-tizen.wgt')
Copy-Item -LiteralPath $packages[0].FullName -Destination $signedWidget
Invoke-TunerNative 'node' @((Join-Path $PSScriptRoot 'check.js'), '--signed', $signedWidget)
Write-Output "Signed widget prepared: $signedWidget. Installation still requires this TV's DUID in the Samsung distributor certificate."
