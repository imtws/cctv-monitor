#!/bin/bash

CHECK_NRPE="/usr/lib64/nagios/plugins/check_nrpe"
NRPE_TIMEOUT=10
PARALLEL=20

STATE_FILE="/var/lib/nagios/cctv_digest_prev_problems.txt"
LOG_FILE="/var/log/cctv_digest.log"

EXCEPT_HOSTS=()
declare -A EXCEPT_REASON_BY_HOST=()
RESTART_THRESHOLD=5

# ---- 0) 웹 모니터링 개별 알림 스케줄 & 중지 상태 스캔 ----
ALERT_CONFIG="/home/www/cammon/data/alert_config.json"
CCTV_CONFIG="/home/www/cammon/data/cctv_config.json"
MAIL_TO=""
GLOBAL_ENABLED="True"
IN_SCHEDULE="true"
ALERT_MAIL_ENABLED="true"

if [ -f "$ALERT_CONFIG" ]; then
    GLOBAL_ENABLED=$(python3 -c "import json; d=json.load(open('$ALERT_CONFIG')); print(d.get('enabled', True))" 2>/dev/null)
    RECIPIENT=$(python3 -c "import json; d=json.load(open('$ALERT_CONFIG')); print((d.get('recipient') or '').strip())" 2>/dev/null)
    if [ -n "$RECIPIENT" ]; then
        MAIL_TO="$RECIPIENT"
    fi

    # 알람 스케줄: 모니터링/상태 갱신은 24h 수행, 메일만 이 시간대에 발송
    IN_SCHEDULE=$(ALERT_CONFIG="$ALERT_CONFIG" python3 - <<'PYIN_SCHEDULE'
import json, datetime, sys, os

cfg_path = os.environ.get('ALERT_CONFIG', '/home/www/cammon/data/alert_config.json')
try:
    cfg = json.load(open(cfg_path))
except Exception:
    print("true")
    sys.exit(0)

start_time_str = str(cfg.get('start_time') or '').strip()
end_time_str   = str(cfg.get('end_time')   or '').strip()
work_days      = cfg.get('work_days', None)

# start_time/end_time 또는 work_days 가 설정되지 않으면 항상 허용
if not start_time_str and not end_time_str and work_days is None:
    print("true")
    sys.exit(0)

now = datetime.datetime.now()
current_weekday = now.weekday()  # 0=월, 6=일
# Python weekday: 0=월~6=일 → JSON work_days: 0=일,1=월~6=토 (JS 기준)
js_weekday = (current_weekday + 1) % 7  # JS 기준으로 변환

# 요일 체크
if work_days is not None:
    work_days_int = [int(d) for d in work_days]
    if js_weekday not in work_days_int:
        print("false")
        sys.exit(0)

# 시간 범위 체크
if start_time_str and end_time_str:
    try:
        s_h, s_m = [int(x) for x in start_time_str.split(':')]
        e_h, e_m = [int(x) for x in end_time_str.split(':')]
        start_minutes = s_h * 60 + s_m
        end_minutes   = e_h * 60 + e_m
        now_minutes   = now.hour * 60 + now.minute
        if now_minutes < start_minutes or now_minutes >= end_minutes:
            print("false")
            sys.exit(0)
    except Exception:
        pass

print("true")
PYIN_SCHEDULE
    )
fi

if [ "$GLOBAL_ENABLED" = "False" ] || [ "$IN_SCHEDULE" = "false" ]; then
    ALERT_MAIL_ENABLED="false"
fi

