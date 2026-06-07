
$port = New-Object System.IO.Ports.SerialPort "COM11", 9600
$port.WriteTimeout = 10000
$port.DtrEnable = $true
$port.RtsEnable = $true
try {
    Write-Host "Opening COM11..."
    $port.Open()
    Write-Host "SUCCESS: Opened COM11. Sending data..."
    $port.WriteLine("HELLO PRINTER ON COM11")
    $port.WriteLine("`n`n`n")
    Write-Host "Sent data."
    $port.Close()
} catch {
    Write-Host "FAILURE: $($_.Exception.Message)"
}
