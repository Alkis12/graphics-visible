$ErrorActionPreference = "Stop"

$server = $env:SERVER_SSH
if (-not $server) {
  $server = "deploy-user@example-host.invalid"
}

$localPort = $env:LOCAL_MONGO_PORT
if (-not $localPort) {
  $localPort = "27018"
}

$remotePort = $env:REMOTE_MONGO_PORT
if (-not $remotePort) {
  $remotePort = "27018"
}

Write-Host "Opening Mongo SSH tunnel: 127.0.0.1:$localPort -> $server -> 127.0.0.1:$remotePort"
Write-Host "Keep this window open while using the server Mongo locally."

ssh -N -L "${localPort}:127.0.0.1:${remotePort}" $server
