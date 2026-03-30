# Native Windows Core — Dependency Upgrade Notes

**Date:** 2026-03-29  
**Scope:** `native/windows-core` only

---

## Dependency Versions Changed

| Dependency | Old | New |
|---|---|---|
| `napi` (Rust crate) | `"2"` | `"3"` (resolves to 3.8.4) |
| `napi-derive` (Rust crate) | `"2"` | `"3"` (resolves to 3.5.3) |
| `napi-build` (Rust build dep) | `"2"` | `"2.3"` (resolves to 2.3.1) |
| `windows` (Rust crate) | `"0.58"` | `"0.62"` (resolves to 0.62.2) |
| `@napi-rs/cli` (npm dev dep) | `^2.18.0` | `^3.6.0` |

---

## Source Changes Required

### `src/hook.rs`

- **Removed** `ErrorStrategy` from the `napi::threadsafe_function` import — eliminated as a type parameter in napi v3.
- **Added** `use napi_derive::napi` import.
- **Added** `#[napi(object)]` attribute on `TriggerData` struct — napi v3 requires the TSFN data type to implement `ToNapiValue`, which this derive macro generates. It also auto-converts `trigger_len` → `triggerLen` (camelCase) in the emitted JS object.
- **Changed** `type Tsfn` — removed `ErrorStrategy::Fatal` second type parameter: `ThreadsafeFunction<TriggerData>`.
- **Changed** `tsfn.call(data, ...)` → `tsfn.call(Ok(data), ...)` — napi v3 call signature wraps the value in `Result<T, Error>`.
- **Changed** both `CallNextHookEx(HHOOK::default(), ...)` → `CallNextHookEx(Some(HHOOK::default()), ...)` — windows 0.62 made nullable handle arguments explicitly `Option<T>`.
- **Changed** `SetWindowsHookExW(..., HINSTANCE::default(), ...)` → `SetWindowsHookExW(..., Some(HINSTANCE::default()), ...)` — same reason.

### `src/lib.rs`

- **Removed** imports: `ErrorStrategy`, `ThreadSafeCallContext`, `napi::JsFunction` — all removed or deprecated in napi v3.
- **Changed** `start_hook` parameter from `callback: JsFunction` to `callback: ThreadsafeFunction<hook::TriggerData>` — napi v3 allows declaring the TSFN as a direct `#[napi]` function parameter; the framework generates the JS function → TSFN conversion automatically using the `ToNapiValue` impl on `TriggerData`.
- **Removed** the entire manual TSFN builder closure (`create_threadsafe_function` + `ThreadSafeCallContext` + `create_object` block) — now redundant; object shape is driven by `#[napi(object)]` on `TriggerData`.

### `src/replacement.rs`

- **Changed** `IsWindow(hwnd)` → `IsWindow(Some(hwnd))` — windows 0.62 nullable param.
- **Changed** all three `SendMessageW` calls — `wParam`/`lParam` are now `Option<WPARAM>` / `Option<LPARAM>` in 0.62; wrapped each with `Some(...)`.
- **Changed** all three `OpenClipboard(HWND(std::ptr::null_mut()))` → `OpenClipboard(None)` — windows 0.62 `hwndNewOwner` is now `Option<HWND>`; `None` is the idiomatic null.
- **Changed** both `SetClipboardData(CF_UNICODETEXT, HANDLE(hmem.0))` → `SetClipboardData(CF_UNICODETEXT, Some(HANDLE(hmem.0)))` — data handle param is now `Option<HANDLE>`.

---

## Steps to Sync

```bash
# 1. Pull the latest changes
git pull

# 2. Install updated npm dev dependency (@napi-rs/cli v3)
cd native/windows-core
npm install

# 3. Rebuild the native .node binary
npm run build

# 4. Verify it compiles cleanly
cargo check
```

> **Note:** The `Cargo.lock` file is committed and already reflects the resolved versions above. Running `cargo check` or `cargo build` will use the locked versions without needing an extra `cargo update`.
