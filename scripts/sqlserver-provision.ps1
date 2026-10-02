param(
  [string]$Server = 'localhost',
  [string]$Database = 'master',
  [string]$User,
  [string]$Password,
  [switch]$IntegratedSecurity
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$schema = Join-Path $root 'database/sqlserver/001_schema.sql'
$seed = Join-Path $root 'database/sqlserver/002_seed.sql'
Add-Type -AssemblyName System.Data
if ($IntegratedSecurity -or [string]::IsNullOrWhiteSpace($User)) {
  $cs = "Server=$Server;Database=$Database;Integrated Security=True;Encrypt=False;TrustServerCertificate=True;"
} else {
  $cs = "Server=$Server;Database=$Database;User ID=$User;Password=$Password;Encrypt=False;TrustServerCertificate=True;"
}
function Invoke-SqlFile([string]$path) {
  $connection = New-Object System.Data.SqlClient.SqlConnection $cs
  try {
    $connection.Open()
    $batches = ((Get-Content -Raw -LiteralPath $path) -split '(?im)^\s*GO\s*(?:--.*)?$') | Where-Object { $_.Trim() }
    foreach ($batch in $batches) {
      $command = $connection.CreateCommand()
      $command.CommandTimeout = 120
      $command.CommandText = $batch
      [void]$command.ExecuteNonQuery()
      $command.Dispose()
    }
  } finally { $connection.Dispose() }
}
Invoke-SqlFile $schema
Invoke-SqlFile $seed
Write-Output "NeoContract SQL Server schema and seed applied on $Server / NeoContract"
