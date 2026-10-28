import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AxiError } from "axi-sdk-js";

export type DownloadFile = { writeFile: (bytes: Uint8Array) => Promise<void> };

export async function windowsDownload<T>(path: string, write: (file: DownloadFile) => Promise<T>): Promise<T> {
  const source = `
using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class PrivateDownload {
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref byte info, uint size);
  public static int Run(string path) {
    FileStream file = null;
    try {
      var sid = WindowsIdentity.GetCurrent().User;
      var allowed = new[] { sid.Value, "S-1-5-18", "S-1-5-32-544" };
      var acl = new FileSecurity();
      acl.SetOwner(sid);
      acl.SetAccessRuleProtection(true, false);
      foreach (var value in allowed)
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(value), FileSystemRights.FullControl, AccessControlType.Allow));
      file = new FileStream(path, FileMode.CreateNew, FileSystemRights.FullControl, FileShare.None, 4096, FileOptions.None, acl);
      var actual = file.GetAccessControl();
      if (!actual.AreAccessRulesProtected || !actual.GetOwner(typeof(SecurityIdentifier)).Equals(sid)) throw new IOException();
      var seen = new System.Collections.Generic.HashSet<string>();
      foreach (FileSystemAccessRule rule in actual.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
        var value = rule.IdentityReference.Value;
        if (Array.IndexOf(allowed, value) < 0 || rule.IsInherited || rule.AccessControlType != AccessControlType.Allow || rule.FileSystemRights != FileSystemRights.FullControl) throw new IOException();
        seen.Add(value);
      }
      foreach (var value in allowed) if (!seen.Contains(value)) throw new IOException();
      Console.WriteLine("ready");
      var input = new BinaryReader(Console.OpenStandardInput());
      for (;;) {
        int length = input.ReadInt32();
        if (length == 0) break;
        if (length < 0 || length > 50 * 1024 * 1024) throw new IOException();
        var bytes = input.ReadBytes(length);
        if (bytes.Length != length) throw new EndOfStreamException();
        file.Write(bytes, 0, length);
        Console.WriteLine("written");
      }
      file.Flush(true);
      file.Dispose();
      file = null;
      return 0;
    } catch {
      if (file != null) {
        byte delete = 1;
        bool removed = SetFileInformationByHandle(file.SafeFileHandle, 4, ref delete, 1);
        file.Dispose();
        if (!removed) return 2;
      }
      return 1;
    }
  }
}`;
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition '${source.replaceAll("'", "''")}'; exit ([PrivateDownload]::Run('${path.replaceAll("'", "''")}'))`;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.on("error", () => {});
  const completed = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", resolve);
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const failure = () => new AxiError("Download file could not be completed", "DOWNLOAD_FILE_ERROR", ["Check destination permissions and free space; inspect --out for an incomplete file"]);
  const send = (bytes: Uint8Array) => new Promise<void>((resolve, reject) => {
    child.stdin.write(bytes, (error) => error ? reject(failure()) : resolve());
  });
  try {
    if ((await lines.next()).value !== "ready") throw failure();
    const result = await write({ writeFile: async (bytes) => {
      if (!bytes.byteLength) return;
      const length = Buffer.alloc(4);
      length.writeInt32LE(bytes.byteLength);
      await send(length);
      await send(bytes);
      if ((await lines.next()).value !== "written") throw failure();
    } });
    await send(Buffer.alloc(4));
    child.stdin.end();
    if (await completed !== 0) throw failure();
    return result;
  } catch (error) {
    child.stdin.end();
    const status = await completed;
    if (status === 2 || status === null) throw failure();
    if (error instanceof AxiError) throw error;
    throw failure();
  }
}
