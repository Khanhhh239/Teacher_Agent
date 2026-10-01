/** PRNG đơn giản (mulberry32) để xáo bài có thể tái tạo lại từ 1 seed số nguyên. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Xáo trộn nhưng giữ nguyên thứ tự các NHÓM (vd PHẦN I/II/III của đề thi) — chỉ xáo các
 * phần tử bên TRONG mỗi nhóm, không xáo lẫn qua nhóm khác. Nhóm không có part_label (null)
 * được coi là 1 nhóm riêng theo đúng vị trí xuất hiện đầu tiên của nó trong danh sách gốc.
 */
export function seededShuffleByGroup<T>(items: T[], seed: number, groupKey: (item: T) => string): T[] {
  const groupOrder: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(item);
  }
  const result: T[] = [];
  for (const key of groupOrder) {
    result.push(...seededShuffle(groups.get(key)!, seed));
  }
  return result;
}

/** Sinh seed số nguyên ổn định từ chuỗi (vd: session_id + question_id). */
export function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
