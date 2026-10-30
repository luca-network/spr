#!/usr/bin/env bash
# Hook: post-edit-lint.sh
# Event: PostToolUse (Edit, Write)
# Purpose: Run node --check on edited .mjs files to catch syntax errors immediately.
#
# Exit 0 = OK (or not an .mjs file); exit 1 = syntax error found.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('file_path',''))" 2>/dev/null)

if echo "$FILE_PATH" | grep -qE "\.mjs$"; then
  if [ -f "$FILE_PATH" ]; then
    node --check "$FILE_PATH" 2>&1
    if [ $? -ne 0 ]; then
      echo "Syntax error in $FILE_PATH. Fix before continuing." >&2
      exit 1
    fi
  fi
fi

exit 0
