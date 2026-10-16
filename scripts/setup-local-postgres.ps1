#Requires -RunAsAdministrator
<#
  One-off local development setup for the native PostgreSQL 18 Windows service.

  - Resets the forgotten `postgres` superuser password by briefly trusting local
    connections for that user only, then always restores the original pg_hba.conf.
  - Creates (or updates) the `mtrs` role and the `mtrs` / `mtrs_test` databases.
  - Writes DATABASE_URL and E2E_DATABASE_URL into apps/api/.env.

  Passwords are prompted for and never stored in this file. Nothing is dropped.
#>
param(
  [string]$PgRoot = 'C:\Program Files\PostgreSQL\18',
  [string]$ServiceName = 'postgresql-x64-18',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgRoot 'bin\psql.exe'
$hba = Join-Path $PgRoot 'data\pg_hba.conf'
$envFile = Join-Path $PSScriptRoot '..\apps\api\.env'

function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Psql([string]$Sql) {
  $Sql | & $psql -U postgres -h 127.0.0.1 -p $Port -d postgres -v ON_ERROR_STOP=1 -q
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
}

foreach ($path in @($psql, $hba)) {
  if (-not (Test-Path $path)) { throw "Not found: $path" }
}

$postgresPassword = Read-Secret 'New password for the postgres superuser'
$mtrsPassword = Read-Secret 'Password for the mtrs application role'
if ($postgresPassword.Length -lt 8 -or $mtrsPassword.Length -lt 8) {
  throw 'Use passwords of at least 8 characters.'
}
$pgLiteral = $postgresPassword.Replace("'", "''")
$mtrsLiteral = $mtrsPassword.Replace("'", "''")

$backup = "$hba.bak-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $hba $backup
Write-Host "Backed up pg_hba.conf to $backup"

try {
  $trust = [Text.Encoding]::ASCII.GetBytes(
    "host all postgres 127.0.0.1/32 trust`r`nhost all postgres ::1/128 trust`r`n")
  [IO.File]::WriteAllBytes($hba, $trust + [IO.File]::ReadAllBytes($backup))
  Restart-Service $ServiceName
  Start-Sleep -Seconds 2

  $sql = @'
ALTER ROLE postgres WITH PASSWORD '__PG__';
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mtrs') THEN
    CREATE ROLE mtrs LOGIN CREATEDB;
  END IF;
END
$$;
ALTER ROLE mtrs WITH LOGIN CREATEDB PASSWORD '__MTRS__';
SELECT 'CREATE DATABASE mtrs OWNER mtrs' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mtrs')\gexec
SELECT 'CREATE DATABASE mtrs_test OWNER mtrs' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mtrs_test')\gexec
'@.Replace('__PG__', $pgLiteral).Replace('__MTRS__', $mtrsLiteral)
  Invoke-Psql $sql
  Write-Host 'postgres password reset; role mtrs and databases mtrs, mtrs_test are ready.'
}
finally {
  Copy-Item $backup $hba -Force
  Restart-Service $ServiceName
  Write-Host 'Original pg_hba.conf restored (password authentication is back on).'
}

$encoded = [Uri]::EscapeDataString($mtrsPassword)
$urls = [ordered]@{
  DATABASE_URL     = "postgresql://mtrs:$encoded@localhost:$Port/mtrs?schema=public"
  E2E_DATABASE_URL = "postgresql://mtrs:$encoded@localhost:$Port/mtrs_test?schema=public"
}
$lines = if (Test-Path $envFile) { [Collections.Generic.List[string]](Get-Content $envFile) } else { [Collections.Generic.List[string]]::new() }
foreach ($key in $urls.Keys) {
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$key\s*=") { $index = $i; break }
  }
  $entry = "$key=$($urls[$key])"
  if ($index -ge 0) { $lines[$index] = $entry } else { $lines.Add($entry) }
}
[IO.File]::WriteAllLines((Resolve-Path -LiteralPath (Split-Path $envFile)).Path + '\.env', $lines, [Text.UTF8Encoding]::new($false))
Write-Host 'apps/api/.env updated with DATABASE_URL and E2E_DATABASE_URL.'
