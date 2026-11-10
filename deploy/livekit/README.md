# Calls server (LiveKit, self-hosted)

Voice calls, video calls and Field team huddles in the app and the CRM go through this server, on the same
VM as the API. Nothing is recorded. The API only issues short passes to join a call and keeps who/when/how long.

## 1. Domain and HTTPS

Phones and browsers connect with a secure WebSocket, so the server needs its own name and certificate:

1. DNS: add an `A` record `calls.nexeagle.com` → the VM's public IP.
2. Reverse proxy (whatever already serves `nexmarket-api.nexeagle.com`) → `http://127.0.0.1:7880`, with WebSocket
   upgrade. Caddy:

   ```
   calls.nexeagle.com {
       reverse_proxy 127.0.0.1:7880
   }
   ```

   nginx:

   ```
   server {
       listen 443 ssl http2;
       server_name calls.nexeagle.com;
       # ssl_certificate … (certbot)
       location / {
           proxy_pass http://127.0.0.1:7880;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_read_timeout 86400;
       }
   }
   ```

## 2. Firewall (cloud security group and the VM)

| Port | Protocol | Why |
|---|---|---|
| 443 | TCP | `wss://calls…` through the proxy |
| 7881 | TCP | media when UDP is blocked |
| 50000–50100 | UDP | media (best quality) |
| 3478 | UDP | TURN relay for phones behind strict mobile networks |

Port 7880 stays closed to the outside (only the proxy uses it).

About 100 UDP ports allow ~50 people in calls at once. Bandwidth: a 1:1 video call at phone quality uses about
0.5–1 Mbit/s each way through the server; voice about 50 kbit/s.

## 3. Secrets

Create two GitHub secrets: `LIVEKIT_API_KEY` (e.g. `nexcalls`) and `LIVEKIT_API_SECRET` (32+ random characters:
`openssl rand -base64 33`). Never commit them.

## 4. Start the server

Copy `livekit-deploy.yml.example` to `.github/workflows/livekit-deploy.yml` and run it (Actions → Calls server →
Run workflow). Or on the VM:

```
cd /opt/nexmarket-livekit   # with livekit.yaml and docker-compose.livekit.yml copied here
LIVEKIT_KEYS="nexcalls: <secret>" docker compose -f docker-compose.livekit.yml up -d
```

## 5. Connect the API

Add three lines to the env file the API deploy writes (`.github/workflows/api-deploy.yml`, the `{ … } > "$ENVFILE"`
block), plus the matching `env:` entries from the secrets:

```
printf 'LiveKit__Url=%s\n' 'wss://calls.nexeagle.com'
printf 'LiveKit__ApiKey=%s\n' "$LIVEKIT_API_KEY"
printf 'LiveKit__ApiSecret=%s\n' "$LIVEKIT_API_SECRET"
```

```
LIVEKIT_API_KEY: ${{ secrets.LIVEKIT_API_KEY }}
LIVEKIT_API_SECRET: ${{ secrets.LIVEKIT_API_SECRET }}
```

Until these are set, `GET /api/v1/calls/status` says `on: false` and the app and CRM hide the call buttons.

## Check it works

- `curl https://calls.nexeagle.com` → `OK`
- LiveKit's connection tester: https://livekit.io/connection-test (needs a token: create one with the CRM by starting
  a call, or ask for a test token).
