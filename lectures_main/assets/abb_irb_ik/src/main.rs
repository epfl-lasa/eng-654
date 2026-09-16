use std::{
    env, fs,
    io::{self, Read},
    time::Instant,
};

use crb15000_ik::kinematics::wrapped_joint_distance;
use crb15000_ik::{Frame, Pose, RootMethod, SolveOptions, SolveReport, solve_batch, solve_matrix};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

const REFERENCE: &str = include_str!("../tests/data/reference_1000.json");

#[derive(Deserialize)]
struct ReferenceFile {
    cases: Vec<ReferenceCase>,
}
#[derive(Deserialize)]
struct ReferenceCase {
    q_seed: [f64; 6],
    pose: [f64; 16],
    solutions: Vec<[f64; 6]>,
}

#[derive(Deserialize)]
struct PoseInput {
    #[serde(default = "default_frame")]
    frame: String,
    poses: Vec<[f64; 16]>,
}
fn default_frame() -> String {
    "tool0".into()
}

struct Arguments {
    command: String,
    method: String,
    samples: usize,
    threads: usize,
    repeat: usize,
    sequential: bool,
    json: bool,
    input: Option<String>,
}

fn usage() {
    println!(
        "crb15000-ik benchmark [--method adaptive|polished|companion|reference] [--samples 1000] [--threads N] [--repeat N] [--sequential] [--json]"
    );
    println!("crb15000-ik solve [--method METHOD] [--threads N] [--input poses.json]");
    println!(
        "solve input: {{\"frame\":\"tool0\",\"poses\":[[16 row-major matrix entries], ...]}}; defaults to stdin"
    );
    println!(
        "benchmark uses the embedded Python reference; setup, warm-up and validation are excluded from timing"
    );
}

fn arguments() -> Result<Option<Arguments>, String> {
    let mut args = env::args().skip(1).peekable();
    let command = match args.peek() {
        Some(value) if !value.starts_with('-') => args.next().unwrap(),
        _ => "benchmark".into(),
    };
    let mut result = Arguments {
        command,
        method: "adaptive".into(),
        samples: 1000,
        threads: std::thread::available_parallelism().map_or(1, usize::from),
        repeat: 1,
        sequential: false,
        json: false,
        input: None,
    };
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--help" | "-h" => {
                usage();
                return Ok(None);
            }
            "--sequential" => result.sequential = true,
            "--json" => result.json = true,
            "--method" => result.method = args.next().ok_or("missing method")?,
            "--input" => result.input = Some(args.next().ok_or("missing input path")?),
            "--samples" | "--threads" | "--repeat" => {
                let value: usize = args
                    .next()
                    .ok_or_else(|| format!("missing value for {flag}"))?
                    .parse()
                    .map_err(|_| format!("{flag} requires a positive integer"))?;
                if value == 0 {
                    return Err(format!("{flag} must be positive"));
                }
                match flag.as_str() {
                    "--samples" => result.samples = value,
                    "--threads" => result.threads = value,
                    _ => result.repeat = value,
                }
            }
            _ => return Err(format!("unknown option: {flag}")),
        }
    }
    if result.command != "benchmark" && result.command != "solve" {
        return Err(format!("unknown command: {}", result.command));
    }
    Ok(Some(result))
}

fn options(method: &str) -> Result<SolveOptions, String> {
    let mut result = SolveOptions::default();
    result.root_options.method = match method {
        "companion" => RootMethod::Companion,
        "polished" => RootMethod::Polished,
        "adaptive" => RootMethod::Adaptive,
        "reference" => RootMethod::Reference,
        _ => return Err(format!("unknown root method: {method}")),
    };
    Ok(result)
}

#[derive(Serialize)]
struct BenchmarkSummary {
    method: String,
    samples: usize,
    repeats: usize,
    worker_threads: usize,
    parallel: bool,
    wall_seconds: f64,
    amortized_microseconds_per_pose: f64,
    poses_per_second: f64,
    mean_worker_microseconds_per_pose: f64,
    median_worker_microseconds_per_pose: f64,
    p95_worker_microseconds_per_pose: f64,
    poses_solved: usize,
    seeds_recovered: usize,
    solutions: usize,
    reference_solutions: usize,
    missing_reference_solutions: usize,
    extra_solutions: usize,
    errors: usize,
    fallback_poses: usize,
    unresolved_root_poses: usize,
    max_position_error_m: f64,
    rms_position_error_m: f64,
    max_rotation_error_rad: f64,
    rms_rotation_error_rad: f64,
    max_nearest_seed_joint_error_rad: Option<f64>,
}

