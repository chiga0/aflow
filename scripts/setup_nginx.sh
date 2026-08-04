#!/usr/bin/env bash
# Install nginx on the VPS and reverse-proxy a domain (or bare IP) to the
# aflow-lite runtime on 127.0.0.1:8765. SSE-friendly (proxy_buffering off).
#
#   setup_nginx.sh user@host [domain]
#
# Without a domain it serves server_name _ on :80 (http://IP/ works once the
# security group opens 80). With a domain (already A-recorded to the host) it
# sets server_name and provisions Let's Encrypt via certbot for HTTPS.
set -euo pipefail
TARGET="${1:?usage: setup_nginx.sh user@host [domain]}"
DOMAIN="${2:-}"
SSH_KEY="${SSH_KEY_FILE:-$HOME/.ssh/lite-old.pem}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

ssh "${SSH_OPTS[@]}" "$TARGET" "DOMAIN='${DOMAIN}' bash -s" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx
if [ -n "${DOMAIN:-}" ]; then apt-get install -y -qq certbot python3-certbot-nginx || true; fi

cat > /etc/nginx/sites-available/aflow-lite <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN:-_};

    # SSE / streaming: do not buffer
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
CONF

ln -sf /etc/nginx/sites-available/aflow-lite /etc/nginx/sites-enabled/aflow-lite
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx || systemctl restart nginx

if [ -n "${DOMAIN:-}" ]; then
  echo "-- provisioning Let's Encrypt for ${DOMAIN} --"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email \
    || echo "certbot failed; HTTP on :80 still works. Open 80/443 in the security group and re-run."
else
  echo "no domain given; serving server_name _ on :80"
fi
systemctl enable nginx >/dev/null 2>&1 || true
echo "NGINX_OK domain=${DOMAIN:-_}"
REMOTE
