<#
.SYNOPSIS
  Builds the module zip and release manifest, and optionally publishes them as a GitHub release.

.DESCRIPTION
  Reads the version from module.json, points its download link at that version's release, and writes
  dist/module.json and dist/module.zip. With -Publish, creates release v<version> on GitHub with both files, so the
  manifest link (releases/latest/download/module.json) serves the new version to Foundry and The Forge.

.EXAMPLE
  ./tools/release.ps1            # build only, to check the zip
  ./tools/release.ps1 -Publish   # build and publish
#>
param([switch]$Publish)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "stage"

$manifest = Get-Content (Join-Path $root "module.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"
$repo = $manifest.url -replace '^https://github.com/', ''
$manifest.download = "https://github.com/$repo/releases/download/$tag/module.zip"

# Stage exactly what Foundry needs: no tooling, git or build output.
Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
foreach ($item in "scripts", "styles", "templates", "lang", "README.md", "LICENSE") {
  Copy-Item (Join-Path $root $item) -Destination $stage -Recurse
}
$json = $manifest | ConvertTo-Json -Depth 10
Set-Content -Path (Join-Path $stage "module.json") -Value $json -Encoding utf8NoBOM
Set-Content -Path (Join-Path $dist "module.json") -Value $json -Encoding utf8NoBOM

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath (Join-Path $dist "module.zip")
Remove-Item $stage -Recurse -Force
Write-Host "Built $tag in $dist"

if ($Publish) {
  gh release create $tag (Join-Path $dist "module.zip") (Join-Path $dist "module.json") `
    --repo $repo --title "$($manifest.title) $version" --generate-notes
  Write-Host "Published $tag. Manifest: $($manifest.manifest)"
}
