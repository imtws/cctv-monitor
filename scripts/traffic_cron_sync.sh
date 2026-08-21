#!/bin/bash
# 트래픽 수집 기간에 맞춰 각 캠 서버의 vnstat/vnstati cron을 활성/비활성 동기화
# cron 예: */5 * * * * /home/www/cammon/scripts/traffic_cron_sync.sh >> /home/www/cammon/data/traffic_cron_sync.log 2>&1
# 강제 동기화: FORCE=1 /home/www/cammon/scripts/traffic_cron_sync.sh
# 트래픽 DB 초기화: RESET=1 /home/www/cammon/scripts/traffic_cron_sync.sh

set -u

BASE_DIR="/home/www/cammon"
ALERT_CONFIG="${BASE_DIR}/data/alert_config.json"
IPS_FILE="${BASE_DIR}/data/cctv_ips.json"
STATE_FILE="${BASE_DIR}/data/traffic_cron_state"
PARALLEL=15
LOG_PREFIX="[traffic_cron_sync]"

mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true

if [ ! -f "$ALERT_CONFIG" ] || [ ! -f "$IPS_FILE" ]; then
    echo "$(date '+%F %T') ${LOG_PREFIX} missing config files"
    exit 1
fi

# Python 결과를 임시 파일로 받아 안전하게 source
_CFG_ENV=$(mktemp)
python3 - "$ALERT_CONFIG" "$_CFG_ENV" <<'PY'
import json, sys
from datetime import datetime

cfg_path, out_path = sys.argv[1], sys.argv[2]
cfg = json.load(open(cfg_path))
enabled = bool(cfg.get("traffic_enabled"))
start = str(cfg.get("traffic_start") or "").strip().replace("T", " ")
end = str(cfg.get("traffic_end") or "").strip().replace("T", " ")
password = str(cfg.get("root_password") or "")

active = False
if enabled and start and end:
    try:
        def parse(s):
            for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
                try:
                    return datetime.strptime(s, fmt)
                except ValueError:
                    pass
            raise ValueError(s)
        now = datetime.now()
        active = parse(start) <= now < parse(end)
    except Exception:
        active = False

def sh_export(name, value):
    # POSIX single-quote escape
    return "%s='%s'\n" % (name, value.replace("'", "'\"'\"'"))

with open(out_path, "w") as f:
    f.write(sh_export("TRAFFIC_ACTIVE", "1" if active else "0"))
    f.write(sh_export("ROOT_PASSWORD", password))
PY
# shellcheck disable=SC1090
source "$_CFG_ENV"
rm -f "$_CFG_ENV"

if [ -z "${ROOT_PASSWORD:-}" ]; then
    echo "$(date '+%F %T') ${LOG_PREFIX} root password empty - skip"
    exit 0
fi

PREV_STATE=""
if [ -f "$STATE_FILE" ]; then
    PREV_STATE="$(cat "$STATE_FILE" 2>/dev/null || true)"
fi
FORCE="${FORCE:-0}"
RESET="${RESET:-0}"

# 활성 전환(0->1) 시 DB 초기화. RESET=1 이면 강제 초기화.
DO_RESET=0
if [ "$RESET" = "1" ]; then
    DO_RESET=1
elif [ "$TRAFFIC_ACTIVE" = "1" ] && [ "$PREV_STATE" != "1" ]; then
    DO_RESET=1
fi

if [ "$RESET" != "1" ] && [ "$FORCE" != "1" ] && [ "$PREV_STATE" = "$TRAFFIC_ACTIVE" ]; then
    echo "$(date '+%F %T') ${LOG_PREFIX} state unchanged (active=${TRAFFIC_ACTIVE}) - skip"
    exit 0
fi

MODE="disable"
if [ "$TRAFFIC_ACTIVE" = "1" ]; then
    MODE="enable"
fi
echo "$(date '+%F %T') ${LOG_PREFIX} sync start mode=${MODE} force=${FORCE} reset=${DO_RESET} prev=${PREV_STATE}"

