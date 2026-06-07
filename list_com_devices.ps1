Get-CimInstance Win32_PnPEntity | Where-Object { $_.Caption -like '*COM*' } | Select-Object Caption, DeviceID
