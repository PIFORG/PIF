<#
  Points the API at an existing PostgreSQL database and role.

  - Prompts for the role's password (hidden input); it is never printed or stored in this file.
  - Verifies the credentials with psql before changing anything.
  - Sets DATABASE_URL in apps/api/.env (read by the API and the Prisma CLI) and, when present,
    in the root .env so both copies agree. Other lines are left untouched.

  Usage: powershell -ExecutionPolicy Bypass -File .\scripts\connect-database.ps1
#>
param(
  [string]$Database = 'PIF',
  [string]$User = 'nasma',
  [string]$DbHost = 'localhost',
  [int]$Port = 5432,
  [string]$PgRoot = 'C:\Program Files\PostgreSQL\18'
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgRoot 'bin\psql.exe'
if (-not (Test-Path $psql)) { throw "Not found: $psql" }

$secure = Read-Host "Password for PostgreSQL role '$User'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

$env:PGPASSWORD = $password
$ErrorActionPreference = 'Continue'
try {
  $identity = & $psql -h $DbHost -p $Port -U $User -d $Database -w -t -A -c 'SELECT current_user || '' @ '' || current_database()' 2>&1 | Out-String
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $ErrorActionPreference = 'Stop'
}
$identity = $identity.Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not connect as '$User' to database '$Database': $identity" }
Write-Host "Connected as $identity"

$url = 'postgresql://{0}:{1}@{2}:{3}/{4}?schema=public' -f [Uri]::EscapeDataString($User), [Uri]::EscapeDataString($password), $DbHost, $Port, [Uri]::EscapeDataString($Database)

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')
$targets = @((Join-Path $root 'apps\api\.env'))
if (Test-Path (Join-Path $root '.env')) { $targets += (Join-Path $root '.env') }

foreach ($file in $targets) {
  $lines = if (Test-Path $file) { [Collections.Generic.List[string]](Get-Content $file) } else { [Collections.Generic.List[string]]::new() }
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*DATABASE_URL\s*=') { $index = $i; break }
  }
  if ($index -ge 0) { $lines[$index] = "DATABASE_URL=$url" } else { $lines.Add("DATABASE_URL=$url") }
  [IO.File]::WriteAllLines($file, $lines, [Text.UTF8Encoding]::new($false))
  Write-Host "DATABASE_URL updated in $file"
}
