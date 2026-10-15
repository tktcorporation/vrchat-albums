import { isAcked, type AckStore } from './ack';
import type { FleetRow } from './row';

export type Groups = { pending: FleetRow[]; working: FleetRow[]; idle: FleetRow[]; other: FleetRow[] };

// 古い done を初回起動時に全部「未確認」として積まないための下限
export const DONE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const byUpdatedDesc = (a: FleetRow, b: FleetRow) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
const byUpdatedAsc = (a: FleetRow, b: FleetRow) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0);

export function groupRows(rows: FleetRow[], acks: AckStore, now: number): Groups {
  const g: Groups = { pending: [], working: [], idle: [], other: [] };
  for (const r of rows) {
    if (r.status === 'blocked') g.pending.push(r);
    else if (r.status === 'done') {
      const stale = r.updatedAt !== null && now - r.updatedAt > DONE_STALE_MS;
      (isAcked(acks, r) || stale ? g.other : g.pending).push(r);
    } else if (r.status === 'working') g.working.push(r);
    else if (r.status === 'idle') g.idle.push(r);
    else g.other.push(r);
  }
  g.pending.sort(byUpdatedAsc);
  g.working.sort(byUpdatedDesc);
  g.idle.sort(byUpdatedDesc);
  g.other.sort(byUpdatedDesc);
  return g;
}
