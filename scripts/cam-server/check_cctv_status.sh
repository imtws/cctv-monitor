#!/bin/bash
#
# check_cctv_status.sh
# NRPE 플러그인 - 캠서버 로컬에서 실행 (check_ffmpeg.sh가 쓴 상태파일을 읽기만 함)
#
# 이중 체크:
#   1) 상태파일 내용(STATUS)을 그대로 신뢰해서 리턴
#   2) 상태파일 자체가 STALE_SEC 이상 안 갱신됐으면 -> 로컬 self-heal(cron)이 죽었다고 보고
#      내용과 무관하게 CRITICAL 처리 (이게 없으면 cron 죽었을 때 마지막 OK가 영원히 유지됨)
#
# 종료코드: 0=OK 1=WARNING 2=CRITICAL 3=UNKNOWN (Nagios/NRPE 표준)

CAM_NAME=$(hostname)
STATUS_FILE="/home/vlc/status/${CAM_NAME}_cctv-relay_status"

# check_ffmpeg.sh cron 주기의 3배 이상으로 잡을 것 (cron이 1분 주기면 180초 권장)
STALE_SEC=180

STATE_OK=0
STATE_WARNING=1
STATE_CRITICAL=2
STATE_UNKNOWN=3

if [ ! -f "$STATUS_FILE" ]; then
    echo "UNKNOWN - status file not found (${STATUS_FILE}); local check may never have run"
    exit $STATE_UNKNOWN
fi

STATUS=$(grep '^STATUS=' "$STATUS_FILE" | cut -d= -f2)
AGE=$(grep '^AGE=' "$STATUS_FILE" | cut -d= -f2)
RESTARTS=$(grep '^RESTARTS=' "$STATUS_FILE" | cut -d= -f2)
UPDATED=$(grep '^UPDATED=' "$STATUS_FILE" | cut -d= -f2)
SELF_HEAL_AT=$(grep '^SELF_HEAL_AT=' "$STATUS_FILE" | cut -d= -f2)
SELF_HEAL_REASON=$(grep '^SELF_HEAL_REASON=' "$STATUS_FILE" | cut -d= -f2-)
SELF_HEAL_AT=${SELF_HEAL_AT:-0}
SELF_HEAL_REASON=${SELF_HEAL_REASON:-}

if [ -z "$STATUS" ] || [ -z "$UPDATED" ]; then
    echo "UNKNOWN - status file malformed (${STATUS_FILE})"
    exit $STATE_UNKNOWN
fi

NOW=$(date +%s)
FILE_AGE=$(( NOW - UPDATED ))

PERF="age=${AGE:-0};;;; restarts=${RESTARTS:-0};;;; self_heal_at=${SELF_HEAL_AT};;;; self_heal_reason=${SELF_HEAL_REASON};;;;"

# ---- 이중 체크: 상태파일 자체가 오래됐으면 내용과 무관하게 CRITICAL ----
if [ "$FILE_AGE" -ge "$STALE_SEC" ]; then
    echo "CRITICAL - status file stale for ${FILE_AGE}s (local self-heal script may be dead) | ${PERF}file_age=${FILE_AGE};;;;"
    exit $STATE_CRITICAL
fi

case "$STATUS" in
    OK)
        echo "OK - segment fresh (age ${AGE}s, restarts=${RESTARTS}) | ${PERF}"
        exit $STATE_OK
        ;;
    WARNING)
        echo "WARNING - segment stale ${AGE}s (restarts=${RESTARTS}) | ${PERF}"
        exit $STATE_WARNING
        ;;
    CRITICAL)
        echo "CRITICAL - segment stale ${AGE}s (restarts=${RESTARTS}) | ${PERF}"
        exit $STATE_CRITICAL
        ;;
    *)
        echo "UNKNOWN - unrecognized status value: ${STATUS}"
        exit $STATE_UNKNOWN
        ;;
esac
