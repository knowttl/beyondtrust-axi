import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats } from "node:fs";
import { execFileSync } from "node:child_process";
import { lstat, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { AxiError } from "axi-sdk-js";
import { windowsDownload, type DownloadFile } from "./windows-download.js";

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

export type PrivateFileOptions = { platform?: NodeJS.Platform; acl?: WindowsAcl; uid?: number };
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
    try {
      const original = await file.stat();
      const current = await lstat(path);
      if (original.dev !== current.dev || original.ino !== current.ino) throw new Error("Destination changed");
      await unlink(path);
    }
    catch { throw new AxiError("Incomplete download could not be removed", "DOWNLOAD_FILE_ERROR", ["Remove the incomplete --out file before retrying"]); }
    finally { await file.close().catch(() => {}); }
    if (error instanceof AxiError) throw error;
    throw new AxiError("Download file could not be completed", "DOWNLOAD_FILE_ERROR", ["Check destination permissions and free space"]);
  }
}
export function readPrivateFile(path: string, secret: boolean, verifyAcl: boolean, options: PrivateFileOptions = {}): string {
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
  try { validate(fstatSync(fd)); return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
}
