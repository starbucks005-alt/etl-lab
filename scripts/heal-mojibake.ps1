# Reverse-decode cp1252 mojibake (UTF-8 bytes once misread as cp1252) back to real UTF-8.
# Usage: powershell -File heal-mojibake.ps1 -Path <file>
param([Parameter(Mandatory=$true)][string]$Path)

$utf8 = New-Object System.Text.UTF8Encoding $false
$cp = [System.Text.Encoding]::GetEncoding(1252)
$raw = [IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)

# Lead bytes of 2-4 byte UTF-8 sequences, as the cp1252 chars they were misread into.
$lead = '[' + [char]0xC2 + '-' + [char]0xDF + [char]0xE0 + '-' + [char]0xEF + [char]0xF0 + '-' + [char]0xF4 + ']'
# Continuation bytes 0x80-0xBF misread as cp1252: a mix of Latin-1 chars and cp1252 punctuation.
$tail = '[' + [char]0x80 + '-' + [char]0xBF + [char]0x152 + [char]0x153 + [char]0x160 + [char]0x161 + [char]0x178 + [char]0x17D + [char]0x17E + [char]0x192 + [char]0x2C6 + [char]0x2DC + [char]0x2013 + [char]0x2014 + [char]0x2018 + [char]0x2019 + [char]0x201A + [char]0x201C + [char]0x201D + [char]0x201E + [char]0x2020 + [char]0x2021 + [char]0x2022 + [char]0x2026 + [char]0x2030 + [char]0x2039 + [char]0x203A + [char]0x20AC + [char]0x2122 + ']{1,3}'

$script:healed = 0
$script:skipped = 0
$rep = [char]0xFFFD

$result = [regex]::Replace($raw, $lead + $tail, {
  param($m)
  try {
    $bytes = $cp.GetBytes($m.Value)
    $dec = $utf8.GetString($bytes)
    if ($dec.Length -ge 1 -and $dec.IndexOf($rep) -lt 0 -and $dec.Length -lt $m.Value.Length) {
      $script:healed++
      return $dec
    }
  } catch {}
  $script:skipped++
  return $m.Value
})

Write-Output "healed: $($script:healed)  skipped: $($script:skipped)"
$after = ([regex]::Matches($result, [char]0x00C2)).Count
Write-Output "A-circumflex remaining: $after"
if ($script:healed -gt 0) {
  [IO.File]::WriteAllText($Path, $result, $utf8)
  Write-Output "written"
} else {
  Write-Output "nothing healed - file untouched"
}
