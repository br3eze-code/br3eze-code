
$names = [System.IO.Ports.SerialPort]::GetPortNames()
Write-Host "Available ports: $($names -join ', ')"
$portName = "COM7"
if ($names -contains $portName) {
    Write-Host "COM7 is in the list."
    $port = New-Object System.IO.Ports.SerialPort $portName, 9600
    try {
        $port.Open()
        Write-Host "SUCCESS"
        $port.Close()
    } catch {
        Write-Host "FAILURE: $($_.Exception.Message)"
    }
} else {
    Write-Host "COM7 is NOT in the list."
}
