# sync-dose-images.ps1
# Copies updated Dose character images from THE_DOSE/assets into etl-lab-push/agents/
# Run this any time a Dose image is updated. It commits and pushes automatically.
#
# Usage: .\scripts\sync-dose-images.ps1

$src  = "C:\Users\w001txo\Desktop\ETL Lab\THE_DOSE\assets"
$repo = "C:\Users\w001txo\Desktop\ETL Lab\etl-lab-push"
$dst  = "$repo\agents"

# Images to skip (old versions superseded by named replacements)
$skip = @("Henry_eyes_open_v2.png", "gardner_eyes_open.png")

$exts   = @("*.png","*.jpg","*.jpeg","*.webp")
$copied = @()

foreach ($ext in $exts) {
    Get-ChildItem -Path $src -Filter $ext -File |
    Where-Object { $_.Name -notin $skip } |
    ForEach-Object {
        Copy-Item $_.FullName (Join-Path $dst $_.Name) -Force
        $copied += $_.Name
    }
}

if ($copied.Count -eq 0) {
    Write-Output "No image files found in $src"
    exit 0
}

Write-Output "Copied $($copied.Count) files:"
$copied | Sort-Object | ForEach-Object { Write-Output "  $_" }

# Stage, commit, push
git -C $repo add "agents/"
git -C $repo commit -m "Sync Dose images from THE_DOSE/assets ($($copied.Count) files)"
git -C $repo push

Write-Output "`nDone. Netlify will deploy shortly."
