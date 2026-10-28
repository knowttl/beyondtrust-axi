# Configuration

No command writes configuration or discovers it from the current directory.
Config precedence is --config, BEYONDTRUST_AXI_CONFIG, then the platform path.
Profile precedence is --profile, BEYONDTRUST_AXI_PROFILE, complete environment profile, config defaultProfile, then sole file profile.
File metadata never mixes with environment profile fields; SecretRefs may explicitly name environment variables.
The default SecretRef alone does not select an environment profile.

```json
{
  "version": 1,
  "defaultProfile": "example",
  "profiles": {
    "example": {
      "host": "example.pm.beyondtrustcloud.com",
      "clientId": "synthetic-client",
      "clientSecret": { "env": "BEYONDTRUST_AXI_CLIENT_SECRET" },
      "downloads": { "allow": false },
      "writes": { "allowWrites": false, "allowDeletes": false, "operations": [] }
    }
  }
}
```

The host is a lowercase DNS name ending .beyondtrustcloud.com, without scheme, port, path, userinfo or IP.
The origin is always HTTPS; later transport will reject redirects and never switch hosts.
clientSecret accepts only an env or absolute file SecretRef, never an inline value.
Omitting clientSecret uses BEYONDTRUST_AXI_CLIENT_SECRET.
Config and secret files must be regular, owned by the current user and not symlinks.
POSIX config files cannot be group/other writable; secret files must have no group/other permissions (use 0600).
On Windows, auth status requires a protected DACL granting FullControl only to the current user, SYSTEM and Administrators.
Discovery does not resolve secret files; auth status validates them locally and never exchanges a token.
Secret files strip a BOM and trailing whitespace; secrets and their escaped/encoded forms are redacted before output truncation.

| Variable | Purpose | Default |
|---|---|---|
| BEYONDTRUST_AXI_CONFIG | Config path override | Platform path |
| BEYONDTRUST_AXI_PROFILE | Named file profile | Selection precedence |
| BEYONDTRUST_AXI_HOST | Environment profile host | Required with client ID and secret |
| BEYONDTRUST_AXI_CLIENT_ID | Environment profile client ID | Required with host and secret |
| BEYONDTRUST_AXI_CLIENT_SECRET | Default secret source | Required for env profile |
| BEYONDTRUST_AXI_READ_ONLY | Forced read-only: 1/true, 0/false | Unset |
| XDG_CONFIG_HOME | Absolute Unix config base | ~/.config |
| XDG_STATE_HOME | Absolute Unix state base | ~/.local/state |
| APPDATA | Absolute Windows config base | ~/AppData/Roaming |
| LOCALAPPDATA | Absolute Windows state base | ~/AppData/Local |

Unix defaults are ~/.config/beyondtrust-axi/config.json and ~/.local/state/beyondtrust-axi.
Windows defaults use APPDATA/beyondtrust-axi/config.json and LOCALAPPDATA/beyondtrust-axi.
Windows ignores XDG; relative base overrides use platform defaults.
Partial environment profiles fail closed; environment profiles never enable writes, deletes or downloads.
Unknown profile fields and invalid read-only overrides fail closed.
File profiles default downloads.allow, writes.allowWrites and writes.allowDeletes to false with no allowed operations.
Only B1 local commands are executable; setting permissions does not add API commands.