fn benchmark(args: &Arguments, options: &SolveOptions) -> Result<(), String> {
    let reference: ReferenceFile = serde_json::from_str(REFERENCE).map_err(|e| e.to_string())?;
    if args.samples > reference.cases.len() {
        return Err(format!(
            "the embedded reference contains {} poses; use --repeat to time more solves",
            reference.cases.len()
        ));
    }
    let cases = &reference.cases[..args.samples];
    let targets: Vec<Pose> = cases
        .iter()
        .map(|case| Pose::from_row_slice(&case.pose))
        .collect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(args.threads)
        .build()
        .map_err(|e| e.to_string())?;
    // Initialize the numerical path and worker pool before starting the clock.
    pool.install(|| {
        let _ = solve_matrix(&targets[0], options);
    });
    let mut worker_times = Vec::with_capacity(args.samples * args.repeat);
    let mut wall_seconds = 0.0;
    let mut last_results = Vec::new();
    for _ in 0..args.repeat {
        let timed = |target: &Pose| {
            let start = Instant::now();
            let result = solve_matrix(target, options);
            (result, start.elapsed().as_secs_f64() * 1e6)
        };
        let start = Instant::now();
        let results: Vec<_> = if args.sequential {
            targets.iter().map(timed).collect()
        } else {
            pool.install(|| targets.par_iter().map(timed).collect())
        };
        wall_seconds += start.elapsed().as_secs_f64();
        worker_times.extend(results.iter().map(|(_, elapsed)| *elapsed));
        last_results = results.into_iter().map(|(result, _)| result).collect();
    }
    worker_times.sort_by(f64::total_cmp);
    let total_solves = args.samples * args.repeat;
    let mut summary = BenchmarkSummary {
        method: args.method.clone(),
        samples: args.samples,
        repeats: args.repeat,
        worker_threads: if args.sequential { 1 } else { args.threads },
        parallel: !args.sequential,
        wall_seconds,
        amortized_microseconds_per_pose: wall_seconds * 1e6 / total_solves as f64,
        poses_per_second: total_solves as f64 / wall_seconds,
        mean_worker_microseconds_per_pose: worker_times.iter().sum::<f64>()
            / worker_times.len() as f64,
        median_worker_microseconds_per_pose: worker_times[worker_times.len() / 2],
        p95_worker_microseconds_per_pose: worker_times
            [((worker_times.len() - 1) as f64 * 0.95).round() as usize],
        poses_solved: 0,
        seeds_recovered: 0,
        solutions: 0,
        reference_solutions: cases.iter().map(|case| case.solutions.len()).sum(),
        missing_reference_solutions: 0,
        extra_solutions: 0,
        errors: 0,
        fallback_poses: 0,
        unresolved_root_poses: 0,
        max_position_error_m: 0.0,
        rms_position_error_m: 0.0,
        max_rotation_error_rad: 0.0,
        rms_rotation_error_rad: 0.0,
        max_nearest_seed_joint_error_rad: Some(0.0),
    };
    let mut position_squared = 0.0;
    let mut rotation_squared = 0.0;
    for (index, (case, result)) in cases.iter().zip(last_results.iter()).enumerate() {
        match result {
            Err(error) => {
                summary.errors += 1;
                summary.missing_reference_solutions += case.solutions.len();
                summary.max_nearest_seed_joint_error_rad = None;
                if summary.errors <= 5 {
                    eprintln!("pose {index}: {error}");
                }
            }
            Ok(report) => {
                summary.fallback_poses += usize::from(report.diagnostics.used_fallback);
                summary.unresolved_root_poses += usize::from(!report.diagnostics.roots_converged);
                let solutions = &report.solutions;
                summary.poses_solved += usize::from(!solutions.is_empty());
                summary.solutions += solutions.len();
                let nearest = solutions
                    .iter()
                    .map(|s| wrapped_joint_distance(&s.q, &case.q_seed))
                    .fold(f64::INFINITY, f64::min);
                summary.seeds_recovered += usize::from(nearest <= 2e-5);
                summary.max_nearest_seed_joint_error_rad = summary
                    .max_nearest_seed_joint_error_rad
                    .and_then(|previous| nearest.is_finite().then_some(previous.max(nearest)));
                summary.missing_reference_solutions += case
                    .solutions
                    .iter()
                    .filter(|q| {
                        !solutions
                            .iter()
                            .any(|s| wrapped_joint_distance(&s.q, q) < 2e-6)
                    })
                    .count();
                summary.extra_solutions += solutions
                    .iter()
                    .filter(|s| {
                        !case
                            .solutions
                            .iter()
                            .any(|q| wrapped_joint_distance(&s.q, q) < 2e-6)
                    })
                    .count();
                for solution in solutions {
                    summary.max_position_error_m =
                        summary.max_position_error_m.max(solution.position_error);
                    summary.max_rotation_error_rad =
                        summary.max_rotation_error_rad.max(solution.rotation_error);
                    position_squared += solution.position_error.powi(2);
                    rotation_squared += solution.rotation_error.powi(2);
                }
            }
        }
    }
    if summary.solutions > 0 {
        summary.rms_position_error_m = (position_squared / summary.solutions as f64).sqrt();
        summary.rms_rotation_error_rad = (rotation_squared / summary.solutions as f64).sqrt();
    }
    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())?
        );
    } else {
        println!(
            "{}: {} poses x {} repeat(s), {} worker(s), {}",
            summary.method,
            summary.samples,
            summary.repeats,
            summary.worker_threads,
            if summary.parallel {
                "Rayon"
            } else {
                "sequential"
            }
        );
        println!(
            "Wall time {:.6} s; {:.3} us/pose amortized; {:.0} poses/s",
            summary.wall_seconds, summary.amortized_microseconds_per_pose, summary.poses_per_second
        );
        println!(
            "Worker latency [us]: mean {:.3}, median {:.3}, p95 {:.3}",
            summary.mean_worker_microseconds_per_pose,
            summary.median_worker_microseconds_per_pose,
            summary.p95_worker_microseconds_per_pose
        );
        println!(
            "Solved {}/{}; seeds recovered {}/{}; errors {}",
            summary.poses_solved,
            summary.samples,
            summary.seeds_recovered,
            summary.samples,
            summary.errors
        );
        println!(
            "Solutions {} / reference {}; missing {}; extra {}",
            summary.solutions,
            summary.reference_solutions,
            summary.missing_reference_solutions,
            summary.extra_solutions
        );
        println!(
            "Fallback poses {}; unresolved root poses {}",
            summary.fallback_poses, summary.unresolved_root_poses
        );
        println!(
            "Position error [m]: max {:.3e}, RMS {:.3e}",
            summary.max_position_error_m, summary.rms_position_error_m
        );
        println!(
            "Rotation error [rad]: max {:.3e}, RMS {:.3e}",
            summary.max_rotation_error_rad, summary.rms_rotation_error_rad
        );
        println!(
            "Maximum nearest-seed joint error [rad]: {:?}",
            summary.max_nearest_seed_joint_error_rad
        );
    }
    if summary.errors > 0
        || summary.poses_solved != summary.samples
        || summary.seeds_recovered != summary.samples
    {
        return Err("benchmark contained failed or unrecovered poses".into());
    }
    if matches!(
        options.root_options.method,
        RootMethod::Adaptive | RootMethod::Reference
    ) && (summary.missing_reference_solutions > 0 || summary.extra_solutions > 0)
    {
        return Err("benchmark solution sets differ from the Python reference".into());
    }
    Ok(())
}

fn solve(args: &Arguments, mut options: SolveOptions) -> Result<(), String> {
    let text = if let Some(path) = &args.input {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        let mut text = String::new();
        io::stdin()
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        text
    };
    let input: PoseInput = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    options.frame = match input.frame.as_str() {
        "tool0" => Frame::Tool0,
        "link6" => Frame::Link6,
        "dh6" => Frame::Dh6,
        _ => return Err("frame must be tool0, link6, or dh6".into()),
    };
    let poses: Vec<Pose> = input
        .poses
        .iter()
        .map(|p| Pose::from_row_slice(p))
        .collect();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(args.threads)
        .build()
        .map_err(|e| e.to_string())?;
    let results: Vec<Result<SolveReport, String>> = pool.install(|| solve_batch(&poses, &options));
    println!(
        "{}",
        serde_json::to_string_pretty(&results).map_err(|e| e.to_string())?
    );
    if results.iter().any(Result::is_err) {
        return Err("one or more poses failed; see JSON results".into());
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let Some(args) = arguments()? else {
        return Ok(());
    };
    let options = options(&args.method)?;
    match args.command.as_str() {
        "benchmark" => benchmark(&args, &options),
        "solve" => solve(&args, options),
        _ => unreachable!(),
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
