$printerName = "EPSON TM-T88V Receipt"
$tempFile = "test_print.bin"
[System.IO.File]::WriteAllBytes((Get-Item .).FullName + "\$tempFile", [System.Text.Encoding]::ASCII.GetBytes("Hello ESC/POS`n`n`n"))

$code = @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern uint StartDocPrinter(IntPtr hPrinter, uint level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, uint dwCount, out uint dwWritten);
}
"@

if (-not ([System.Management.Automation.PSTypeName]"RawPrint").Type) {
    Add-Type -TypeDefinition $code
}

$h = [IntPtr]::Zero
$di = New-Object RawPrint+DOCINFOA
$di.pDocName = "Test Print"
$di.pDataType = "RAW"

if ([RawPrint]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) {
    Write-Host "OpenPrinter Success"
    if ([RawPrint]::StartDocPrinter($h, 1, $di) -ne 0) {
        Write-Host "StartDocPrinter Success"
        if ([RawPrint]::StartPagePrinter($h)) {
            Write-Host "StartPagePrinter Success"
            $b = [System.IO.File]::ReadAllBytes((Get-Item $tempFile).FullName)
            $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
            [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
            $w = 0
            $res = [RawPrint]::WritePrinter($h, $ptr, $b.Length, [ref]$w)
            if ($res) {
                Write-Host "Sent $w bytes successfully"
            } else {
                Write-Host "WritePrinter failed"
            }
            [RawPrint]::EndPagePrinter($h)
            [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
        } else {
            Write-Host "StartPagePrinter failed"
        }
        [RawPrint]::EndDocPrinter($h)
    } else {
        Write-Host "StartDocPrinter failed"
    }
    [RawPrint]::ClosePrinter($h)
} else {
    Write-Host "OpenPrinter failed for '$printerName'"
}
