import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { isWebhookConfigured, verifyWebhookSecret } from '@/lib/push/auth';
import { getSubscriptions, saveSubscriptions } from '@/lib/push/store';

// Configure web-push
const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;
// VAPID "subject" identifies the sender to push services — a mailto: or https: URL.
const vapidSubject = process.env.VAPID_SUBJECT || 'https://nexmarket.nexeagle.com';

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(vapidSubject, publicVapidKey, privateVapidKey);
}

export async function POST(req: Request) {
  try {
    if (!isWebhookConfigured()) {
      return NextResponse.json({ error: 'Notification webhook is not configured on the server' }, { status: 503 });
    }

    // Server-to-server only: callers must send `Authorization: Bearer <NOTIFY_WEBHOOK_SECRET>`.
    // Without this, anyone on the internet could push notifications to every agent.
    if (!verifyWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!publicVapidKey || !privateVapidKey) {
      return NextResponse.json({ error: 'VAPID keys are not configured on the server' }, { status: 500 });
    }

    const { title, body, targetAgentId, data } = await req.json();

    if (!title || !body) {
      return NextResponse.json({ error: 'title and body are required' }, { status: 400 });
    }

    const allSubs = getSubscriptions();

    // Filter by targetAgentId if provided, otherwise send to all
    const targetSubs = targetAgentId
      ? allSubs.filter(s => s.agentId === targetAgentId)
      : allSubs;

    if (targetSubs.length === 0) {
      return NextResponse.json({ message: 'No subscriptions found for the target' }, { status: 200 });
    }

    const payload = JSON.stringify({ title, body, data });

    const expiredEndpoints = new Set<string>();
    const results = await Promise.all(
      targetSubs.map(sub =>
        webpush.sendNotification(sub.subscription, payload)
          .then(() => true)
          .catch((err: { statusCode?: number }) => {
            // 404/410 mean the browser has dropped this subscription for good.
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              expiredEndpoints.add(sub.subscription.endpoint);
            } else {
              console.error('Failed to send notification to', sub.agentId, err);
            }
            return false;
          })
      )
    );

    if (expiredEndpoints.size > 0) {
      saveSubscriptions(getSubscriptions().filter(s => !expiredEndpoints.has(s.subscription?.endpoint)));
    }

    const failedCount = results.filter(ok => !ok).length;
    return NextResponse.json({
      success: true,
      sent: targetSubs.length - failedCount,
      failed: failedCount,
      removedExpired: expiredEndpoints.size,
    });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
