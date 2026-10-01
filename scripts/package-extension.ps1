$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
node (Join-Path $PSScriptRoot 'package-extension.mjs') $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Extension packaging failed' }
