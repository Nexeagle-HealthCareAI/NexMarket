import { NextResponse } from 'next/server';
import { isPushTokenConfigured, verifyPushToken } from '@/lib/push/auth';
import { getSubscriptions, isValidSubscription, saveSubscriptions } from '@/lib/push/store';

export async function POST(req: Request) {
  try {
    if (!isPushTokenConfigured()) {
      return NextResponse.json({ error: 'Push notifications are not configured on the server' }, { status: 503 });
    }

    // The agentId comes only from the signed push token — never from the body —
    // so one agent can't register (or overwrite) another agent's subscription.
    const agentId = verifyPushToken(req);
    if (!agentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscription } = await req.json();
    if (!isValidSubscription(subscription)) {
      return NextResponse.json({ error: 'A valid push subscription is required' }, { status: 400 });
    }

    // One subscription per agent: replace any previous one for this agent, and
    // drop the same endpoint if it was registered under someone else (shared device).
    const subs = getSubscriptions().filter(
      s => s.agentId !== agentId && s.subscription?.endpoint !== subscription.endpoint
    );
    subs.push({
      agentId,
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      },
      updatedAt: new Date().toISOString(),
    });
    saveSubscriptions(subs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
