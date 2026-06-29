#!/usr/bin/env bash
# Start CUPS, register the Brother network printer, then launch the app.
set -e

QUEUE="${PRINTER_QUEUE:-Brother_QL_1110NWB}"
PRINTER_URI="${PRINTER_URI:-ipp://192.168.1.150/ipp/print}"

echo "[entrypoint] starting cupsd…"
# Run the CUPS scheduler in the background (foreground mode -f would block).
cupsd
# Give the scheduler a moment to open its socket.
for i in $(seq 1 10); do
  if lpstat -r >/dev/null 2>&1; then break; fi
  sleep 0.5
done

if lpstat -p "$QUEUE" >/dev/null 2>&1; then
  echo "[entrypoint] queue $QUEUE already exists"
else
  echo "[entrypoint] adding queue $QUEUE -> $PRINTER_URI"
  # IPP Everywhere (driverless) first; fall back to a raw queue if unavailable.
  lpadmin -p "$QUEUE" -E -v "$PRINTER_URI" -m everywhere \
    || lpadmin -p "$QUEUE" -E -v "$PRINTER_URI"
fi

# Make sure the queue accepts + is enabled.
cupsenable "$QUEUE" 2>/dev/null || true
cupsaccept "$QUEUE" 2>/dev/null || true

echo "[entrypoint] launching app…"
exec node src/index.js
