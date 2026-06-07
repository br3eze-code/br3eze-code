# Add route to MikroTik hotspot subnet via LAN gateway
Write-Host "Adding route: 192.168.88.0/24 via 192.168.1.1 ..."
route add 192.168.88.0 mask 255.255.255.0 192.168.1.1

Write-Host "Testing 192.168.88.1 (MikroTik hotspot API)..."
ping -n 2 192.168.88.1

Write-Host "`nTesting 192.168.88.100 (AgentOS main server)..."
ping -n 2 192.168.88.100

Write-Host "`nTesting port 8728 on 192.168.88.1..."
$api = (Test-NetConnection 192.168.88.1 -Port 8728 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Host "Port 8728 open: $api"

Write-Host "`nTesting port 3000 on 192.168.88.100..."
$main = (Test-NetConnection 192.168.88.100 -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded
Write-Host "Port 3000 open: $main"
