import { ApiError, get, OfflineError, post } from './api';
import { kvJson, kvSet, notifyChange } from './db';
import { nowIso } from './util';

/**
 * Tasks the manager gives from Block assignments. The list is cached on the phone so it shows
 * offline; marking one done works offline too — it is queued and sent at the next sync.
 */

export interface Task {
  id: string; title: string; detail?: string | null; priority: 'high' | 'normal' | 'low'; dueDate?: string | null; overdue: boolean;
  block?: string | null; panchayats: { id: string; name: string; lat?: number | null; lng?: number | null }[];
  partner?: { clientId: string; name: string; type?: string | null } | null;
  status: 'open' | 'done' | 'cancelled'; createdBy: string; createdAt: string; doneAt?: string | null; doneNote?: string | null;
}
interface Pending { id: string; note: string | null; doneAt: string; undo: boolean }

const K_TASKS = 'tasks';
const K_QUEUE = 'taskQueue';

export const cachedTasks = (): Task[] => kvJson<Task[]>(K_TASKS, []);
const queue = (): Pending[] => kvJson<Pending[]>(K_QUEUE, []);

function apply(list: Task[], q: Pending[]): Task[] {
  return list.map((t) => {
    const p = [...q].reverse().find((x) => x.id === t.id);
    if (!p) return t;
    return p.undo ? { ...t, status: 'open', doneAt: null } : { ...t, status: 'done', doneAt: p.doneAt, doneNote: p.note ?? t.doneNote };
  });
}

let running: Promise<void> | null = null;

/** Send queued "done" taps, then fetch the latest list. Safe to call often; offline is not an error. */
export function refreshTasks(): Promise<void> {
  running ??= (async () => {
    try {
      let q = queue();
      for (const p of q) {
        try {
          await post(`/api/v1/me/tasks/${p.id}/done`, { note: p.note, doneAt: p.doneAt, undo: p.undo });
        } catch (e) {
          if (e instanceof OfflineError) throw e;
          if (!(e instanceof ApiError && (e.status === 404 || e.status === 400))) throw e;
          // The task was removed on the server; drop the tap.
        }
        q = q.filter((x) => x !== p);
        kvSet(K_QUEUE, JSON.stringify(q));
      }
      const r = await get<{ tasks: Task[] }>('/api/v1/me/tasks');
      kvSet(K_TASKS, JSON.stringify(apply(r.tasks, queue())));
      notifyChange();
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Mark done (or undo). Changes the phone at once and sends when there is signal. */
export function setTaskDone(id: string, note: string | null, undo = false) {
  const p: Pending = { id, note: note?.trim() || null, doneAt: nowIso(), undo };
  const q = [...queue(), p];
  kvSet(K_QUEUE, JSON.stringify(q));
  kvSet(K_TASKS, JSON.stringify(apply(cachedTasks(), [p])));
  notifyChange();
  void refreshTasks().catch(() => undefined);
}

export const pendingTaskCount = () => queue().length;
