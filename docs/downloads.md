# Downloads

The [command reference](commands.md) lists the flags for computer log download, policy download, policy revision download, and api-definition download.
For permission gates, content limits and output fields, see [Safety](../README.md#safety).
Downloads stream through the originally created private file handle without reopening the destination by pathname.
Success metadata bypasses the usual string preview limit, so the resolved absolute path remains complete without --full, with secret-derived strings redacted.

On Windows, downloads require Windows PowerShell and its .NET Framework FileStream support for creation with a FileSecurity descriptor.
The file is created exclusively with a protected DACL granting FullControl only to the current user, SYSTEM and Administrators, with no inherited entries.
That DACL and ownership are verified through the same open handle before authentication or download requests; the handle denies sharing until closed.
The offline tests in [test/downloads.test.ts](../test/downloads.test.ts) exercise the Windows creation, ACL and sharing behavior only when run on Windows.
A run on another platform does not verify this Windows mechanism; long-path metadata and injected filesystem-failure tests are skipped on Windows.

On any failure after creation, the tool attempts to truncate the partial content through that same open handle and closes it.
It leaves the file for the operator to inspect and remove before retrying, and never unlinks a download by pathname.
The error preserves its cause code and names the partial destination with secrets redacted.
Truncation is best-effort, so the file may still contain partial content if truncation fails or the process terminates unexpectedly.
If another process has moved or replaced the destination, cleanup still acts only on the originally opened file; inspect any moved file as well as --out before removing anything.
An existing file or symlink refused during exclusive creation is left untouched.
