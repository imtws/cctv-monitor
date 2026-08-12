# CCTV 관제 시스템

예시 행사 CCTV 실시간 관제 및 알람 관리 시스템.

---

## 구조

```
cammon/
├── index.php                  # 진입점
├── api.php                    # REST API 엔드포인트
├── parse_excel.py             # 엑셀 → cctv_config.json 변환
│
├── app/
│   ├── controllers/CctvController.php
│   ├── models/CctvModel.php
│   └── views/
│       ├── layout.php
│       └── partials/
│           ├── header.php
│           ├── toolbar.php
│           ├── settings_drawer.php
│           └── modal_player.php
│
├── assets/
│   ├── css/style.css
│   └── js/app.js
│
├── data/
│   ├── cctv_config.json       # 카메라 목록 · 상태 · 알림 설정
│   ├── alert_config.json      # 글로벌 알림 설정
│   └── uploads/               # 엑셀 업로드 임시 저장 (apache 소유 필요)
│
└── scripts/
    └── cctv_digest.sh         # NRPE 상태 수집 · 알람 메일 발송 (cron)
```

---

## 화면 기능

| 기능 | 설명 |
|------|------|
| 카드뷰 / 리스트뷰 전환 | 상단 버튼으로 전환 |
| 카메라 상태 변경 | 개별 또는 체크박스 일괄 선택 → 우측 드로어에서 변경 |
| 알림 스케줄 관리 | 드로어 내 사용 여부 + 시간 범위 설정 |
| 엑셀 업로드 | 툴바 버튼 → `.xlsx` 업로드 → 카메라 목록 일괄 갱신 |
| HLS 스트림 뷰어 | 카드 `확대` 버튼 또는 리스트 행 펼침으로 영상 확인 |
| DDNS 바로가기 | 리스트뷰 행 액션 버튼에서 DDNS 링크로 바로 이동 |
| 문자 발송폼 | 작동 중지 캠 자동 취합 → example SMS 발송 양식 생성 |

---

## 카메라 상태

| 값 | 의미 | 알람 |
|----|------|------|
| `ACTIVE` | 경기 진행 중 | ✅ 발송 |
| `STOPPED` | 작동 중지 | ❌ 차단 |
| `INSPECTION` | 점검중 | ❌ 차단 |

---

## 데이터 파일

### `data/cctv_config.json`

```json
[
  {
    "id": "cam01",
    "num": 1,
    "stadium": "인천기계공업고등학교 (제1경기장)",
    "category": "금형",
    "ddns": "https://ddns.hanwha-security.com/mold8088",
    "status": "ACTIVE",
    "alert_enabled": true,
    "alert_start": "08:00",
    "alert_end": "18:00"
  }
]
```

| 필드 | 설명 |
|------|------|
| `id` | 카메라 식별자 (`cam01` 형식) |
| `num` | 표시 번호 (페이지 범위 필터 기준) |
| `stadium` | 경기장명 |
| `category` | 종목명 |
| `ddns` | 외부 링크용 DDNS 주소 |
| `status` | `ACTIVE` / `STOPPED` / `INSPECTION` |
| `alert_enabled` | 알림 사용 여부 |
| `alert_start` / `alert_end` | 알림 시간 범위 (`HH:MM`) |
| `suppress_until` | 개별 임시 알람 억제 (`2026-08-12T18:00` 형식, 선택) |

### `data/alert_config.json`

```json
{
  "enabled": true,
  "start_time": "08:00",
  "end_time": "18:00",
  "work_days": [1, 2, 3, 4, 5],
  "recipient": "stw@example.com",
  "suppress_until": null
}
```

---

## 엑셀 업로드

툴바 → **경기장 정보 엑셀 업로드** 버튼으로 `.xlsx`를 올리면 `parse_excel.py`가 자동 실행됩니다.

**엑셀 필수 헤더** (첫 10행 안에 있어야 함):

