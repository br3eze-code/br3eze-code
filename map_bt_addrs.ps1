
$devs = Get-PnpDevice | Where-Object { $_.FriendlyName -like "*Bluetooth*link*" }
foreach ($d in $devs) {
    try {
        $addr = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName "DEVPKEY_Device_Address"
        Write-Host "$($d.FriendlyName) -> $($addr.Data)"
    } catch {
        Write-Host "$($d.FriendlyName) -> No address"
    }
}
