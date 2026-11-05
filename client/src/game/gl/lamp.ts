/** Seeded event per 32s block; successive dips are 24-40s apart. The two
 * 60Hz ticks are visual time only, independent of song/beat/input timing. */
export function lampLevel(timeMs: number) {
  const t = timeMs / 1000, cycle = Math.floor(t / 32);
  let bits = Math.imul(cycle + 19, 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  const seed = ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
  const tick = Math.floor((t - cycle * 32 - 23 - seed * 8) * 60);
  return tick === 0 ? .80 : tick === 1 ? .90 : 1;
}
