/**
 * Deterministic, dependency-free 128-bit hash used to derive stable
 * UUID-shaped identifiers (e.g. snapshot ids) without I/O, randomness, or a
 * clock. Pure integer math. This is NOT cryptographic; it only shapes stable
 * identifiers so identical inputs always produce identical ids.
 */
const FNV_OFFSET_1 = 0xcbf29ce484222325n;
const FNV_OFFSET_2 = 0x9e3779b97f4a7c15n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64(input: string, offset: bigint): bigint {
  let hash = offset;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

/**
 * Derives a deterministic v4-shaped UUID string from a namespace and payload.
 * Same inputs always yield the same identifier.
 */
export function deterministicUuid(namespace: string, payload: string): string {
  const a = fnv1a64(`${namespace}\u0000${payload}`, FNV_OFFSET_1);
  const b = fnv1a64(`${payload}\u0000${namespace}`, FNV_OFFSET_2);
  const hex =
    a.toString(16).padStart(16, "0") + b.toString(16).padStart(16, "0");
  // Shape into 8-4-4-4-12 with version nibble 4 and variant nibble 8.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
