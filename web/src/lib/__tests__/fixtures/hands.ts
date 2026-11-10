/** synthetic PokerStars-format hands (made up for the tests, not real play) */

export const H_CO_OPEN = `PokerStars Hand #230000000001:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/03/02 20:15:01 ET
Table 'Aurora' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($105.50 in chips)
Seat 3: Hero ($98 in chips)
Seat 4: Dan ($120 in chips)
Seat 5: Eve ($99 in chips)
Seat 6: Frank ($150 in chips)
Eve: posts small blind $0.50
Frank: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Alice: folds
Bob: folds
Hero: raises $1.50 to $2.50
Dan: folds
Eve: folds
Frank: calls $1.50
*** FLOP *** [Ks 7d 2c]
Frank: checks
Hero: bets $3
Frank: calls $3
*** TURN *** [Ks 7d 2c] [9h]
Frank: checks
Hero: checks
*** RIVER *** [Ks 7d 2c 9h] [3s]
Frank: checks
Hero: bets $6
Frank: folds
Uncalled bet ($6) returned to Hero
Hero collected $10.45 from pot
*** SUMMARY ***
Total pot $11 | Rake $0.55
Board [Ks 7d 2c 9h 3s]
Seat 3: Hero collected ($10.45)`;

/** hero on the button 3-bets a UTG open with 72o (a clear preflop mistake), gets called, folds the flop */
export const H_BAD_3BET = `PokerStars Hand #230000000002:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/03/02 20:20:11 ET
Table 'Aurora' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($100 in chips)
Seat 3: Cara ($100 in chips)
Seat 4: Hero ($100 in chips)
Seat 5: Eve ($100 in chips)
Seat 6: Frank ($100 in chips)
Eve: posts small blind $0.50
Frank: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Alice: raises $1.50 to $2.50
Bob: folds
Cara: folds
Hero: raises $5.50 to $8
Eve: folds
Frank: folds
Alice: calls $5.50
*** FLOP *** [Qs Jd 4c]
Alice: checks
Hero: checks
*** TURN *** [Qs Jd 4c] [8h]
Alice: bets $10
Hero: folds
Uncalled bet ($10) returned to Alice
Alice collected $17 from pot
*** SUMMARY ***
Total pot $17 | Rake $0
Board [Qs Jd 4c 8h]`;

/** hero is BB, UTG min-opens, hero shoves AA preflop, gets called and wins at showdown (all-in with "and is all-in") */
export const H_ALLIN = `PokerStars Hand #230000000003:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/03/02 20:25:40 ET
Table 'Aurora' 6-max Seat #2 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($100 in chips)
Seat 3: Hero ($100 in chips)
Seat 4: Dan ($100 in chips)
Seat 5: Eve ($100 in chips)
Seat 6: Frank ($100 in chips)
Hero: posts small blind $0.50
Dan: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [As Ad]
Eve: folds
Frank: folds
Alice: folds
Bob: raises $2 to $3
Hero: raises $97 to $100 and is all-in
Dan: folds
Bob: calls $97
*** FLOP *** [2c 7d Ts]
*** TURN *** [2c 7d Ts] [Jc]
*** RIVER *** [2c 7d Ts Jc] [3h]
*** SHOW DOWN ***
Hero: shows [As Ad] (a pair of Aces)
Bob: shows [Kh Kd] (a pair of Kings)
Hero collected $200 from pot
*** SUMMARY ***
Total pot $201 | Rake $1`;

export const H_HEADS_UP = `PokerStars Hand #230000000004:  Hold'em No Limit ($1/$2 USD) - 2024/03/03 01:02:03 ET
Table 'Zeta' 6-max Seat #1 is the button
Seat 1: Hero ($200 in chips)
Seat 4: Villain ($180 in chips)
Hero: posts small blind $1
Villain: posts big blind $2
*** HOLE CARDS ***
Dealt to Hero [9h 9d]
Hero: raises $4 to $6
Villain: folds
Uncalled bet ($4) returned to Hero
Hero collected $4 from pot
Hero: doesn't show hand
*** SUMMARY ***
Total pot $4 | Rake $0`;

export const H_TOURNAMENT = `PokerStars Hand #230000000005:  Tournament #3333333, $5.00+$0.50 USD Hold'em No Limit - Level I (10/20) - 2024/03/03 02:00:00 ET
Table '3333333 1' 9-max Seat #1 is the button
Seat 1: Hero (1500 in chips)
Seat 2: Villain (1500 in chips)
Hero: posts small blind 10
Villain: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]`;

export const H_OMAHA = `PokerStars Hand #230000000006:  Omaha Pot Limit ($0.50/$1.00 USD) - 2024/03/03 02:00:00 ET
Table 'Omaha' 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: Villain ($100 in chips)`;

