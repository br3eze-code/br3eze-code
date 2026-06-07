[System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object {
    $name = $_
    Write-Host "Testing $name ..."
    $p = New-Object System.IO.Ports.SerialPort $name, 9600
    try {
        $p.Open()
        Write-Host "  Successfully opened $name"
        $p.Close()
    } catch {
        Write-Host "  Failed to open $name : $($_.Exception.Message)"
    }
}
