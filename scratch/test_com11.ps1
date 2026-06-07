try {
    $portName = 'COM5'
    $port = New-Object System.IO.Ports.SerialPort $portName, 9600, 'None', 8, 'One'
    $port.WriteTimeout = 3000
    $port.Open()
    Write-Host "SUCCESS: $portName opened"
    $port.Close()
} catch {
    Write-Host "ERROR on $portName : $($_.Exception.Message)"
}
try {
    $portName = 'COM7'
    $port = New-Object System.IO.Ports.SerialPort $portName, 9600, 'None', 8, 'One'
    $port.WriteTimeout = 3000
    $port.Open()
    Write-Host "SUCCESS: $portName opened"
    $port.Close()
} catch {
    Write-Host "ERROR on $portName : $($_.Exception.Message)"
}
