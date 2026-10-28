# Downloads

The [command reference](commands.md) lists the flags for computer log download, policy download, policy revision download, and api-definition download.
All four commands require downloads.allow in a named file profile and an exclusive new --out destination.
They stream raw bytes through the originally created private file handle, with a 50 MiB cap, and report the complete redacted path, size, sha256, and contentType on success.

On any failure after creation, the tool attempts to truncate the partial content through that same open handle and closes it.
It leaves the file for the operator to inspect and remove before retrying, and never unlinks a download by pathname.
The error preserves its cause code and names the partial destination with secrets redacted.
Truncation is best-effort, so the file may still contain partial content if truncation fails or the process terminates unexpectedly.
If another process has moved or replaced the destination, cleanup still acts only on the originally opened file; inspect any moved file as well as --out before removing anything.
An existing file or symlink refused during exclusive creation is left untouched.
