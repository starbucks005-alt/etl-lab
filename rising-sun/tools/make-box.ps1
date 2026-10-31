# make-box.ps1: sets up one companion box, or one lid screen, from start to finish. 2026-10-31, for Dr. O.
#
# What it does: asks a few questions, downloads the Arduino command line tool and the board files the first time only,
# builds the sketch with the right settings (it sets the Partition Scheme and PSRAM itself, so the wake word model always goes on),
# uploads it to the board, then listens for ten seconds and tells you what the board said.
#
# Run it from the downloaded etl-lab folder: double-click make-box.bat in rising-sun\tools.
# "-DryRun" builds but does not upload. NOT TRIED on Windows yet; the commands it runs were tried on another computer.
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$root     = Join-Path $env:USERPROFILE 'ETL-Box'
$cliDir   = Join-Path $root 'arduino-cli'
$cli      = Join-Path $cliDir 'arduino-cli.exe'
$settings = Join-Path $root 'settings.json'
$env:ARDUINO_DIRECTORIES_DATA = Join-Path $root 'arduino-data'
$env:ARDUINO_DIRECTORIES_USER = Join-Path $root 'arduino-user'
New-Item -ItemType Directory -Force -Path $root | Out-Null

function Say($t)  { Write-Host $t }
function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Stop-Here($t) { Write-Host ''; Write-Host $t -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function Ask($question, $default) {
  if ($default) { $a = Read-Host "$question [$default]" } else { $a = Read-Host $question }
  if ([string]::IsNullOrWhiteSpace($a)) { return $default }
  return $a.Trim()
}
# Runs the command line tool, shows what it says, returns its exit code.
function Run-Cli {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $cli @args 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $old
  return $code
}
function Cpp-Text($s) { return ($s -replace '\\', '\\' -replace '"', '\"') }

Say ''
Say 'Companion box setup'
Say '-------------------'

# 1. which kind
Say '1 = a companion box (the audio board with the speaker)'
Say '2 = a screen for the lid (the small Waveshare screen)'
$kind = Ask 'Which one are you setting up? (1 or 2)' '1'
if ($kind -eq '1') {
  $sketchName = 'box-chat'
  $fqbn = 'esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=esp_sr_16,PSRAM=opi'
  $needLibs = @()
} elseif ($kind -eq '2') {
  $sketchName = 'box-screen'
  $fqbn = 'esp32:esp32:esp32c6:CDCOnBoot=cdc'
  $needLibs = @('GFX Library for Arduino@1.6.9', 'JPEGDEC@1.8.5')
} else { Stop-Here 'Please answer 1 or 2.' }

$source = Join-Path (Split-Path -Parent $here) $sketchName
if (-not (Test-Path (Join-Path $source "$sketchName.ino"))) {
  Stop-Here "I cannot find $sketchName.ino next to this script (looked in $source). Run this from inside the downloaded etl-lab folder, in rising-sun\tools."
}

# 2. the questions
$saved = @{}
if (Test-Path $settings) { try { (Get-Content $settings -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $saved[$_.Name] = $_.Value } } catch {} }
Step 'A few questions (your answers are kept on this computer only)'
$name = Ask 'A short name for this box (letters, numbers or a dash, like desk or kitchen)' $(if ($saved.lastName) { $saved.lastName } else { 'main' })
$name = $name.ToLower()
if ($name -notmatch '^[a-z0-9-]{1,20}$') { Stop-Here 'The name can only use letters, numbers and a dash, up to 20 characters.' }
$wifi = Ask 'Wi-Fi name (it has to be 2.4 GHz)' $saved.wifi
$maskedPw = if ($saved.wifiPassword) { '********' } else { '' }
$pw = Ask 'Wi-Fi password' $maskedPw
if ($pw -eq '********' -and $saved.wifiPassword) { $pw = $saved.wifiPassword }
$maskedKey = if ($saved.key) { '********' } else { '' }
$key = Ask 'The home access code' $maskedKey
if ($key -eq '********' -and $saved.key) { $key = $saved.key }
if (-not $wifi -or -not $pw -or -not $key) { Stop-Here 'I need the Wi-Fi name, the password and the access code.' }
@{ lastName = $name; wifi = $wifi; wifiPassword = $pw; key = $key } | ConvertTo-Json | Set-Content -Encoding UTF8 $settings

# 3. the tools, the first time only
Step 'Checking the tools'
if (-not (Test-Path $cli)) {
  Say 'Downloading the Arduino command line tool (once, a few minutes)...'
  New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
  $zip = Join-Path $root 'arduino-cli.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip' -OutFile $zip } catch { Stop-Here "The download failed: $($_.Exception.Message)" }
  Expand-Archive -Force -Path $zip -DestinationPath $cliDir
  Remove-Item $zip
}
if (-not (Test-Path $cli)) { Stop-Here 'The Arduino tool did not unpack where I expected.' }
Run-Cli config set board_manager.additional_urls 'https://espressif.github.io/arduino-esp32/package_esp32_index.json' | Out-Null
if ((Run-Cli core update-index) -ne 0) { Stop-Here 'Could not update the board list. Check the internet connection and run this again.' }
$old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$cores = & $cli core list 2>&1 | Out-String
$ErrorActionPreference = $old
if ($cores -notmatch 'esp32:esp32\s+3\.2\.0') {
  Say 'Installing the ESP32 board files, version 3.2.0 (once, this is a big download, maybe ten minutes)...'
  if ((Run-Cli core install 'esp32:esp32@3.2.0') -ne 0) { Stop-Here 'The board files did not install. Run this again; it will carry on.' }
}
foreach ($lib in $needLibs) {
  Say "Installing $lib ..."
  if ((Run-Cli lib install $lib) -ne 0) { Stop-Here "Could not install $lib." }
}

