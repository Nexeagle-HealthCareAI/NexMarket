/**
 * Server-only helpers for authenticating the web-push API routes.
 *
 * The .NET API owns login, and its httpOnly cookies live on the API origin, so
 * these Next.js routes can't see them. Two mechanisms are used instead:
 *
 *  - /api/notifications/subscribe: the browser first fetches a short-lived
 *    token from GET {API}/api/v1/notifications/push-token (authenticated by the
 *    API's cookie). That token is HMAC-signed with PUSH_TOKEN_SECRET, which only
 *    the two servers know, and carries the caller's agentId.
 *  - /api/webhook/notify: server-to-server, guarded by NOTIFY_WEBHOOK_SECRET
 *    sent as `Authorization: Bearer <secret>`.
 */
import { createHmac, timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/** Returns the verified agentId, or null if the token is missing/invalid/expired. */
export function verifyPushToken(req: Request): string | null {
  const secret = process.env.PUSH_TOKEN_SECRET;
  if (!secret || secret.length < 32) return null;

  const token = bearer(req);
  if (!token) return null;

  const [payloadPart, signaturePart, ...rest] = token.split('.');
  if (!payloadPart || !signaturePart || rest.length > 0) return null;

  const expected = createHmac('sha256', secret).update(payloadPart).digest('base64url');
  if (!safeEqual(signaturePart, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8'));
    if (typeof payload?.agentId !== 'string' || !payload.agentId) return null;
    if (typeof payload?.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload.agentId;
  } catch {
    return null;
  }
}

export function isPushTokenConfigured(): boolean {
  const secret = process.env.PUSH_TOKEN_SECRET;
  return !!secret && secret.length >= 32;
}

export function isWebhookConfigured(): boolean {
  const secret = process.env.NOTIFY_WEBHOOK_SECRET;
  return !!secret && secret.length >= 32;
}

export function verifyWebhookSecret(req: Request): boolean {
  const secret = process.env.NOTIFY_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return false;
  const provided = bearer(req);
  return !!provided && safeEqual(provided, secret);
}
