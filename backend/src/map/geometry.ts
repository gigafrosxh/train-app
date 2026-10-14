export type Point = [number, number];
export const distance = (a: Point, b: Point) => {
  const r = Math.PI / 180,
    dy = (b[1] - a[1]) * r,
    dx = (b[0] - a[0]) * r;
  const h =
    Math.sin(dy / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dx / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
export function along(line: Point[], fraction: number) {
  const lengths = line.slice(1).map((p, i) => distance(line[i], p));
  let left =
    Math.max(0, Math.min(1, fraction)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? left / lengths[i] : 0;
      const a = line[i],
        b = line[i + 1];
      return {
        coordinates: [
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
        ] as Point,
        bearing:
          ((Math.atan2(
            (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180),
            b[1] - a[1],
          ) *
            180) /
            Math.PI +
            360) %
          360,
      };
    }
    left -= lengths[i];
  }
  return { coordinates: line[0], bearing: 0 };
}
export function locate(line: Point[], p: Point) {
  const total = line.slice(1).reduce((s, b, i) => s + distance(line[i], b), 0);
  let used = 0,
    best = Infinity,
    result = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i],
      b = line[i + 1],
      c = Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * c,
      dy = b[1] - a[1];
    const f = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * c * dx + (p[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const at: [number, number] = [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
    ];
    const d = distance(at, p),
      len = distance(a, b);
    if (d < best) {
      best = d;
      result = (used + len * f) / (total || 1);
    }
    used += len;
  }
  return { fraction: result, distance: best };
}
export function inside(p: Point | null, bbox?: string) {
  if (!p) return false;
  if (!bbox) return true;
  const [x1, y1, x2, y2] = bbox.split(",").map(Number);
  return p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2;
}