# 4. a clean copy with this box's secrets
Step "Building $sketchName for the box named '$name'"
$work = Join-Path $root "build\$name-$sketchName"
$sketchDir = Join-Path $work $sketchName
$buildPath = Join-Path $work 'out'
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $sketchDir | Out-Null
Get-ChildItem $source -File | Where-Object { $_.Name -notin @('secrets.h', 'secrets.h.example', 'README.md') } | Copy-Item -Destination $sketchDir
$secrets = "#define WIFI_NAME      `"$(Cpp-Text $wifi)`"`r`n#define WIFI_PASSWORD  `"$(Cpp-Text $pw)`"`r`n#define BOX_KEY        `"$(Cpp-Text $key)`"`r`n#define BOX_NAME       `"$name`"`r`n"
[IO.File]::WriteAllText((Join-Path $sketchDir 'secrets.h'), $secrets, (New-Object Text.UTF8Encoding($false)))
if ((Run-Cli compile --fqbn $fqbn --build-path $buildPath $sketchDir) -ne 0) { Stop-Here 'The build failed. Copy the red lines above and send them to Claude.' }
Say 'Build ok.'
if ($DryRun) { Say 'Dry run: not uploading.'; Read-Host 'Press Enter to close'; exit 0 }

# 5. the port
Step 'Uploading'
Say 'Close the Arduino IDE Serial Monitor first, and plug the board in with its USB cable.'
if ($kind -eq '2') { Say 'If no port shows up for the screen: unplug it, hold the BOOT button, plug it in, then let go.' }
$ports = @()
for ($try = 0; $try -lt 2 -and $ports.Count -eq 0; $try++) {
  $ports = @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
  if ($ports.Count -eq 0) { Read-Host 'I see no board. Plug it in, then press Enter' | Out-Null }
}
if ($ports.Count -eq 0) { Stop-Here 'Still no board found.' }
$port = $ports[0]
if ($ports.Count -gt 1) { Say ('Ports I can see: ' + ($ports -join ', ')); $port = Ask 'Which one is the board?' $ports[-1] }
if ((Run-Cli upload --fqbn $fqbn -p $port --input-dir $buildPath $sketchDir) -ne 0) { Stop-Here "The upload failed. Is the Serial Monitor closed? Unplug the board, plug it back in and run this again." }
Say 'Upload ok.'

# 6. listen for ten seconds
Step 'Listening to the board for ten seconds'
$heard = ''
try {
  Start-Sleep -Seconds 3
  $sp = New-Object System.IO.Ports.SerialPort $port, 115200
  $sp.ReadTimeout = 500
  $sp.Open()
  $end = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $end) { try { $l = $sp.ReadLine(); Write-Host $l; $heard += $l + "`n" } catch [TimeoutException] {} }
  $sp.Close()
} catch { Say "(I could not listen: $($_.Exception.Message). That does not mean it failed. Open the Serial Monitor at 115200 to look.)" }

Say ''
if ($kind -eq '1') {
  if ($heard -match 'Wake word engine: ok') { Write-Host 'Wake word engine: ok.' -ForegroundColor Green } else { Say 'I did not see "Wake word engine: ok". Look at the lines above.' }
  if ($heard -match 'Wi-Fi: joined') { Say 'Wi-Fi: joined.' } else { Say 'I did not see "Wi-Fi: joined". Check the name and password, and that the network is 2.4 GHz.' }
} else {
  if ($heard -match 'Wi-Fi joined') { Say 'Wi-Fi: joined.' } else { Say 'I did not see "Wi-Fi joined". Did the screen flash red, green and blue? Check the name and password.' }
}
Say ''
Say "Done. This box is named '$name'. Open https://emerging-tech-lab.com/rising-sun/box-panel.html and pick '$name' to choose its companion."
Read-Host 'Press Enter to close'
