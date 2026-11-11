/** deep links into the Study screens (app paths; <Link> adds the hosting sub-path itself) */
export const preflopLink = (depth: number, node: number, hand: number | null = null): string => `/study/#d=${depth}&n=${node}${hand === null ? "" : `&h=${hand}`}`;
export const postflopLink = (scenario: string, flop: number, node: number): string => `/study/postflop/#s=${scenario}&f=${flop}&n=${node}`;

/** the "#…" part of a pre-flop link: what the Study screen keeps in the address bar */
export const preflopHash = (depth: number, node: number, hand: number | null): string => preflopLink(depth, node, hand).slice("/study/".length);
