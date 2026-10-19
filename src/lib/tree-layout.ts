// Pure layout for the family tree (no server imports, so it runs in the browser and in tests).

export type LayoutRel = { type: "parent" | "spouse"; personA: string; personB: string; subtype: string };
export type PositionedNode = { id: string; x: number; y: number; gen: number };
export type TreeEdge = { key: string; d: string; dashed: boolean };

export const CARD_W = 176;
export const CARD_H = 76;
const GAP_X = 32;
const GAP_Y = 104;

export function layoutTree(personIds: string[], rels: LayoutRel[]) {
  const ids = new Set(personIds);
  const parentRels = rels.filter((r) => r.type === "parent" && ids.has(r.personA) && ids.has(r.personB));
  const spouseRels = rels.filter((r) => r.type === "spouse" && ids.has(r.personA) && ids.has(r.personB));
  const parentsOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  for (const id of personIds) {
    parentsOf.set(id, []);
    spousesOf.set(id, []);
  }
  for (const r of parentRels) parentsOf.get(r.personB)!.push(r.personA);
  for (const r of spouseRels) {
    spousesOf.get(r.personA)!.push(r.personB);
    spousesOf.get(r.personB)!.push(r.personA);
  }

  // Generations: a child sits below its parents; spouses share a row. Bounded so odd data cannot loop forever.
  const gen = new Map(personIds.map((id) => [id, 0]));
  for (let i = 0, changed = true; changed && i < personIds.length * 2 + 10; i++) {
    changed = false;
    for (const r of parentRels) {
      if (gen.get(r.personB)! < gen.get(r.personA)! + 1) {
        gen.set(r.personB, gen.get(r.personA)! + 1);
        changed = true;
      }
    }
    for (const r of spouseRels) {
      const m = Math.max(gen.get(r.personA)!, gen.get(r.personB)!);
      if (gen.get(r.personA) !== m || gen.get(r.personB) !== m) {
        gen.set(r.personA, m);
        gen.set(r.personB, m);
        changed = true;
      }
    }
  }

  // Units: spouses kept side by side; the person with several spouses goes in the middle.
  const unitOf = new Map<string, string[]>();
  for (const id of personIds) {
    if (unitOf.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (unitOf.has(cur) || members.includes(cur)) continue;
      members.push(cur);
      for (const s of spousesOf.get(cur)!) if (gen.get(s) === gen.get(id)) stack.push(s);
    }
    const hub = members.reduce((a, b) => (spousesOf.get(b)!.length > spousesOf.get(a)!.length ? b : a));
    const others = members.filter((m) => m !== hub);
    const ordered = [...others.slice(0, Math.ceil(others.length / 2)), hub, ...others.slice(Math.ceil(others.length / 2))];
    for (const m of ordered) unitOf.set(m, ordered);
  }

  const rows = new Map<number, string[][]>();
  const seenUnits = new Set<string[]>();
  for (const id of personIds) {
    const unit = unitOf.get(id)!;
    if (seenUnits.has(unit)) continue;
    seenUnits.add(unit);
    const g = gen.get(id)!;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g)!.push(unit);
  }

  const x = new Map<string, number>();
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const unitWidth = (u: string[]) => u.length * CARD_W + (u.length - 1) * GAP_X;
  for (const g of gens) {
    const units = rows.get(g)!;
    // Barycenter ordering: place each family unit under the middle of its parents.
    const desired = new Map<string[], number | null>();
    for (const u of units) {
      const parentXs = u.flatMap((m) => parentsOf.get(m)!).filter((p) => x.has(p)).map((p) => x.get(p)! + CARD_W / 2);
      desired.set(u, parentXs.length ? parentXs.reduce((a, b) => a + b, 0) / parentXs.length : null);
    }
    const withParents = units.filter((u) => desired.get(u) != null).sort((a, b) => desired.get(a)! - desired.get(b)!);
    const without = units.filter((u) => desired.get(u) == null);
    let cursor: number | null = null;
    for (const u of [...withParents, ...without]) {
      const w = unitWidth(u);
      const center = desired.get(u);
      const want = center != null ? center - w / 2 : (cursor ?? 0);
      const start: number = cursor == null ? want : Math.max(want, cursor);
      u.forEach((m, i) => x.set(m, start + i * (CARD_W + GAP_X)));
      cursor = start + w + GAP_X * 2;
    }
  }

  const nodes: PositionedNode[] = personIds.map((id) => ({ id, x: x.get(id)!, y: gen.get(id)! * (CARD_H + GAP_Y), gen: gen.get(id)! }));
  const pos = new Map(nodes.map((n) => [n.id, n]));

  const edges: TreeEdge[] = [];
  for (const r of spouseRels) {
    const a = pos.get(r.personA)!;
    const b = pos.get(r.personB)!;
    const [l, rgt] = a.x <= b.x ? [a, b] : [b, a];
    const y1 = l.y + CARD_H / 2;
    edges.push({
      key: `s:${r.personA}:${r.personB}`,
      d: `M${l.x + CARD_W},${y1} L${rgt.x},${rgt.y + CARD_H / 2}`,
      dashed: r.subtype === "divorced",
    });
  }

  // Children grouped by their exact set of parents share one connector.
  const groups = new Map<string, { parents: string[]; children: { id: string; dashed: boolean }[] }>();
  for (const child of personIds) {
    const parents = [...parentsOf.get(child)!].sort();
    if (!parents.length) continue;
    const key = parents.join("+");
    if (!groups.has(key)) groups.set(key, { parents, children: [] });
    const nonBio = parentRels.some((r) => r.personB === child && r.subtype !== "biological");
    groups.get(key)!.children.push({ id: child, dashed: nonBio });
  }
  for (const [key, { parents, children }] of groups) {
    const ps = parents.map((p) => pos.get(p)!);
    const ox = ps.reduce((s, p) => s + p.x + CARD_W / 2, 0) / ps.length;
    const sameRowPair = ps.length === 2 && ps[0].y === ps[1].y;
    const oy = sameRowPair ? ps[0].y + CARD_H / 2 : Math.max(...ps.map((p) => p.y)) + CARD_H;
    const parentBottom = Math.max(...ps.map((p) => p.y)) + CARD_H;
    const cs = children.map((c) => ({ ...c, n: pos.get(c.id)! }));
    const barY = Math.min(...cs.map((c) => c.n.y)) - GAP_Y / 2;
    const xs = [ox, ...cs.map((c) => c.n.x + CARD_W / 2)];
    edges.push({
      key: `p:${key}`,
      d: `M${ox},${oy} V${Math.max(barY, parentBottom)} M${Math.min(...xs)},${barY} H${Math.max(...xs)}`,
      dashed: false,
    });
    for (const c of cs) {
      edges.push({ key: `c:${key}:${c.id}`, d: `M${c.n.x + CARD_W / 2},${barY} V${c.n.y}`, dashed: c.dashed });
    }
  }

  const minX = Math.min(0, ...nodes.map((n) => n.x));
  const maxX = Math.max(CARD_W, ...nodes.map((n) => n.x + CARD_W));
  const maxY = Math.max(CARD_H, ...nodes.map((n) => n.y + CARD_H));
  return { nodes, edges, bounds: { minX, minY: 0, width: maxX - minX, height: maxY } };
}
