use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn call(args: &[&str], input: Value) -> (bool, Value) {
    // Locate the sibling executable at runtime so moved build directories and
    // Windows tests under Wine do not retain a host-only compile-time path.
    let test_exe = std::env::current_exe().unwrap();
    let binary = test_exe
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(format!("iiwa7-ik{}", std::env::consts::EXE_SUFFIX));
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();
    let result = child.wait_with_output().unwrap();
    (
        result.status.success(),
        serde_json::from_slice(&result.stdout).unwrap(),
    )
}
#[test]
fn cli_fk_solve_and_useful_only() {
    let (ok, request) = call(&["fk"], json!({"q":[0.4,-0.7,0.5,1.8,-0.9,0.8,0.3]}));
    assert!(ok);
    let (ok, all) = call(&["solve-pose"], request.clone());
    assert!(ok);
    assert_eq!(all["solutions"].as_array().unwrap().len(), 8);
    let (ok, filtered) = call(&["solve-pose", "--useful-only"], request);
    assert!(ok);
    assert_eq!(filtered["solutions"].as_array().unwrap().len(), 4);
    assert!(
        filtered["solutions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["within_limits"] == true)
    );
    let (ok, benchmark) = call(&["benchmark", "--samples", "10"], json!({}));
    assert!(ok);
    assert_eq!(benchmark["samples"], 10);
    assert_eq!(benchmark["passed"], true);
}
#[test]
fn malformed_requests_return_json_errors_and_nonzero_exit() {
    for request in [
        json!({"pose":[0,0,1,1,0,0,0]}),
        json!({"pose":[0,0,1,0,0,0,0],"q3":0}),
        json!({"pose":[0,0,1,1,0,0,0],"q3":0,"frame":"link6"}),
        json!({"pose":[0,0,1,1,0,0,0],"q3":0,"respect_limt":true}),
    ] {
        let (ok, report) = call(&["solve-pose"], request);
        assert!(!ok);
        assert!(report["error"].is_string());
    }
    let (ok, report) = call(&["benchmark", "--samples", "0"], json!({}));
    assert!(!ok);
    assert!(report["error"].is_string());
}
