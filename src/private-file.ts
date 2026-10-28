import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, type Stats } from "node:fs";
import { execFileSync } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { AxiError } from "axi-sdk-js";

export type WindowsAcl = (path: string, verify: boolean, protect?: boolean) => void;
export const windowsAcl: WindowsAcl = (path, verify, protect = false) => {
  const quoted = `'${path.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference='Stop'; $p=${quoted}; $item=Get-Item -LiteralPath $p -Force; `
    + `if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point' }; `
    + (protect ? `$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); `
      + `foreach ($s in @($sid.Value,'S-1-5-18','S-1-5-32-544')) { $identity=New-Object Security.Principal.SecurityIdentifier($s); $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $p -AclObject $acl; ` : "")
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
export async function newPrivateFile<T>(path: string, write: (file: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  let file;
  try { file = await open(path, "wx", 0o600); }
  catch { throw new AxiError("Cannot create a new download file", "DOWNLOAD_FILE_ERROR", ["Choose a new --out path in an existing writable directory"]); }
  try {
    if (process.platform === "win32") windowsAcl(path, true, true);
    else await file.chmod(0o600);
    const result = await write(file);
    await file.sync();
    await file.close();
    return result;
  } catch (error) {
    await file.close().catch(() => {});
    try { await unlink(path); }
    catch { throw new AxiError("Incomplete download could not be removed", "DOWNLOAD_FILE_ERROR", ["Remove the incomplete --out file before retrying"]); }
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
