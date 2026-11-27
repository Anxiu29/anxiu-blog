param(
  [ValidateSet('doctor','start','stop','status','backup','verify','restore')]
  [string]$Action = 'status',
  [string]$NativeHome = $env:CHRONOFRAME_NATIVE_HOME,
  [string]$BackupPath,
  [string]$TargetPath
)
$ErrorActionPreference = 'Stop'
if (-not $NativeHome) {
  $pointer = Join-Path $PSScriptRoot '../../.local/chronoframe/native-home.txt'
  if (Test-Path -LiteralPath $pointer) { $NativeHome = (Get-Content -LiteralPath $pointer -Raw).Trim() }
}
if (-not $NativeHome) { throw 'Set CHRONOFRAME_NATIVE_HOME or pass -NativeHome; see docs/chronoframe-local.md' }
$operatorScript = Join-Path ([IO.Path]::GetFullPath($NativeHome)) 'manage.ps1'
if (-not (Test-Path -LiteralPath $operatorScript)) { throw 'Native gallery operator script is missing' }
$arguments = @{Action=$Action}
if ($BackupPath) { $arguments.BackupPath=$BackupPath }
if ($TargetPath) { $arguments.TargetPath=$TargetPath }
& $operatorScript @arguments
