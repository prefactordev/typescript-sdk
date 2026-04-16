param(
  [Parameter(Position = 0)]
  [string]$Release = "stable"
)

$ErrorActionPreference = "Stop"

function Resolve-Channel {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -eq "stable") { return "stable" }
  if ($Value -eq "latest") { return "latest" }
  if ($Value -match '^v?\d+\.\d+\.\d+$') { return "pinned" }

  throw "Unsupported release selector '$Value'. Use stable, latest, or a semver like 0.0.4."
}

function Normalize-Version {
  param([string]$Value)

  if ($Value.StartsWith('v')) { return $Value }
  return "v$Value"
}

function Resolve-Arch {
  if ($env:PREFACTOR_INSTALL_TEST_ARCH) {
    switch ($env:PREFACTOR_INSTALL_TEST_ARCH) {
      "arm64" { return "arm64" }
      "x64" { return "x64" }
      default { throw "Unsupported architecture: $($env:PREFACTOR_INSTALL_TEST_ARCH)" }
    }
  }

  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default { throw "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
  }
}

function Invoke-Download {
  param(
    [string]$Url,
    [string]$Output
  )

  Invoke-WebRequest -Uri $Url -OutFile $Output
}

function Read-Checksum {
  param(
    [string]$ChecksumPath,
    [string]$AssetName
  )

  foreach ($line in Get-Content -Path $ChecksumPath) {
    if ($line -match '^([a-fA-F0-9]{64})\s+\*?(.+)$' -and $Matches[2] -eq $AssetName) {
      return $Matches[1].ToLowerInvariant()
    }
  }

  throw "No checksum entry found for $AssetName."
}

function Verify-Checksum {
  param(
    [string]$AssetPath,
    [string]$ChecksumPath,
    [string]$AssetName
  )

  $expected = Read-Checksum -ChecksumPath $ChecksumPath -AssetName $AssetName
  $actual = (Get-FileHash -Path $AssetPath -Algorithm SHA256).Hash.ToLowerInvariant()

  if ($expected -ne $actual) {
    throw "Checksum mismatch for $AssetName."
  }
}

if ($Release -eq "--help" -or $Release -eq "-h") {
  Write-Host "Install the Prefactor CLI from GitHub Releases."
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  ./scripts/install.ps1 [stable|latest|<version>]"
  exit 0
}

$channel = Resolve-Channel -Value $Release
$requestedVersion = $null
if ($channel -eq "pinned") {
  $requestedVersion = Normalize-Version -Value $Release
}

$arch = Resolve-Arch
$assetName = "prefactor-windows-$arch.zip"

$baseUrl = if ($env:PREFACTOR_RELEASE_BASE_URL) { $env:PREFACTOR_RELEASE_BASE_URL } else { "https://github.com/prefactordev/typescript-sdk/releases/download" }
$latestBaseUrl = if ($env:PREFACTOR_RELEASE_LATEST_BASE_URL) { $env:PREFACTOR_RELEASE_LATEST_BASE_URL } else { "https://github.com/prefactordev/typescript-sdk/releases/latest/download" }

$resolvedTag = $null
switch ($channel) {
  "stable" {
    $assetUrl = "$latestBaseUrl/$assetName"
    $checksumUrl = "$latestBaseUrl/SHA256SUMS"
  }
  "latest" {
    $assetUrl = "$baseUrl/canary/$assetName"
    $checksumUrl = "$baseUrl/canary/SHA256SUMS"
    $resolvedTag = "canary"
  }
  "pinned" {
    $assetUrl = "$baseUrl/$requestedVersion/$assetName"
    $checksumUrl = "$baseUrl/$requestedVersion/SHA256SUMS"
    $resolvedTag = $requestedVersion
  }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("prefactor-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null

try {
  $archivePath = Join-Path $tempRoot $assetName
  $checksumPath = Join-Path $tempRoot "SHA256SUMS"
  $extractDir = Join-Path $tempRoot "extracted"

  New-Item -ItemType Directory -Path $extractDir | Out-Null

  Write-Host "==> Downloading $assetName"
  Invoke-Download -Url $assetUrl -Output $archivePath
  Invoke-Download -Url $checksumUrl -Output $checksumPath
  Verify-Checksum -AssetPath $archivePath -ChecksumPath $checksumPath -AssetName $assetName

  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
  $binaryPath = Join-Path $extractDir "prefactor.exe"
  if (-not (Test-Path -LiteralPath $binaryPath)) {
    throw "Expected extracted binary at $binaryPath"
  }

  $installArgs = @("install")
  if ($channel -eq "pinned") {
    $installArgs += @("--version", $requestedVersion)
  } else {
    $installArgs += @("--channel", $channel)
  }
  if ($resolvedTag) {
    $installArgs += @("--resolved-tag", $resolvedTag)
  }
  $installArgs += @("--asset-name", $assetName)

  if ($env:PREFACTOR_INSTALL_TEST_CAPTURE_ARGS) {
    Set-Content -LiteralPath $env:PREFACTOR_INSTALL_TEST_CAPTURE_ARGS -Value ($installArgs -join "`n")
    return
  }

  Write-Host "==> Running installer"
  & $binaryPath @installArgs
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
