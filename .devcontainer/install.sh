#!/usr/bin/env bash
set -euo pipefail

npm --prefix adapters ci --no-audit --no-fund
npm --prefix server ci --no-audit --no-fund
npm --prefix client ci --no-audit --no-fund
