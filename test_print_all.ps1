
$ports = @("COM11", "COM12")
foreach ($p in $ports) {
    Write-Host "Trying to print to $p ..."
    $port = New-Object System.IO.Ports.SerialPort $p, 9600
    $port.WriteTimeout = 2000
    try {
        $port.Open()
        $text = "`n`nHELLO FROM $p`n`n"
        $b = [System.Text.Encoding]::ASCII.GetBytes($text)
        $port.Write($b, 0, $b.Length)
        Write-Host "  Sent data to $p"
        $port.Close()
    } catch {
        Write-Host "  FAILED $p : $($_.Exception.Message)"
    }
}
