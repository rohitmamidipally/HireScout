#!/bin/bash
# HireScout — Remove the daily scheduler
# Usage: ./uninstall-scheduler.sh

PLIST_DEST="$HOME/Library/LaunchAgents/com.hirescout.dailyagent.plist"

echo ""
echo "  Removing HireScout daily scheduler…"

launchctl unload "$PLIST_DEST" 2>/dev/null && echo "  ✓ Unloaded from launchd" || echo "  (was not loaded)"
rm -f "$PLIST_DEST" && echo "  ✓ Plist removed" || echo "  (plist not found)"

echo ""
echo "  Done. The agent will no longer run automatically."
echo "  You can still run it manually with: node agent.js"
echo ""
