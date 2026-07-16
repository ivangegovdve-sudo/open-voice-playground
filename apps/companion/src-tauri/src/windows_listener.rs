use std::{net::SocketAddr, os::windows::io::AsRawSocket};

use open_voice_companion::server::{
    FIXED_LISTENER_ADDR, FixedListenerPort, LISTENER_BACKLOG, ListenerError,
};
use tokio::net::{TcpListener, TcpSocket};
use windows::Win32::Networking::WinSock::{
    SO_EXCLUSIVEADDRUSE, SOCKET, SOCKET_ERROR, SOL_SOCKET, WSAGetLastError, setsockopt,
};

#[derive(Clone, Copy, Debug)]
pub struct WindowsExclusiveListenerPort;

impl WindowsExclusiveListenerPort {
    pub const fn new() -> Self {
        Self
    }
}

impl Default for WindowsExclusiveListenerPort {
    fn default() -> Self {
        Self::new()
    }
}

impl FixedListenerPort for WindowsExclusiveListenerPort {
    fn bind_fixed(&self) -> Result<TcpListener, ListenerError> {
        bind_exclusive_fixed().map_err(|failure| classify_raw_error(failure.raw_os_error))
    }
}

struct WindowsBindFailure {
    raw_os_error: Option<i32>,
}

impl WindowsBindFailure {
    const fn from_raw(raw_os_error: Option<i32>) -> Self {
        Self { raw_os_error }
    }

    fn from_io(error: &std::io::Error) -> Self {
        Self::from_raw(error.raw_os_error())
    }
}

const fn classify_raw_error(raw_os_error: Option<i32>) -> ListenerError {
    match raw_os_error {
        Some(10_013) | Some(10_048) => ListenerError::Conflict,
        _ => ListenerError::Unavailable,
    }
}

fn bind_exclusive_fixed() -> Result<TcpListener, WindowsBindFailure> {
    let socket = TcpSocket::new_v4().map_err(|error| WindowsBindFailure::from_io(&error))?;
    let enabled = 1_i32.to_ne_bytes();
    let socket_handle = SOCKET(
        usize::try_from(socket.as_raw_socket()).map_err(|_| WindowsBindFailure::from_raw(None))?,
    );
    // SAFETY: socket_handle borrows the live Tokio TcpSocket; enabled is a valid
    // four-byte BOOL buffer for this call; neither ownership nor buffer escapes.
    let result = unsafe {
        setsockopt(
            socket_handle,
            SOL_SOCKET,
            SO_EXCLUSIVEADDRUSE,
            Some(&enabled),
        )
    };
    if result == SOCKET_ERROR {
        // SAFETY: called immediately after the failed Winsock call on this thread.
        let raw = unsafe { WSAGetLastError() }.0;
        return Err(WindowsBindFailure::from_raw(Some(raw)));
    }
    socket
        .bind(SocketAddr::V4(FIXED_LISTENER_ADDR))
        .map_err(|error| WindowsBindFailure::from_io(&error))?;
    socket
        .listen(LISTENER_BACKLOG)
        .map_err(|error| WindowsBindFailure::from_io(&error))
}

#[cfg(test)]
mod tests {
    use std::{
        net::{Ipv4Addr, SocketAddr, SocketAddrV4},
        sync::Arc,
        time::{Duration, Instant},
    };

