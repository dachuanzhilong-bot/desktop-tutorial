//! Tessera solver core.
//!
//! * `cards`   – card / 169-hand-class helpers
//! * `eval`    – 7 card hand evaluator
//! * `equity`  – 169x169 equity + blocker tables (Monte-Carlo)
//! * `engine`  – generic n-player vector-form CFR+ engine
//! * `preflop` – 6-max preflop tree, payoff model, export
//! * `postflop` – heads-up flop/turn/river solver over 1,326 combos
//! * `games`   – tiny reference games (Kuhn, clairvoyant half street, push/fold)
pub mod cards;
pub mod engine;
pub mod equity;
pub mod eval;
pub mod ffi;
pub mod games;
pub mod postflop;
pub mod preflop;
pub mod rng;
pub mod solution_io;
