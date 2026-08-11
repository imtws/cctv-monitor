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
MAIL_TO="stw@example.com"

if [ -f "$ALERT_CONFIG" ]; then
    GLOBAL_ENABLED=$(python3 -c "import json; d=json.load(open('$ALERT_CONFIG')); print(d.get('enabled', True))" 2>/dev/null)
    if [ "$GLOBAL_ENABLED" = "False" ]; then
        exit 0
    fi
fi

if [ -f "$CCTV_CONFIG" ]; then
    EXCEPT_LIST=$(CCTV_CONFIG="$CCTV_CONFIG" ALERT_CONFIG="$ALERT_CONFIG" python3 - <<'PYIN'
import datetime
import json
import os

now      = datetime.datetime.now()
now_iso  = now.strftime("%Y-%m-%dT%H:%M")

cams  = json.load(open(os.environ["CCTV_CONFIG"]))
alert = json.load(open(os.environ["ALERT_CONFIG"])) if os.path.exists(os.environ["ALERT_CONFIG"]) else {}

g_suppress_until = str(alert.get("suppress_until") or "").strip()

rows = []

# 글로벌 suppress_until 확인
if g_suppress_until and g_suppress_until >= now_iso:
    # 전체 스케줄: 모든 cam 예외 처리
    for c in cams:
        cam_id   = str(c.get("id") or "").strip()
        cam_num  = c.get("num")
        host_name = f"example-account-cam-{int(cam_num):02d}" if str(cam_num).isdigit() else cam_id
        rows.append((host_name, cam_id, f"글로벌 스케줄({g_suppress_until}까지)"))
else:
    for c in cams:
        cam_id    = str(c.get("id") or "").strip()
        cam_num   = c.get("num")
        host_name = f"example-account-cam-{int(cam_num):02d}" if str(cam_num).isdigit() else cam_id
        status    = str(c.get("status", "ACTIVE") or "ACTIVE").strip()
        c_suppress = str(c.get("suppress_until") or "").strip()

        reason = None
        if status == "STOPPED":
            reason = "작동 중지"
        elif status == "INSPECTION":
            reason = "점검"
        elif c_suppress and c_suppress >= now_iso:
            reason = f"스케줄({c_suppress}까지)"

        if reason:
            rows.append((host_name, cam_id, reason))

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

# ---- 1) 캠 호스트 목록 ----

: > "${WORKDIR}/hostlist.txt"

for cfg in /etc/nagios/objects/Monitor/cam/*.cfg; do
    [ -e "$cfg" ] || continue

    hn=$(awk '/^[[:space:]]*host_name/{print $2; exit}' "$cfg")
    addr=$(awk '/^[[:space:]]*address/{print $2; exit}' "$cfg")

    [ -z "$hn" ] && continue
    [ -z "$addr" ] && continue

    printf '%s\t%s\n' "$hn" "$addr" >> "${WORKDIR}/hostlist.txt"
done

if [ ! -s "${WORKDIR}/hostlist.txt" ]; then
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

PROBLEM_COUNT=${#PROBLEM_ROWS[@]}

# ---- 4.5) 웹 모니터링 연동용 실시간 상태 JSON 저장 ----
if [ -f "$RESULTS_FILE" ]; then
    RESULTS_FILE="$RESULTS_FILE" python3 - <<'PYIN'
import datetime
import json
import os
import re
import time

results_path = os.environ.get("RESULTS_FILE")
out_json = "/home/www/cammon/data/live_status.json"

status_map = {}
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
                age_match = re.search(r'file_age=(\d+)', out)
                if age_match:
                    file_age = int(age_match.group(1))
                
                status_map[hn] = {
                    "rc": int(rc),
                    "output": out,
                    "file_age": file_age,
                    "checked_at": int(time.time())
                }

# 원자적 쓰기
if status_map:
    tmp_path = out_json + ".tmp"
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(status_map, f, indent=2, ensure_ascii=False)
        os.rename(tmp_path, out_json)
        os.chmod(out_json, 0o666)
    except Exception as e:
        pass
PYIN
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

log "check completed: critical=$PROBLEM_COUNT current_problem=${#CURRENT_PROBLEM_HOSTS[@]} recovered=$RECOVERED_COUNT excepted=${#EXCEPT_HOSTS[@]}"

# ---- 9) 메일 설정 ----

MAIL_TO="${MAIL_TO:-stw@example.com}"
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
    max-width:680px;
    margin:0 auto;
    overflow:hidden;
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
        echo "To: ${MAIL_TO}"
        echo "From: ${MAIL_FROM}"
        echo "Subject: ${subject}"
        echo "MIME-Version: 1.0"
        echo "Content-Type: text/html; charset=UTF-8"
        echo
        echo "$body"
    } | /usr/sbin/sendmail -t
}

# ---- 10) CRITICAL 메일 ----

if [ "$PROBLEM_COUNT" -gt 0 ]; then

    # 장애 테이블
    CRIT_TABLE="<table class='data'>"
    CRIT_TABLE+="<tr><th>호스트</th><th>상태</th><th>상세 메시지</th></tr>"
    for row in "${PROBLEM_ROWS[@]}"; do
        IFS=$'\t' read -r hn rc out <<< "$row"
        CRIT_TABLE+="<tr>"
        CRIT_TABLE+="<td>${hn}</td>"
        CRIT_TABLE+="<td><span class='chip chip-critical'>CRITICAL</span></td>"
        CRIT_TABLE+="<td style='font-size:12px;color:#94a3b8;'>${out}</td>"
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

# ---- 11) RECOVERY 메일 ----

if [ "$RECOVERED_COUNT" -gt 0 ]; then

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
