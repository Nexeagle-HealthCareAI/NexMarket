import { NextResponse } from 'next/server';
import webpush from 'web-push';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'push-subscriptions.json');

// Configure web-push
const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
  webpush.setVapidDetails(
    'mailto:test@example.com',
    publicVapidKey,
    privateVapidKey
  );
}

function getSubscriptions(): any[] {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading subscriptions:', err);
  }
  return [];
}

export async function POST(req: Request) {
  try {
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

    const payload = JSON.stringify({
      title,
      body,
      data
    });

    const sendPromises = targetSubs.map(sub => 
      webpush.sendNotification(sub.subscription, payload).catch(err => {
        console.error('Failed to send notification to', sub.agentId, err);
        // Note: In a real system, you'd want to remove expired subscriptions here (statusCode 410 or 404)
        return { success: false, error: err, agentId: sub.agentId };
      })
    );

    const results = await Promise.all(sendPromises);
    const failedCount = results.filter(r => r && (r as any).success === false).length;

    return NextResponse.json({ 
      success: true, 
      sent: targetSubs.length - failedCount,
      failed: failedCount
    });

  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
