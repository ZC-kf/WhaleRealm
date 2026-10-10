/*
 * 鲸域 · WhaleRealm
 * Copyright (C) 2026 凛枫
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 附加署名要求：任何分发本程序或其衍生作品的行为，必须在显著位置
 * 保留上述版权声明及作者署名。
 */
// Independently authored ownership broker. A private Windows job is the authority;
// PID numbers are never termination authority. Assignment occurs before first instruction.
export const WINDOWS_JOB_SOURCE = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.ComponentModel;
public static class OwnedJob {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public int size; public string reserved, desktop, title; public int x,y,cx,cy,charsX,charsY,fill,flags; public short show, reserved2; public IntPtr reserved3, input, output, error; }
 [StructLayout(LayoutKind.Sequential)] struct Created { public IntPtr process, thread; public uint pid, tid; }
 [StructLayout(LayoutKind.Sequential)] struct Limits { public long perProcess,perJob; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup si,out Created pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,int length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,IntPtr info,int length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,int flags,StringBuilder image,ref int length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr process);
 [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr process);
 static string prefix;
 static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static string Enc(string value) { return Convert.ToBase64String(Encoding.UTF8.GetBytes(value)); }
 static void Emit(string value) { Console.Out.WriteLine("\n"+prefix+value); Console.Out.Flush(); }
 static uint[] Members(IntPtr job) {
  int size=65536; IntPtr data=Marshal.AllocHGlobal(size);
  try { Check(QueryInformationJobObject(job,3,data,size,IntPtr.Zero)); int count=Marshal.ReadInt32(data,4); uint[] ids=new uint[count]; for(int i=0;i<count;i++) ids[i]=(uint)Marshal.ReadIntPtr(data,8+i*IntPtr.Size).ToInt64(); return ids; }
  finally { Marshal.FreeHGlobal(data); }
 }
 static void Identity(IntPtr process,out long created,out string image) {
  long exit,kernel,user; Check(GetProcessTimes(process,out created,out exit,out kernel,out user)); int length=32768; var text=new StringBuilder(length); Check(QueryFullProcessImageName(process,0,text,ref length)); image=text.ToString();
 }
 static void Suspend(IntPtr job,bool pause) {
  var changed=new List<IntPtr>(); var seen=new HashSet<uint>();
  try {
   while(true) {
    bool found=false;
    foreach(uint pid in Members(job)) {
     if(!seen.Add(pid)) continue;
     found=true; IntPtr handle=OpenProcess(0x1800,false,pid);
     if(handle==IntPtr.Zero) { if(Marshal.GetLastWin32Error()==87) continue; throw new Win32Exception(Marshal.GetLastWin32Error()); }
     bool keep=false;
     try {
      bool member; Check(IsProcessInJob(handle,job,out member)); if(!member) continue;
      long created; string image; Identity(handle,out created,out image);
      int status=pause?NtSuspendProcess(handle):NtResumeProcess(handle); if(status!=0) throw new Exception("Process control failed: "+status);
      changed.Add(handle); keep=true;
     } finally { if(!keep) CloseHandle(handle); }
    }
    // Once all parents are suspended, no member can create an unobserved child.
    if(!pause || !found) break;
   }
  } catch {
   if(pause) foreach(IntPtr handle in changed) NtResumeProcess(handle);
   throw;
  } finally { foreach(IntPtr handle in changed) CloseHandle(handle); }
 }
 public static void Run(string command,string cwd,bool hidden,string marker) {
  prefix=marker; IntPtr job=IntPtr.Zero, input=IntPtr.Zero; Created child=new Created(); bool assigned=false;
  try {
   job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
   Extended limits=new Extended(); limits.basic.flags=0x2000; Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Extended))));
   input=CreateFile("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero); Check(input!=new IntPtr(-1));
   var si=new Startup(); si.size=Marshal.SizeOf(typeof(Startup)); si.flags=0x100|(hidden?1:0); si.show=0; si.input=input; si.output=GetStdHandle(-11); si.error=GetStdHandle(-12);
   Check(SetHandleInformation(input,1,1)); Check(SetHandleInformation(si.output,1,1)); Check(SetHandleInformation(si.error,1,1));
   Check(CreateProcess(null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,4,IntPtr.Zero,cwd,ref si,out child));
   Check(AssignProcessToJobObject(job,child.process)); assigned=true;
   long created; string image; Identity(child.process,out created,out image);
   Check(ResumeThread(child.thread)!=0xffffffff);
   Emit("ready|"+child.pid+"|"+created+"|"+Enc(image));
   Task<string> read=Task.Run(()=>Console.In.ReadLine()); bool stopping=false; DateTime deadline=DateTime.MaxValue;
   while(true) {
    if(read.IsCompleted) {
     string line=read.GetAwaiter().GetResult();
     if(line==null || line=="stop") { Check(TerminateJobObject(job,1)); stopping=true; deadline=DateTime.UtcNow.AddSeconds(8); }
     else { var parts=line.Split('|'); try { Suspend(job,parts[0]=="pause"); Emit("ack|"+parts[1]); } catch(Exception e) { Emit("error|"+parts[1]+"|"+Enc(e.Message)); } }
     read=line==null?new TaskCompletionSource<string>().Task:Task.Run(()=>Console.In.ReadLine());
    }
    if(WaitForSingleObject(child.process,0)==0 && !stopping) { Check(TerminateJobObject(job,1)); stopping=true; deadline=DateTime.UtcNow.AddSeconds(8); }
    if(stopping && Members(job).Length==0) { uint code; Check(GetExitCodeProcess(child.process,out code)); Emit("exit|"+code); return; }
    if(DateTime.UtcNow>deadline) throw new Exception("Owned job exit timed out");
    System.Threading.Thread.Sleep(20);
   }
  } catch(Exception e) {
   try {
    if(assigned) Check(TerminateJobObject(job,1)); else if(child.process!=IntPtr.Zero) Check(TerminateProcess(child.process,1));
    DateTime until=DateTime.UtcNow.AddSeconds(8);
    while((assigned&&Members(job).Length>0)||(!assigned&&child.process!=IntPtr.Zero&&WaitForSingleObject(child.process,0)!=0)) { if(DateTime.UtcNow>until) throw new Exception("Failed startup cleanup timed out"); System.Threading.Thread.Sleep(20); }
    Emit("exit|1");
   } catch(Exception cleanup) { Emit("fatal|"+Enc(cleanup.Message)); }
   Emit("fatal|"+Enc(e.Message));
  }
  finally { if(child.process!=IntPtr.Zero&&!assigned) TerminateProcess(child.process,1); if(job!=IntPtr.Zero) CloseHandle(job); if(child.process!=IntPtr.Zero) CloseHandle(child.process); if(child.thread!=IntPtr.Zero) CloseHandle(child.thread); if(input!=IntPtr.Zero) CloseHandle(input); }
 }
}
`
