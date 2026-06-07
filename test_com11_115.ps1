
$port = New-Object System.IO.Ports.SerialPort "COM11", 115200
try {
    $port.Open()
    Write-Host "SUCCESS: Port COM11 opened at 115200."
    $port.Write([byte[]]@(0x1B, 0x40), 0, 2) # ESC @ (Initialize)
    Write-Host "Sent Init"
    $port.Close()
} catch {
    Write-Host "FAILURE: $($_.Exception.Message)"
}
