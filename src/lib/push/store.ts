/**
 * Server-only web-push subscription store (one JSON file).
 *
 * The file lives in PUSH_DATA_DIR (default ./data). In the Docker deployment that
 * directory is a named volume, so subscriptions survive redeploys — previously the
 * file sat in the container's working directory and was wiped on every deploy.
 */
import fs from 'fs';
import path from 'path';

export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface StoredSubscription {
  agentId: string;
  subscription: PushSubscriptionJSON;
  updatedAt: string;
}

const DATA_DIR = process.env.PUSH_DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'push-subscriptions.json');

export function getSubscriptions(): StoredSubscription[] {
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.error('Error reading subscriptions:', err);
  }
  return [];
}

export function saveSubscriptions(subs: StoredSubscription[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated file.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(subs, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

/** Basic shape check so arbitrary JSON can't be stored as a "subscription". */
export function isValidSubscription(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const keys = v.keys as Record<string, unknown> | undefined;
  if (typeof v.endpoint !== 'string' || v.endpoint.length > 2048) return false;
  try {
    if (new URL(v.endpoint).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return (
    !!keys &&
    typeof keys.p256dh === 'string' && keys.p256dh.length <= 256 &&
    typeof keys.auth === 'string' && keys.auth.length <= 256
  );
}
