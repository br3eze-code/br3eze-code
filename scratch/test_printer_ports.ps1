
$ports = [System.IO.Ports.SerialPort]::GetPortNames()
foreach ($port in $ports) {
    Write-Host "Probing $port..."
    try {
        $p = New-Object System.IO.Ports.SerialPort $port, 9600
        $p.Open()
        $p.Close()
        Write-Host "Success: $port is openable"
    } catch {
        Write-Host "Error: $port failed - $($_.Exception.Message)"
    }
}
