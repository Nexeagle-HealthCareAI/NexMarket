const crypto = require('crypto');
const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();
console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
// Shared between the API (Push__TokenSecret) and the web app (PUSH_TOKEN_SECRET).
console.log('PUSH_TOKEN_SECRET=' + crypto.randomBytes(32).toString('base64url'));
// Sent by whatever server calls /api/webhook/notify.
console.log('NOTIFY_WEBHOOK_SECRET=' + crypto.randomBytes(32).toString('base64url'));