| 헤더 | 설명 |
|------|------|
| `순번` | 카메라 번호 |
| `경기장 번호` | 경기장 코드 |
| `경기장명` | 경기장 이름 |
| `경기직종명` | 종목명 |
| `DDNS명` | DDNS 주소 |

> 기존 JSON에 동일 `id`가 있으면 `status`, `alert_enabled`, `alert_start`, `alert_end` 값은 유지됩니다.
> 신규 카메라는 기본값 `status: STOPPED`로 생성됩니다.

---

## NRPE 알람 (`scripts/cctv_digest.sh`)

cron으로 주기적으로 실행되며 각 카메라 서버에 NRPE로 접속해 HLS 세그먼트 상태를 확인합니다.

### 알람 예외처리 로직

스크립트 실행 시 `/etc/nagios/objects/Monitor/` 하위 **모든 계정 디렉터리**를 자동 스캔해
카메라 번호 → 실제 Nagios 호스트명 매핑을 동적으로 생성합니다.

```
/etc/nagios/objects/Monitor/
├── example-account@example.com/
├── example-account@example.com/   → example-cam-01.cfg, example-cam-02.cfg ...
├── example-account@example.com/   → example-cam-06.cfg
└── (이후 추가되는 계정도 자동 인식)
```

새 계정(example-account, example-account 등)이 추가되어도 **별도 설정 없이 자동으로 인식**됩니다.
Nagios cfg 파일만 등록되어 있으면 됩니다.

### 예외처리 우선순위

1. `alert_config.json`의 `suppress_until` → 전체 캠 알람 차단
2. `cctv_config.json`의 `status: STOPPED / INSPECTION` → 해당 캠 알람 차단
3. `cctv_config.json`의 `suppress_until` → 해당 캠 임시 알람 차단

### cron 등록 예시

```bash
# /etc/cron.d/cctv_digest
*/5 * * * * root /home/www/cammon/scripts/cctv_digest.sh
```

### 로그 / 상태 파일

| 파일 | 용도 |
|------|------|
| `/var/log/cctv_digest.log` | 실행 로그 |
| `/var/lib/nagios/cctv_digest_prev_problems.txt` | 직전 장애 상태 (Recovery 판단용) |
| `data/live_status.json` | 웹 UI 실시간 상태 표시용 |

---

## HLS 스트림 URL

```
http://{cam_id}.example.com:8080/hls/webcam.m3u8
```

예) `cam01` → `http://cam01.example.com:8080/hls/webcam.m3u8`

---

## API

| Method | Action | 설명 |
|--------|--------|------|
| GET | `get_data` | 전체 카메라 목록 + 글로벌 알림 설정 조회 |
| POST | `update_status` | 개별 상태 변경 (`cam_id`, `status`) |
| POST | `update_cam_alert` | 개별 알림 설정 변경 |
| POST | `batch_update` | 일괄 상태/스케줄 변경 (`cam_ids[]`) |
| POST | `update_alert` | 글로벌 알림 설정 변경 |
| POST | `upload_excel` | 엑셀 업로드 (multipart/form-data) |

---

## 초기 설정 / 운영 메모

```bash
# uploads 폴더 권한
chown apache:apache /home/www/cammon/data/uploads
chmod 755 /home/www/cammon/data/uploads

# 엑셀 파서 의존성
pip3 install openpyxl
```

### 트러블슈팅

| 증상 | 원인 | 조치 |
|------|------|------|
| 엑셀 업로드 실패 | `data/uploads/` 권한 | `chown apache:apache data/uploads` |
| 영상 안 나옴 | 방화벽 또는 HLS 경로 문제 | 카메라 DDNS·포트 접근 확인 |
| 알람이 예외처리 안 됨 | Nagios cfg 미등록 | `/etc/nagios/objects/Monitor/` 하위 cfg 파일 확인 |
| NRPE 통신 불가 | 방화벽 미설정 | 해당 서버 5666 포트 인바운드 허용 |
