#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_os = "windows")]
pub mod windows_listener;

fn main() {}
