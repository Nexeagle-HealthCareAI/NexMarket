import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'push-subscriptions.json');

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

function saveSubscriptions(subs: any[]) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(subs, null, 2));
  } catch (err) {
    console.error('Error saving subscriptions:', err);
  }
}

export async function POST(req: Request) {
  try {
    const { agentId, subscription } = await req.json();

    if (!agentId || !subscription) {
      return NextResponse.json({ error: 'agentId and subscription are required' }, { status: 400 });
    }

    const subs = getSubscriptions();
    
    // Remove existing subscription for this agent if it exists
    const filteredSubs = subs.filter(s => s.agentId !== agentId);
    
    // Add new subscription
    filteredSubs.push({
      agentId,
      subscription,
      updatedAt: new Date().toISOString()
    });

    saveSubscriptions(filteredSubs);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to subscribe to push:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