    use async_trait::async_trait;
    use open_voice_companion::http_dispatch::{
        AuthError, AuthPermit, AuthPort, AuthRequest, HandlerContext, HandlerError, HandlerPort,
        HandlerRequest, HandlerSuccess,
    };
    use open_voice_companion::origin::OriginPolicy;
    use open_voice_companion::rate::{RateLimitError, RateLimitPort, RatePermit, RateRequest};
    use open_voice_companion::scheduler::Clock;
    use open_voice_companion::server::{
        CompanionServer, FIXED_LISTENER_ADDR, FixedListenerPort, LISTENER_BACKLOG, LISTENER_PORT,
        ListenerError, ServerPorts,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpSocket, TcpStream},
        time::{sleep, timeout},
    };

    use super::{WindowsExclusiveListenerPort, bind_exclusive_fixed, classify_raw_error};

    fn ordinary_fixed_listener() -> TcpListener {
        let socket = TcpSocket::new_v4().expect("ordinary IPv4 socket");
        socket
            .bind(SocketAddr::V4(FIXED_LISTENER_ADDR))
            .expect("ordinary fixed bind");
        socket
            .listen(LISTENER_BACKLOG)
            .expect("ordinary fixed listen")
    }

    struct NeverHandler;

    #[async_trait]
    impl HandlerPort for NeverHandler {
        async fn handle(
            &self,
            _context: HandlerContext,
            _request: HandlerRequest,
        ) -> Result<HandlerSuccess, HandlerError> {
            Err(HandlerError::RuntimeUnavailable)
        }
    }

    struct DenyAuth;

    #[async_trait]
    impl AuthPort for DenyAuth {
        async fn reserve(&self, _request: AuthRequest) -> Result<Box<dyn AuthPermit>, AuthError> {
            Err(AuthError::Unavailable)
        }
    }

    struct DenyRate;

    impl RateLimitPort for DenyRate {
        fn reserve(&self, _request: RateRequest) -> Result<Box<dyn RatePermit>, RateLimitError> {
            Err(RateLimitError::Unavailable)
        }
    }

    struct NativeClock;

    impl Clock for NativeClock {
        fn monotonic(&self) -> Instant {
            Instant::now()
        }

        fn utc(&self) -> time::OffsetDateTime {
            time::OffsetDateTime::now_utc()
        }
    }

    fn production_ports() -> ServerPorts {
        ServerPorts::new(
            Arc::new(NeverHandler),
            Arc::new(DenyAuth),
            Arc::new(DenyRate),
            Arc::new(NativeClock),
            Arc::new(WindowsExclusiveListenerPort::new()),
        )
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn c9_windows_exclusive_bind_blocks_both_directions_and_maps_both_codes() {
        assert_eq!(LISTENER_PORT, 17_843);
        assert_eq!(LISTENER_BACKLOG, 32);
        assert_eq!(
            FIXED_LISTENER_ADDR,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, 17_843)
        );
        assert_eq!(classify_raw_error(Some(10_013)), ListenerError::Conflict);
        assert_eq!(classify_raw_error(Some(10_048)), ListenerError::Conflict);
        assert_eq!(classify_raw_error(Some(12_345)), ListenerError::Unavailable);
        assert_eq!(classify_raw_error(None), ListenerError::Unavailable);

        let exclusive = bind_exclusive_fixed().unwrap_or_else(|_| panic!("exclusive fixed bind"));
        assert_eq!(
            exclusive.local_addr().expect("exclusive local address"),
            SocketAddr::V4(FIXED_LISTENER_ADDR)
        );
        let reuse = TcpSocket::new_v4().expect("reuse socket");
        reuse
            .set_reuseaddr(true)
            .expect("enable reuse for hostile bind");
        let reuse_error = reuse
            .bind(SocketAddr::V4(FIXED_LISTENER_ADDR))
            .expect_err("exclusive first bind must block reuse bind");
        assert_eq!(reuse_error.raw_os_error(), Some(10_013));
        assert!(matches!(
            WindowsExclusiveListenerPort::new().bind_fixed(),
            Err(ListenerError::Conflict)
        ));
        drop(exclusive);

        let ordinary = ordinary_fixed_listener();
        let exclusive_error = match bind_exclusive_fixed() {
            Ok(_) => panic!("ordinary first bind must block exclusive bind"),
            Err(error) => error,
        };
        assert_eq!(exclusive_error.raw_os_error, Some(10_048));
        drop(ordinary);

        let ordinary = ordinary_fixed_listener();
        assert!(matches!(
            WindowsExclusiveListenerPort::new().bind_fixed(),
            Err(ListenerError::Conflict)
        ));
        drop(ordinary);

        let rebound = WindowsExclusiveListenerPort::new()
            .bind_fixed()
            .expect("immediate exclusive rebind");
        assert_eq!(
            rebound.local_addr().expect("rebound local address"),
            SocketAddr::V4(FIXED_LISTENER_ADDR)
        );
        drop(rebound);

        let alternate = TcpSocket::new_v4().expect("alternate socket");
        alternate
            .bind(SocketAddr::V4(SocketAddrV4::new(
                Ipv4Addr::LOCALHOST,
                LISTENER_PORT + 1,
            )))
            .expect("production binder must not consume an alternate port");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn c9_windows_exclusive_rebind_cycles_and_full_server_shutdowns() {
        for _ in 0..16 {
            let listener = WindowsExclusiveListenerPort::new()
                .bind_fixed()
                .expect("exclusive bind cycle");
            assert_eq!(
                listener.local_addr().expect("cycle local address"),
                SocketAddr::V4(FIXED_LISTENER_ADDR)
            );
            drop(listener);
        }

        for _ in 0..4 {
            let server = CompanionServer::start(OriginPolicy::debug_local(), production_ports())
                .await
                .expect("production exclusive full server cycle");
            let mut stream = TcpStream::connect(server.local_addr()).await.unwrap();
            stream.write_all(b"G").await.unwrap();
            timeout(Duration::from_secs(2), async {
                loop {
                    let metrics = server.metrics();
                    if metrics.active_connections == 1 && metrics.tracked_connection_tasks == 1 {
                        break;
                    }
                    sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .expect("accepted socket becomes tracked");
            let final_metrics = server.shutdown().await;
            assert_eq!(final_metrics.active_connections, 0);
            assert_eq!(final_metrics.tracked_connection_tasks, 0);
            assert_eq!(final_metrics.occupied_handler_slots, 0);

            let mut byte = [0_u8; 1];
            match timeout(Duration::from_secs(1), stream.read(&mut byte)).await {
                Ok(Ok(0)) => {}
                Ok(Err(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset
                            | std::io::ErrorKind::ConnectionAborted
                            | std::io::ErrorKind::BrokenPipe
                    ) => {}
                other => panic!("cancelled production socket remained writable: {other:?}"),
            }
        }
    }
}
