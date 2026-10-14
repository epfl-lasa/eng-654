use iiwa7_ik::{benchmark, *};
use serde::Deserialize;
use std::{
    io::{self, Read},
    path::PathBuf,
};

const HELP: &str = "iiwa7-ik: analytical KUKA iiwa 7 IK with fixed q3 (radians)

  iiwa7-ik solve-pose [--input pose.json] [--useful-only]
  iiwa7-ik fk [--input joints.json]
  iiwa7-ik benchmark [--samples 1000000] [--seed 654] [--within-limits]

solve-pose JSON: {\"pose\":[px,py,pz,qw,qx,qy,qz],\"q3\":0.5}
Optional fields: frame (iiwa_link_ee default, iiwa_link_7), respect_limits
(false default), singular_samples ({q1:0,q2:0,q5:0}, radians).
--useful-only / respect_limits:true keep only URDF hard-limit-valid solutions.
fk JSON: {\"q\":[q1,q2,q3,q4,q5,q6,q7],\"frame\":\"iiwa_link_ee\"}
All positions in metres, angles in radians; quaternion order w,x,y,z.
JSON is read from stdin if --input is omitted. Results are JSON on stdout.
";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    pose: [f64; 7],
    q3: f64,
    #[serde(default)]
    frame: Frame,
    #[serde(default)]
    respect_limits: bool,
    #[serde(default)]
    singular_samples: SingularSamples,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FkRequest {
    q: [f64; 7],
    #[serde(default)]
    frame: Frame,
}

fn input(path: Option<PathBuf>) -> Result<String, String> {
    match path {
        Some(path) => std::fs::read_to_string(path).map_err(|e| e.to_string()),
        None => {
            let mut text = String::new();
            io::stdin()
                .read_to_string(&mut text)
                .map_err(|e| e.to_string())?;
            Ok(text)
        }
    }
}
fn print_json(value: &impl serde::Serialize) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn execute() -> Result<bool, String> {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "--help".into());
    if matches!(command.as_str(), "--help" | "-h" | "help") {
        print!("{HELP}");
        return Ok(true);
    }
    if matches!(command.as_str(), "--version" | "-V") {
        println!("iiwa7-ik {}", env!("CARGO_PKG_VERSION"));
        return Ok(true);
    }
    if !matches!(command.as_str(), "solve-pose" | "fk" | "benchmark") {
        return Err(format!("unknown command {command}; use --help"));
    }
    let mut path = None;
    let mut useful = false;
    let mut samples = 1_000_000;
    let mut seed = 654;
    let mut limited = false;
    while let Some(arg) = args.next() {
        match (command.as_str(), arg.as_str()) {
            (_, "--help" | "-h") => {
                print!("{HELP}");
                return Ok(true);
            }
            ("solve-pose" | "fk", "--input") => {
                path = Some(PathBuf::from(args.next().ok_or("--input requires a path")?))
            }
            ("solve-pose", "--useful-only") => useful = true,
            ("benchmark", "--samples") => {
                samples = args
                    .next()
                    .ok_or("--samples requires a positive integer")?
                    .parse()
                    .map_err(|_| "invalid sample count")?
            }
            ("benchmark", "--seed") => {
                seed = args
                    .next()
                    .ok_or("--seed requires an unsigned integer")?
                    .parse()
                    .map_err(|_| "invalid seed")?
            }
            ("benchmark", "--within-limits") => limited = true,
            _ => return Err(format!("unsupported option {arg} for {command}")),
        }
    }
    match command.as_str() {
        "solve-pose" => {
            let request: Request =
                serde_json::from_str(&input(path)?).map_err(|e| e.to_string())?;
            let report = solve(
                Pose::from_array(request.pose)?,
                request.q3,
                SolveOptions {
                    frame: request.frame,
                    respect_limits: request.respect_limits || useful,
                    singular_samples: request.singular_samples,
                },
            )?;
            print_json(&report)?;
            Ok(true)
        }
        "fk" => {
            let request: FkRequest =
                serde_json::from_str(&input(path)?).map_err(|e| e.to_string())?;
            if !request.q.iter().all(|v| v.is_finite()) {
                return Err("q must contain seven finite angles".into());
            }
            let target = fk(&request.q, request.frame);
            print_json(
                &serde_json::json!({"pose":target.to_array(),"q3":request.q[2],"frame":request.frame}),
            )?;
            Ok(true)
        }
        "benchmark" => {
            let report = benchmark::run(samples, seed, limited, Frame::Ee)?;
            print_json(&report)?;
            Ok(report.passed)
        }
        _ => unreachable!(),
    }
}
fn main() -> std::process::ExitCode {
    match execute() {
        Ok(true) => std::process::ExitCode::SUCCESS,
        Ok(false) => {
            eprintln!("FK->IK accuracy benchmark failed; inspect the JSON report");
            std::process::ExitCode::from(1)
        }
        Err(error) => {
            println!("{}", serde_json::json!({"error":error}));
            eprintln!("iiwa7-ik: {error}");
            std::process::ExitCode::from(1)
        }
    }
}
