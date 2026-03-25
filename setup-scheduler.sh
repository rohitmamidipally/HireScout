#!/bin/bash
# HireScout — Automated Scheduler Setup
# Run this once to install the 7am daily agent.
# Usage: ./setup-scheduler.sh

set -e

echo ""
echo "  HireScout — Daily Agent Scheduler Setup"
echo "  ════════════════════════════════════════"
echo ""

# ── Detect the hirescout folder path ──
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AGENT_PATH="$SCRIPT_DIR/agent.js"
PLIST_SRC="$SCRIPT_DIR/com.hirescout.dailyagent.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.hirescout.dailyagent.plist"

echo "  HireScout folder: $SCRIPT_DIR"
echo ""

# ── Check agent.js exists ──
if [ ! -f "$AGENT_PATH" ]; then
  echo "  ✗ agent.js not found in $SCRIPT_DIR"
  echo "  Make sure you're running this from inside the hirescout folder."
  exit 1
fi

# ── Check config.js is filled in ──
if grep -q "YOUR-KEY-HERE" "$SCRIPT_DIR/config.js" 2>/dev/null; then
  echo "  ⚠ Warning: config.js still has placeholder values."
  echo "  Fill in your API keys before the agent runs."
  echo ""
fi

# ── Detect node path ──
NODE_PATH=$(which node 2>/dev/null || echo "")
if [ -z "$NODE_PATH" ]; then
  echo "  ✗ Node.js not found. Install from nodejs.org first."
  exit 1
fi
echo "  Node.js found at: $NODE_PATH"

# ── Write the plist with correct paths ──
echo "  Installing launchd job…"
mkdir -p "$HOME/Library/LaunchAgents"

sed \
  -e "s|HIRESCOUT_PATH|$SCRIPT_DIR|g" \
  -e "s|/usr/local/bin/node|$NODE_PATH|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

echo "  Plist written to: $PLIST_DEST"

# ── Load the job ──
# Unload first in case it's already loaded
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo ""
echo "  ✓ Scheduler installed successfully!"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  The agent will run every day at 7:00 AM.   │"
echo "  │                                             │"
echo "  │  To test it right now:                      │"
echo "  │    node agent.js --dry-run                  │"
echo "  │                                             │"
echo "  │  To run for real immediately:               │"
echo "  │    node agent.js                            │"
echo "  │                                             │"
echo "  │  To check the log:                          │"
echo "  │    tail -f agent.log                        │"
echo "  │                                             │"
echo "  │  To uninstall the scheduler:                │"
echo "  │    ./uninstall-scheduler.sh                 │"
echo "  └─────────────────────────────────────────────┘"
echo ""
