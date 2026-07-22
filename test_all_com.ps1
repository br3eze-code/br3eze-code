
$ports = @("COM7", "COM11", "COM12")
foreach ($p in $ports) {
    Write-Host "Testing $p ..."
    $port = New-Object System.IO.Ports.SerialPort $p, 9600
    try {
        $port.Open()
        Write-Host "  SUCCESS: $p is accessible."
        $port.Close()
    } catch {
        Write-Host "  FAILURE: $p -> $($_.Exception.Message)"
    }
}
