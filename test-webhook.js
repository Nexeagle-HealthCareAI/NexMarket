// Test Webhook Notification
// Usage: NOTIFY_WEBHOOK_SECRET=... node test-webhook.js

async function sendNotification() {
  const url = process.env.NOTIFY_URL || 'http://localhost:3000/api/webhook/notify';
  const secret = process.env.NOTIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Set NOTIFY_WEBHOOK_SECRET (the same value the web app runs with).');
    process.exit(1);
  }
  const payload = {
    title: 'New Escalated Lead',
    body: 'Please review John Doe urgently.',
    data: {
      type: 'LEAD_ESCALATION',
      clientId: 'mock-client-id-123'
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Webhook Response:', res.status, data);
  } catch (err) {
    console.error('Error sending webhook:', err);
  }
}

sendNotification();
