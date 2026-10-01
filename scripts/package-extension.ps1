$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionFiles = @('manifest.json','background.js','page-reader.js','login.js','content.js','popup.html','popup.js','options.html','options.js','INSTALL.txt')
$inputPaths = $extensionFiles | ForEach-Object { Join-Path $projectRoot "extension/$_" }
foreach ($inputPath in $inputPaths) { if (-not (Test-Path -LiteralPath $inputPath)) { throw "Missing extension file: $inputPath" } }
$zipPath = Join-Path $projectRoot 'src/web/public/lead-radar-extension.zip'
Compress-Archive -LiteralPath $inputPaths -DestinationPath $zipPath -Force
Write-Output "Extension package ready: $zipPath"
