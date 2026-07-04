// build.rs — required by napi-rs.
//
// napi_build::setup() emits cargo:rustc-cdylib-link-arg directives
// that link the output .node file against node.exe at runtime (delay-load
// on Windows). Without this the module will fail to load with
// "Entry point not found" or a missing symbol error.
extern crate napi_build;

fn main() {
  napi_build::setup();

  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-lib=framework=ApplicationServices");
}