sync_one() {
    local cam_id="$1"
    local ip="$2"
    local mode="$3"
    local pw="$4"
    local do_reset="$5"

    local out rc
    out=$(sshpass -p "$pw" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
        "root@${ip}" "MODE=${mode} DO_RESET=${do_reset} bash -s" <<'REMOTE' 2>&1
set -e
TMP=$(mktemp)
crontab -l 2>/dev/null > "$TMP" || true
python3 - "$TMP" "$MODE" <<'PY'
import re, sys
path, mode = sys.argv[1], sys.argv[2]
enable = mode == "enable"
try:
    lines = open(path).read().splitlines()
except Exception:
    lines = []

patterns = [
    r"vnstat\s+-u\s+-i\s+eth0",
    r"vnstati\s+-d\s+-i\s+eth0.*traffic/summary\.png",
]
defaults = [
    "*/5 * * * * /usr/bin/vnstat -u -i eth0",
    "*/5 * * * * /usr/bin/vnstati -d -i eth0 -o /usr/local/nginx/html/traffic/summary.png",
]

def strip_comment(line):
    s = line.lstrip()
    if s.startswith("#"):
        return s[1:].lstrip()
    return line

found = [False, False]
out = []
for line in lines:
    body = strip_comment(line)
    matched = False
    for i, pat in enumerate(patterns):
        if re.search(pat, body):
            found[i] = True
            matched = True
            out.append(body if enable else ("#" + body))
            break
    if not matched:
        out.append(line)

if enable:
    for i, ok in enumerate(found):
        if not ok:
            out.append(defaults[i])

open(path, "w").write("\n".join(out) + ("\n" if out else ""))
PY
crontab "$TMP"
rm -f "$TMP"

if [ "${DO_RESET}" = "1" ]; then
    mkdir -p /usr/local/nginx/html/traffic
    systemctl stop vnstat 2>/dev/null || true
    systemctl stop vnstatd 2>/dev/null || true
    pkill -9 vnstatd 2>/dev/null || true
    sleep 1
    rm -f /var/lib/vnstat/vnstat.db /var/lib/vnstat/*.db 2>/dev/null || true
    rm -f /usr/local/nginx/html/traffic/summary.png 2>/dev/null || true
    vnstat --add -i eth0 >/dev/null 2>&1 || true
    systemctl start vnstat 2>/dev/null || /usr/sbin/vnstatd --daemon || true
    # 기간 시작 직후에는 그래프가 비어 있을 수 있음 (데이터 부족)
    /usr/bin/vnstati -d -i eth0 -o /usr/local/nginx/html/traffic/summary.png >/dev/null 2>&1 || true
fi
REMOTE
)
    rc=$?
    if [ $rc -eq 0 ]; then
        echo "OK ${cam_id} ${ip}"
        return 0
    fi
    echo "FAIL ${cam_id} ${ip} rc=${rc} ${out}"
    return 1
}

export -f sync_one

HOST_LIST=$(python3 - "$IPS_FILE" <<'PY'
import json, sys
ips = json.load(open(sys.argv[1]))
for cam_id, ip in sorted(ips.items()):
    ip = (ip or "").strip()
    if ip:
        print("%s %s" % (cam_id, ip))
PY
)

RESULT_DIR=$(mktemp -d)
SUCCESS=0
FAIL=0

while IFS= read -r line; do
    [ -z "$line" ] && continue
    cam_id="${line%% *}"
    ip="${line#* }"
    (
        if sync_one "$cam_id" "$ip" "$MODE" "$ROOT_PASSWORD" "$DO_RESET"; then
            echo OK > "${RESULT_DIR}/${cam_id}"
        else
            echo FAIL > "${RESULT_DIR}/${cam_id}"
        fi
    ) &
    while [ "$(jobs -rp | wc -l)" -ge "$PARALLEL" ]; do
        sleep 0.2
    done
done <<< "$HOST_LIST"
wait

for f in "$RESULT_DIR"/*; do
    [ -f "$f" ] || continue
    if grep -q OK "$f"; then
        SUCCESS=$((SUCCESS + 1))
    else
        FAIL=$((FAIL + 1))
    fi
done
rm -rf "$RESULT_DIR"

echo "$(date '+%F %T') ${LOG_PREFIX} done mode=${MODE} success=${SUCCESS} fail=${FAIL} reset=${DO_RESET}"
echo "$TRAFFIC_ACTIVE" > "$STATE_FILE"
exit 0
