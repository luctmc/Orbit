fn main() {
    println!("cargo:rerun-if-changed=native/Dictation.swift");
    println!("cargo:rerun-if-changed=Info.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let build_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let out = build_dir.join("orbit-dictation");
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let target = if arch == "aarch64" { "arm64-apple-macosx12.0" } else { "x86_64-apple-macosx12.0" };
        let status = std::process::Command::new("xcrun").args(["swiftc", "native/Dictation.swift", "-O", "-target", target,
            "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Info.plist", "-o"])
            .arg(&out).arg("-module-cache-path").arg(build_dir.join("swift-cache"))
            .status().expect("swiftc necessário para compilar o ditado nativo");
        assert!(status.success(), "falha ao compilar o ditado nativo");
    }
    tauri_build::build()
}
