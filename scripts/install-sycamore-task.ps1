$ErrorActionPreference = "Stop"

$taskName = "GolfWithJim - Sycamore Laptop Publisher"
$stateDirectory = Join-Path $env:LOCALAPPDATA "GolfWithJim"
$runner = Join-Path $stateDirectory "publish-sycamore.mjs"
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe"
}
if (-not (Test-Path -LiteralPath $node)) { throw "Node.js was not found." }
if (-not (Test-Path -LiteralPath "C:\Program Files\Git\cmd\git.exe")) { throw "Git was not found." }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notlike "*$runner*") { throw "An unrelated task uses this name; no changes made." }
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "publish-sycamore.mjs") -Destination $runner -Force
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$daily = New-ScheduledTaskTrigger -Daily -At "06:15"
$repeating = New-ScheduledTaskTrigger -Once -At "06:15" -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 15)
$daily.Repetition = $repeating.Repetition
$signIn = New-ScheduledTaskTrigger -AtLogOn -User $user
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $runner + '"') -WorkingDirectory $stateDirectory
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily, $signIn) -Principal $principal -Settings $settings -Description "Collect and publish Sycamore while signed in, online, and on AC power. Catch up after wake; never wake the laptop." -Force | Out-Null
Write-Output "Installed $taskName. Log/status directory: $stateDirectory"
Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo | Select-Object NextRunTime, LastRunTime, LastTaskResult