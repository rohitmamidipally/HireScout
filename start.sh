#!/bin/bash
# HireScout — start the local proxy server
# Usage: ./start.sh

set -e

echo ""
echo "  ██╗  ██╗██╗██████╗ ███████╗███████╗ ██████╗ ██████╗ ██╗   ██╗████████╗"
echo "  ██║  ██║██║██╔══██╗██╔════╝██╔════╝██╔════╝██╔═══██╗██║   ██║╚══██╔══╝"
echo "  ███████║██║██████╔╝█████╗  ███████╗██║     ██║   ██║██║   ██║   ██║   "
echo "  ██╔══██║██║██╔══██╗██╔══╝  ╚════██║██║     ██║   ██║██║   ██║   ██║   "
echo "  ██║  ██║██║██║  ██║███████╗███████║╚██████╗╚██████╔╝╚██████╔╝   ██║   "
echo "  ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝  ╚═════╝    ╚═╝   "
echo ""

# Check Node.js is installed
if ! command -v node &> /dev/null; then
  echo "  ✗ Node.js not found."
  echo ""
  echo "  Install it from: https://nodejs.org  (LTS version recommended)"
  echo "  Then run this script again."
  echo ""
  exit 1
fi

NODE_VER=$(node -v)
echo "  Node.js $NODE_VER detected ✓"

# Check hiring-agent.html exists
if [ ! -f "hiring-agent.html" ]; then
  echo ""
  echo "  ✗ hiring-agent.html not found in current directory."
  echo "  Make sure server.js and hiring-agent.html are in the same folder."
  echo ""
  exit 1
fi

echo "  hiring-agent.html found ✓"
echo ""

# Start server
node server.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Open browser
PORT=3747
URL="http://localhost:$PORT"

echo ""
echo "  Opening $URL in your browser…"
echo ""

if command -v open &> /dev/null; then
  open "$URL"                    # macOS
elif command -v xdg-open &> /dev/null; then
  xdg-open "$URL"               # Linux
fi

# Wait for server process (keeps script alive so Ctrl+C stops server)
echo "  Press Ctrl+C to stop the server."
echo ""
wait $SERVER_PID