if [ -f "$CCTV_CONFIG" ]; then
    EXCEPT_LIST=$(CCTV_CONFIG="$CCTV_CONFIG" ALERT_CONFIG="$ALERT_CONFIG" python3 - <<'PYIN'
import datetime
import json
import os
import re

now      = datetime.datetime.now()
now_iso  = now.strftime("%Y-%m-%dT%H:%M")

cams  = json.load(open(os.environ["CCTV_CONFIG"]))
alert = json.load(open(os.environ["ALERT_CONFIG"])) if os.path.exists(os.environ["ALERT_CONFIG"]) else {}

g_suppress_until = str(alert.get("suppress_until") or "").strip()

rows = []

# Nagios cfg 파일에서 실제 host_name 자동 매핑 (c*@example.com 계정 전체 스캔)
nagios_dir = "/etc/nagios/objects/Monitor"
num_to_hostnames = {}  # cam_num(int) → list of host_names [str, ...]
if os.path.isdir(nagios_dir):
    for account_dir in os.listdir(nagios_dir):
        account_path = os.path.join(nagios_dir, account_dir)
        if not os.path.isdir(account_path):
            continue
        for cfg_file in os.listdir(account_path):
            if not cfg_file.endswith(".cfg"):
                continue
            m = re.search(r'-cam-(\d+)\.cfg$', cfg_file)
            if not m:
                continue
            num = int(m.group(1))
            host_name = cfg_file[:-4]  # 확장자 제거
            if num not in num_to_hostnames:
                num_to_hostnames[num] = []
            num_to_hostnames[num].append(host_name)

def resolve_hosts(c):
    """cam 번호 기준으로 Nagios 실제 host_names 리스트 반환. 없으면 host_name 필드(수동) fallback."""
    cam_num = c.get("num")
    if str(cam_num).isdigit():
        found = num_to_hostnames.get(int(cam_num))
        if found:
            return found
    # fallback: cctv_config의 host_name 필드 (수동 지정)
    override = str(c.get("host_name") or "").strip()
    return [override] if override else []

# 글로벌 suppress_until 확인
if g_suppress_until and g_suppress_until >= now_iso:
    for c in cams:
        cam_id = str(c.get("id") or "").strip()
        hosts  = resolve_hosts(c)
        for host_name in hosts:
            rows.append((host_name, cam_id, f"글로벌 스케줄({g_suppress_until}까지)"))
else:
    for c in cams:
        cam_id     = str(c.get("id") or "").strip()
        hosts      = resolve_hosts(c)
        status     = str(c.get("status", "ACTIVE") or "ACTIVE").strip()
        c_suppress = str(c.get("suppress_until") or "").strip()

        reason = None
        if status == "STOPPED":
            reason = "작동 중지"
        elif status == "INSPECTION":
            reason = "점검"
        elif c_suppress and c_suppress >= now_iso:
            reason = f"스케줄({c_suppress}까지)"

        if reason:
            for host_name in hosts:
                rows.append((host_name, cam_id, reason))

# cctv_config.json(엑셀)에 없는 Nagios 호스트 → 모니터링·알람 대상 제외
registered_nums = {
    int(c["num"]) for c in cams
    if str(c.get("num", "")).isdigit()
}
excepted_hosts = {row[0] for row in rows}
for num, hostnames in num_to_hostnames.items():
    if num in registered_nums:
        continue
    cam_id = f"cam{num:02d}"
    for host_name in hostnames:
        if host_name in excepted_hosts:
            continue
        rows.append((host_name, cam_id, "미등록(엑셀 외)"))
        excepted_hosts.add(host_name)

for host_name, cam_id, reason in rows:
    print(f"{host_name}\t{cam_id}\t{reason}")
PYIN
    )

    while IFS=$'	' read -r host_name cam_id reason; do
        [ -z "$host_name" ] && continue
        if [ -z "${EXCEPT_REASON_BY_HOST[$host_name]+x}" ]; then
            EXCEPT_HOSTS+=("$host_name")
        fi
        EXCEPT_REASON_BY_HOST["$host_name"]="$cam_id|$reason"
    done <<< "$EXCEPT_LIST"
fi

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"
}

is_excepted() {
    local hn="$1"
    local e

    for e in "${EXCEPT_HOSTS[@]}"; do
        [ "$hn" = "$e" ] && return 0
    done

    return 1
}

mkdir -p "$(dirname "$STATE_FILE")"
touch "$LOG_FILE" "$STATE_FILE"

WORKDIR=$(mktemp -d /tmp/cctv_digest.XXXXXX)
RESULTS_FILE="${WORKDIR}/results.tsv"

trap 'rm -rf "$WORKDIR"' EXIT

# ---- 1) 캠 호스트 목록 (cctv_config.json = 엑셀 업로드 기준, 여기 있는 번호만 NRPE 조회) ----

