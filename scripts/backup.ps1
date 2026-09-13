param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [string]$ProjectName = ''
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupDirectory = Join-Path $outputRoot "familyhub-$stamp"
New-Item -ItemType Directory -Path $backupDirectory | Out-Null

$compose = @('compose')
if ($ProjectName) { $compose += @('-p', $ProjectName) }
$compose += @('-f', (Join-Path $repository 'compose.yaml'))

function Invoke-Docker([string[]]$Arguments) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker a échoué (code $LASTEXITCODE)." }
}

$dbContainer = (& docker @compose ps -q db).Trim()
$appContainer = (& docker @compose ps -q app).Trim()
if (!$dbContainer -or !$appContainer) {
  throw 'Les services FamilyHub app et db doivent être démarrés.'
}

$dbEnvironment = & docker inspect $dbContainer --format '{{json .Config.Env}}' | ConvertFrom-Json
$dbUser = ($dbEnvironment | Where-Object { $_ -like 'POSTGRES_USER=*' }) -replace '^POSTGRES_USER=', ''
$dbName = ($dbEnvironment | Where-Object { $_ -like 'POSTGRES_DB=*' }) -replace '^POSTGRES_DB=', ''
if (!$dbUser -or !$dbName) { throw 'Configuration PostgreSQL introuvable.' }

$databaseFile = Join-Path $backupDirectory 'database.dump'
$attachmentFile = Join-Path $backupDirectory 'attachments.tar.gz'
$temporaryDump = "/tmp/familyhub-$stamp.dump"
try {
  Invoke-Docker @('exec', $dbContainer, 'pg_dump', '-U', $dbUser, '-d', $dbName, '-Fc', '-f', $temporaryDump)
  Invoke-Docker @('cp', "${dbContainer}:${temporaryDump}", $databaseFile)
} finally {
  & docker exec $dbContainer rm -f $temporaryDump 2>$null
}

$appInspection = & docker inspect $appContainer | ConvertFrom-Json
$attachmentMount = $appInspection[0].Mounts | Where-Object { $_.Destination -eq '/data/attachments' } | Select-Object -First 1
if (!$attachmentMount) { throw 'Volume de pièces jointes introuvable.' }
$appImage = $appInspection[0].Config.Image
Invoke-Docker @(
  'run', '--rm',
  '--volume', "$($attachmentMount.Name):/source:ro",
  '--volume', "${backupDirectory}:/backup",
  '--entrypoint', 'sh',
  $appImage,
  '-c', 'tar -czf /backup/attachments.tar.gz -C /source .'
)

$schemaVersion = (& docker exec $dbContainer psql -U $dbUser -d $dbName -Atc 'select count(*) from drizzle.__drizzle_migrations;').Trim()
$revision = (& docker inspect $appContainer --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}').Trim()
$manifest = [ordered]@{
  format = 'familyhub-backup'
  version = 1
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  image = $appImage
  revision = $revision
  schemaMigrations = [int]$schemaVersion
  files = [ordered]@{
    'database.dump' = (Get-FileHash -Algorithm SHA256 $databaseFile).Hash.ToLowerInvariant()
    'attachments.tar.gz' = (Get-FileHash -Algorithm SHA256 $attachmentFile).Hash.ToLowerInvariant()
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $backupDirectory 'manifest.json')
Write-Output $backupDirectory
