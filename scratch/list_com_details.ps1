
$devices = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Caption -match 'COM' }
foreach ($dev in $devices) {
    [PSCustomObject]@{
        Caption = $dev.Caption
        PNPDeviceID = $dev.PNPDeviceID
    } | Format-Table -HideTableHeaders
}
