param(
    [string]$SdkPath,
    [string]$WorkspacePath,
    [string]$JavaPath,
    [switch]$Hidden
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Tizen-Common.ps1')
$sdk = Resolve-TunerTizenSdk -SdkPath $SdkPath
$manager = Join-Path $sdk.Root 'tools/certificate-manager/eclipse.exe'
if (-not (Test-Path -LiteralPath $manager -PathType Leaf)) {
    throw 'The standalone Certificate Manager is missing from this SDK.'
}
if (-not $JavaPath) { $JavaPath = Join-Path $sdk.Root 'jdk/bin/javaw.exe' }
$javaw = [System.IO.Path]::GetFullPath($JavaPath)
$java = Join-Path (Split-Path -Parent $javaw) 'java.exe'
if (-not (Test-Path -LiteralPath $javaw -PathType Leaf) -or -not (Test-Path -LiteralPath $java -PathType Leaf)) {
    throw 'The Certificate Manager needs the x64 Java 8 runtime bundled with this SDK.'
}
$previousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $runtimeInfo = & $java -XshowSettings:properties -version 2>&1 | Out-String
    $runtimeExitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPreference }
if ($runtimeExitCode -ne 0 -or $runtimeInfo -notmatch 'java\.specification\.version\s*=\s*1\.8\b') {
    throw 'This standalone Certificate Manager requires Java 8. Use its bundled x64 runtime or specify -JavaPath.'
}
if (-not $WorkspacePath) { $WorkspacePath = Join-Path (Get-TunerPrivateSigningDirectory) 'workspace' }
$workspace = [System.IO.Path]::GetFullPath($WorkspacePath)
[System.IO.Directory]::CreateDirectory($workspace) | Out-Null
# Explicit VM arguments replace the legacy Eclipse defaults, which mix incompatible Java flags.
$managerArguments = @(
    '-nosplash', '-vm', ('"' + $javaw + '"'),
    '-data', ('"' + $workspace + '"'),
    '-vmargs', '-Dfile.encoding=UTF-8', '-Xms128m', '-Xmx512m'
)
$windowStyle = if ($Hidden) { 'Hidden' } else { 'Normal' }
$process = Start-Process -FilePath $manager -ArgumentList $managerArguments `
    -WorkingDirectory (Split-Path -Parent $manager) -WindowStyle $windowStyle -PassThru
Write-Host "Certificate Manager started (process $($process.Id))."
Write-Host 'Create a Samsung TV profile and sign in using the Samsung account window.'
