Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TunerRepositoryRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
}

function Get-TunerPrivateSigningDirectory {
    return Join-Path (Get-TunerRepositoryRoot) 'signing/tizen'
}

function Resolve-TunerTizenSdk {
    param([string]$SdkPath)
    if (-not $SdkPath) { $SdkPath = $env:TIZEN_SDK }
    if (-not $SdkPath) { $SdkPath = Join-Path (Get-TunerRepositoryRoot) 'output/tools/tizen/sdk' }
    $resolved = [System.IO.Path]::GetFullPath($SdkPath)
    $cli = Join-Path $resolved 'tools/ide/bin/tizen.bat'
    $sdb = Join-Path $resolved 'tools/sdb.exe'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf) -or -not (Test-Path -LiteralPath $sdb -PathType Leaf)) {
        throw "Tizen Web CLI/SDB are missing. Set -SdkPath or TIZEN_SDK to the installed SDK directory."
    }
    return @{ Root = $resolved; Cli = $cli; Sdb = $sdb }
}

function Invoke-TunerNative {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Tizen tool failed with exit code $LASTEXITCODE." }
}

function Get-TunerOutputDirectory {
    param([string]$OutputDirectory)
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Get-TunerRepositoryRoot) 'output/tizen' }
    return [System.IO.Path]::GetFullPath($OutputDirectory)
}
