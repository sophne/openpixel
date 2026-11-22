//! The MCP and HTTP-path checks of the Mac app's self-test (SelfTest.swift), run as tests.
use openpixel::selftest::{self, Checks};

fn assert_all(c: Checks) {
    assert!(c.count > 0);
    assert!(c.ok(), "failed: {:#?}", c.failed);
}

#[test]
fn protocol_checks_pass() {
    let mut c = Checks::new(false);
    selftest::protocol_checks(&mut c);
    assert_all(c);
}

#[test]
fn http_paths_are_confined() {
    let mut c = Checks::new(false);
    selftest::http_path_checks(&mut c);
    assert_all(c);
}

#[test]
#[ignore = "needs the ported engine"]
fn tools_are_listed_and_called() {
    let mut c = Checks::new(false);
    selftest::tool_checks(&mut c);
    assert_all(c);
}
