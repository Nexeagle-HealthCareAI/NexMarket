# Calls server (LiveKit, self-hosted)

Voice calls, video calls and Field team huddles in the app and the CRM go through this server, on the same
VM as the API. Nothing is recorded. The API only issues short passes to join a call and keeps who/when/how long.

## 1. Domain and HTTPS

Phones and browsers connect with a secure WebSocket, so the server needs its own name and certificate:

1. DNS: add two `A` records → the VM's public IP: `calls.nexeagle.com` (connecting) and `turn.nexeagle.com` (the
   relay for strict networks, step 2b).
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
| 443 | TCP | `wss://calls…` through the proxy, and TURN over TLS (`turn.nexeagle.com`) on strict networks |
| 7881 | TCP | media when UDP is blocked |
| 50000–50100 | UDP | media (best quality) |
| 3478 | UDP | TURN relay for phones behind strict mobile networks |

Ports 7880, 5349 and 5350 stay closed to the outside (only nginx uses them).

About 100 UDP ports allow ~50 people in calls at once. Bandwidth: a 1:1 video call at phone quality uses about
0.5–1 Mbit/s each way through the server; voice about 50 kbit/s.

## 2b. Calls on strict networks (TURN over port 443)

Many mobile data plans, hospital and office Wi-Fi block the UDP that calls normally use; then a call can't connect at
all. LiveKit can relay a call over TLS on port 443 (it looks like ordinary HTTPS), and it always tells phones to use
`turns:turn.nexeagle.com:443`. Port 443 is already used by the websites, so nginx shares it by name:
`turn.nexeagle.com` goes to LiveKit, everything else to the websites as before.

1. Certificate for the relay name (port 80 keeps working as it is):

   ```
   sudo certbot certonly --nginx -d turn.nexeagle.com --deploy-hook "docker restart nexmarket-livekit"
   ```

   (The hook restarts the calls server whenever the certificate renews, so it picks up the new one.)
2. Share port 443: follow the steps at the top of `nginx-443-sni.conf` (install `libnginx-mod-stream`, include the file,
   move the existing HTTPS sites to `listen 127.0.0.1:8443 ssl proxy_protocol;` with the two real-IP lines, then
   `sudo nginx -t && sudo systemctl reload nginx`). Check the websites still open afterwards.
3. Deploy the calls server again: it sees the certificate and switches TURN over 443 on ("TURN over 443: on" in the
   job's log). Until the certificate exists it runs without it, so calls still work on ordinary networks.

If the VM uses Caddy instead of nginx for HTTPS: put nginx's `stream` block in front on 443 as above and move Caddy to
`127.0.0.1:8443` (Caddy needs the `proxy_protocol` listener wrapper to see real visitor IPs), or give
`turn.nexeagle.com` a second public IP and set `tls_port: 443` in `livekit.yaml` instead.

Tested before shipping: with UDP blocked, two browsers connected and exchanged audio and video through
`turns:turn.nexeagle.com:443` behind this nginx routing, and HTTPS on the same port still reached the website.

## 3. Secrets

Create two GitHub secrets: `LIVEKIT_API_KEY` (e.g. `nexcalls`) and `LIVEKIT_API_SECRET` (32+ random characters:
`openssl rand -base64 33`). Never commit them.

## 4. Start the server

Copy `livekit-deploy.yml.example` to `.github/workflows/livekit-deploy.yml` and run it (Actions → Calls server →
Run workflow). Or on the VM:

```
cd /opt/nexmarket-livekit   # with livekit.yaml and docker-compose.livekit.yml copied here
# with the turn.nexeagle.com certificate:  cp livekit.yaml livekit.active.yaml
# without it yet:                          grep -v tls-only livekit.yaml > livekit.active.yaml
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
- `openssl s_client -connect turn.nexeagle.com:443 -servername turn.nexeagle.com </dev/null | grep subject` →
  `CN = turn.nexeagle.com` (the relay answers on 443), and the websites still open in a browser.
- LiveKit's connection tester: https://livekit.io/connection-test (needs a token: create one with the CRM by starting
  a call, or ask for a test token).
