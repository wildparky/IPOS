export interface GraphLike {
  nodes: any[];
  edges: any[];
  name?: string;
  [key: string]: any;
}

const TRANSIENT_NODE_KEYS = ['selected', 'dragging', 'resizing', 'measured'];

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).filter(k => value[k] !== undefined).sort().reduce((o, k) => {
      o[k] = canonical(value[k]);
      return o;
    }, {} as any);
  }
  return value;
}

function equal(a: any, b: any): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function cleanEntity(entity: any, keys: string[]): any {
  const result = clone(entity);
  for (const key of keys) delete result[key];
  return result;
}

export function cleanGraph<T extends { nodes: any[]; edges: any[] }>(p: T): T {
  const result: any = clone(p);
  result.nodes = p.nodes.map(node => cleanEntity(node, TRANSIENT_NODE_KEYS));
  result.edges = p.edges.map(edge => cleanEntity(edge, ['selected']));
  return result;
}

export function graphPatch(before: GraphLike, after: GraphLike): any {
  const result: any = { nodes: [], edges: [] };
  for (const kind of ['nodes', 'edges'] as const) {
    const oldItems = new Map(before[kind].map(item => [item.id, item]));
    const newItems = new Map(after[kind].map(item => [item.id, item]));
    const ids = [...before[kind].map(x => x.id), ...after[kind].map(x => x.id).filter(id => !oldItems.has(id))];
    result[kind] = ids.filter(id => !equal(oldItems.get(id), newItems.get(id))).map(id => ({
      id, before: oldItems.has(id) ? clone(oldItems.get(id)) : null, after: newItems.has(id) ? clone(newItems.get(id)) : null
    }));
  }
  if (!equal(before.name, after.name)) result.name = { before: before.name ?? null, after: after.name ?? null };
  return result;
}

function mergeEntities(base: any[], local: any[], remote: any[], kind: string): any[] {
  const b = new Map(base.map(x => [x.id, x])), l = new Map(local.map(x => [x.id, x])), r = new Map(remote.map(x => [x.id, x]));
  const ids = [...remote.map(x => x.id), ...local.map(x => x.id).filter(id => !r.has(id))];
  const out = new Map<string, any>();
  for (const id of ids) {
    const bv = b.get(id), lv = l.get(id), rv = r.get(id);
    if (!bv) {
      if (lv && rv && !equal(lv, rv)) throw new Error(`Conflict in ${kind} ${id}`);
      out.set(id, clone(rv ?? lv));
    } else if (equal(lv, bv)) out.set(id, clone(rv));
    else if (equal(rv, bv) || equal(lv, rv)) out.set(id, clone(lv));
    else if (lv === undefined || rv === undefined) {
      const survivor = lv === undefined ? rv : lv;
      if (survivor && !equal(survivor, bv)) throw new Error(`Conflict in ${kind} ${id}`);
    } else throw new Error(`Conflict in ${kind} ${id}`);
  }
  return [...out.values()].filter(Boolean);
}

export function mergeProject<T extends GraphLike>(base: T, local: T, remote: T): T {
  const b = cleanGraph(base), l = cleanGraph(local), r = cleanGraph(remote);
  const nodes = mergeEntities(b.nodes, l.nodes, r.nodes, 'node');
  const edges = mergeEntities(b.edges, l.edges, r.edges, 'edge');
  const nodeIds = new Set(nodes.map(x => x.id));
  const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (validEdges.length !== edges.length) {
    const attached = edges.filter(e => !nodeIds.has(e.source) || !nodeIds.has(e.target));
    for (const edge of attached) {
      const baseEdge = b.edges.find(x => x.id === edge.id);
      const localEdge = l.edges.find(x => x.id === edge.id), remoteEdge = r.edges.find(x => x.id === edge.id);
      if ((localEdge && !equal(localEdge, baseEdge)) || (remoteEdge && !equal(remoteEdge, baseEdge))) throw new Error(`Conflict in edge ${edge.id}`);
    }
  }
  const result: any = { ...clone(remote), nodes, edges: validEdges };
  if (!equal(l.name, b.name) && !equal(r.name, b.name) && !equal(l.name, r.name)) throw new Error('Conflict in name');
  result.name = equal(l.name, b.name) ? r.name : l.name;
  return result;
}
