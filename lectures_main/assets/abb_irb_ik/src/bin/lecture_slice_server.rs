//! Loopback-only streaming slice server for the lecture's native Rust solver.
//! No filesystem or code-execution API is exposed. Rayon threads are shared and bounded.
use crb15000_ik::{Frame, JOINT_LIMITS, Pose, RootMethod, SolveOptions, solve_matrix};
use rayon::prelude::*;
use serde_json::{Value, json};
use std::{env, io::{BufRead, BufReader, Read, Write}, net::{TcpListener, TcpStream},
    sync::{Arc, atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc}, time::{Duration, Instant}};

const DEFAULT_PORT: u16 = 8743;
const MAX_BODY: usize = 64 * 1024;
const CHUNK: usize = 512;

struct Slice {
    request: Value, nx: usize, rows: usize, xmin: f64, xmax: f64,
    low: f64, high: f64, fixed: f64, xy: bool, rotation: [[f64; 3]; 3],
}
impl Slice {
    fn parse(request: Value) -> Result<Self, String> {
        let number = |key: &str| request[key].as_f64().filter(|v| v.is_finite()).ok_or_else(|| format!("{key} must be finite."));
        let integer = |key: &str| request[key].as_u64().filter(|v| (2..=400).contains(v)).map(|v| v as usize).ok_or_else(|| format!("{key} must be an integer in 2…400."));
        let xy = match request["plane"].as_str() { Some("xy") => true, Some("xz") => false, _ => return Err("Choose an xy or xz slice.".into()) };
        let nx = integer("nx")?; let rows = integer(if xy { "ny" } else { "nz" })?;
        let xmin = number("xmin")?; let xmax = number("xmax")?;
        let low = number(if xy { "ymin" } else { "zmin" })?;
        let high = number(if xy { "ymax" } else { "zmax" })?;
        let fixed = number(if xy { "z" } else { "y" })?;
        if xmin >= xmax || low >= high { return Err("Slice bounds must increase.".into()); }
        let rotation: [[f64; 3]; 3] = serde_json::from_value(request["orientation"].clone()).map_err(|_| "A finite 3×3 orientation is required.")?;
        for i in 0..3 { for j in 0..3 {
            let dot: f64 = (0..3).map(|k| rotation[k][i] * rotation[k][j]).sum();
            if !dot.is_finite() || (dot - if i == j { 1. } else { 0. }).abs() > 1e-6 { return Err("Orientation must be orthonormal.".into()); }
        }}
        let r = rotation;
        let det = r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
        if (det-1.).abs()>1e-6 { return Err("Orientation determinant must be +1.".into()); }
        Ok(Self { request, nx, rows, xmin, xmax, low, high, fixed, xy, rotation })
    }
    fn pose(&self, index: usize) -> Pose {
        let x = self.xmin + (index % self.nx) as f64 * (self.xmax-self.xmin)/(self.nx-1) as f64;
        let v = self.low + (index / self.nx) as f64 * (self.high-self.low)/(self.rows-1) as f64;
        let (y,z) = if self.xy { (v,self.fixed) } else { (self.fixed,v) }; let r = self.rotation;
        Pose::new(r[0][0],r[0][1],r[0][2],x,r[1][0],r[1][1],r[1][2],y,r[2][0],r[2][1],r[2][2],z,0.,0.,0.,1.)
    }
}

fn headers(stream: &mut TcpStream, status: &str, content_type: &str) -> std::io::Result<()> {
    write!(stream,"HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nConnection: close\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n\r\n")
}
fn line(stream: &mut TcpStream, value: Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *stream, &value)?; stream.write_all(b"\n")?; stream.flush()
}
fn error(stream: &mut TcpStream, status: &str, message: &str) {
    let _ = headers(stream,status,"application/json"); let _ = line(stream,json!({"error":message}));
}

