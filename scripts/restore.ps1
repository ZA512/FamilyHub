param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory,
  [Parameter(Mandatory = $true)]
  [switch]$ConfirmRestore,
  [string]$ProjectName = ''
)

$ErrorActionPreference = 'Stop'
if (!$ConfirmRestore) { throw 'Ajoutez -ConfirmRestore pour autoriser le remplacement des données.' }
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backup = (Resolve-Path $BackupDirectory).Path
$manifestPath = Join-Path $backup 'manifest.json'
$databaseFile = Join-Path $backup 'database.dump'
$attachmentFile = Join-Path $backup 'attachments.tar.gz'
$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
if ($manifest.format -ne 'familyhub-backup' -or $manifest.version -ne 1) {
  throw 'Format de sauvegarde FamilyHub non reconnu.'
}
foreach ($name in @('database.dump', 'attachments.tar.gz')) {
  $path = Join-Path $backup $name
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
  if ($actual -ne $manifest.files.$name) { throw "Empreinte invalide pour $name." }
}

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
  throw 'Les services FamilyHub app et db doivent être démarrés avant la restauration.'
}
$dbEnvironment = & docker inspect $dbContainer --format '{{json .Config.Env}}' | ConvertFrom-Json
$dbUser = ($dbEnvironment | Where-Object { $_ -like 'POSTGRES_USER=*' }) -replace '^POSTGRES_USER=', ''
$dbName = ($dbEnvironment | Where-Object { $_ -like 'POSTGRES_DB=*' }) -replace '^POSTGRES_DB=', ''
$appInspection = & docker inspect $appContainer | ConvertFrom-Json
$attachmentMount = $appInspection[0].Mounts | Where-Object { $_.Destination -eq '/data/attachments' } | Select-Object -First 1
if (!$attachmentMount) { throw 'Volume de pièces jointes introuvable.' }
$appImage = $appInspection[0].Config.Image
$temporaryDump = "/tmp/familyhub-restore-$([guid]::NewGuid().ToString('N')).dump"

Invoke-Docker ($compose + @('stop', 'app'))
try {
  Invoke-Docker @('cp', $databaseFile, "${dbContainer}:${temporaryDump}")
  Invoke-Docker @(
    'exec', $dbContainer, 'pg_restore', '-U', $dbUser, '-d', $dbName,
    '--clean', '--if-exists', '--no-owner', '--no-privileges', $temporaryDump
  )
  Invoke-Docker @(
    'run', '--rm',
    '--volume', "$($attachmentMount.Name):/target",
    '--volume', "${backup}:/backup:ro",
    '--entrypoint', 'sh',
    $appImage,
    '-c', 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/attachments.tar.gz -C /target'
  )
} finally {
  & docker exec $dbContainer rm -f $temporaryDump 2>$null
  Invoke-Docker ($compose + @('start', 'app'))
}
Write-Output 'Restauration terminée. Vérifiez /api/v1/health/ready avant utilisation.'
