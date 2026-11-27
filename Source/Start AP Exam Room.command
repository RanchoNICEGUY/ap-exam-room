#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

export NO_PROXY="127.0.0.1,localhost"
export no_proxy="127.0.0.1,localhost"

PORT=$(python3 -c '
import socket
for p in range(18990, 19010):
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", p)) != 0:
            print(p); break
')

echo "Starting AP Exam Room Portable on http://127.0.0.1:${PORT}/"
python3 dev_server.py "$PORT" >/tmp/ap_exam_room_portable.log 2>&1 &
SRV_PID=$!
trap 'kill $SRV_PID 2>/dev/null || true' EXIT

sleep 1
open -g "http://127.0.0.1:${PORT}/" 2>/dev/null || open "http://127.0.0.1:${PORT}/"
echo "Server running (PID=$SRV_PID). Press Ctrl+C in this window to stop."
wait $SRV_PID
