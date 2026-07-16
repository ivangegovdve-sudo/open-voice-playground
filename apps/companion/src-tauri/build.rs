fn main() {
    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let icon_path = out_dir.join("open-voice-companion.ico");
    // Deterministic one-pixel ICO generated into target/. No binary asset is downloaded or tracked.
    let mut icon = vec![0, 0, 1, 0, 1, 0];
    icon.extend_from_slice(&[1, 1, 0, 0, 1, 0, 32, 0, 48, 0, 0, 0, 22, 0, 0, 0]);
    icon.extend_from_slice(&40_u32.to_le_bytes());
    icon.extend_from_slice(&1_i32.to_le_bytes());
    icon.extend_from_slice(&2_i32.to_le_bytes());
    icon.extend_from_slice(&1_u16.to_le_bytes());
    icon.extend_from_slice(&32_u16.to_le_bytes());
    icon.extend_from_slice(&0_u32.to_le_bytes());
    icon.extend_from_slice(&4_u32.to_le_bytes());
    icon.extend_from_slice(&0_i32.to_le_bytes());
    icon.extend_from_slice(&0_i32.to_le_bytes());
    icon.extend_from_slice(&0_u32.to_le_bytes());
    icon.extend_from_slice(&0_u32.to_le_bytes());
    icon.extend_from_slice(&[0xB3, 0x6A, 0x2D, 0xFF, 0, 0, 0, 0]);
    std::fs::write(&icon_path, icon).expect("write generated Windows icon");
    let windows = tauri_build::WindowsAttributes::new().window_icon_path(icon_path);
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("build Tauri context");
}
