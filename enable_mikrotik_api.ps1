$routerIp = "192.168.88.1"
$sshUser = "admin"

# RouterOS commands to enable API service and allow all IPs
$routerCmd = '/ip service enable api; /ip service set api address=0.0.0.0/0; :put [/ip service get api disabled]'

Write-Host "Enabling MikroTik API on $routerIp via SSH..."

# Use built-in ssh.exe (comes with Windows 10+)
# Note: will prompt for password — type 'admin123' when asked
$proc = Start-Process -FilePath "ssh.exe" `
    -ArgumentList "-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=no ${sshUser}@${routerIp} `"$routerCmd`"" `
    -NoNewWindow -Wait -PassThru 2>&1   

Write-Host "SSH exit code: $($proc.ExitCode)"

Start-Sleep -Seconds 2

Write-Host "`nTesting port 8728 on $routerIp..."
$test = Test-NetConnection $routerIp -Port 8728 -WarningAction SilentlyContinue
if ($test.TcpTestSucceeded) {
    Write-Host "SUCCESS: Port 8728 is NOW OPEN - API enabled!"
}
else {
    Write-Host "Port 8728 still closed. You may need to enable the API manually in Winbox:"
    Write-Host "  IP > Services > api > Enable it, set Address to 0.0.0.0/0"
    Write-Host ""
    Write-Host "Or connect via web browser to: http://$routerIp"
}