/** a player whose name contains ": " and spaces, 5 players, a limp and an iso-raise, three-way flop */
export const H_ODD_NAMES = `PokerStars Hand #230000000007:  Hold'em No Limit ($0.25/$0.50 USD) - 2024/03/04 10:00:00 ET
Table 'Odd' 6-max Seat #6 is the button
Seat 1: Mr: X ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: p l a y e r ($50 in chips)
Seat 5: Gina ($50 in chips)
Seat 6: Hal ($50 in chips) 
Seat 4: Sitter ($50 in chips) is sitting out
Mr: X: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Qh Jh]
p l a y e r: folds
Gina: calls $0.50
Hal: raises $1.50 to $2
Mr: X: folds
Hero: calls $1.50
Gina: calls $1.50
*** FLOP *** [Th 8h 2s]
Hero: checks
Gina: checks
Hal: bets $2.50
Hero: raises $7.50 to $10
Gina: folds
Hal: calls $7.50
*** TURN *** [Th 8h 2s] [Ac]
Hero: bets $38 and is all-in
Hal: folds
Uncalled bet ($38) returned to Hero
Hero collected $26.5 from pot
*** SUMMARY ***
Total pot $26.5 | Rake $0`;

export const FILE_CRLF_BOM = "﻿" + [H_CO_OPEN, H_BAD_3BET, H_TOURNAMENT].join("\r\n\r\n\r\n").replace(/\n/g, "\r\n");

/** 40bb effective: hero on the button 3-bets a UTG open with 72o */
export const H_40BB = `PokerStars Hand #230000000008:  Hold'em No Limit ($0.50/$1.00 USD) - 2024/03/05 20:20:11 ET
Table 'Aurora' 6-max Seat #4 is the button
Seat 1: Alice ($40 in chips)
Seat 2: Bob ($40 in chips)
Seat 3: Cara ($40 in chips)
Seat 4: Hero ($40 in chips)
Seat 5: Eve ($40 in chips)
Seat 6: Frank ($40 in chips)
Eve: posts small blind $0.50
Frank: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Alice: raises $1.50 to $2.50
Bob: folds
Cara: folds
Hero: raises $5.50 to $8
Eve: folds
Frank: folds
Alice: folds
Uncalled bet ($5.50) returned to Hero
Hero collected $6 from pot
*** SUMMARY ***
Total pot $6 | Rake $0`;

/** the GGPoker layout (header "Poker Hand #HD…", Rush & Cash table name), written from the documented format */
export const H_GG = `Poker Hand #HD2300000009: Hold'em No Limit ($0.50/$1) - 2024/03/06 20:15:01
Table 'RushAndCash99' 6-max Seat #4 is the button
Seat 1: 1a2b3c4d ($100 in chips)
Seat 2: 5e6f7a8b ($105.50 in chips)
Seat 3: Hero ($98 in chips)
Seat 4: 9c0d1e2f ($120 in chips)
Seat 5: 3a4b5c6d ($99 in chips)
Seat 6: 7e8f9a0b ($150 in chips)
3a4b5c6d: posts small blind $0.50
7e8f9a0b: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
1a2b3c4d: folds
5e6f7a8b: folds
Hero: raises $1.50 to $2.50
9c0d1e2f: folds
3a4b5c6d: folds
7e8f9a0b: folds
Uncalled bet ($1.50) returned to Hero
Hero collected $2.25 from pot
*** SUMMARY ***
Total pot $2.25 | Rake $0.25`;

/**
 * A short PokerStars session with the noise real files contain: players joining / leaving / sitting out,
 * chat, disconnects, time-outs, a dead "small & big blinds" post, a three-way all-in with a side pot,
 * mucked and shown hands. Synthetic (written from the documented format), not real play.
 */
