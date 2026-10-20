// Pure layout for the family tree (no server imports, so it runs in the browser and in tests).

export type LayoutRel = { type: "parent" | "spouse"; personA: string; personB: string; subtype: string };
export type PositionedNode = { id: string; x: number; y: number; gen: number };
// from/to: the people an edge joins, so a selected person's bloodline can light up. gen: row of its lower end.
export type TreeEdge = { key: string; d: string; dashed: boolean; from: string[]; to: string[]; gen: number; knot?: { x: number; y: number } };

// A node is a round medallion with the name underneath; MEDAL_CY/MEDAL_R place the medallion inside the node box.
export const CARD_W = 152;
export const CARD_H = 152;
export const MEDAL_CY = 48;
export const MEDAL_R = 44;
const GAP_X = 24;
const GAP_Y = 84;

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

  const cx = (n: PositionedNode) => n.x + CARD_W / 2;
  const cy = (n: PositionedNode) => n.y + MEDAL_CY;

  const edges: TreeEdge[] = [];
  for (const r of spouseRels) {
    const a = pos.get(r.personA)!;
    const b = pos.get(r.personB)!;
    const [l, rgt] = a.x <= b.x ? [a, b] : [b, a];
    edges.push({
      key: `s:${r.personA}:${r.personB}`,
      d: `M${cx(l) + MEDAL_R},${cy(l)} L${cx(rgt) - MEDAL_R},${cy(rgt)}`,
      dashed: r.subtype === "divorced",
      from: [l.id], to: [rgt.id], gen: Math.max(l.gen, rgt.gen),
      knot: { x: (cx(l) + cx(rgt)) / 2, y: (cy(l) + cy(rgt)) / 2 },
    });
  }

  // Children grouped by their exact set of parents grow from one point: the couple's knot, or below a lone parent.
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
    const cs = children.map((c) => ({ ...c, n: pos.get(c.id)! }));
    const ox = ps.reduce((s, p) => s + cx(p), 0) / ps.length;
    const sy = Math.max(...ps.map((p) => p.y)) + CARD_H + 6; // just below the parents' names
    if (ps.length === 2 && ps[0].y === ps[1].y) {
      edges.push({
        key: `t:${key}`, d: `M${ox},${cy(ps[0])} V${sy}`, dashed: false,
        from: parents, to: children.map((c) => c.id), gen: Math.min(...cs.map((c) => c.n.gen)),
      });
    }
    for (const c of cs) {
      const tx = cx(c.n);
      const ty = cy(c.n) - MEDAL_R - 4;
      const k = (ty - sy) / 2;
      edges.push({
        key: `c:${key}:${c.id}`, d: `M${ox},${sy} C${ox},${sy + k} ${tx},${ty - k} ${tx},${ty}`, dashed: c.dashed,
        from: parents, to: [c.id], gen: c.n.gen,
      });
    }
  }

  const minX = Math.min(0, ...nodes.map((n) => n.x));
  const maxX = Math.max(CARD_W, ...nodes.map((n) => n.x + CARD_W));
  const maxY = Math.max(CARD_H, ...nodes.map((n) => n.y + CARD_H));
  return { nodes, edges, bounds: { minX, minY: 0, width: maxX - minX, height: maxY } };
}

/** The person, their spouses, and everyone above or below them by parent links. */
export function lineageOf(id: string, rels: LayoutRel[]) {
  const set = new Set([id]);
  const climb = (dir: "up" | "down") => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const r of rels) {
        if (r.type !== "parent") continue;
        const next = dir === "up" ? (r.personB === cur ? r.personA : null) : (r.personA === cur ? r.personB : null);
        if (next && !set.has(next)) {
          set.add(next);
          stack.push(next);
        }
      }
    }
  };
  climb("up");
  climb("down");
  for (const r of rels) if (r.type === "spouse" && (r.personA === id || r.personB === id)) set.add(r.personA === id ? r.personB : r.personA);
  return set;
}
