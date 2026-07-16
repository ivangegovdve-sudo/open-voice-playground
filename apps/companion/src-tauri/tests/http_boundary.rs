use std::{net::SocketAddr, time::Duration};

use open_voice_companion::{
    origin::OriginPolicy,
    server::{CompanionServer, ListenerError},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::{sleep, timeout},
};

const GOOD_ORIGIN: &str = "http://127.0.0.1:5173";
static FIXED_PORT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn request(method: &str, target: &str, extra: &str) -> String {
    format!(
        "{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n{extra}\r\n"
    )
}

async fn roundtrip(raw: impl AsRef<[u8]>) -> String {
    let mut stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    stream.write_all(raw.as_ref()).await.unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(2), stream.read_to_end(&mut response))
        .await
        .expect("server must close one-request connection")
        .unwrap();
    String::from_utf8(response).unwrap()
}

fn assert_security_headers(response: &str) {
    assert!(response.contains("\r\nCache-Control: no-store\r\n"));
    assert!(response.contains("\r\nX-Content-Type-Options: nosniff\r\n"));
    assert!(!response.to_ascii_lowercase().contains("set-cookie"));
    assert!(
        !response
            .to_ascii_lowercase()
            .contains("access-control-allow-credentials")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fixed_ipv4_raw_http_boundary_fails_closed() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");
    assert_eq!(
        server.local_addr(),
        SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, 17_843))
    );
    assert_eq!(
        CompanionServer::start(OriginPolicy::debug_local())
            .await
            .unwrap_err(),
        ListenerError::Conflict
    );

    let health = roundtrip(request("GET", "/v1/health", "")).await;
    assert!(health.starts_with("HTTP/1.1 200 OK\r\n"));
    assert!(health.contains("\"listenerState\":\"listening\""));
    assert!(health.contains(&format!("Access-Control-Allow-Origin: {GOOD_ORIGIN}")));
    assert_security_headers(&health);

    for bad_host in [
        "",
        "Host: 127.0.0.1:17843\r\nHost: 127.0.0.1:17843\r\n",
        "Host: 127.0.0.1:17843, localhost:17843\r\n",
        "Host: localhost:17843\r\n",
        "Host: 127.0.0.1.:17843\r\n",
        "Host: 127.0.0.1:17844\r\n",
        "Host: [::1]:17843\r\n",
        "Host: user@127.0.0.1:17843\r\n",
    ] {
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\n{bad_host}Origin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\n\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(
            response.starts_with("HTTP/1.1 400 Bad Request"),
            "{bad_host:?}"
        );
        assert!(response.contains("\"code\":\"host-invalid\""));
        assert_security_headers(&response);
    }

    let absolute_mismatch = roundtrip(request("GET", "http://localhost:17843/v1/health", "")).await;
    assert!(absolute_mismatch.contains("\"code\":\"host-invalid\""));

    for (origin_header, code) in [
        ("", "origin-missing"),
        ("Origin: null\r\n", "origin-denied"),
        ("Origin: file://\r\n", "origin-denied"),
        ("Origin: https://preview.example\r\n", "origin-denied"),
        (
            "Origin: http://127.0.0.1:5173\r\nOrigin: http://127.0.0.1:5173\r\n",
            "origin-denied",
        ),
    ] {
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:17843\r\n{origin_header}X-OVP-Client-Version: 1.0.0\r\n\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(response.contains(&format!("\"code\":\"{code}\"")));
        assert!(!response.contains("Access-Control-Allow-Origin"));
    }

    for (version, code) in [("", "version-missing"), ("2.0.0", "version-unsupported")] {
        let version_header = if version.is_empty() {
            String::new()
        } else {
            format!("X-OVP-Client-Version: {version}\r\n")
        };
        let raw = format!(
            "GET /v1/health HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\n{version_header}\r\n"
        );
        let response = roundtrip(raw).await;
        assert!(response.contains(&format!("\"code\":\"{code}\"")));
    }

    for headers in [
        "Authorization: Bearer a\r\nAuthorization: Bearer b\r\n",
        "Content-Length: 1\r\nContent-Length: 1\r\n",
        "Content-Length: 1\r\nTransfer-Encoding: chunked\r\n",
        "Transfer-Encoding: gzip\r\n",
    ] {
        let response = roundtrip(request("POST", "/v1/pairings/challenges", headers)).await;
        assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
        assert_security_headers(&response);
    }

    let oversize = roundtrip(request(
        "POST",
        "/v1/pairings/challenges",
        "Content-Type: application/json\r\nContent-Length: 16385\r\n",
    ))
    .await;
    assert!(oversize.starts_with("HTTP/1.1 413 Payload Too Large"));
    assert!(oversize.contains("\"code\":\"body-too-large\""));

    let preflight = roundtrip(format!(
        "OPTIONS /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Authorization, Content-Type, X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: true\r\n\r\n"
    ))
    .await;
    assert!(preflight.starts_with("HTTP/1.1 204 No Content"));
    assert!(preflight.contains("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS"));
    assert!(preflight.contains(
        "Access-Control-Allow-Headers: Authorization, Content-Type, X-OVP-Client-Version"
    ));
    assert!(preflight.contains("Access-Control-Max-Age: 600"));
    assert!(preflight.contains("Access-Control-Allow-Private-Network: true"));
    assert!(preflight.contains("Access-Control-Request-Private-Network"));
    assert_security_headers(&preflight);

    let invalid_preflight = roundtrip(format!(
        "OPTIONS /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nAccess-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: X-Evil\r\n\r\n"
    ))
    .await;
    assert!(invalid_preflight.starts_with("HTTP/1.1 403 Forbidden"));
    assert!(!invalid_preflight.contains("Access-Control-Allow-Origin"));

    let long_target = format!("/{}", "a".repeat(2_048));
    let response = roundtrip(request("GET", &long_target, "")).await;
    assert!(response.contains("\"code\":\"request-line-too-large\""));

    let large_header = "X-Fill: ".to_owned() + &"a".repeat(8_192) + "\r\n";
    let response = roundtrip(request("GET", "/v1/health", &large_header)).await;
    assert!(response.contains("\"code\":\"headers-too-large\""));

    let before = server.metrics();
    let mut prebody = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    prebody
        .write_all(
            b"POST /v1/pairings/challenges HTTP/1.1\r\nHost: localhost:17843\r\nOrigin: http://127.0.0.1:5173\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Length: 100\r\n\r\n",
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    timeout(Duration::from_secs(1), prebody.read_to_end(&mut response))
        .await
        .expect("bad Host must reject without waiting for body")
        .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"host-invalid\"")
    );
    assert_eq!(server.metrics().body_reads, before.body_reads);

    let mut held = Vec::new();
    for _ in 0..40 {
        if let Ok(mut stream) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843)).await {
            let _ = stream.write_all(b"G").await;
            held.push(stream);
        }
    }
    sleep(Duration::from_millis(100)).await;
    let metrics = server.metrics();
    assert!(metrics.peak_connections <= 32);
    assert!(metrics.peak_in_flight <= 8);
    drop(held);

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_header_and_body_deadlines_close_slow_requests() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");

    let mut slow_header = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    slow_header.write_all(b"GET /v1/health").await.unwrap();
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(6),
        slow_header.read_to_end(&mut response),
    )
    .await
    .expect("five second header deadline")
    .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"header-timeout\"")
    );

    let mut slow_body = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, 17_843))
        .await
        .unwrap();
    slow_body
        .write_all(
            request(
                "POST",
                "/v1/pairings/challenges",
                "Content-Type: application/json\r\nContent-Length: 10\r\n",
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    timeout(
        Duration::from_secs(11),
        slow_body.read_to_end(&mut response),
    )
    .await
    .expect("ten second absolute body deadline")
    .unwrap();
    assert!(
        String::from_utf8(response)
            .unwrap()
            .contains("\"code\":\"body-timeout\"")
    );

    server.shutdown().await;
}
