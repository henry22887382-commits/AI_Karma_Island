#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Start', 'Stop')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$entryPoint = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'src\ui\server.ts'))
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
$port = 4173
$logPath = Join-Path $projectRoot 'data\launcher-activity.jsonl'
$ownershipPath = Join-Path $projectRoot 'data\managed-server.owner'

function Read-SharedUtf8Text {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [System.IO.FileStream]::new(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite
    )
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
    try {
        return $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
}

function Wait-ForLauncherAcknowledgement {
    param([string]$JobName = '', [int]$ProcessId = 0, [string]$Prompt = '按 Enter 繼續')
    [void](Read-Host $Prompt)
    if ($JobName) {
        $stopped = Stop-ManagedJob -JobName $JobName
        Write-LauncherRecord -Event 'stop' -ProcessId $ProcessId -ImageName 'node.exe' -Result $(if ($stopped) { 'terminated-managed-job-tree-on-launcher-exit' } else { 'managed-job-already-ended' })
        Remove-ManagedJobRecord -JobName $JobName -ProcessId $ProcessId
        [IslandLauncher.NativeJobProcess]::CloseJob()
    }
}

function Initialize-NativeJobSupport {
    $typeName = 'IslandLauncher.NativeJobProcess'
    if (-not ($typeName -as [type])) {
        $nativeSource = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace IslandLauncher {
    public static class NativeJobProcess {
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private const int JobObjectExtendedLimitInformation = 9;
        private const int StartfUseStdHandles = 0x00000100;
        private const uint CreateSuspended = 0x00000004;
        private const uint CreateNoWindow = 0x08000000;
        private static IntPtr jobHandle = IntPtr.Zero;

        [StructLayout(LayoutKind.Sequential)]
        private struct SecurityAttributes {
            public int Length;
            public IntPtr SecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct StartupInfo {
            public int Size;
            public string Reserved;
            public string Desktop;
            public string Title;
            public int X;
            public int Y;
            public int XSize;
            public int YSize;
            public int XCountChars;
            public int YCountChars;
            public int FillAttribute;
            public int Flags;
            public short ShowWindow;
            public short Reserved2Size;
            public IntPtr Reserved2;
            public IntPtr StandardInput;
            public IntPtr StandardOutput;
            public IntPtr StandardError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessInformation {
            public IntPtr Process;
            public IntPtr Thread;
            public uint ProcessId;
            public uint ThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeFileTime {
            public uint Low;
            public uint High;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimitInformation {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimitInformation {
            public BasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenJobObjectW(uint desiredAccess, bool inheritHandle, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        [DllImport("kernel32.dll")]
        private static extern void SetLastError(uint errorCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimitInformation information, uint informationLength);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFileW(string fileName, uint desiredAccess, uint shareMode, ref SecurityAttributes securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetProcessTimes(IntPtr process, out NativeFileTime creationTime, out NativeFileTime exitTime, out NativeFileTime kernelTime, out NativeFileTime userTime);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        private static void SetKillOnJobClose(bool enabled) {
            ExtendedLimitInformation information = new ExtendedLimitInformation();
            information.BasicLimitInformation.LimitFlags = enabled ? JobObjectLimitKillOnJobClose : 0;
            if (!SetInformationJobObject(jobHandle, JobObjectExtendedLimitInformation, ref information, (uint)Marshal.SizeOf(typeof(ExtendedLimitInformation)))) {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not update job close policy");
            }
        }

        private static void EnsureJob(string name) {
            if (jobHandle != IntPtr.Zero) return;
            SetLastError(0);
            jobHandle = CreateJobObjectW(IntPtr.Zero, name);
            if (jobHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
            int error = Marshal.GetLastWin32Error();
            if (error == 183) {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
                throw new InvalidOperationException("The generated job name already exists");
            }
            SetKillOnJobClose(true);
        }

        private static IntPtr OpenFile(string path, uint access, uint disposition, ref SecurityAttributes attributes) {
            IntPtr handle = CreateFileW(path, access, 0x00000001 | 0x00000002, ref attributes, disposition, 0x00000080, IntPtr.Zero);
            if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open redirected process stream");
            return handle;
        }

        public static int Start(string imagePath, string arguments, string workingDirectory, string stdoutPath, string stderrPath, string jobName, string ownershipPath, string projectRoot, string ownerNonce, int startSessionId) {
            EnsureJob(jobName);
            SecurityAttributes attributes = new SecurityAttributes();
            attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            attributes.InheritHandle = true;
            IntPtr input = IntPtr.Zero;
            IntPtr output = IntPtr.Zero;
            IntPtr error = IntPtr.Zero;
            ProcessInformation process = new ProcessInformation();
            bool processCreated = false;
            try {
                input = OpenFile("NUL", 0x80000000, 3, ref attributes);
                output = OpenFile(stdoutPath, 0x40000000, 2, ref attributes);
                error = OpenFile(stderrPath, 0x40000000, 2, ref attributes);
                StartupInfo startup = new StartupInfo();
                startup.Size = Marshal.SizeOf(typeof(StartupInfo));
                startup.Flags = StartfUseStdHandles;
                startup.StandardInput = input;
                startup.StandardOutput = output;
                startup.StandardError = error;
                StringBuilder commandLine = new StringBuilder("\"" + imagePath + "\" " + arguments);
                string recordedCommandLine = commandLine.ToString();
                if (!CreateProcessW(imagePath, commandLine, IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateNoWindow, IntPtr.Zero, workingDirectory, ref startup, out process)) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed");
                }
                processCreated = true;
                if (!AssignProcessToJobObject(jobHandle, process.Process)) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed");
                }
                NativeFileTime creationTime;
                NativeFileTime exitTime;
                NativeFileTime kernelTime;
                NativeFileTime userTime;
                if (!GetProcessTimes(process.Process, out creationTime, out exitTime, out kernelTime, out userTime)) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "GetProcessTimes failed for the created server process");
                }
                long startTimeFileTime = ((long)creationTime.High << 32) | creationTime.Low;
                string recordedImagePath = Path.GetFullPath(imagePath);
                string ownershipRecord = "island-sim-managed-server-v4" + Environment.NewLine + Path.GetFullPath(projectRoot) + Environment.NewLine + jobName + Environment.NewLine + ownerNonce + Environment.NewLine + process.ProcessId.ToString() + Environment.NewLine + startTimeFileTime.ToString() + Environment.NewLine + recordedImagePath + Environment.NewLine + recordedCommandLine + Environment.NewLine + startSessionId.ToString();
                System.IO.File.WriteAllText(ownershipPath, ownershipRecord, new System.Text.UTF8Encoding(false));
                if (ResumeThread(process.Thread) == 0xFFFFFFFF) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");
                }
                return (int)process.ProcessId;
            }
            catch {
                if (processCreated) {
                    TerminateProcess(process.Process, 1);
                    WaitForSingleObject(process.Process, 5000);
                }
                throw;
            }
            finally {
                if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
                if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
                if (input != IntPtr.Zero) CloseHandle(input);
                if (output != IntPtr.Zero) CloseHandle(output);
                if (error != IntPtr.Zero) CloseHandle(error);
            }
        }

        public static bool NamedJobExists(string name) {
            IntPtr handle = OpenJobObjectW(0x0004, false, name);
            if (handle == IntPtr.Zero) {
                int error = Marshal.GetLastWin32Error();
                if (error == 2) return false;
                throw new Win32Exception(error, "OpenJobObject failed");
            }
            CloseHandle(handle);
            return true;
        }

        public static bool StopNamedJob(string name) {
            int error = TryStopNamedJob(name);
            if (error == 2) return false;
            if (error != 0) throw new Win32Exception(error, "OpenJobObject or TerminateJobObject failed for named job '" + name + "' (Win32 " + error.ToString() + ")");
            return true;
        }

        public static int TryStopNamedJob(string name) {
            IntPtr handle = OpenJobObjectW(0x0008 | 0x00100000, false, name);
            if (handle == IntPtr.Zero) {
                return Marshal.GetLastWin32Error();
            }
            try {
                if (!TerminateJobObject(handle, 1)) return Marshal.GetLastWin32Error();
                uint waitResult = WaitForSingleObject(handle, 15000);
                if (waitResult != 0) return Marshal.GetLastWin32Error();
                return 0;
            }
            finally {
                CloseHandle(handle);
            }
        }

        public static void CloseJob() {
            if (jobHandle == IntPtr.Zero) return;
            CloseHandle(jobHandle);
            jobHandle = IntPtr.Zero;
        }

        public static bool DetachJobFromLauncherExit() {
            if (jobHandle == IntPtr.Zero) throw new InvalidOperationException("No managed job handle is available to detach");
            SetKillOnJobClose(false);
            IntPtr handle = jobHandle;
            jobHandle = IntPtr.Zero;
            // If closing fails, the PowerShell process will close this handle on exit.
            // The kill-on-close limit is already disabled, so that cleanup is safe.
            return CloseHandle(handle);
        }
    }
}
'@
        [void](Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop)
    }
}

function Start-ServerInJob {
    param(
        [Parameter(Mandatory = $true)][string]$ImagePath,
        [Parameter(Mandatory = $true)][string]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath,
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$OwnershipPath,
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$OwnerNonce,
        [Parameter(Mandatory = $true)][int]$StartSessionId
    )

    Initialize-NativeJobSupport
    return [IslandLauncher.NativeJobProcess]::Start($ImagePath, $Arguments, $WorkingDirectory, $StdoutPath, $StderrPath, $JobName, $OwnershipPath, $ProjectRoot, $OwnerNonce, $StartSessionId)
}

function Stop-ManagedJob {
    param([Parameter(Mandatory = $true)][string]$JobName)

    Initialize-NativeJobSupport
    return [IslandLauncher.NativeJobProcess]::StopNamedJob($JobName)
}

function Get-ManagedJobStopError {
    param([Parameter(Mandatory = $true)][string]$JobName)
    Initialize-NativeJobSupport
    return [IslandLauncher.NativeJobProcess]::TryStopNamedJob($JobName)
}

function Test-ManagedJobExists {
    param([Parameter(Mandatory = $true)][string]$JobName)
    Initialize-NativeJobSupport
    return [IslandLauncher.NativeJobProcess]::NamedJobExists($JobName)
}

function Read-ManagedJobRecord {
    if (-not (Test-Path -LiteralPath $ownershipPath)) {
        return $null
    }

    $contents = [System.IO.File]::ReadAllText($ownershipPath, [System.Text.Encoding]::UTF8).TrimEnd([char[]]@("`r", "`n"))
    $fields = @($contents -split "`r?`n")
    if ($fields.Count -ne 9 -or $fields[0] -ne 'island-sim-managed-server-v4' -or
        [System.IO.Path]::GetFullPath($fields[1]).TrimEnd('\\') -ine $projectRoot.TrimEnd('\\') -or
        $fields[2] -notmatch '^Local\\IslandSim-([0-9a-f]{32})$' -or
        $fields[3] -cne $Matches[1] -or $fields[4] -notmatch '^[1-9]\d*$' -or
        $fields[5] -notmatch '^[1-9]\d*$' -or [System.IO.Path]::GetFullPath($fields[6]) -ine [System.IO.Path]::GetFullPath($nodeCommand.Source) -or
        $fields[7] -cne ('"{0}" --experimental-strip-types "{1}"' -f $fields[6], $entryPoint) -or $fields[8] -notmatch '^\d+$') {
        throw 'Managed-server ownership record is invalid; refusing to guess which process to stop.'
    }
    return [pscustomobject]@{ ProjectRoot = $fields[1]; JobName = $fields[2]; OwnerNonce = $fields[3]; ProcessId = [int]$fields[4]; StartTimeFileTimeUtc = [long]$fields[5]; ImagePath = $fields[6]; CommandLine = $fields[7]; StartSessionId = [int]$fields[8] }
}

function Remove-ManagedJobRecord {
    param([Parameter(Mandatory = $true)][string]$JobName, [int]$ProcessId = 0)

    $managedJob = Read-ManagedJobRecord
    if ($managedJob -and $managedJob.JobName -eq $JobName -and ($ProcessId -eq 0 -or $managedJob.ProcessId -eq $ProcessId)) {
        Remove-Item -LiteralPath $ownershipPath -Force
    }
}

function Write-LauncherRecord {
    param(
        [Parameter(Mandatory = $true)] [string]$Event,
        [int]$ProcessId = 0,
        [string]$ImageName = '',
        [string]$CommandLineSummary = '',
        [Parameter(Mandatory = $true)] [string]$Result
    )

    $logDirectory = Split-Path -Parent $logPath
    if (-not (Test-Path -LiteralPath $logDirectory)) {
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    }

    $record = [ordered]@{
        timestamp = [DateTime]::Now.ToString('o')
        event = $Event
        port = $port
        pid = $ProcessId
        image = $ImageName
        commandLine = $CommandLineSummary
        powerShellSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        result = $Result
    }
    $line = $record | ConvertTo-Json -Compress
    [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Get-PortListeners {
    try {
        return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique)
    }
    catch {
        $errorId = [string]$_.FullyQualifiedErrorId
        if ($errorId -like '*CmdletizationQuery_NotFound*') {
            return @()
        }

        $netstatLines = @(& netstat.exe -ano -p tcp 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw "Get-NetTCPConnection failed and netstat could not read TCP listeners. Original error: $($_.Exception.Message)"
        }

        $listenerIds = foreach ($line in $netstatLines) {
            if ([string]$line -match '^\s*TCP\s+\S+:4173\s+\S+\s+LISTENING\s+(\d+)\s*$') {
                [int]$Matches[1]
            }
        }
        return @($listenerIds | Sort-Object -Unique)
    }
}

function Test-PortAcceptsConnections {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $pending = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($pending)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-ForLocalPortRelease {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $listeners = @(Get-PortListeners)
            if ($listeners.Count -eq 0 -and -not (Test-PortAcceptsConnections)) {
                return $true
            }
        }
        catch {
            # Listener identity is part of the stop postcondition. If it cannot be
            # checked, fail closed and retain the owner record for later recovery.
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Get-LogTailSummary {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ''
    }
    $summary = (@(Get-Content -LiteralPath $Path -Tail 6 -ErrorAction SilentlyContinue) -join ' | ') -replace '\s+', ' '
    if ($summary.Length -gt 320) {
        $summary = $summary.Substring(0, 320)
    }
    return $summary
}

function Get-ProcessDetails {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-IsProjectServerProcess {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $processInfo = Get-ProcessDetails -ProcessId $ProcessId
    if (-not $processInfo -or $processInfo.Name -ine 'node.exe' -or -not $processInfo.CommandLine) {
        return $false
    }

    $normalizedCommandLine = $processInfo.CommandLine.Replace('/', '\')
    $normalizedEntryPoint = $entryPoint.Replace('/', '\')
    return $normalizedCommandLine.IndexOf($normalizedEntryPoint, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Stop-VerifiedProjectServerProcess {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    if (-not (Test-IsProjectServerProcess -ProcessId $ProcessId)) {
        return $false
    }

    # Re-check immediately before termination so a reused PID is not treated as the server.
    if (-not (Test-IsProjectServerProcess -ProcessId $ProcessId)) {
        return $false
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-ProcessDetails -ProcessId $ProcessId)) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    throw "已確認本專案 server PID $ProcessId，但等待停止逾時。"
}

function Stop-VerifiedManagedOwnerProcess {
    param([Parameter(Mandatory = $true)]$ManagedJob)

    $serverProcess = $null
    try {
        $serverProcess = [System.Diagnostics.Process]::GetProcessById($ManagedJob.ProcessId)
    }
    catch [System.ArgumentException] {
        throw "Could not open managed owner PID $($ManagedJob.ProcessId) to verify its identity; refusing to assume it exited or remove the owner record."
    }

    try {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) {
            return 'managed-owner-process-already-exited'
        }
        if ($serverProcess.ProcessName -ine 'node' -or
            $serverProcess.StartTime.ToUniversalTime().ToFileTimeUtc() -ne $ManagedJob.StartTimeFileTimeUtc) {
            throw 'Managed owner PID no longer identifies the original Node process; refusing to terminate a reused PID.'
        }
        $actualImagePath = [System.IO.Path]::GetFullPath($serverProcess.MainModule.FileName)
        if ($actualImagePath -ine [System.IO.Path]::GetFullPath($ManagedJob.ImagePath) -or
            $actualImagePath -ine [System.IO.Path]::GetFullPath($nodeCommand.Source) -or
            $ManagedJob.CommandLine -cne ('"{0}" --experimental-strip-types "{1}"' -f $ManagedJob.ImagePath, $entryPoint)) {
            throw 'Managed owner PID image or recorded command line does not match this project; refusing to terminate it.'
        }

        $killTreeMethod = $serverProcess.GetType().GetMethod('Kill', [type[]]@([bool]))
        if ($killTreeMethod) {
            [void]$killTreeMethod.Invoke($serverProcess, @($true))
        }
        else {
            $taskkill = Get-Command taskkill.exe -ErrorAction Stop | Select-Object -First 1
            $taskkillOutput = @(& $taskkill.Source /PID $ManagedJob.ProcessId /T /F 2>&1)
            if ($LASTEXITCODE -ne 0 -and -not $serverProcess.HasExited) {
                throw "taskkill could not terminate the verified process tree: $($taskkillOutput -join ' ')"
            }
        }
        if (-not $serverProcess.WaitForExit(15000)) {
            throw "Timed out waiting for verified owner PID $($ManagedJob.ProcessId) to exit."
        }
        return 'terminated-verified-owner-process-tree'
    }
    finally {
        if ($serverProcess) {
            $serverProcess.Dispose()
        }
    }
}

function Get-ProjectLauncherCommandProcesses {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $matches = @()
    $visited = @{}
    $current = Get-ProcessDetails -ProcessId $ProcessId
    for ($depth = 0; $current -and $depth -lt 12; $depth++) {
        $parentId = [int]$current.ParentProcessId
        if ($parentId -le 0 -or $visited.ContainsKey($parentId)) {
            break
        }
        $visited[$parentId] = $true
        $parent = Get-ProcessDetails -ProcessId $parentId
        if (-not $parent) {
            break
        }

        if ($parent.Name -ieq 'cmd.exe' -and $parent.CommandLine -and
            $parent.CommandLine.IndexOf((Join-Path $projectRoot 'start-island.cmd'), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $matches += $parent
        }
        $current = $parent
    }
    return $matches
}

if ($Action -eq 'Stop') {
    try {
        $managedJob = Read-ManagedJobRecord
        if ($managedJob) {
            # First stop the validated named job. If it is unavailable, verify the exact
            # recorded PID, creation time, executable, and project command line before killing it.
            $stopError = Get-ManagedJobStopError -JobName $managedJob.JobName
            $stopDiagnostic = "jobName=$($managedJob.JobName); ownerNonce=$($managedJob.OwnerNonce); projectRoot=$($managedJob.ProjectRoot); ownerPid=$($managedJob.ProcessId); startPowerShellSessionId=$($managedJob.StartSessionId); stopPowerShellSessionId=$([System.Diagnostics.Process]::GetCurrentProcess().SessionId); openOrTerminateWin32Error=$stopError"
            if ($stopError -eq 0) {
                if (-not (Wait-ForLocalPortRelease)) {
                    Write-LauncherRecord -Event 'stop-port-still-active' -ProcessId $managedJob.ProcessId -ImageName 'node.exe' -Result $stopDiagnostic
                    throw "Managed job was terminated, but listener state for TCP port $port is not confirmed clear; keeping the owner record. $stopDiagnostic"
                }
                Write-Host '已停止本專案確認過的服務程序。'
                Write-LauncherRecord -Event 'stop' -ProcessId $managedJob.ProcessId -ImageName 'node.exe' -Result "terminated-managed-job-tree; $stopDiagnostic"
                Remove-ManagedJobRecord -JobName $managedJob.JobName -ProcessId $managedJob.ProcessId
                exit 0
            }
            Write-LauncherRecord -Event 'stop-managed-job-open-failed' -ProcessId $managedJob.ProcessId -ImageName 'node.exe' -Result $stopDiagnostic
            if ($stopError -ne 2) {
                throw "Unable to open or terminate the validated managed job; refusing process fallback. $stopDiagnostic"
            }
            $ownerStopResult = Stop-VerifiedManagedOwnerProcess -ManagedJob $managedJob
            if (-not (Wait-ForLocalPortRelease)) {
                Write-LauncherRecord -Event 'stop-port-still-active' -ProcessId $managedJob.ProcessId -ImageName 'node.exe' -Result "$ownerStopResult; $stopDiagnostic"
                throw "Verified owner process ended, but listener state for TCP port $port is not confirmed clear; keeping the owner record. $stopDiagnostic"
            }
            Write-Host '已停止本專案確認過的服務程序。'
            Write-LauncherRecord -Event 'stop' -ProcessId $managedJob.ProcessId -ImageName 'node.exe' -Result "$ownerStopResult; $stopDiagnostic"
            Remove-ManagedJobRecord -JobName $managedJob.JobName -ProcessId $managedJob.ProcessId
            exit 0
        }

        $listeners = @(Get-PortListeners)
        if ($listeners.Count -eq 0) {
            if (Test-PortAcceptsConnections) {
                throw "TCP port $port still accepts connections but its listener process cannot be identified; refusing to report Stop success."
            }
            Write-Host 'TCP port 4173 目前沒有監聽程序。'
            if ($managedJob) {
                Remove-ManagedJobRecord -JobName $managedJob.JobName -ProcessId $managedJob.ProcessId
            }
            exit 0
        }

        $stoppedIds = @()
        $unverifiedIds = @()
        foreach ($listenerId in $listeners) {
            $listenerProcessId = [int]$listenerId
            if (Stop-VerifiedProjectServerProcess -ProcessId $listenerProcessId) {
                $stoppedIds += $listenerProcessId
                Write-LauncherRecord -Event 'stop' -ProcessId $listenerProcessId -ImageName 'node.exe' -Result 'terminated-verified-project-server-listener'
            }
            else {
                $unverifiedIds += $listenerProcessId
            }
        }
        if ($stoppedIds.Count -gt 0) {
            Write-Host "已停止確認屬於本專案的 server PID：$($stoppedIds -join ', ')。"
        }
        if ($unverifiedIds.Count -gt 0) {
            Write-Error "未停止無法確認身分的 port 4173 程序 PID：$($unverifiedIds -join ', ')。請在工作管理員的「詳細資料」核對該 PID 的映像路徑/命令列；只有確認是本專案後才結束該程序。確認後再執行 Start。" -ErrorAction Continue
            exit 1
        }
        if ($stoppedIds.Count -gt 0 -and -not (Wait-ForLocalPortRelease)) {
            Write-Error "已停止確認屬於本專案的 PID，但 TCP port $port 仍接受連線；不回報 Stop 成功。" -ErrorAction Continue
            exit 1
        }
        if ($managedJob) {
            Remove-ManagedJobRecord -JobName $managedJob.JobName -ProcessId $managedJob.ProcessId
        }
        exit 0
    }
    catch {
        Write-Error "無法停止本啟動器管理的服務：$($_.Exception.Message)" -ErrorAction Continue
        Wait-ForLauncherAcknowledgement
        exit 1
    }
}

if (-not $nodeCommand) {
    Write-LauncherRecord -Event 'start' -Result 'failed-node-not-found'
    Write-Error '找不到 node.exe。請先安裝 Node.js。' -ErrorAction Continue
    Wait-ForLauncherAcknowledgement
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    Write-LauncherRecord -Event 'start' -ImageName 'node.exe' -Result 'failed-dependencies-missing'
    Write-Error '找不到 node_modules，請先安裝專案依賴。' -ErrorAction Continue
    Wait-ForLauncherAcknowledgement
    exit 1
}

$listeners = Get-PortListeners
if ($listeners.Count -gt 0) {
    foreach ($listenerId in $listeners) {
        $processInfo = Get-ProcessDetails -ProcessId ([int]$listenerId)
        $summary = if ($processInfo) { $processInfo.CommandLine } else { '' }
        if ($summary -and $summary.Length -gt 240) {
            $summary = $summary.Substring(0, 240)
        }
        Write-LauncherRecord -Event 'start-blocked' -ProcessId ([int]$listenerId) -ImageName $(if ($processInfo) { $processInfo.Name } else { '' }) -CommandLineSummary $summary -Result 'port-in-use-no-new-process-started'
    }
    $listenerSummary = @($listeners | ForEach-Object { [string]$_ }) -join ', '
    Write-Error "TCP port $port 已被占用（PID：$listenerSummary）。選 Stop 會只停止命令列可確認為本專案 src/ui/server.ts 的程序；若 Stop 列出未確認 PID，請在工作管理員「詳細資料」核對其映像路徑/命令列，確認屬於本專案後結束該程序，再重新選 Start。" -ErrorAction Continue
    Wait-ForLauncherAcknowledgement
    exit 1
}

$previousHost = $env:ISLAND_HOST
$previousPort = $env:ISLAND_PORT
$previousDbPath = $env:ISLAND_DB_PATH
try {
    $env:ISLAND_HOST = '127.0.0.1'
    $env:ISLAND_PORT = [string]$port
    $env:ISLAND_DB_PATH = './data/island.sqlite'

    $dataDirectory = Split-Path -Parent $logPath
    if (-not (Test-Path -LiteralPath $dataDirectory)) {
        New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    }
    $launchId = [Guid]::NewGuid().ToString('N')
    $jobName = "Local\IslandSim-$launchId"
   $stdoutPath = Join-Path $dataDirectory ("launcher-server-$launchId.stdout.log")
    $stderrPath = Join-Path $dataDirectory ("launcher-server-$launchId.stderr.log")
    $escapedEntryPoint = $entryPoint.Replace('"', '\"')
    $argumentLine = '--experimental-strip-types "{0}"' -f $escapedEntryPoint
    try {
        $startSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        $serverId = Start-ServerInJob -ImagePath $nodeCommand.Source -Arguments $argumentLine -WorkingDirectory $projectRoot -StdoutPath $stdoutPath -StderrPath $stderrPath -JobName $jobName -OwnershipPath $ownershipPath -ProjectRoot $projectRoot -OwnerNonce $launchId -StartSessionId $startSessionId
        $server = [System.Diagnostics.Process]::GetProcessById($serverId)
    }
    catch {
        $launchError = $_.Exception.Message
        Write-LauncherRecord -Event 'start' -ImageName 'node.exe' -Result ("failed-managed-job-launch: $launchError")
        if ('IslandLauncher.NativeJobProcess' -as [type]) {
            [IslandLauncher.NativeJobProcess]::CloseJob()
        }
        Write-Error "無法將本次服務安全交由啟動器管理，因此未啟動服務：$launchError" -ErrorAction Continue
        Wait-ForLauncherAcknowledgement
        exit 1
    }
    $summary = '"{0}" {1}' -f $nodeCommand.Source, $argumentLine
    if ($summary.Length -gt 240) {
        $summary = $summary.Substring(0, 240)
    }
    Write-LauncherRecord -Event 'start' -ProcessId $server.Id -ImageName 'node.exe' -CommandLineSummary $summary -Result ("launched-by-island-launcher; stdout=$stdoutPath; stderr=$stderrPath")

    $readinessDeadline = [DateTime]::UtcNow.AddSeconds(15)
    $ready = $false
    $readinessEvidence = ''
    do {
        $server.Refresh()
        if ($server.HasExited) {
            break
        }
        $serverOutput = ''
        try {
            $serverOutput = Read-SharedUtf8Text -Path $stdoutPath
        }
        catch {
            $serverOutput = ''
        }
        $serverReportedReady = $serverOutput.Contains("http://127.0.0.1:$port")
        if ($serverReportedReady) {
            $server.Refresh()
            if (-not $server.HasExited) {
                $ready = $true
                $readinessEvidence = 'launcher-pid-alive; server-listen-callback-recorded-for-configured-url'
                break
            }
        }
        $listeners = Get-PortListeners
        if ($listeners -contains [int]$server.Id) {
            $server.Refresh()
            if (-not $server.HasExited) {
                $ready = $true
                $readinessEvidence = 'listener-pid-confirmed'
                break
            }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $readinessDeadline)

    $stdoutReadError = ''
    try {
        $serverOutput = Read-SharedUtf8Text -Path $stdoutPath
    }
    catch {
        $stdoutReadError = $_.Exception.Message
        $serverOutput = ''
    }
    $server.Refresh()
    $diagnosticProcessAlive = -not $server.HasExited
    $serverReportedReady = $serverOutput.Contains("http://127.0.0.1:$port")
    $diagnosticTcpConnected = $false
    $diagnosticTcpError = ''
    $diagnosticClient = [System.Net.Sockets.TcpClient]::new()
    try {
        $diagnosticClient.Connect('127.0.0.1', $port)
        $diagnosticTcpConnected = $diagnosticClient.Connected
    }
    catch {
        $diagnosticTcpError = $_.Exception.Message
    }
    finally {
        $diagnosticClient.Dispose()
    }
    $diagnosticRawOutput = $serverOutput.Replace("`r", '\\r').Replace("`n", '\\n')
    $diagnosticResult = "stdoutPath=$stdoutPath; encoding=UTF-8; stdoutLength=$($serverOutput.Length); pid=$($server.Id); hasExited=$($server.HasExited); callback=$serverReportedReady; tcpConnected=$diagnosticTcpConnected; tcpError=$diagnosticTcpError; stdoutReadError=$stdoutReadError; stdoutRaw=$diagnosticRawOutput"
    Write-LauncherRecord -Event 'start-readiness-diagnostic' -ProcessId $server.Id -ImageName 'node.exe' -CommandLineSummary $summary -Result $diagnosticResult
    if (-not $ready -or $stdoutReadError -or $diagnosticTcpError -or -not $diagnosticProcessAlive) {
        Write-Host "啟動診斷：$diagnosticResult" -ForegroundColor DarkGray
    }

    if ($ready) {
        $jobHandleClosed = [IslandLauncher.NativeJobProcess]::DetachJobFromLauncherExit()
        if (-not $jobHandleClosed) {
            Write-Warning '啟動器無法立即關閉 job handle；PowerShell 結束時會由作業系統回收。服務仍由獨立 Stop 管理。'
        }
        Write-LauncherRecord -Event 'start-ready' -ProcessId $server.Id -ImageName 'node.exe' -CommandLineSummary $summary -Result "listening-on-configured-port; evidence=$readinessEvidence"
        $editorBasePath = $env:ISLAND_EDITOR_BASE_PATH
        if (-not $editorBasePath) {
            $editorBasePath = ''
        }
        else {
            $editorBasePath = $editorBasePath.TrimEnd('/')
        }
        Write-Host "服務已啟動（PID $($server.Id)）；關閉此視窗後服務仍會執行，停止時重新開啟 start-island.cmd 並選 [2]。"
        Write-Host "觀察台：http://127.0.0.1:$port/"
        Write-Host "內容工房：http://127.0.0.1:$port$editorBasePath/editor"
        $server.Dispose()
        exit 0
    }
    else {
        $server.Refresh()
        if ($server.HasExited) {
            $exitCode = $server.ExitCode
            $stdoutTail = Get-LogTailSummary -Path $stdoutPath
            $stderrTail = Get-LogTailSummary -Path $stderrPath
            $result = "failed-before-listening; exitCode=$exitCode; stdoutTail=$stdoutTail; stderrTail=$stderrTail"
            Write-LauncherRecord -Event 'start-failed' -ProcessId $server.Id -ImageName 'node.exe' -CommandLineSummary $summary -Result $result
            Write-Error "服務啟動失敗（Node exit code $exitCode），尚未監聽 port $port。錯誤紀錄：$stderrPath" -ErrorAction Continue
            Wait-ForLauncherAcknowledgement -JobName $jobName -ProcessId $server.Id
            $server.Dispose()
            exit 1
        }

        $listeners = Get-PortListeners
        $listenerSummary = (@($listeners) -join ',')
        Write-LauncherRecord -Event 'start-timeout' -ProcessId $server.Id -ImageName 'node.exe' -CommandLineSummary $summary -Result "readiness-timeout-15s; listenerPids=$listenerSummary; process-left-running; stdout=$stdoutPath; stderr=$stderrPath"
        Write-Error "服務在 15 秒內未監聽 port $port；PID $($server.Id) 仍在執行，未自動關閉。輸出紀錄：$stdoutPath；錯誤紀錄：$stderrPath" -ErrorAction Continue
        Wait-ForLauncherAcknowledgement -JobName $jobName -ProcessId $server.Id
        $server.Dispose()
        exit 1
    }

    Write-Host "輸出紀錄：$stdoutPath"
    Write-Host "錯誤紀錄：$stderrPath"
    exit 0
}
finally {
    $env:ISLAND_HOST = $previousHost
    $env:ISLAND_PORT = $previousPort
    $env:ISLAND_DB_PATH = $previousDbPath
}
