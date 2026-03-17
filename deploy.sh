#!/usr/bin/env bash
# AquaLight deploy — run from your local machine (not robix)
# Usage: ./deploy.sh
set -e

REMOTE=rcampbell@robix
REMOTE_DIR=/var/www/aqualight

echo "==> Building..."
npm run build

echo "==> Syncing to robix..."
ssh "$REMOTE" "sudo mkdir -p $REMOTE_DIR && sudo chown rcampbell:rcampbell $REMOTE_DIR"
rsync -av --delete dist/    "$REMOTE:$REMOTE_DIR/dist/"
rsync -av            backend/ "$REMOTE:$REMOTE_DIR/backend/"
rsync -av            aqualight.service "$REMOTE:/tmp/aqualight.service"
rsync -av            aqualight.nginx   "$REMOTE:/tmp/aqualight.nginx"

echo "==> Installing on robix..."
ssh "$REMOTE" bash <<'ENDSSH'
  set -e

  # Python deps
  pip3 install -q flask

  # Create .env if it doesn't exist (user fills in HA_TOKEN)
  if [ ! -f /var/www/aqualight/.env ]; then
    cat > /var/www/aqualight/.env <<EOF
HA_CONFIG=/home/rcampbell/.homeassistant
HA_URL=http://localhost:8123
HA_TOKEN=
PORT=5175
EOF
    echo "  Created /var/www/aqualight/.env — add your HA_TOKEN!"
  fi

  # sudoers rule: allow writing automations.yaml without password
  echo 'rcampbell ALL=(ALL) NOPASSWD: /usr/bin/cp, /usr/bin/tee, /usr/bin/rm' \
    | sudo tee /etc/sudoers.d/aqualight > /dev/null
  sudo chmod 440 /etc/sudoers.d/aqualight

  # systemd service
  sudo cp /tmp/aqualight.service /etc/systemd/system/aqualight.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now aqualight
  sudo systemctl restart aqualight

  # nginx
  sudo cp /tmp/aqualight.nginx /etc/nginx/sites-available/aqualight
  sudo ln -sf /etc/nginx/sites-available/aqualight /etc/nginx/sites-enabled/aqualight
  sudo nginx -t && sudo systemctl reload nginx

  echo "  Done. AquaLight running at http://aqualight.robix"
ENDSSH

echo ""
echo "==> Updating robix index page..."
ssh "$REMOTE" bash <<'ENDSSH'
  INDEX=/var/www/html/index.html
  if [ ! -f "$INDEX" ]; then
    INDEX=$(find /var/www -name index.html | head -1)
  fi
  if [ -f "$INDEX" ]; then
    if ! grep -q "aqualight" "$INDEX"; then
      # Insert link before closing </ul> or </body>
      sudo sed -i 's|</ul>|  <li><a href="http://aqualight.robix">AquaLight</a> — Aquarium light schedule editor</li>\n</ul>|' "$INDEX" \
        || sudo sed -i 's|</body>|<p><a href="http://aqualight.robix">AquaLight</a> — Aquarium light schedule editor</p>\n</body>|' "$INDEX"
      echo "  Added AquaLight to index at $INDEX"
    else
      echo "  AquaLight already in index."
    fi
  else
    echo "  WARNING: Could not find robix index.html — add the link manually."
  fi
ENDSSH

echo ""
echo "All done!"
echo "  App:    http://aqualight.robix"
echo "  .env:   /var/www/aqualight/.env  (add HA_TOKEN for auto-reload)"
