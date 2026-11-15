#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on the deployment host.'; exit 1; }
cd "$(dirname "$0")/.."
[[ $(git branch --show-current) == main ]] || { echo 'Switch checkout to main first.'; exit 1; }
[[ -f .env && -f compose.yaml ]] || { echo 'Configure the checkout before installing the updater.'; exit 1; }
deploy/cosign-update.sh --check-migration
# Copy outside the checkout so a git update cannot change an executing script.
systemctl disable --now orderguard-update.timer 2>/dev/null || true
systemctl stop orderguard-update.service 2>/dev/null || true
systemctl stop cosign-update.timer 2>/dev/null || true
systemctl stop cosign-update.service 2>/dev/null || true
install -d -m 700 /var/lib/cosign-deploy
ln -sfnT -- "$(pwd -P)" /var/lib/cosign-deploy/checkout
install -m 755 deploy/cosign-update.sh /usr/local/sbin/cosign-update
install -m 644 deploy/systemd/cosign-update.service /etc/systemd/system/
install -m 644 deploy/systemd/cosign-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cosign-update.timer
systemctl start --no-block cosign-update.service
