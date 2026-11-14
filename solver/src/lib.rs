//! Tessera solver core.
//!
//! * `cards`   – card / 169-hand-class helpers
//! * `eval`    – 7 card hand evaluator
//! * `equity`  – 169x169 equity + blocker tables (Monte-Carlo)
//! * `engine`  – generic n-player vector-form CFR+ engine
//! * `preflop` – 6-max preflop tree, payoff model, export
//! * `postflop` – heads-up flop/turn/river solver over 1,326 combos
//! * `measure` – exploitability of a shipped postflop file over every turn / river card
//! * `allcards` – one flop over every card: checkpoints, full-card values, the river re-solved (REFACTOR_PLAN 3-3-3)
//! * `icm`     – ICM push/fold for up to nine players
//! * `games`   – tiny reference games (Kuhn, clairvoyant half street, push/fold)
// The numerical kernels walk several parallel arrays (hands x actions) with one index;
// iterator chains would hide that and are not faster here.
#![allow(clippy::needless_range_loop)]

pub mod allcards;
pub mod cards;
pub mod engine;
pub mod equity;
pub mod eval;
pub mod ffi;
pub mod games;
pub mod icm;
pub mod measure;
pub mod postflop;
pub mod preflop;
pub mod rng;
pub mod solution_io;
