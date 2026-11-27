using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace FollowDesk {
    // One job contains the CLI, its workers, and any review browser they launch.
    internal sealed class ChildJob : SafeHandleZeroOrMinusOneIsInvalid {
        [StructLayout(LayoutKind.Sequential)]
        private struct Basic {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcesses;
            public UIntPtr Affinity;
            public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct Extended {
            public Basic Limits;
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr CreateJobObject(IntPtr attrs, string name);
        [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(ChildJob job, int kind, ref Extended info, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool AssignProcessToJobObject(ChildJob job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool TerminateJobObject(ChildJob job, uint exitCode);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        internal ChildJob() : base(true) {
            SetHandle(CreateJobObject(IntPtr.Zero,null));
            var info = new Extended();
            info.Limits.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (IsInvalid || !SetInformationJobObject(this,9,ref info,(uint)Marshal.SizeOf(info))) {
                int error = Marshal.GetLastWin32Error();
                Dispose(); throw new System.ComponentModel.Win32Exception(error);
            }
        }
        protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }

    internal sealed class TaskRunner : IDisposable {
        static string cachedNode;
        readonly string root;
        ChildJob job;
        public TaskRunner(string projectRoot) { root = projectRoot; }

        static string CombineDir(string baseDir, string sub) {
            return String.IsNullOrEmpty(baseDir) ? null : Path.Combine(baseDir, sub);
        }
        static IEnumerable<string> CandidateDirs() {
            foreach (var p in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
                yield return p;
            yield return CombineDir(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs");
            yield return Environment.GetEnvironmentVariable("NVM_SYMLINK");
            yield return CombineDir(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs");
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            yield return CombineDir(local, @"Volta\bin");
            yield return CombineDir(home, @"scoop\apps\nodejs\current");
            yield return CombineDir(home, @"scoop\apps\nodejs-lts\current");
            string fnm = CombineDir(local, "fnm_multishells");
            if (!String.IsNullOrEmpty(fnm) && Directory.Exists(fnm)) {
                DirectoryInfo[] subs = null;
                try { subs = new DirectoryInfo(fnm).GetDirectories(); } catch { }
                if (subs != null) {
                    foreach (var sub in subs.OrderByDescending(s => s.LastWriteTimeUtc))
                        yield return sub.FullName;
                }
            }
            yield return CombineDir(roaming, @"fnm\aliases\default");
            yield return CombineDir(local, @"fnm\aliases\default");
            yield return CombineDir(local, @"Programs\nodejs");
            yield return CombineDir(roaming, "nvm");
        }
        static bool IsSupportedNode(string exe) {
            try {
                var info = new ProcessStartInfo(exe, "-p \"process.versions.node\"") {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8
                };
                using (var proc = Process.Start(info)) {
                    if (proc == null) return false;
                    string ver = proc.StandardOutput.ReadToEnd().Trim();
                    if (!proc.WaitForExit(3000)) {
                        try { proc.Kill(); } catch { }
                        return false;
                    }
                    if (proc.ExitCode != 0 || String.IsNullOrEmpty(ver)) return false;
                    int dot = ver.IndexOf('.');
                    string majorText = dot > 0 ? ver.Substring(0, dot) : ver;
                    int major;
                    return int.TryParse(majorText, NumberStyles.Integer, CultureInfo.InvariantCulture, out major) && major >= 20;
                }
            } catch {
                return false;
            }
        }
        static string NodePath() {
            string hit = cachedNode;
            if (!String.IsNullOrEmpty(hit) && File.Exists(hit)) return hit;
            bool foundLegacy = false;
            foreach (var dir in CandidateDirs()) {
                if (String.IsNullOrWhiteSpace(dir)) continue;
                string d = dir.Trim().Trim('"');
                try {
                    if (!Path.IsPathRooted(d)) continue;
                    var file = Path.Combine(d, "node.exe");
                    if (!File.Exists(file)) continue;
                    if (IsSupportedNode(file)) { cachedNode = file; return file; }
                    foundLegacy = true;
                } catch (ArgumentException) { continue; }
            }
            if (foundLegacy) throw new InvalidOperationException("检测到旧版 Node.js，关序需要 Node.js 20 或更高版本。");
            throw new FileNotFoundException("找不到 Node.js。请检查本机的 Node.js 安装和 PATH。");
        }
        static string Quote(string value) {
            var text = new StringBuilder("\"");
            int slashes = 0;
            foreach (char c in value) {
                if (c == '\\') { slashes++; continue; }
                if (c == '"') text.Append('\\',slashes * 2 + 1);
                else text.Append('\\',slashes);
                slashes = 0; text.Append(c);
            }
            return text.Append('\\',slashes*2).Append('"').ToString();
        }
        public async Task<int> Run(string[] args, Action<string> stdout, Action<string> stderr) {
            if (job != null) throw new InvalidOperationException("已有任务正在运行。");
            var info = new ProcessStartInfo(NodePath(), String.Join(" ", args.Select(Quote))) {
                WorkingDirectory=root, UseShellExecute=false, CreateNoWindow=true,
                RedirectStandardOutput=true, RedirectStandardError=true,
                StandardOutputEncoding=Encoding.UTF8, StandardErrorEncoding=Encoding.UTF8
            };
            using (var proc = new Process {StartInfo=info})
            using (var owned = new ChildJob()) {
                proc.OutputDataReceived += (s,e) => { if(e.Data != null) stdout(e.Data); };
                proc.ErrorDataReceived += (s,e) => { if(e.Data != null) stderr(e.Data); };
                if (!proc.Start()) throw new IOException("无法启动任务。");
                if (!ChildJob.AssignProcessToJobObject(owned,proc.Handle) && !proc.HasExited) {
                    int code = Marshal.GetLastWin32Error();
                    proc.Kill(); proc.WaitForExit();
                    throw new System.ComponentModel.Win32Exception(code,"无法管理本次任务的子进程。");
                }
                job=owned;
                try {
                    proc.BeginOutputReadLine(); proc.BeginErrorReadLine();
                    await Task.Run((Action)proc.WaitForExit);
                    return proc.ExitCode;
                } finally { job=null; }
            }
        }
        public void Stop() {
            ChildJob current = job;
            if (current != null && !ChildJob.TerminateJobObject(current,1223) && job != null) throw new System.ComponentModel.Win32Exception();
        }
        public void Dispose() { if (job != null) job.Dispose(); }
    }
}