export const SESSION_STARS = `PokerStars Hand #231000000001:  Hold'em No Limit ($0.25/$0.50 USD) - 2024/04/01 21:00:00 CET [2024/04/01 15:00:00 ET]
Table 'Thalia II' 6-max Seat #2 is the button
Seat 1: Hero ($50 in chips)
Seat 2: kroko_99 ($61.20 in chips)
Seat 3: Mia.L ($48.75 in chips)
Seat 4: x Ray x ($50 in chips)
Seat 5: SlowRoller ($23.10 in chips) is sitting out
Seat 6: NewGuy ($50 in chips)
Mia.L: posts small blind $0.25
x Ray x: posts big blind $0.50
NewGuy: posts small & big blinds $0.75
*** HOLE CARDS ***
Dealt to Hero [Qs Qd]
NewGuy: checks
Hero: raises $1.25 to $1.75
SlowRoller leaves the table
kroko_99: calls $1.75
Mia.L: folds
x Ray x: raises $5.50 to $7.25
NewGuy: folds
Hero: raises $42.75 to $50 and is all-in
kroko_99 said, "wow"
kroko_99: calls $48.25
x Ray x: calls $42.75 and is all-in
*** FLOP *** [8h 4c 2s]
*** TURN *** [8h 4c 2s] [Kd]
*** RIVER *** [8h 4c 2s Kd] [6c]
*** SHOW DOWN ***
x Ray x: shows [Ah Ad] (a pair of Aces)
Hero: shows [Qs Qd] (a pair of Queens)
kroko_99: shows [Kh Ks] (three of a kind, Kings)
kroko_99 collected $0 from side pot
kroko_99 collected $150.95 from main pot
*** SUMMARY ***
Total pot $151 Main pot $150.95. Side pot $0. | Rake $0.05
Board [8h 4c 2s Kd 6c]
Seat 1: Hero showed [Qs Qd] and lost with a pair of Queens
Seat 2: kroko_99 (button) showed [Kh Ks] and won ($150.95) with three of a kind, Kings
Seat 3: Mia.L (small blind) folded before Flop
Seat 4: x Ray x (big blind) showed [Ah Ad] and lost with a pair of Aces
Seat 6: NewGuy folded before Flop



PokerStars Hand #231000000002:  Hold'em No Limit ($0.25/$0.50 USD) - 2024/04/01 21:01:30 CET [2024/04/01 15:01:30 ET]
Table 'Thalia II' 6-max Seat #3 is the button
Seat 1: Hero ($50 in chips)
Seat 2: kroko_99 ($100 in chips)
Seat 3: Mia.L ($48.50 in chips)
Seat 6: NewGuy ($49.25 in chips)
NewGuy: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [7c 2d]
Lena_K joins the table at seat #5
kroko_99: raises $1 to $1.50
Mia.L is disconnected
Mia.L has timed out while disconnected
Mia.L: folds
Mia.L is sitting out
NewGuy: folds
Hero: folds
Uncalled bet ($1) returned to kroko_99
kroko_99 collected $1.25 from pot
kroko_99: doesn't show hand
*** SUMMARY ***
Total pot $1.25 | Rake $0
Seat 1: Hero (big blind) folded before Flop
Seat 2: kroko_99 collected ($1.25)
Seat 3: Mia.L (button) folded before Flop
Seat 6: NewGuy (small blind) folded before Flop`;

/**
 * GGPoker-style hands with its quirks: "Dealt to" for every player, Rush & Cash drop, "*** SHOWDOWN ***",
 * extra summary fields. Synthetic, written from the format as published on hand-history converters' docs.
 */
export const SESSION_GG = `Poker Hand #RC2310000003: Hold'em No Limit ($0.10/$0.25) - 2024/04/02 11:00:00
Table 'RushAndCash12345' 6-max Seat #1 is the button
Seat 1: 1f2e3d4c ($25 in chips)
Seat 2: Hero ($26.10 in chips)
Seat 3: 9a8b7c6d ($25 in chips)
Seat 4: 0f1e2d3c ($30.40 in chips)
Seat 5: 5b6a7f8e ($25 in chips)
Seat 6: aa11bb22 ($18 in chips)
Hero: posts small blind $0.10
9a8b7c6d: posts big blind $0.25
*** HOLE CARDS ***
Dealt to 1f2e3d4c 
Dealt to Hero [Ac Jc]
Dealt to 9a8b7c6d 
Dealt to 0f1e2d3c 
Dealt to 5b6a7f8e 
Dealt to aa11bb22 
0f1e2d3c: folds
5b6a7f8e: raises $0.35 to $0.60
aa11bb22: folds
1f2e3d4c: folds
Hero: raises $1.90 to $2.50
9a8b7c6d: folds
5b6a7f8e: calls $1.90
*** FLOP *** [Jd 8s 3c]
Hero: bets $1.80
5b6a7f8e: calls $1.80
*** TURN *** [Jd 8s 3c] [2h]
Hero: bets $4.10
5b6a7f8e: folds
Uncalled bet ($4.10) returned to Hero
*** SHOWDOWN ***
Hero collected $8.69 from pot
*** SUMMARY ***
Total pot $8.85 | Rake $0.16 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Board [Jd 8s 3c 2h]
Seat 2: Hero (small blind) won ($8.69)



Poker Hand #RC2310000004: Hold'em No Limit ($0.10/$0.25) - 2024/04/02 11:01:10
Table 'RushAndCash12345' 6-max Seat #2 is the button
Seat 1: c0ffee00 ($25 in chips)
Seat 2: Hero ($32.43 in chips)
Seat 3: deadbeef ($25 in chips)
Seat 4: 12ab34cd ($25 in chips)
Seat 5: 56ef78ab ($27 in chips)
Seat 6: 90cd12ef ($25 in chips)
deadbeef: posts small blind $0.10
12ab34cd: posts big blind $0.25
Cash Drop to Pot : total $1
*** HOLE CARDS ***
Dealt to c0ffee00 
Dealt to Hero [5h 5d]
Dealt to deadbeef 
Dealt to 12ab34cd 
Dealt to 56ef78ab 
Dealt to 90cd12ef 
56ef78ab: folds
90cd12ef: folds
c0ffee00: folds
Hero: raises $0.40 to $0.65
deadbeef: folds
12ab34cd: folds
Uncalled bet ($0.40) returned to Hero
*** SHOWDOWN ***
Hero collected $1.60 from pot
*** SUMMARY ***
Total pot $1.60 | Rake $0 | Jackpot $0 | Bingo $0 | Fortune $0 | Tax $0
Seat 2: Hero (button) won ($1.60)`;