REGISTERED_CAM_NUMS=""
if [ -f "$CCTV_CONFIG" ]; then
    REGISTERED_CAM_NUMS=$(python3 -c "
import json
try:
    cams = json.load(open('$CCTV_CONFIG'))
except Exception:
    cams = []
print(' '.join(str(int(c['num'])) for c in cams if str(c.get('num', '')).isdigit()))
" 2>/dev/null)
fi

: > "${WORKDIR}/hostlist.txt"

for cfg in /etc/nagios/objects/Monitor/c*@example.com/*.cfg; do
    [ -e "$cfg" ] || continue

    hn=$(awk '/^[[:space:]]*host_name/{print $2; exit}' "$cfg")
    addr=$(awk '/^[[:space:]]*address/{print $2; exit}' "$cfg")

    [ -z "$hn" ] && continue
    [ -z "$addr" ] && continue

    # cam 호스트만 (패턴: *-cam-*)
    [[ "$hn" != *-cam-* ]] && continue

    # 엑셀(cctv_config)에 등록된 번호만 모니터링 — 미등록(해지) 호스트는 NRPE 생략
    if [ -f "$CCTV_CONFIG" ]; then
        if [[ "$hn" =~ -cam-([0-9]+)$ ]]; then
            cam_num_int=$((10#${BASH_REMATCH[1]}))
            if [ -z "$REGISTERED_CAM_NUMS" ]; then
                continue
            fi
            if ! echo " $REGISTERED_CAM_NUMS " | grep -q " ${cam_num_int} "; then
                continue
            fi
        else
            continue
        fi
    fi

    printf '%s\t%s\n' "$hn" "$addr" >> "${WORKDIR}/hostlist.txt"
done

if [ ! -s "${WORKDIR}/hostlist.txt" ]; then
    if [ -f "$CCTV_CONFIG" ]; then
        log "no registered camera hosts to check (cctv_config has no matching Nagios hosts)"
        : > "$STATE_FILE"
        exit 0
    fi
    log "ERROR: no camera hosts found"
    exit 1
fi

# ---- 2) 개별 NRPE 조회 ----

check_one() {
    local hn="$1"
    local addr="$2"
    local out
    local rc

    out=$("$CHECK_NRPE" \
        -H "$addr" \
        -c check_cctv_status \
        -t "$NRPE_TIMEOUT" \
        2>&1)

    rc=$?

    printf '%s\t%s\t%s\n' \
        "$hn" \
        "$rc" \
        "$out" >> "$RESULTS_FILE"
}

export -f check_one
export CHECK_NRPE NRPE_TIMEOUT RESULTS_FILE

# ---- 3) 병렬 조회 ----

xargs -a "${WORKDIR}/hostlist.txt" \
    -d '\n' \
    -P "$PARALLEL" \
    -L 1 \
    bash -c 'IFS=$'\''\t'\'' read -r hn addr <<< "$1"; check_one "$hn" "$addr"' _

# ---- 4) 상태 분류 ----

PROBLEM_ROWS=()
CURRENT_PROBLEM_HOSTS=()

while IFS=$'\t' read -r hn rc out; do
    [ -z "$hn" ] && continue

    if is_excepted "$hn"; then
        continue
    fi

    # CRITICAL / UNKNOWN 모두 장애 상태로 저장
    if [ "$rc" = "2" ] || [ "$rc" = "3" ]; then
        CURRENT_PROBLEM_HOSTS+=("$hn")

        # CRITICAL만 장애 메일 대상
        if [ "$rc" = "2" ]; then
            PROBLEM_ROWS+=(
                "${hn}"$'\t'"${rc}"$'\t'"${out}"
            )
        fi
    fi

done < "$RESULTS_FILE"

# ---- 4.4) HLS 0초 멈춤 감지 (NRPE OK인데 EXTINF≈0 / TARGETDURATION=0) ----
# Nagios는 세그먼트 파일 age만 보므로, 플레이리스트 duration 이상을 별도 검사한다.
HLS_STALL_FILE="${WORKDIR}/hls_stall.tsv"
: > "$HLS_STALL_FILE"

EXCEPT_HOSTS_STR=$(printf '%s\n' "${EXCEPT_HOSTS[@]}")
CURRENT_PROBLEM_STR=$(printf '%s\n' "${CURRENT_PROBLEM_HOSTS[@]}")

RESULTS_FILE="$RESULTS_FILE" \
HLS_STALL_FILE="$HLS_STALL_FILE" \
EXCEPT_HOSTS_STR="$EXCEPT_HOSTS_STR" \
CURRENT_PROBLEM_STR="$CURRENT_PROBLEM_STR" \
python3 - <<'PYIN_HLS'
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

results_path = os.environ.get("RESULTS_FILE")
out_path = os.environ.get("HLS_STALL_FILE")
excepted = set(x.strip() for x in (os.environ.get("EXCEPT_HOSTS_STR") or "").splitlines() if x.strip())
already = set(x.strip() for x in (os.environ.get("CURRENT_PROBLEM_STR") or "").splitlines() if x.strip())

candidates = []
if results_path and os.path.exists(results_path):
    with open(results_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            hn, rc = parts[0], parts[1]
            if hn in excepted or hn in already:
                continue
            # NRPE OK(0) / WARNING(1) 만 대상 — CRITICAL/UNKNOWN 은 이미 장애
            if rc not in ("0", "1"):
                continue
            m = re.search(r"-cam-(\d+)$", hn)
            if not m:
                continue
            cam_id = f"cam{int(m.group(1)):02d}"
            candidates.append((hn, cam_id))

def probe(item):
    hn, cam_id = item
    url = f"http://{cam_id}.example.com:8080/hls/webcam.m3u8"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cctv-digest-hls-probe/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read().decode("utf-8", "ignore")
    except Exception as e:
        # 접속 실패는 NRPE CRITICAL 쪽에서 다루는 경우가 많아 여기선 skip
        return None

    td_m = re.search(r"#EXT-X-TARGETDURATION:([\d.]+)", body)
    ext = [float(x) for x in re.findall(r"#EXTINF:([\d.]+)", body)]
    if not td_m and not ext:
        return None

    td_v = float(td_m.group(1)) if td_m else None
    avg = (sum(ext) / len(ext)) if ext else None
    stall = (td_v is not None and td_v < 1.0) or (avg is not None and avg < 0.5)
    if not stall:
        return None

    td_s = f"{td_v:.6f}".rstrip("0").rstrip(".") if td_v is not None else "n/a"
    avg_s = f"{avg:.6f}".rstrip("0").rstrip(".") if avg is not None else "n/a"
    msg = (
        f"CRITICAL - HLS stall (video stuck at 0s): "
        f"TARGETDURATION={td_s}, EXTINF_avg={avg_s} | cam={cam_id}"
    )
    return f"{hn}\t2\t{msg}\thls_stall"

rows = []
if candidates:
    with ThreadPoolExecutor(max_workers=20) as pool:
        futs = [pool.submit(probe, c) for c in candidates]
        for fut in as_completed(futs):
            row = fut.result()
            if row:
                rows.append(row)

rows.sort()
with open(out_path, "w", encoding="utf-8") as f:
    for row in rows:
        f.write(row + "\n")
PYIN_HLS

if [ -s "$HLS_STALL_FILE" ]; then
    while IFS=$'\t' read -r hn rc out kind; do
        [ -z "$hn" ] && continue
        CURRENT_PROBLEM_HOSTS+=("$hn")
        PROBLEM_ROWS+=(
            "${hn}"$'\t'"${rc}"$'\t'"${out}"$'\t'"${kind:-hls_stall}"
        )
        log "hls_stall detected: $hn — $out"
    done < "$HLS_STALL_FILE"
fi

PROBLEM_COUNT=${#PROBLEM_ROWS[@]}

# ---- 4.5) 웹 모니터링 연동용 실시간 상태 JSON 저장 ----
if [ -f "$RESULTS_FILE" ]; then
    RESULTS_FILE="$RESULTS_FILE" \
    HLS_STALL_FILE="$HLS_STALL_FILE" \
    python3 - <<'PYIN'
import json
import os
import re
import time

results_path = os.environ.get("RESULTS_FILE")
hls_path = os.environ.get("HLS_STALL_FILE")
out_json = "/home/www/cammon/data/live_status.json"

hls_by_host = {}
if hls_path and os.path.exists(hls_path):
    with open(hls_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 3:
                hls_by_host[parts[0]] = parts[2]

status_map = {}
now_ts = int(time.time())
if results_path and os.path.exists(results_path):
    with open(results_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) >= 3:
                hn, rc, out = parts[0], parts[1], parts[2]

                file_age = None
                age_match = re.search(r'(?:file_age|age)=(\d+)', out)
                if age_match:
                    file_age = int(age_match.group(1))

                entry = {
                    "rc": int(rc),
                    "output": out,
                    "file_age": file_age,
                    "checked_at": now_ts,
                    "hls_stall": False,
                }
                if hn in hls_by_host:
                    entry["hls_stall"] = True
                    entry["output"] = hls_by_host[hn]
                status_map[hn] = entry

# 원자적 쓰기
if status_map:
    tmp_path = out_json + ".tmp"
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(status_map, f, indent=2, ensure_ascii=False)
        os.rename(tmp_path, out_json)
        os.chmod(out_json, 0o666)
    except Exception:
        pass
PYIN
fi

# ---- 4.6) 캠서버 self-heal(자동 재기동) → cammon 작업이력 ----
SELF_HEAL_STATE="/var/lib/nagios/cctv_digest_prev_self_heal.json"
SELF_HEAL_COUNT_FILE="${WORKDIR}/self_heal_count.txt"
: > "$SELF_HEAL_COUNT_FILE"

RESULTS_FILE="$RESULTS_FILE" \
HOSTLIST_FILE="${WORKDIR}/hostlist.txt" \
SELF_HEAL_STATE="$SELF_HEAL_STATE" \
SELF_HEAL_COUNT_FILE="$SELF_HEAL_COUNT_FILE" \
HISTORY_FILE="/home/www/cammon/data/action_history.json" \
python3 - <<'PYIN_HEAL'
import json
import os
import re
import uuid
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))

results_path = os.environ.get("RESULTS_FILE")
hostlist_path = os.environ.get("HOSTLIST_FILE")
state_path = os.environ.get("SELF_HEAL_STATE")
history_path = os.environ.get("HISTORY_FILE")
count_path = os.environ.get("SELF_HEAL_COUNT_FILE")

ip_by_host = {}
if hostlist_path and os.path.exists(hostlist_path):
    with open(hostlist_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 2:
                ip_by_host[parts[0]] = parts[1]

prev = {}
if state_path and os.path.exists(state_path):
    try:
        prev = json.load(open(state_path, encoding="utf-8"))
        if not isinstance(prev, dict):
            prev = {}
    except Exception:
        prev = {}

reason_label = {
    "hls_stall": "HLS 0초 멈춤 자동조치",
    "mtime_stale": "세그먼트 미갱신 자동조치",
}

new_events = []
curr_state = dict(prev)

if results_path and os.path.exists(results_path):
    with open(results_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            hn, _rc, out = parts[0], parts[1], parts[2]
            m_at = re.search(r"self_heal_at=(\d+)", out)
            m_rs = re.search(r"self_heal_reason=([^\s;|]+)", out)
            if not m_at:
                continue
            heal_at = int(m_at.group(1))
            if heal_at <= 0:
                continue
            reason = (m_rs.group(1) if m_rs else "").strip() or "unknown"
            # state 값이 dict(구 쿨다운 포맷)여도 heal_at만 사용
            prev_raw = prev.get(hn, 0)
            if isinstance(prev_raw, dict):
                try:
                    prev_at = int(prev_raw.get("heal_at") or 0)
                except Exception:
                    prev_at = 0
            else:
                try:
                    prev_at = int(prev_raw or 0)
                except Exception:
                    prev_at = 0
            if heal_at <= prev_at:
                curr_state[hn] = prev_at
                continue

            m_cam = re.search(r"-cam-(\d+)$", hn)
            if not m_cam:
                curr_state[hn] = heal_at
                continue
            cam_id = f"cam{int(m_cam.group(1)):02d}"
            ip = ip_by_host.get(hn, "")
            label = reason_label.get(reason, f"자동조치({reason})")
            created = datetime.fromtimestamp(heal_at, tz=KST).strftime("%Y-%m-%d %H:%M:%S")
            new_events.append({
                "id": "h" + uuid.uuid4().hex[:16],
                "type": "cctv_relay_restart",
                "title": f"캠 서버 {cam_id} ({ip}) cctv-relay 자동 재기동 ({label})",
                "status": "success",
                "detail": {
                    "cam_id": cam_id,
                    "ip": ip,
                    "service_status": "active",
                    "output": label,
                    "auto": True,
                    "trigger": reason,
                    "host_name": hn,
                    "self_heal_at": heal_at,
                },
                "created_at": created,
            })
            curr_state[hn] = heal_at

# dict 잔여 정리 (int만 유지)
for hn, v in list(curr_state.items()):
    if isinstance(v, dict):
        try:
            curr_state[hn] = int(v.get("heal_at") or 0)
        except Exception:
            curr_state[hn] = 0

if new_events and history_path:
    history = []
    if os.path.exists(history_path):
        try:
            history = json.load(open(history_path, encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []
    new_events.sort(key=lambda e: e.get("detail", {}).get("self_heal_at") or 0)
    history = list(reversed(new_events)) + history
    if len(history) > 500:
        history = history[:500]
    tmp = history_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=4, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, history_path)
    try:
        os.chmod(history_path, 0o666)
    except Exception:
        pass

if state_path:
    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    tmp = state_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(curr_state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, state_path)

if count_path:
    with open(count_path, "w", encoding="utf-8") as f:
        f.write(str(len(new_events)))
PYIN_HEAL

HEAL_COUNT=0
if [ -f "$SELF_HEAL_COUNT_FILE" ]; then
    HEAL_COUNT=$(cat "$SELF_HEAL_COUNT_FILE" 2>/dev/null || echo 0)
fi
if [ "${HEAL_COUNT:-0}" -gt 0 ] 2>/dev/null; then
    log "self-heal history logged: ${HEAL_COUNT} event(s)"
fi

# ---- 5) 이전 장애 상태 읽기 ----

PREV_PROBLEM_HOSTS=()

if [ -s "$STATE_FILE" ]; then
    while IFS= read -r line; do
        [ -n "$line" ] && PREV_PROBLEM_HOSTS+=("$line")
    done < "$STATE_FILE"
fi

# ---- 6) Recovery 계산 ----
# 주의: EXCEPT_HOSTS(STOPPED/INSPECTION/스케줄 등)로 이동한 호스트는
#       "복구"가 아니라 "예외 전환"이므로 Recovery 메일 대상에서 제외

RECOVERED_HOSTS=()

if [ ${#PREV_PROBLEM_HOSTS[@]} -gt 0 ]; then
    for prev_hn in "${PREV_PROBLEM_HOSTS[@]}"; do
        [ -z "$prev_hn" ] && continue

        # 예외 처리된 호스트는 Recovery 아님 (상태 변경으로 예외 전환)
        if is_excepted "$prev_hn"; then
            log "skipped recovery for excepted host: $prev_hn (${EXCEPT_REASON_BY_HOST[$prev_hn]:-unknown})"
            continue
        fi

        found=0

        if [ ${#CURRENT_PROBLEM_HOSTS[@]} -gt 0 ]; then
            for cur_hn in "${CURRENT_PROBLEM_HOSTS[@]}"; do
                if [ "$prev_hn" = "$cur_hn" ]; then
                    found=1
                    break
                fi
            done
        fi

        if [ "$found" -eq 0 ]; then
            RECOVERED_HOSTS+=("$prev_hn")
        fi
    done
fi

RECOVERED_COUNT=${#RECOVERED_HOSTS[@]}

# ---- 7) 현재 장애 상태 저장 ----

STATE_TMP="${STATE_FILE}.tmp.$$"

: > "$STATE_TMP"

if [ ${#CURRENT_PROBLEM_HOSTS[@]} -gt 0 ]; then
    for hn in "${CURRENT_PROBLEM_HOSTS[@]}"; do
        [ -n "$hn" ] && printf '%s\n' "$hn" >> "$STATE_TMP"
    done
fi

mv -f "$STATE_TMP" "$STATE_FILE"

# ---- 8) 로그 ----

log "check completed: critical=$PROBLEM_COUNT current_problem=${#CURRENT_PROBLEM_HOSTS[@]} recovered=$RECOVERED_COUNT excepted=${#EXCEPT_HOSTS[@]} mail_enabled=$ALERT_MAIL_ENABLED"

# ---- 9) 메일 설정 ----

MAIL_TO="${MAIL_TO:-}"
MAIL_FROM="cctv-monitor@localhost"
MONITOR_URL="http://cammon.example.com:1080/"
GENERATED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

# 공통 HTML 스타일 (cammon 다크 테마)
MAIL_STYLE="
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  body{
    margin:0;padding:0;
    background:#0f172a;
    font-family:'Helvetica Neue',Arial,sans-serif;
    color:#f8fafc;
  }
  .wrapper{
    background:#0f172a;
    padding:32px 16px;
  }
  .card{
    background:#1e293b;
    border:1px solid rgba(255,255,255,0.08);
    border-radius:12px;
    max-width:920px;
    margin:0 auto;
    overflow:hidden;
  }
  .action-cell{
    font-size:12px;
    color:#fbbf24;
    line-height:1.45;
    max-width:320px;
  }
  .card-header{
    padding:24px 28px 20px;
    border-bottom:1px solid rgba(255,255,255,0.08);
  }
  .badge{
    display:inline-block;
    font-size:11px;
    font-weight:700;
    letter-spacing:.08em;
    padding:3px 10px;
    border-radius:999px;
    margin-bottom:10px;
  }
  .badge-critical{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);}
  .badge-recovery{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3);}
  .card-title{
    font-size:20px;
    font-weight:700;
    color:#f8fafc;
    margin:0 0 4px;
    letter-spacing:-.02em;
  }
  .card-meta{
    font-size:12px;
    color:#64748b;
  }
  .card-body{padding:24px 28px;}
  .section-label{
    font-size:11px;
    font-weight:700;
    letter-spacing:.1em;
    color:#64748b;
    text-transform:uppercase;
    margin-bottom:10px;
  }
  table.data{
    width:100%;
    border-collapse:collapse;
    font-size:13px;
    margin-bottom:20px;
  }
  table.data th{
    background:#0f172a;
    color:#94a3b8;
    font-weight:600;
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.06em;
    padding:8px 12px;
    text-align:left;
    border-bottom:1px solid rgba(255,255,255,0.08);
  }
  table.data td{
    padding:10px 12px;
    border-bottom:1px solid rgba(255,255,255,0.05);
    color:#cbd5e1;
    vertical-align:middle;
  }
  table.data tr:last-child td{border-bottom:none;}
  .chip{
    display:inline-block;
    padding:2px 8px;
    border-radius:999px;
    font-size:11px;
    font-weight:700;
  }
  .chip-critical{background:rgba(239,68,68,.15);color:#ef4444;}
  .chip-recovery{background:rgba(16,185,129,.15);color:#10b981;}
  .chip-except{background:rgba(100,116,139,.15);color:#94a3b8;}
  .cam-id{font-family:monospace;font-size:12px;color:#3b82f6;}
  .divider{border:none;border-top:1px solid rgba(255,255,255,0.07);margin:4px 0 20px;}
  .footer{
    padding:20px 28px 24px;
    border-top:1px solid rgba(255,255,255,0.08);
    text-align:center;
  }
  .btn-link{
    display:inline-block;
    background:#3b82f6;
    color:#fff !important;
    text-decoration:none;
    padding:10px 24px;
    border-radius:8px;
    font-size:13px;
    font-weight:600;
    letter-spacing:-.01em;
    margin-bottom:12px;
  }
  .footer-meta{
    font-size:11px;
    color:#475569;
  }
</style>"

# 장애 유형별 권장 조치
# kind: hls_stall | (그 외는 out 메시지로 추론)
recommend_action() {
    local out="$1"
    local kind="${2:-}"

    if [ "$kind" = "hls_stall" ] || echo "$out" | grep -qi 'HLS stall'; then
        echo "캠 설정 배포/재기동 → cctv-relay 서비스 재기동 조치 시도 필요 (세그먼트는 갱신되나 EXTINF≈0으로 영상이 0초에 멈춤)"
        return
    fi

    # 캠 통신 불가 / 세그먼트 stale (age 폭주 포함)
    if echo "$out" | grep -qiE 'segment stale|age=999999|Connection refused|No route to host|Connection timed out|Socket timeout|Could not connect|NRPE:'; then
        echo "알람 지속 발생 시 DDNS Origin IP 변경 여부 확인. 캠 설정 배포를 통해 Origin IP 반영 작업 진행."
        return
    fi

    echo "캠 서버 통신 및 cctv-relay 상태 확인. 통신 불가면 Origin IP 확인, 세그먼트 OK·재생 불가면 cctv-relay 재기동."
}

# 예외처리 테이블 HTML 생성 함수 (CRITICAL·RECOVERY 공용)
build_except_table() {
    if [ ${#EXCEPT_HOSTS[@]} -eq 0 ]; then
        echo "<p style='font-size:13px;color:#475569;margin:0;'>현재 예외 처리 대상 없음</p>"
        return
    fi
    local tbl
    tbl="<table class='data'>"
    tbl+="<tr><th>호스트</th><th>캠 ID</th><th>예외 사유</th></tr>"
    for ex_hn in "${EXCEPT_HOSTS[@]}"; do
        local ex_data="${EXCEPT_REASON_BY_HOST[$ex_hn]}"
        local ex_cam="${ex_data%%|*}"
        local ex_rsn="${ex_data#*|}"
        tbl+="<tr>"
        tbl+="<td>${ex_hn}</td>"
        tbl+="<td><span class='cam-id'>${ex_cam}</span></td>"
        tbl+="<td><span class='chip chip-except'>${ex_rsn}</span></td>"
        tbl+="</tr>"
    done
    tbl+="</table>"
    echo "$tbl"
}

# 하단 공통 푸터 HTML
build_footer() {
    echo "
    <div class='footer'>
      <a href='${MONITOR_URL}' class='btn-link'>&#128247; 캠 모니터링 페이지 바로가기</a><br>
      <span class='footer-meta'>CCTV 관제 시스템 &middot; 생성 시각: ${GENERATED_AT}</span>
    </div>"
}

send_html_mail() {
    local subject="$1"
    local body="$2"

    {
        printf 'To: %s\n'              "${MAIL_TO}"
        printf 'From: %s\n'            "${MAIL_FROM}"
        printf 'Subject: %s\n'         "${subject}"
        printf 'MIME-Version: 1.0\n'
        printf 'Content-Type: text/html; charset=UTF-8\n'
        printf 'Content-Transfer-Encoding: 8bit\n'
        printf '\n'
        printf '%s\n' "${body}"
    } | /usr/sbin/sendmail -t
}

# ---- 10) CRITICAL 메일 (스케줄/전역 enabled 일 때만) ----

if [ "$ALERT_MAIL_ENABLED" = "true" ] && [ "$PROBLEM_COUNT" -gt 0 ]; then

    # 장애 테이블 (권장 조치 포함)
    CRIT_TABLE="<table class='data'>"
    CRIT_TABLE+="<tr><th>호스트</th><th>상태</th><th>상세 메시지</th><th>권장 조치</th></tr>"
    for row in "${PROBLEM_ROWS[@]}"; do
        IFS=$'\t' read -r hn rc out kind <<< "$row"
        action="$(recommend_action "$out" "$kind")"
        CRIT_TABLE+="<tr>"
        CRIT_TABLE+="<td>${hn}</td>"
        CRIT_TABLE+="<td><span class='chip chip-critical'>CRITICAL</span></td>"
        CRIT_TABLE+="<td style='font-size:12px;color:#94a3b8;'>${out}</td>"
        CRIT_TABLE+="<td class='action-cell'>${action}</td>"
        CRIT_TABLE+="</tr>"
    done
    CRIT_TABLE+="</table>"

    BODY="<html><head>${MAIL_STYLE}</head><body>"
    BODY+="<div class='wrapper'><div class='card'>"

    # 헤더
    BODY+="<div class='card-header'>"
    BODY+="<span class='badge badge-critical'>&#9888; CRITICAL</span>"
    BODY+="<div class='card-title'>CCTV Relay 상태 이상 &mdash; ${PROBLEM_COUNT}대</div>"
    BODY+="<div class='card-meta'>감지 시각: ${GENERATED_AT}</div>"
    BODY+="</div>"

    # 본문
    BODY+="<div class='card-body'>"

    # 장애 목록
    BODY+="<div class='section-label'>&#128308; 이상 감지 카메라</div>"
    BODY+="${CRIT_TABLE}"

    # 예외처리 목록
    BODY+="<hr class='divider'>"
    BODY+="<div class='section-label'>&#128256; 알람 예외 처리 현황 (${#EXCEPT_HOSTS[@]}대)</div>"
    BODY+="$(build_except_table)"

    BODY+="</div>" # card-body

    # 푸터
    BODY+="$(build_footer)"

    BODY+="</div></div></body></html>" # card, wrapper

    send_html_mail \
        "[CCTV] 상태 이상 ${PROBLEM_COUNT}대 감지" \
        "$BODY"

    log "CRITICAL mail sent: $PROBLEM_COUNT hosts"
fi

# ---- 11) RECOVERY 메일 (스케줄/전역 enabled 일 때만) ----

if [ "$ALERT_MAIL_ENABLED" = "true" ] && [ "$RECOVERED_COUNT" -gt 0 ]; then

    # 복구 테이블
    RECV_TABLE="<table class='data'>"
    RECV_TABLE+="<tr><th>호스트</th><th>상태</th></tr>"
    for hn in "${RECOVERED_HOSTS[@]}"; do
        RECV_TABLE+="<tr>"
        RECV_TABLE+="<td>${hn}</td>"
        RECV_TABLE+="<td><span class='chip chip-recovery'>RECOVERED</span></td>"
        RECV_TABLE+="</tr>"
    done
    RECV_TABLE+="</table>"

    BODY="<html><head>${MAIL_STYLE}</head><body>"
    BODY+="<div class='wrapper'><div class='card'>"

    # 헤더
    BODY+="<div class='card-header'>"
    BODY+="<span class='badge badge-recovery'>&#10003; RECOVERED</span>"
    BODY+="<div class='card-title'>CCTV Relay 복구 &mdash; ${RECOVERED_COUNT}대</div>"
    BODY+="<div class='card-meta'>복구 감지 시각: ${GENERATED_AT}</div>"
    BODY+="</div>"

    # 본문
    BODY+="<div class='card-body'>"

    # 복구 목록
    BODY+="<div class='section-label'>&#128994; 복구 완료 카메라</div>"
    BODY+="${RECV_TABLE}"

    # 예외처리 목록
    BODY+="<hr class='divider'>"
    BODY+="<div class='section-label'>&#128256; 알람 예외 처리 현황 (${#EXCEPT_HOSTS[@]}대)</div>"
    BODY+="$(build_except_table)"

    BODY+="</div>" # card-body

    # 푸터
    BODY+="$(build_footer)"

    BODY+="</div></div></body></html>" # card, wrapper

    send_html_mail \
        "[CCTV] 복구 감지 ${RECOVERED_COUNT}대" \
        "$BODY"

    log "RECOVERY mail sent: $RECOVERED_COUNT hosts"
fi

exit 0
