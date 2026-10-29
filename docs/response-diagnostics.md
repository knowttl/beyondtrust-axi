# Response diagnostics copy contract

`src/response-diagnostics.ts` is the canonical, self-contained TypeScript helper.
Change it here and re-copy it byte-for-byte into consumers; do not edit copies.
Inject the consumer's redactor through `{ text(value: string): string }` and pass its response-invalid codes as the optional second constructor argument.
The default codes are `API_RESPONSE_INVALID` and `AUTH_RESPONSE_INVALID`.
Render `forError(error)` as structured fields beside the stable error message.
Never put diagnostics inside the message.

`record(status, headers, data)` replaces the previous response's diagnostics.
Only integer HTTP statuses from 100 through 599 and media types of at most 128 characters are accepted; other metadata becomes null.
Content-type parameters are discarded before redaction.
Values and validator messages are never emitted.
Keys use the existing identifier-only rule: an ASCII letter followed by up to 39 ASCII letters, digits or underscores, excluding GUID-like keys.
Other keys become `<key>` before redaction.
Arrays carry a `count` and only their first element is visited at `[*]`.
The report stops at 64 entries, depth 4, 256 characters per path or 4096 total path characters.

`validationFailed(issues)` adds bounded `issuePaths` using the same key policy and `[*]` for array indices.
Recognized validator `expected` types annotate matching received `shape` entries, whose `type` describes the received value.
Arbitrary expected strings, messages and other validator fields are ignored.
Array paths describe the first element only, even when later elements differ.
`shapeTruncated` and `issuePathsTruncated` report budget exhaustion separately.
Successful command output and response validation remain owned by the consumer.

`test/fixtures/response-diagnostics-vectors.json` contains portable synthetic inputs and expected diagnostics for TypeScript copies and language ports.
Absent `contentType` means no header; absent `issues` means no validation callback.
Optional `secrets` use literal replacement with `***redacted***` for the vector redactor.
`test/fixtures/response-diagnostics-sha256.json` records SHA-256 hashes of the canonical source and the vectors.
After an intentional contract change, update those hashes and the vectors together.
Each consumer must verify its copied bytes against those recorded hashes and execute the vectors through the helper's public interface.
