#!/usr/bin/env bash
#
# One-time bootstrap for chumlab-be on a fresh Ubuntu 22.04 EC2 instance.
# Run as root (or with sudo) AFTER editing the variables below.
#
#   sudo bash setup-server.sh
#
# Re-running is safe: each step is idempotent.

set -euo pipefail

# ─── Edit these BEFORE running ───────────────────────────────────────────────
DEPLOY_USER="deploy"
APP_DIR="/var/www/chumlab-be"
DOMAIN="api.chumlab.com"
LETSENCRYPT_EMAIL="you@chumlab.com"          # used by certbot for renewal notices
REPO_URL="git@github.com:chumlabhq/chumlab-be.git"   # SSH if private; HTTPS if public
# ─────────────────────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash setup-server.sh)"
  exit 1
fi

echo "==> 1/9 apt update + base packages"
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates gnupg

echo "==> 2/9 Node 20 LTS + PM2"
if ! command -v node >/dev/null || ! node -v | grep -q "^v20"; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "==> 3/9 deploy user"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"

# Allow deploy user to reload/restart nginx without password.
cat > /etc/sudoers.d/deploy-nginx <<EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx, /bin/systemctl restart nginx
EOF
chmod 440 /etc/sudoers.d/deploy-nginx

echo "==> 4/9 app directory"
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==> 5/9 clone + install (as $DEPLOY_USER)"
sudo -u "$DEPLOY_USER" -H bash <<EOSU
set -euo pipefail
cd "$APP_DIR"
if [ ! -d .git ]; then
  # If REPO_URL is SSH-form, the deploy user must have an SSH key with read
  # access to the repo (GitHub deploy key). See README for setup steps.
  git clone "$REPO_URL" .
fi
mkdir -p logs
npm ci --omit=dev
EOSU

echo "==> 6/9 .env stub"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=5000

MONGODB_URI=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_OAUTH_VERIFY=true

CORS_ORIGIN=https://chumlab.com
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo
  echo "  *** Stub created at $APP_DIR/.env"
  echo "  *** Fill in MONGODB_URI / RAZORPAY_* / GOOGLE_CLIENT_ID, then run:"
  echo "  ***   sudo -u $DEPLOY_USER pm2 reload chumlab-be --update-env"
fi

echo "==> 7/9 PM2 startup (as $DEPLOY_USER)"
sudo -u "$DEPLOY_USER" -H bash <<EOSU
set -euo pipefail
cd "$APP_DIR"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
EOSU
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" >/dev/null

echo "==> 8/9 nginx site"
install -m 644 "$APP_DIR/deploy/nginx.conf" "/etc/nginx/sites-available/$DOMAIN.conf"
sed -i "s/api\.chumlab\.com/$DOMAIN/g" "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> 9/9 firewall + SSL"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

apt-get install -y certbot python3-certbot-nginx
certbot --nginx --non-interactive --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$DOMAIN" \
  --redirect

echo
echo "==================================================================="
echo "Bootstrap complete."
echo "  Domain:  https://$DOMAIN"
echo "  Health:  curl https://$DOMAIN/api/health"
echo
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env and fill in real values."
echo "  2. sudo -u $DEPLOY_USER pm2 reload chumlab-be --update-env"
echo "  3. Add the GitHub Actions deploy public key to:"
echo "       /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "==================================================================="
