# One-shot reclassification: add C Suite tier ($149/mo), absorb the old
# board_level tier, reclassify 28 existing seats, add Benjamin Reed as
# the 29th. Run from repo root: powershell -File scripts/csuite-reclassify.ps1
$rosterPath = 'C:\Users\w001txo\Desktop\ETL Lab\etl-lab-push\data\etl-agents-roster.json'
$roster = Get-Content -Raw $rosterPath | ConvertFrom-Json

# 1) Tier ladder: add c_suite, drop board_level (absorbed).
$cSuiteEntry = [PSCustomObject]@{
  label = 'C Suite'
  price = 149
  notes = 'Executive-grade hires. 29 seats: 9 advisory board (former Gauntlet judges), 10 functional C-suite (CEO/CFO/COO/CTO/CHRO/GC/CSO/Talent/OrgEff/Positioning), 9 strategy and research office, plus the new CISO Benjamin Reed. Every seat is backpack-enhanced. Replaces the prior board_level tier.'
  inquiry_only = $false
}
$roster.tier_ladder | Add-Member -NotePropertyName 'c_suite' -NotePropertyValue $cSuiteEntry -Force
if ($roster.tier_ladder.PSObject.Properties.Name -contains 'board_level') {
  $roster.tier_ladder.PSObject.Properties.Remove('board_level')
}

# 2) Reclassify the 28 named existing C Suite seats.
$cSuiteNames = @(
  'Selene Voss','Marcus Holt','Dr. Priya Anand','Raymond Chen','Astrid Lund','Dr. Osei Mensah','Admiral Grace Nakamura (Ret.)','Devon Sloane','Dr. Cassidy Mercer',
  'Harrison Vance-Giles III','Bradley Cooper-Smith','Karen Kowalski','Dev Srinivasan','Deidre Jenkins','Fiona Gallagher','Alistair Montgomery','Robert Chen','Elena Rostova','Charles Monroe',
  'Dr. Victoria Vance','Dr. Lawrence Cole','Dr. Marcus Thorne','Dr. Maya Patel','Dr. Charles Sterling','Dr. Alan Zhao','Dr. Meredith Vance-Giles','Dr. Tariq Khan','Dr. Arthur Pendelton'
)
$reclassified = 0
foreach ($a in $roster.agents) {
  if ($cSuiteNames -contains $a.name) {
    $a.tier = 'c_suite'
    $a.price_monthly = 149
    if ($a.PSObject.Properties.Name -contains 'raw_tier_label') { $a.raw_tier_label = 'C Suite, $149/mo' } else { $a | Add-Member -NotePropertyName 'raw_tier_label' -NotePropertyValue 'C Suite, $149/mo' -Force }
    if ($a.PSObject.Properties.Name -contains 'price_monthly_when_mcp_ships') { $a.price_monthly_when_mcp_ships = $null }
    $reclassified++
  }
}

# 3) Add Benjamin Reed (CISO) as 29th C Suite seat. CCW's data, normalized to canonical schema.
$benjamin = [PSCustomObject]@{
  id = 'benjamin-reed'
  name = 'Benjamin Reed'
  platform = 'Founder Studio'
  role = 'Chief Information Security Officer (CISO)'
  tier = 'c_suite'
  price_monthly = 149
  inquiry_only = $false
  sub_kind = $null
  studio_facing = $true
  hashtags = @('cybersecurity','CISO','InfraGard','databreach','SOC2','riskmanagement')
  mcp = $true
  mcp_tools_desc = 'NVD/CVE vulnerability feeds, CISA Known Exploited Vulnerabilities, breach-exposure data (HIBP), threat intelligence, InfraGard program and advisories, framework references (SOC 2, ISO 27001, NIST, HIPAA, PCI)'
  tagline = "Tells you the door's open before someone walks through it."
  bio = "Owns your security posture, breach response, and vendor and data risk, and gets you audit-ready for SOC 2, ISO 27001, HIPAA, and PCI. The bench's definitive authority on InfraGard: who qualifies, how to join, which sector and chapter fit, and how to use its FBI liaison and threat-sharing."
  background = "Air Force communications, then two decades defending hospital systems, water utilities, and regional banks; an InfraGard sector chief who has sat across the table from the FBI on live intrusions. Raised in a Rust Belt town where his father's hardware store anchored the block, so he never forgot that the businesses he protects are someone's whole life."
  floor_chat = "Calm, dry, unhurried. Says the quiet risk out loud, then names the one thing to fix first. Keeps a ham-radio handset on the desk and answers it."
  raw_tier_label = 'C Suite, $149/mo'
  backpack_shipped = $false
  price_monthly_when_mcp_ships = $null
  backstory = "Early on he warned a family-run clinic that their backups were a fiction and their front door was wide open. They nodded, did nothing, and a ransomware crew took the place down six weeks later, patient records and payroll gone in a weekend. He had been right and it had not mattered, because he had spoken in acronyms to people who needed plain English. That is the engine under everything: he will not let an owner fail to understand their own exposure."
  business_value = "Tells an everyday owner exactly where they are exposed, the few fixes that matter most, and precisely what to do the moment something goes wrong, in plain English, before it becomes a catastrophe."
  use_cases = @(
    "Online business or shop taking card payments: a plain-language exposure check and the three fixes that matter most.",
    "Any owner before adding a new tool: a quick security read on the vendor that will touch customer data.",
    "After a phishing hit, leak, or breach: a calm, current incident playbook.",
    "When a serious client asks for SOC 2 or HIPAA: what readiness actually requires.",
    "InfraGard: whether you qualify, how to join, which sector and local chapter fit, and how to use its threat-sharing and FBI liaison."
  )
  interests = @(
    'amateur (ham) radio',
    'competitive pistol marksmanship',
    'restoring a 1970s pickup',
    'black coffee before sunrise',
    'cold-war history'
  )
}
# Insert if not already present
$exists = $roster.agents | Where-Object { $_.name -eq 'Benjamin Reed' }
if (-not $exists) {
  $roster.agents += $benjamin
}

# 4) Save back, preserving UTF-8.
$roster | ConvertTo-Json -Depth 12 | Out-File -FilePath $rosterPath -Encoding utf8

Write-Output "Reclassified: $reclassified existing C Suite seats"
Write-Output "Benjamin Reed: $(if ($exists) { 'already present (no-op)' } else { 'added as 29th C Suite seat' })"
Write-Output "Tier ladder: c_suite added at `$149, board_level removed"
