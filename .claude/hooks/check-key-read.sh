#!/usr/bin/env bash
# Hook: check-key-read.sh
# Event: PreToolUse (Read, Edit, Bash)
# Purpose: Warn if a tool input appears to target key.pem or private key material.
#
# Claude Code hooks receive tool input as JSON on stdin.
# This hook reads stdin, checks for key.pem references, and prints a warning.
# Exit 0 = allow; exit 2 = block with message to Claude.
#
# Limitations: pattern-based only; cannot guarantee complete enforcement.
# See docs/engineering/HOOKS.md for details.

INPUT=$(cat)

# Check if the input mentions key.pem in a read/write context
if echo "$INPUT" | grep -qiE '"key\.pem"|/key\.pem'; then
  TOOL=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null)
  # Allow spr-verify and read-only references; block writes
  if echo "$TOOL" | grep -qiE "^(Write|Edit)$"; then
    echo "BLOCKED: Attempting to write key.pem. Private key files must never be written to export locations." >&2
    exit 2
  else
    echo "WARNING: Tool references key.pem. Ensure private key material does not appear in export output." >&2
  fi
fi

exit 0
