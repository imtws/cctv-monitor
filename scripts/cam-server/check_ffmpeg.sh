#!/bin/bash
#
# check_ffmpeg.sh (v5)
# - 캠서버 로컬 cron으로 도는 self-heal 스크립트
# - webcam.m3u8이 DELAY(30초) 이상 미갱신이면 서비스 재시작
# - m3u8은 갱신되지만 TARGETDURATION/EXTINF≈0 (영상 0초 멈춤)이면 재시작
# - 재기동 시 SELF_HEAL_AT / SELF_HEAL_REASON 을 상태파일에 기록
#   -> NRPE(check_cctv_status) → cctv_digest.sh 가 cammon 작업이력에 남김
# - 개별 메일 발송 로직은 제거함 (나기오스 서버의 cctv_digest.sh가 통합 알림 전담)
# - STATUS 판정은 기존과 동일하게 AGE 기준 (NRPE 메시지 호환)
#
set -u

CAM_NAME=$(hostname)
HLS_FILE="/usr/local/nginx/html/hls/webcam.m3u8"
SERVICE_NAME="cctv-relay.service"

STATUS_DIR="/home/vlc/status"
STATUS_FILE="${STATUS_DIR}/${CAM_NAME}_cctv-relay_status"

DELAY=30       # 이 초 이상 미갱신이면 self-heal 재시작 시도
WARN_SEC=60    # 상태파일 판정 기준 - digest 스크립트가 참고 (WARNING)
CRIT_SEC=300   # 5분 - (CRITICAL)

mkdir -p "$STATUS_DIR"

NOW=$(date "+%s")

# 이전 self-heal 정보 유지 (재기동 없는 주기에도 NRPE가 마지막 이벤트를 볼 수 있게)
PREV_SELF_HEAL_AT=0
PREV_SELF_HEAL_REASON=""
if [ -f "$STATUS_FILE" ]; then
    PREV_SELF_HEAL_AT=$(grep '^SELF_HEAL_AT=' "$STATUS_FILE" 2>/dev/null | cut -d= -f2)
    PREV_SELF_HEAL_REASON=$(grep '^SELF_HEAL_REASON=' "$STATUS_FILE" 2>/dev/null | cut -d= -f2-)
    PREV_SELF_HEAL_AT=${PREV_SELF_HEAL_AT:-0}
fi

if [ -f "$HLS_FILE" ]; then
    FILETIME=$(stat --format=%Y "$HLS_FILE")
    AGE=$(( NOW - FILETIME ))
else
    AGE=999999
fi

# systemd가 이미 갖고 있는 누적 재시작 횟수 재활용 (별도 카운터 파일 안 만듦)
RESTARTS=$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null)
RESTARTS=${RESTARTS:-0}

# ---- HLS duration 검사 (세그먼트는 갱신되지만 재생이 0초에 멈추는 케이스) ----
HLS_STALL=0
HLS_TD=-1
HLS_EXTINF_AVG=-1
HLS_EXTINF_N=0

if [ -f "$HLS_FILE" ]; then
    eval "$(
        awk '
            BEGIN { td="-1"; n=0; sum=0 }
            /^#EXT-X-TARGETDURATION:/ {
                split($0, a, ":"); gsub(/\r/, "", a[2]); td=a[2]+0
            }
            /^#EXTINF:/ {
                split($0, a, ":");
                gsub(/,.*/, "", a[2]);
                gsub(/\r/, "", a[2]);
                sum+=a[2]+0; n++
            }
            END {
                avg = (n>0) ? sum/n : -1
                printf "HLS_TD=%s\nHLS_EXTINF_AVG=%s\nHLS_EXTINF_N=%d\n", td, avg, n
            }
        ' "$HLS_FILE"
    )"

    # TARGETDURATION < 1 또는 EXTINF 평균 < 0.5
    if [ "${HLS_EXTINF_N:-0}" -gt 0 ]; then
        stall_flag=$(awk -v td="$HLS_TD" -v avg="$HLS_EXTINF_AVG" 'BEGIN {
            if ((td+0) >= 0 && (td+0) < 1) { print 1; exit }
            if ((avg+0) >= 0 && (avg+0) < 0.5) { print 1; exit }
            print 0
        }')
        HLS_STALL=$stall_flag
    fi
fi

# ---- 상태 판정 (AGE 기준 — 기존 NRPE/digest 호환) ----
if [ "$AGE" -ge "$CRIT_SEC" ]; then
    STATUS="CRITICAL"
elif [ "$AGE" -ge "$WARN_SEC" ]; then
    STATUS="WARNING"
else
    STATUS="OK"
fi

# ---- self-heal ----
# 1) DELAY 이상 미갱신
# 2) HLS duration≈0 (영상 0초 멈춤)
SELF_HEAL_AT=${PREV_SELF_HEAL_AT:-0}
SELF_HEAL_REASON=${PREV_SELF_HEAL_REASON:-}

if [ "$AGE" -ge "$DELAY" ] || [ "$HLS_STALL" -eq 1 ]; then
    if [ "$HLS_STALL" -eq 1 ]; then
        SELF_HEAL_REASON="hls_stall"
    else
        SELF_HEAL_REASON="mtime_stale"
    fi
    systemctl restart "$SERVICE_NAME"
    SELF_HEAL_AT=$NOW
    # 재기동 직후 NRestarts 갱신값 반영
    RESTARTS=$(systemctl show "$SERVICE_NAME" -p NRestarts --value 2>/dev/null)
    RESTARTS=${RESTARTS:-0}
fi

# ---- 상태파일 원자적 기록 (tmp + mv → flock 불필요, 항상 완전한 파일만 노출됨) ----
TMP_FILE="${STATUS_FILE}.tmp.$$"
{
    echo "STATUS=${STATUS}"
    echo "AGE=${AGE}"
    echo "RESTARTS=${RESTARTS}"
    echo "UPDATED=${NOW}"
    echo "HLS_STALL=${HLS_STALL}"
    echo "HLS_TD=${HLS_TD}"
    echo "HLS_EXTINF_AVG=${HLS_EXTINF_AVG}"
    echo "SELF_HEAL_AT=${SELF_HEAL_AT}"
    echo "SELF_HEAL_REASON=${SELF_HEAL_REASON}"
} > "$TMP_FILE"
mv -f "$TMP_FILE" "$STATUS_FILE"
