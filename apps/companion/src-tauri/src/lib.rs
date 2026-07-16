#![forbid(unsafe_code)]

//! Protocol and native boundary for the fail-closed companion.

pub mod deep_link;
pub mod http_dispatch;
mod http_response;
pub mod origin;
pub mod pairing;
pub mod protocol;
pub mod rate;
pub mod router;
pub mod scheduler;
pub mod schema;
mod secret;
pub mod server;