fn serve_slice(mut stream: TcpStream, slice: Slice, pool: &rayon::ThreadPool) -> std::io::Result<()> {
    let total = slice.nx * slice.rows; let workers = pool.current_num_threads(); let start_time = Instant::now();
    headers(&mut stream,"200 OK","application/x-ndjson")?;
    line(&mut stream,json!({"done":0,"total":total,"backend":"rust-native","workers":workers}))?;
    let options = SolveOptions { frame: Frame::Tool0, ..SolveOptions::default() };
    let mut retry = options.clone(); retry.coefficient_precision=512; retry.root_options.method=RootMethod::Reference;
    let mut counts=vec![-1;total]; let mut legal=vec![-1;total]; let mut unresolved=0; let mut fallback=0; let mut max_error=0_f64;
    let cancelled=AtomicBool::new(false);
    std::thread::scope(|scope| -> std::io::Result<()> {
        let (sender,receiver)=mpsc::sync_channel(4096);
        let cancellation=&cancelled; let request=&slice;
        scope.spawn(move || {
            let _=pool.install(|| (0..total).into_par_iter().try_for_each_with(sender,|sender,i| -> Result<(),()> {
                if cancellation.load(Ordering::Relaxed) { return Err(()); }
                let pose=request.pose(i);
                let report=solve_matrix(&pose,&options).or_else(|_|solve_matrix(&pose,&retry));
                let value=match report {
                    Ok(result) => {
                        let legal=result.solutions.iter().filter(|s|s.q.iter().zip(JOINT_LIMITS).all(|(&v,[lo,hi])|[-1.,0.,1.].iter().any(|&turn|v+turn*std::f64::consts::TAU>=lo-1e-10&&v+turn*std::f64::consts::TAU<=hi+1e-10))).count();
                        (result.solutions.len() as i32,legal as i32,result.diagnostics.used_fallback,result.solutions.iter().map(|s|s.position_error.max(s.rotation_error)).fold(0.,f64::max))
                    },
                    Err(_) => (-1,-1,false,0.), // Unresolved is never zero IKs.
                };
                sender.send((i,value)).map_err(|_|())
            }));
        });
        // One full Rayon job avoids barriers between chunks. Ready contiguous
        // tiles can stream in any order; each carries its global start index.
        let mut remaining:Vec<_>=(0..total).step_by(CHUNK).map(|start|(total-start).min(CHUNK)).collect();
        let mut done=0;
        for (i,(count,limit_count,used_fallback,error)) in receiver {
            counts[i]=count; legal[i]=limit_count; done+=1;
            unresolved+=usize::from(count<0); fallback+=usize::from(used_fallback); max_error=max_error.max(error);
            let tile=i/CHUNK; remaining[tile]-=1;
            if remaining[tile]==0 {
                let start=tile*CHUNK; let end=(start+CHUNK).min(total);
                if let Err(error)=line(&mut stream,json!({"start":start,"counts":&counts[start..end],"limitCounts":&legal[start..end],"done":done,"total":total,"unresolved":unresolved,"backend":"rust-native","workers":workers,"elapsedSeconds":start_time.elapsed().as_secs_f64()})) {
                    cancelled.store(true,Ordering::Relaxed); return Err(error);
                }
            }
        }
        Ok(())
    })?;
    let mut result=slice.request;
    result["counts"]=json!(counts); result["limitCounts"]=json!(legal); result["unresolved"]=json!(unresolved);
    result["backend"]=json!("rust-native"); result["workers"]=json!(workers); result["source"]=json!("live");
    result["elapsedSeconds"]=json!(start_time.elapsed().as_secs_f64()); result["maxFkError"]=json!(max_error);
    result["fallbackPoses"]=json!(fallback); result["solver"]=json!("Native Rust/Rug adaptive degree-16 solver, Rayon batches, 512-bit reference retry");
    line(&mut stream,json!({"result":result}))
}

