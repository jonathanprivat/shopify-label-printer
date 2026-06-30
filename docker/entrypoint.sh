#!/usr/bin/env bash
# Start CUPS, register the Brother network printer, then launch the app.
# Printer/CUPS setup is best-effort and must NEVER stop the app from starting
# (we can fix printing later; the bot + webhook should always come up).
set -u
export PATH="/usr/sbin:/usr/local/sbin:/usr/bin:/usr/local/bin:${PATH:-}"

QUEUE="${PRINTER_QUEUE:-Brother_QL_1110NWB}"
PRINTER_URI="${PRINTER_URI:-ipp://192.168.1.150/ipp/print}"

echo "[entrypoint] starting cupsd…"
/usr/sbin/cupsd 2>/dev/null || cupsd 2>/dev/null || echo "[entrypoint] cupsd not started (continuing)"

# Wait briefly for the scheduler socket.
for i in $(seq 1 10); do lpstat -r >/dev/null 2>&1 && break; sleep 0.5; done

if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  echo "[entrypoint] queue $QUEUE already exists"
else
  echo "[entrypoint] registering $QUEUE -> $PRINTER_URI"
  lpadmin -p "$QUEUE" -E -v "$PRINTER_URI" -m everywhere 2>/dev/null \
    || lpadmin -p "$QUEUE" -E -v "$PRINTER_URI" 2>/dev/null \
    || echo "[entrypoint] printer registration failed (continuing; fix later)"
fi
cupsenable "$QUEUE" 2>/dev/null || true
cupsaccept "$QUEUE" 2>/dev/null || true

echo "[entrypoint] launching app…"
exec node src/index.js
