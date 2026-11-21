//! With the Cargo feature `cuda` (REFACTOR_PLAN 4-6; off by default), compile `cuda/*.cu` with `nvcc` and link them and the
//! CUDA runtime (static).  Without it, nothing: CI, the WebAssembly build and every other build are as before.
//! `nvcc` is `$CUDA_PATH/bin/nvcc` (default `/usr/local/cuda`), or `$NVCC`.  `TG_ACC_DOUBLE=1` adds the showdown and fold
//! sums in f64 instead of f32.
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var_os("CARGO_FEATURE_CUDA").is_none() {
        return;
    }
    println!("cargo:rerun-if-changed=cuda");
    println!("cargo:rerun-if-env-changed=CUDA_PATH");
    println!("cargo:rerun-if-env-changed=NVCC");
    println!("cargo:rerun-if-env-changed=TG_ACC_DOUBLE");
    println!("cargo:rerun-if-env-changed=TG_NVCC_FLAGS");
    let cuda = PathBuf::from(std::env::var("CUDA_PATH").unwrap_or_else(|_| "/usr/local/cuda".into()));
    let nvcc = std::env::var("NVCC").map(PathBuf::from).unwrap_or_else(|_| cuda.join("bin/nvcc"));
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let obj = out.join("bench_river.o");
    let mut cmd = Command::new(&nvcc);
    // sm_89: the RTX 4060 Ti of the owner's PC.  No contraction into FMA, so that the arithmetic that is per hand
    // (regret matching, decisions) rounds as the CPU's does.
    cmd.args(["-O3", "-arch=sm_89", "--fmad=false", "-Xcompiler", "-fPIC", "-c", "cuda/bench_river.cu", "-o"]).arg(&obj);
    if std::env::var("TG_ACC_DOUBLE").is_ok_and(|v| v == "1") {
        cmd.arg("-DTG_ACC_DOUBLE");
    }
    // experiments: more nvcc arguments (e.g. -DTG_... switches of the kernel)
    if let Ok(x) = std::env::var("TG_NVCC_FLAGS") {
        cmd.args(x.split_whitespace());
    }
    let st = cmd.status().unwrap_or_else(|e| panic!("{}: {} (set CUDA_PATH or NVCC)", nvcc.display(), e));
    assert!(st.success(), "nvcc failed");
    let lib = out.join("libtessera_cuda.a");
    let _ = std::fs::remove_file(&lib);
    assert!(Command::new("ar").arg("crs").arg(&lib).arg(&obj).status().expect("ar").success(), "ar failed");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=tessera_cuda");
    for d in ["lib64", "lib"] {
        println!("cargo:rustc-link-search=native={}", cuda.join(d).display());
    }
    println!("cargo:rustc-link-lib=static=cudart_static");
    for l in ["stdc++", "dl", "rt", "pthread"] {
        println!("cargo:rustc-link-lib=dylib={}", l);
    }
}
