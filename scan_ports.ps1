$target = "192.168.88.1"
$ports  = @(8728, 8729, 80, 443, 22, 2222, 8291)

Write-Host "Scanning $target ..."
foreach ($port in $ports) {
    $result = (Test-NetConnection $target -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
    $status = if ($result) { "OPEN" } else { "closed" }
    Write-Host "  Port $port : $status"
}
Write-Host "Done."
