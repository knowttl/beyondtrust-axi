import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, type Stats } from "node:fs";
import { execFileSync } from "node:child_process";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { AxiError } from "axi-sdk-js";
import { incompleteDownloadError, windowsDownload, type DownloadFile } from "./windows-download.js";

export type WindowsAcl = (path: string, verify: boolean) => void;
export const windowsAcl: WindowsAcl = (path, verify) => {
  const quoted = `'${path.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'; $p=${quoted}; $item=Get-Item -LiteralPath $p -Force; `
    + `if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }; `
    + (verify ? `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $allowed=@($sid.Value,'S-1-5-18','S-1-5-32-544'); `
      + `$acl=Get-Acl -LiteralPath $p; if (!$acl.AreAccessRulesProtected -or ($acl.Owner -ne $sid.Translate([Security.Principal.NTAccount]).Value -and $acl.Owner -ne $sid.Value)) { throw 'Unprotected ACL' }; `
      + `$seen=@(); foreach ($r in $acl.Access) { $s=$r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if ($s -notin $allowed -or $r.IsInherited -or $r.AccessControlType -ne 'Allow' -or $r.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Unexpected ACL' }; $seen+=$s }; foreach ($s in $allowed) { if ($s -notin $seen) { throw 'Missing ACL' } }` : "");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe" });
};

export function toolDirectory(kind: "config" | "state", env = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === "win32") {
    const base = env[kind === "config" ? "APPDATA" : "LOCALAPPDATA"];
    return win32.join(base && win32.isAbsolute(base) ? base : win32.join(home, "AppData", kind === "config" ? "Roaming" : "Local"), "beyondtrust-axi");
  }
  const xdg = env[kind === "config" ? "XDG_CONFIG_HOME" : "XDG_STATE_HOME"];
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, kind === "config" ? ".config" : ".local/state"), "beyondtrust-axi");
}

export type PrivateFileOptions = { platform?: NodeJS.Platform; acl?: WindowsAcl; uid?: number; maxBytes?: number };
export async function newPrivateFile<T>(path: string, write: (file: DownloadFile) => Promise<T>): Promise<T> {
  if (process.platform === "win32") return windowsDownload(path, write);
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch { throw new AxiError("Cannot create a new download file", "DOWNLOAD_FILE_ERROR", ["Choose a new --out path in an existing writable directory"]); }
  try {
    await file.chmod(0o600);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o777) !== 0o600) throw new Error("Insecure destination");
    const result = await write(file);
    await file.sync();
    await file.close();
    return result;
  } catch (error) {
    await file.truncate(0).catch(() => {});
    await file.close().catch(() => {});
    throw incompleteDownloadError(path, error);
  }
}
export function readPrivateFile(path: string, secret: boolean, verifyAcl: boolean, options: PrivateFileOptions = {}): string {
  return readPrivateBytes(path, secret, verifyAcl, options).toString("utf8");
}
export function readPrivateBytes(path: string, secret: boolean, verifyAcl: boolean, options: PrivateFileOptions = {}): Buffer {
  const platform = options.platform ?? process.platform;
  const insecure = (): never => { throw new AxiError("Insecure private file", "CONFIG_INSECURE", [
    platform === "win32" ? "Apply a protected DACL granting FullControl only to the current user, SYSTEM and Administrators"
      : "Ensure the file is regular, owned by the current user and has mode 600",
  ]); };
  function validate(stat: Stats): void {
    if (!stat.isFile() || stat.isSymbolicLink()) insecure();
    if (platform !== "win32" && (stat.uid !== (options.uid ?? process.getuid!()) || (stat.mode & (secret ? 0o077 : 0o022)) !== 0)) insecure();
  }
  validate(lstatSync(path));
  if (platform === "win32") {
    try { (options.acl ?? windowsAcl)(path, verifyAcl); } catch { insecure(); }
  }
  const fd = openSync(path, constants.O_RDONLY | (platform === "win32" ? 0 : constants.O_NOFOLLOW));
  try {
    const stat = fstatSync(fd);
    validate(stat);
    if (options.maxBytes === undefined) return readFileSync(fd);
    const tooLarge = () => { throw new AxiError("Input file exceeds 10 MiB", "VALIDATION_ERROR"); };
    if (stat.size > options.maxBytes) tooLarge();
    const bytes = Buffer.alloc(options.maxBytes + 1);
    let size = 0;
    for (;;) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      size += count;
      if (size > options.maxBytes) tooLarge();
      if (!count) return bytes.subarray(0, size);
    }
  } finally { closeSync(fd); }
}
