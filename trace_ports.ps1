
Get-PnpDevice -Class Ports | ForEach-Object {
    $port = $_
    try {
        $parent = Get-PnpDeviceProperty -InstanceId $port.InstanceId -KeyName "DEVPKEY_Device_Parent"
        Write-Host "$($port.FriendlyName) -> Parent: $($parent.Data)"
    } catch {
        Write-Host "$($port.FriendlyName) -> No parent info"
    }
}
