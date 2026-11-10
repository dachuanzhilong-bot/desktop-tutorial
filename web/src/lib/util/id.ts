/** short, time-ordered, practically unique id for locally created records (ranges, solves, practice sets) */
export function newId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .padStart(3, "0")}`;
}