struct Active<'a>(&'a AtomicUsize);
impl Drop for Active<'_> { fn drop(&mut self) { self.0.fetch_sub(1,Ordering::SeqCst); } }
fn handle(mut stream: TcpStream, pool: Arc<rayon::ThreadPool>, active: Arc<AtomicUsize>) {
    let _=stream.set_read_timeout(Some(Duration::from_secs(3))); let _=stream.set_write_timeout(Some(Duration::from_secs(2)));
    let mut reader=BufReader::new(&stream); let mut first=String::new();
    if reader.read_line(&mut first).is_err() { return; }
    let parts:Vec<_>=first.split_whitespace().collect(); if parts.len()!=3 { return; }
    let method=parts[0].to_owned(); let route=parts[1].to_owned();
    let mut length=0usize; let mut header_bytes=first.len(); let mut host=String::new();
    loop { let mut row=String::new(); if reader.read_line(&mut row).unwrap_or(0)==0 { return; } header_bytes+=row.len(); if header_bytes>8192 { return; } if row=="\r\n"||row=="\n" { break; }
        if let Some((key,value))=row.split_once(':') { if key.eq_ignore_ascii_case("content-length") { length=value.trim().parse().unwrap_or(MAX_BODY+1); } if key.eq_ignore_ascii_case("host") { host=value.trim().to_owned(); } }
    }
    if !host.starts_with("127.0.0.1:")&&!host.starts_with("localhost:") { drop(reader); error(&mut stream,"403 Forbidden","Use the loopback address."); return; }
    if method=="OPTIONS" { drop(reader); let _=headers(&mut stream,"204 No Content","text/plain"); return; }
    if method=="GET"&&route=="/health" { drop(reader); let _=headers(&mut stream,"200 OK","application/json"); let _=line(&mut stream,json!({"backend":"rust-native","workers":pool.current_num_threads(),"protocol":1,"activeJobs":active.load(Ordering::SeqCst)})); return; }
    if method!="POST"||route!="/slice" { drop(reader); error(&mut stream,"404 Not Found","Use POST /slice."); return; }
    if length==0||length>MAX_BODY { drop(reader); error(&mut stream,"413 Payload Too Large","A slice request must be smaller than 64 KB."); return; }
    let mut body=vec![0;length]; if reader.read_exact(&mut body).is_err() { return; } drop(reader);
    let slice=serde_json::from_slice(&body).map_err(|e|e.to_string()).and_then(Slice::parse);
    let slice=match slice { Ok(v)=>v,Err(e)=>{error(&mut stream,"400 Bad Request",&e);return;} };
    // Shared CPU pool plus an admission bound avoids unbounded browser requests.
    if active.fetch_add(1,Ordering::SeqCst)>=2 { active.fetch_sub(1,Ordering::SeqCst); error(&mut stream,"429 Too Many Requests","Two calculations are already active; cancel one and retry."); return; }
    let _guard=Active(&active); let started=Instant::now(); let total=slice.nx*slice.rows;
    let completed=serve_slice(stream,slice,&pool).is_ok();
    eprintln!("{} {total} poses in {:.3}s on {} workers",if completed {"Completed"} else {"Cancelled"},started.elapsed().as_secs_f64(),pool.current_num_threads());
}

fn main() -> Result<(),Box<dyn std::error::Error>> {
    let mut port=DEFAULT_PORT; let available=std::thread::available_parallelism().map_or(1,usize::from); let mut workers=available.min(16);
    let mut args=env::args().skip(1); while let Some(arg)=args.next() { match arg.as_str() {
        "--port"=>port=args.next().ok_or("Missing port")?.parse()?,
        "--threads"=>workers=args.next().ok_or("Missing thread count")?.parse::<usize>()?.clamp(1,available.min(32)),
        _=>return Err(format!("Unknown option {arg}; use --port N or --threads N.").into()),
    }}
    let pool=Arc::new(rayon::ThreadPoolBuilder::new().num_threads(workers).build()?); let active=Arc::new(AtomicUsize::new(0));
    let listener=TcpListener::bind(("127.0.0.1",port))?;
    eprintln!("ABB CRB native IK listening at http://127.0.0.1:{port} ({workers} Rayon workers)");
    for stream in listener.incoming() { let stream=stream?; let pool=pool.clone(); let active=active.clone(); std::thread::spawn(move||handle(stream,pool,active)); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn slice_axes_and_bounds_are_unambiguous() {
        let mut input=json!({"plane":"xy","nx":3,"ny":2,"xmin":0.,"xmax":1.,"ymin":-1.,"ymax":1.,"z":0.2,"orientation":[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]]});
        let slice=Slice::parse(input.clone()).unwrap(); assert_eq!([slice.pose(5)[(0,3)],slice.pose(5)[(1,3)],slice.pose(5)[(2,3)]],[1.,1.,0.2]);
        input["orientation"][0][0]=json!(2.); assert!(Slice::parse(input.clone()).is_err());
        input["nx"]=json!(100000); assert!(Slice::parse(input).is_err());
    }
}
