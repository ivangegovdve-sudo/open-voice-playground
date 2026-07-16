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

fn assert_problem(response: &str, status: &str, code: &str) {
    assert!(
        response.starts_with(&format!("HTTP/1.1 {status}\r\n")),
        "expected {status} for {code}, got {response:?}"
    );
    assert!(
        response.contains(&format!("\"code\":\"{code}\"")),
        "expected {code}, got {response:?}"
    );
    assert_security_headers(response);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_rejects_non_origin_forms_without_whatwg_equivalence() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");

    let rejected_targets = [
        "http://127.0.0.1:17843/v1/health",
        "HTTP://127.0.0.1:17843/v1/health",
        "https://127.0.0.1:17843/v1/health",
        "http://localhost:17843/v1/health",
        "http://127.0.0.1.:17843/v1/health",
        "http://127.1:17843/v1/health",
        "http://0177.0.0.1:17843/v1/health",
        "http://0x7f000001:17843/v1/health",
        "http://2130706433:17843/v1/health",
        "http://[::1]:17843/v1/health",
        "http://127.0.0.1/v1/health",
        "http://127.0.0.1:17844/v1/health",
        "http://127.0.0.1:80/v1/health",
        "http:///v1/health",
        "http://user@127.0.0.1:17843/v1/health",
        "http://@127.0.0.1:17843/v1/health",
        r"http:\\127.0.0.1:17843\v1\health",
        r"http://127.0.0.1:17843\v1\health",
        "127.0.0.1:17843",
        "//127.0.0.1:17843/v1/health",
        "*",
    ];
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    for target in rejected_targets {
        let before = server.metrics().body_reads;
        let response = roundtrip(request("GET", target, &authorization)).await;
        assert_problem(&response, "400 Bad Request", "host-invalid");
        assert_eq!(
            server.metrics().body_reads,
            before,
            "non-origin target reached body polling: {target:?}"
        );
        assert!(!response.contains(target), "raw target leaked: {target:?}");
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_rejects_queries_fragments_and_normalization_aliases() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");

    let rejected_targets = [
        "/v1/health?",
        "/v1/health?x=1",
        "/v1/health#C7_RAW_TARGET_SENTINEL",
        "/v1/%68ealth",
        "/v1/health%3f",
        "/v1/health%2F",
        r"/v1\health",
        r"/v1/health\",
        "/v1//health",
        "/v1/health/",
        "/v1/./health",
        "/v1/../health",
        "/./v1/health",
        "/v1/ health",
        "/v1/\u{1f}health",
        "/v1/\u{7f}health",
        "/v1/héalth",
        "/v1/h\u{80}ealth",
    ];
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    for target in rejected_targets {
        let before = server.metrics().body_reads;
        let response = roundtrip(request("GET", target, &authorization)).await;
        assert_problem(&response, "400 Bad Request", "schema-invalid");
        assert_eq!(
            server.metrics().body_reads,
            before,
            "invalid origin form reached body polling: {target:?}"
        );
        assert!(
            !response.contains("C7_RAW_TARGET_SENTINEL"),
            "raw target leaked: {target:?}"
        );
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_classifies_unknown_wrong_method_and_bad_parameters_before_auth() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));

    let cases = vec![
        (
            "GET",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "POST",
            "/v1/C7_RAW_TARGET_SENTINEL",
            format!("{authorization}Content-Type: application/json\r\n"),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "DELETE",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "PUT",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "HEAD",
            "/v1/C7_RAW_TARGET_SENTINEL",
            authorization.clone(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "OPTIONS",
            "/v1/C7_RAW_TARGET_SENTINEL",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "POST",
            "/v1/health",
            format!("{authorization}Content-Type: application/json\r\n"),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "DELETE",
            "/v1/pairings/challenges",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "GET",
            "/v1/jobs",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "get",
            "/v1/health",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "BREW",
            "/v1/health",
            authorization.clone(),
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "POST",
            "/v1/pairings/challenges/not-a-uuid/redeem",
            "Content-Type: application/json\r\n".to_owned(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/jobs/not-a-uuid",
            authorization.clone(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/jobs/not-a-uuid/audio",
            authorization.clone(),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "POST",
            "/v1/packs/not-a-pack/actions",
            format!("{authorization}Content-Type: application/json\r\n"),
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "GET",
            "/v1/runtime",
            String::new(),
            "401 Unauthorized",
            "auth-missing",
        ),
        (
            "GET",
            "/v1/runtime",
            authorization,
            "401 Unauthorized",
            "auth-invalid",
        ),
    ];

    for (method, target, extra, status, code) in cases {
        let before = server.metrics().body_reads;
        let response = roundtrip(request(method, target, &extra)).await;
        assert_problem(&response, status, code);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "route classification reached body polling: {method} {target}"
        );
        assert!(
            !response.contains("C7_RAW_TARGET_SENTINEL"),
            "raw target leaked: {method} {target}"
        );
    }

    server.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_buffered_body_overrun_precedes_protected_auth() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");
    let authorization = format!("Authorization: Bearer {}\r\n", "S".repeat(43));
    let raw = format!(
        "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\nX-OVP-Client-Version: 1.0.0\r\nContent-Type: application/json\r\nContent-Length: 0\r\n{authorization}\r\nX"
    );

    let before = server.metrics().body_reads;
    let response = roundtrip(raw).await;
    assert_problem(&response, "400 Bad Request", "schema-invalid");
    assert!(!response.contains("auth-invalid"));
    assert_eq!(
        server.metrics().body_reads,
        before,
        "buffered framing overrun reached body polling"
    );

    server.shutdown().await;
}

fn preflight_request(target: &str, headers: &str, body: &str) -> String {
    format!(
        "OPTIONS {target} HTTP/1.1\r\nHost: 127.0.0.1:17843\r\nOrigin: {GOOD_ORIGIN}\r\n{headers}\r\n{body}"
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn c7_preflight_is_route_method_header_parameter_and_body_exact() {
    let _fixed_port = FIXED_PORT.lock().await;
    let server = CompanionServer::start(OriginPolicy::debug_local())
        .await
        .expect("fixed listener should bind");

    let valid = [
        ("/v1/health", "GET", "x-ovp-client-version"),
        (
            "/v1/pairings/challenges",
            "POST",
            "X-OVP-CLIENT-VERSION,\tcontent-type",
        ),
        (
            "/v1/pairings/challenges/11111111-1111-4111-8111-111111111111/redeem",
            "POST",
            "content-type, X-OVP-Client-Version",
        ),
        (
            "/v1/pairings/current",
            "GET",
            "x-ovp-client-version, AUTHORIZATION",
        ),
        (
            "/v1/pairings/current",
            "DELETE",
            "Authorization,X-OVP-Client-Version",
        ),
        ("/v1/runtime", "GET", "Authorization, X-OVP-Client-Version"),
        ("/v1/engines", "GET", "X-OVP-Client-Version, authorization"),
        ("/v1/voices", "GET", "authorization,\tX-OVP-Client-Version"),
        ("/v1/packs", "GET", "Authorization, X-OVP-Client-Version"),
        (
            "/v1/jobs",
            "POST",
            "content-type, X-OVP-Client-Version, AUTHORIZATION",
        ),
        (
            "/v1/jobs/22222222-2222-4222-8222-222222222222",
            "GET",
            "Authorization, X-OVP-Client-Version",
        ),
        (
            "/v1/jobs/33333333-3333-4333-8333-333333333333",
            "DELETE",
            "x-ovp-client-version, authorization",
        ),
        (
            "/v1/jobs/44444444-4444-4444-8444-444444444444/audio",
            "GET",
            "AUTHORIZATION, x-ovp-client-version",
        ),
        (
            "/v1/packs/pocket-companion-pack/actions",
            "POST",
            "X-OVP-Client-Version, Content-Type, Authorization",
        ),
    ];
    for (index, (target, method, requested_headers)) in valid.into_iter().enumerate() {
        let private_network = if index % 2 == 0 {
            "Access-Control-Request-Private-Network: true\r\n"
        } else {
            ""
        };
        let headers = format!(
            "Access-Control-Request-Method: {method}\r\nAccess-Control-Request-Headers: {requested_headers}\r\n{private_network}"
        );
        let before = server.metrics().body_reads;
        let response = roundtrip(preflight_request(target, &headers, "")).await;
        assert!(
            response.starts_with("HTTP/1.1 204 No Content\r\n"),
            "valid preflight failed: {method} {target}: {response:?}"
        );
        assert!(response.ends_with("\r\n\r\n"));
        assert_security_headers(&response);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "valid preflight polled a body: {method} {target}"
        );
    }

    let rejected = vec![
        (
            "/v1/C7_PREFLIGHT_SENTINEL",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "404 Not Found",
            "resource-not-found",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: OPTIONS\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "405 Method Not Allowed",
            "method-not-allowed",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: HEAD\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: PUT\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: get\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/runtime",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version, X-C7-Extra\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: *\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: , X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version, x-ovp-client-version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/pairings/challenges/not-a-uuid/redeem",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/jobs/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: Authorization, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/packs/not-the-pack/actions",
            "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: Authorization, Content-Type, X-OVP-Client-Version\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            format!(
                "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAuthorization: Bearer {}\r\n",
                "S".repeat(43)
            ),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nCookie: c7=forbidden\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Type: application/json\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nX-OVP-Client-Version: 1.0.0\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: false\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: True\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nAccess-Control-Request-Private-Network: true\r\nAccess-Control-Request-Private-Network: true\r\n".to_owned(),
            "",
            "400 Bad Request",
            "duplicate-header",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\n".to_owned(),
            "C7_BODY_PREFIX",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Length: 1\r\n".to_owned(),
            "",
            "400 Bad Request",
            "schema-invalid",
        ),
        (
            "/v1/health",
            "Access-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: X-OVP-Client-Version\r\nContent-Length: 0\r\n".to_owned(),
            "X",
            "400 Bad Request",
            "schema-invalid",
        ),
    ];

    for (target, headers, body, status, code) in rejected {
        let before = server.metrics().body_reads;
        let response = roundtrip(preflight_request(target, &headers, body)).await;
        assert_problem(&response, status, code);
        assert_eq!(
            server.metrics().body_reads,
            before,
            "rejected preflight polled a body: {target}"
        );
        assert!(!response.contains("C7_PREFLIGHT_SENTINEL"));
    }

    server.shutdown().await;
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
    assert_problem(&invalid_preflight, "400 Bad Request", "schema-invalid");
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
