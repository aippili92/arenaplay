#!/usr/bin/env bash
# ArenaPlay — start backend + frontend
# Backend  → http://localhost:9000
# Frontend → http://localhost:9001

set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Backend ──────────────────────────────────────────────────────────────────
echo "Starting backend on port 9000..."
cd "$REPO_ROOT"
pip3 install -r backend/requirements.txt -q

# Run in background, log to backend.log
uvicorn backend.main:app --port 9000 --reload > "$REPO_ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID (logs: arenaplay/backend.log)"

# Wait for backend to be ready
echo -n "  Waiting for backend..."
for i in $(seq 1 20); do
  sleep 0.5
  if curl -sf http://localhost:9000/health > /dev/null 2>&1; then
    echo " ready."
    break
  fi
  echo -n "."
done

# ── Frontend ─────────────────────────────────────────────────────────────────
echo "Starting frontend on port 9001..."
cd "$REPO_ROOT/frontend"
npm install --silent
npm run dev &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"

echo ""
echo "──────────────────────────────────────────────"
echo "  ArenaPlay is running:"
echo "  → http://localhost:9001  (open this)"
echo "  Backend API: http://localhost:9000"
echo "  Backend logs: tail -f arenaplay/backend.log"
echo "──────────────────────────────────────────────"
echo "  Press Ctrl+C to stop both."
echo ""

# Keep running; kill both on Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait
