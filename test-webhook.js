// Test Webhook Notification

async function sendNotification() {
  const url = 'http://localhost:3000/api/webhook/notify';
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Webhook Response:', data);
  } catch (err) {
    console.error('Error sending webhook:', err);
  }
}

sendNotification();
