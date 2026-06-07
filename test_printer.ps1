$code = @"
using System;
using System.Runtime.InteropServices;
public class RawPrintV4 {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOC_INFO_1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
    public static extern uint StartDocPrinter(IntPtr hPrinter, uint level, [In] ref DOC_INFO_1 di);
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

Add-Type -TypeDefinition $code
$h = [IntPtr]::Zero
$di = New-Object RawPrintV4+DOC_INFO_1
$di.pDocName = "Test Page"
$di.pDatatype = "RAW"
$printer = "Microsoft Print to PDF"

Write-Host "Opening printer: $printer"
if ([RawPrintV4]::OpenPrinter($printer, [ref]$h, [IntPtr]::Zero)) {
    Write-Host "Printer opened successfully. Handle: $h"
    Write-Host "Starting document..."
    $docId = [RawPrintV4]::StartDocPrinter($h, 1, [ref]$di)
    if ($docId -ne 0) {
        Write-Host "Document started. ID: $docId"
        if ([RawPrintV4]::StartPagePrinter($h)) {
            Write-Host "Page started."
            $text = "AgentOS Test Print`n"
            $b = [System.Text.Encoding]::ASCII.GetBytes($text)
            $ptr = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($b.Length)
            [System.Runtime.InteropServices.Marshal]::Copy($b, 0, $ptr, $b.Length)
            $written = 0
            if ([RawPrintV4]::WritePrinter($h, $ptr, $b.Length, [ref]$written)) {
                Write-Host "Bytes written: $written"
                [RawPrintV4]::EndPagePrinter($h)
                [RawPrintV4]::EndDocPrinter($h)
                Write-Host "Document finished."
            } else {
                Write-Host "WritePrinter failed."
            }
            [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
        } else {
            Write-Host "StartPagePrinter failed."
        }
        [RawPrintV4]::ClosePrinter($h)
    } else {
        $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-Host "StartDocPrinter failed. Win32 Error: $err"
        [RawPrintV4]::ClosePrinter($h)
    }
} else {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Host "OpenPrinter failed. Win32 Error: $err"
}
