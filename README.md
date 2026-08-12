# CCTV 관제 시스템 매뉴얼

이 문서는 현재 구현 기준 운영·개발 매뉴얼입니다.  
사람과 AI 모두 구조·동작 방식을 빠르게 파악할 수 있도록 작성했습니다.

---

## 1. 프로젝트 개요

예시 행사 CCTV 실시간 관제 및 상태 관리 시스템입니다.  
엑셀로 경기장·카메라 목록을 관리하고, 각 카메라의 실시간 HLS 스트림을 카드뷰/리스트뷰로 모니터링합니다.

**핵심 기능**

- 카드뷰 / 리스트뷰 전환
- 개별·일괄 카메라 상태 변경 (confirm 확인 다이얼로그 포함)
- 카메라별 알림 스케줄 관리 (사용 여부 + 시간 범위)
- 경기장 정보 엑셀 업로드를 통한 일괄 갱신
- 실시간 HLS 스트림 팝업 뷰어 (모달)
- 리스트뷰 행 펼침 → 미리보기 스트림 + 상세 메타 표시
- **모니터링 문자 발송폼**: 작동 중지 처리된 캠을 자동 취합하여 알림 문자 발송 양식 제공 (복사 기능 및 example SMS 발송 링크 포함)
- **리스트뷰 내 DDNS 바로가기**: 각 행의 액션 버튼 영역에 DDNS 바로가기 링크 추가

---

## 2. 디렉토리 구조

```
/home/www/cammon/
├── index.php                        # 진입점 (View 렌더링 위임)
├── api.php                          # API 진입점 (JSON + multipart 처리)
├── parse_excel.py                   # 엑셀 파서 (Python 3 + openpyxl)
├── README.md                        # 이 문서 (운영·개발 매뉴얼)
├── ai.md                            # AI 참조용 아키텍처 레퍼런스
│
├── app/
│   ├── controllers/
│   │   └── CctvController.php       # 요청 파싱 · action 라우팅 · JSON 응답
│   ├── models/
│   │   └── CctvModel.php            # JSON 파일 CRUD · 엑셀 파서 실행
│   └── views/
│       ├── layout.php               # 메인 HTML 레이아웃 (외부 CDN 포함)
│       └── partials/
│           ├── header.php           # 상단 헤더 (뷰 전환 · 일괄 설정 버튼)
│           ├── toolbar.php          # 필터 · 페이징 · 엑셀 업로드 툴바
│           ├── settings_drawer.php  # 우측 설정 드로어 (오버레이 포함)
│           └── modal_player.php     # 영상 팝업 모달 (확대 뷰어)
│
├── assets/
│   ├── css/style.css                # 전체 스타일시트 (CSS 변수 기반)
│   └── js/app.js                    # 클라이언트 JS 로직 (약 830줄)
│
├── data/
│   ├── cctv_config.json             # 카메라 목록 · 상태 · 알림 설정
│   ├── alert_config.json            # 글로벌 알림 설정
│   └── uploads/                     # 업로드된 엑셀 임시 보관 (apache 소유 필요)
│
└── stw_backup/                      # 이전 버전 · 레거시 파일 보관
    ├── sample_cctv.xlsx             # 엑셀 양식 원본
    ├── cctv_current.xlsx            # 현재 데이터 기반 생성 양식
    ├── generate_excel.py            # 현재 JSON → 엑셀 재생성 스크립트
    └── ...
```

---

## 3. 아키텍처 (MVC)

| 레이어 | 파일 | 역할 |
|--------|------|------|
| **Front Controller** | `index.php` | `app/views/layout.php` 렌더링 위임 |
| **Front Controller** | `api.php` | JSON body / form-data 파싱 → Controller 위임 |
| **Controller** | `CctvController.php` | action 라우팅, 입력 검증, JSON 응답 반환 |
| **Model** | `CctvModel.php` | JSON 파일 CRUD (atomic write), 엑셀 파서 실행 |
| **View** | `layout.php` + `partials/` | PHP 서버사이드 HTML 렌더링 |
| **Assets** | `style.css`, `app.js` | 스타일 및 클라이언트 SPA 로직 |

### 3.1 요청 흐름

```
브라우저
  ├─ GET  index.php → layout.php → HTML(CSS/JS 참조) → app.js
  └─ XHR  api.php?action=... → CctvController::dispatch() → CctvModel → JSON
                                                        └─ upload_excel → parse_excel.py
```

---

## 4. 외부 의존성

| 종류 | 버전/내용 |
|------|----------|
| Google Fonts (CDN) | Pretendard (300·400·500·600·700) |
| FontAwesome (CDN) | 6.4.0 |
| HLS.js (CDN) | latest (`cdn.jsdelivr.net`) |
| Python 3 | 시스템 설치 필요 |
| openpyxl | `pip3 install openpyxl` |

> 오프라인 환경에서는 폰트·아이콘·HLS 플레이어가 정상 동작하지 않을 수 있습니다.

---

## 5. 화면 구성

### 5.1 상단 헤더 (`partials/header.php`)

- 카드뷰 / 리스트뷰 전환 버튼 (`btn-card-view` / `btn-list-view`)
- **문자 발송폼** 버튼 (`btn-sms-form`) → 작동 중지 처리된 캠 목록을 기반으로 알림 발송용 텍스트 양식을 자동 생성하는 드로어 오픈
- 일괄 설정 버튼 → 선택된 항목에 드로어 적용

### 5.2 툴바 (`partials/toolbar.php`)

- **경기장 정보 엑셀 업로드** 버튼 + 숨겨진 `<input type="file">` (`excel-upload`)
- 캠 새로고침 버튼 (`loadData()` 호출)
- 필터 초기화 버튼 (`resetFilters()`)
- 페이지 범위 필터 (`전체 보기`, `CAM 1~10`, `CAM 11~20` …) — 카메라 `num` 기준 10개 단위
- **공통 필터 영역 (하단 바)**:
  - 텍스트 검색창 (`search-input`)을 좌측에 넓게 배치하여 입력 가독성 증대
  - 우측에 경기장 필터 (`stadium-filter`), 상태 필터 (`status-filter`), 현재 페이지 전체 선택 체크박스 (`select-all-cb`) 배치

### 5.3 카드뷰 (`#card-panel`)

- 필터된 카메라별 카드 (`video-card`)
- 카드 상단: HLS 스트림 `<video>` + 체크박스 (`cam-multi-check`)
- 카드 하단: CAM 번호·종목, 경기장명, 상태 칩, 알림 스케줄 배지, DDNS 외부 링크
- `설정` 버튼 → 개별 설정 드로어
- `확대` 버튼 → 모달 팝업 뷰어

### 5.4 리스트뷰 (`#list-panel`)

- sticky 헤더 (`list-header`) + 스크롤 베일(`.list-veil`) 처리
- 행: 체크박스, CAM 번호/경기장/종목 mini-meta, 상태 칩, 작업 버튼
- **DDNS 바로가기 버튼** 추가: 작업 버튼 영역에서 바로 해당 DDNS 링크로 새 창 이동 가능
- `꺾쇠` 버튼 → 행 펼침 (`.list-item-group.open`) → HLS 미리보기 + 상세 메타
- `설정`, `확대` 버튼

### 5.5 우측 설정 드로어 (`partials/settings_drawer.php`)

- 오버레이 (`settings-drawer-overlay`) + 드로어 패널 (`settings-drawer`)
- 선택 항목 목록
- 상태 변경 버튼 3종 (confirm 확인 → `applyDrawerStatus()`)
- 알람 스케줄: 사용 체크박스 + 시간 범위 → `applyDrawerSchedule()`
- 개별(`single`) / 일괄(`batch`) 두 모드 공용

### 5.6 모달 팝업 (`partials/modal_player.php`)

- `player-modal` — Flex 오버레이
- HLS.js 또는 native `<video>` 재생
- 닫기 시 HLS 인스턴스 destroy + `<video>` src 초기화

---

## 6. 카메라 상태 값

| 값 | 라벨 | 의미 |
|----|------|------|
| `ACTIVE` | 경기 진행 중 | 정상 운영 |
| `STOPPED` | 작동 중지 | 비활성 |
| `INSPECTION` | 점검중 | 점검·정비 중 |

> `STOPPED` 또는 `INSPECTION` 상태의 카메라는 알람 경보 대상에서 제외됩니다.

---

## 7. 데이터 구조

### 7.1 `data/cctv_config.json`

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

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | string | 카메라 식별자 (`cam01` 형식) |
| `num` | int | 표시용 번호 (페이지 범위 필터 기준) |
| `stadium` | string | 경기장명 — `경기장명 (경기장번호)` 형태 |
| `category` | string | 종목명 |
| `ddns` | string | 외부 링크용 DDNS 주소 |
| `status` | string | `ACTIVE` / `STOPPED` / `INSPECTION` |
| `alert_enabled` | bool | 카메라 알림 사용 여부 |
| `alert_start` | string | 알림 시작 시간 (`HH:MM`) |
| `alert_end` | string | 알림 종료 시간 (`HH:MM`) |

### 7.2 `data/alert_config.json`

```json
{
  "enabled": true,
  "start_time": "08:00",
  "end_time": "18:00",
  "work_days": [1, 2, 3, 4, 5],
  "recipient": "stw@example.com"
}
```

| 필드 | 설명 |
|------|------|
| `enabled` | 글로벌 알림 활성화 여부 |
| `start_time` | 글로벌 알림 시작 시간 |
| `end_time` | 글로벌 알림 종료 시간 |
| `work_days` | 요일 배열 (1=월 … 5=금) |
| `recipient` | 알림 수신자 (서버 사이드 고정값: `stw@example.com`) |

---

## 8. API 문서

모든 응답은 `Content-Type: application/json; charset=utf-8`입니다.

### 8.1 데이터 조회

```http
GET api.php?action=get_data
```

```json
{ "success": true, "cctvs": [...], "alert": {} }
```

### 8.2 개별 상태 변경

```http
POST api.php
Content-Type: application/json

{ "action": "update_status", "cam_id": "cam01", "status": "ACTIVE" }
```

> 허용 status 값: `ACTIVE`, `STOPPED`, `INSPECTION`

### 8.3 개별 카메라 알림 설정 변경

```http
POST api.php
Content-Type: application/json

{
  "action": "update_cam_alert",
  "cam_id": "cam01",
  "alert_enabled": true,
  "alert_start": "08:00",
  "alert_end": "18:00"
}
```

### 8.4 일괄 상태/스케줄 변경

```http
POST api.php
Content-Type: application/json

{
  "action": "batch_update",
  "cam_ids": ["cam01", "cam02"],
  "status": "STOPPED",
  "alert_enabled": true,
  "alert_start": "08:00",
  "alert_end": "18:00"
}
```

> `status`, `alert_enabled`, `alert_start`, `alert_end`는 각각 독립적으로 선택 적용됩니다.  
> 실제 UI는 상태 변경과 스케줄 변경을 별도 버튼으로 분리하여 호출합니다.

### 8.5 글로벌 알림 설정 변경

```http
POST api.php
Content-Type: application/json

{ "action": "update_alert", "enabled": true, "start_time": "07:00", "end_time": "19:00" }
```

```json
{ "success": true, "message": "Global alert settings saved", "alert": {} }
```

### 8.6 경기장 정보 엑셀 업로드

```http
POST api.php
Content-Type: multipart/form-data

action=upload_excel
excel_file=<.xlsx 파일>
```

```json
{ "success": true, "count": 50 }
```

---

## 9. 엑셀 파서 (`parse_excel.py`)

첫 10행 안에서 `순번` 헤더를 탐색해 컬럼을 매핑합니다.  
헤더가 없으면 기본 컬럼 순서(1~5열)를 사용합니다.

| 헤더명 | 의미 |
|--------|------|
| `순번` | 카메라 번호 → `cam01` 형식 ID 생성 |
| `경기장 번호` | 경기장 코드 |
| `경기장명` | 경기장 이름 → `경기장명 (경기장번호)` 형태로 저장 |
| `경기직종명` | 종목명 |
| `DDNS명` | DDNS 주소 |

**처리 규칙**

- 기존 JSON에 동일 `id`가 있으면 `status`, `alert_enabled`, `alert_start`, `alert_end` 값을 유지합니다.
- 신규 카메라의 기본 status는 `STOPPED`로 초기화됩니다.
- 업로드된 `.xlsx`는 `data/uploads/uploaded_{timestamp}.xlsx`로 저장 후 파서가 실행됩니다.
- `data/uploads/` 폴더는 `apache` 소유·쓰기 권한이 필요합니다.

**양식 파일 위치**

| 파일 | 설명 |
|------|------|
| `stw_backup/sample_cctv.xlsx` | 원본 샘플 양식 |
| `stw_backup/cctv_current.xlsx` | 현재 데이터 기반으로 생성된 양식 |
| `stw_backup/generate_excel.py` | 현재 JSON → 엑셀 재생성 스크립트 |

---

## 10. HLS 스트림 URL 규칙

```
http://{cam_id}.example.com:8080/hls/webcam.m3u8
```

예) `cam01` → `http://cam01.example.com:8080/hls/webcam.m3u8`

- HLS.js 지원 브라우저: `Hls.isSupported()` 확인 후 HLS.js 사용
- Safari (native HLS 지원): `video.canPlayType('application/vnd.apple.mpegurl')` 분기 처리
- 카드뷰 전환 시 기존 HLS 인스턴스 전부 `destroy()` 후 재생성

---

## 11. 클라이언트 JS 주요 전역 상태 (`app.js`)

| 변수 | 타입 | 설명 |
|------|------|------|
| `allCctvs` | `Array` | 서버에서 받은 전체 카메라 배열 |
| `alertConfig` | `Object` | 글로벌 알림 설정 |
| `activePageFilter` | `string` | 현재 페이지 범위 필터 (`'all'` 또는 `'1-10'` 형식) |
| `selectedCamIds` | `Set<string>` | 현재 체크 선택된 카메라 ID 집합 |
| `hlsInstances` | `Object` | 카드뷰 HLS 인스턴스 맵 (`{camId: HlsInstance}`) |
| `listPreviewHls` | `Object` | 리스트뷰 펼침 HLS 인스턴스 맵 |
| `listExpandedIds` | `Set<string>` | 펼쳐진 리스트 행 ID 집합 |
| `modalHls` | `HlsInstance\|null` | 모달 팝업 HLS 인스턴스 |
| `settingsDrawerMode` | `string` | `'single'` 또는 `'batch'` |
| `settingsDrawerIds` | `Array<string>` | 드로어 대상 카메라 ID 배열 |
| `currentViewMode` | `string` | `'card'` 또는 `'list'` |

---

## 12. 트러블슈팅

### 12.1 화면은 뜨는데 데이터가 없음

- `data/cctv_config.json` 존재 여부 확인
- `api.php?action=get_data` 직접 호출해서 JSON 응답 확인
- 브라우저 콘솔 오류 확인

### 12.2 실시간 영상이 안 나옴

- 카메라 DDNS/HLS 경로가 실제로 접근 가능한지 확인
- 네트워크 방화벽 또는 CORS 문제 확인
- `hls.js` CDN 로딩 가능 여부 확인 (오프라인 환경)

### 12.3 엑셀 업로드 실패

| 오류 메시지 | 원인 | 해결 |
|-------------|------|------|
| `Failed to save uploaded file` | `data/uploads/` 권한 문제 | `chown apache:apache data/uploads` |
| `Error parsing Excel: ...` | `openpyxl` 미설치 또는 파일 형식 오류 | `pip3 install openpyxl` 확인, `.xlsx` 형식 확인 |
| `File upload failed` | PHP `upload_max_filesize` 초과 | `php.ini` 설정 확인 |
| `Failed to execute Excel parser script` | python3 경로 문제 | `which python3` 확인 |

### 12.4 상태/알림 저장이 안 됨

- 웹 서버 프로세스(`apache`)가 `data/` 디렉터리에 쓰기 권한이 있는지 확인
- `api.php` POST 요청이 정상 수신되는지 확인
- `cam_id` 값이 `cam01` 형태와 일치하는지 확인

### 12.5 `:1080/munin` 또는 `:1080/nagios`가 안 뜸

- `/etc/httpd/conf.d/vhost.conf`의 `VirtualHost *:1080` 안에 `Alias /nagios`, `Alias /munin`이 있는지 확인
- `httpd reload` 후 `function.example.com:1080`으로 재확인

---

## 13. 운영 권한 메모

```bash
# uploads 폴더 권한 (최초 또는 root 변경 후)
chown apache:apache /home/www/cammon/data/uploads
chmod 755 /home/www/cammon/data/uploads

# 엑셀 파서 의존성
pip3 install openpyxl

# 현재 데이터 기반 엑셀 재생성
python3 /home/www/cammon/stw_backup/generate_excel.py
```

---

## 14. 빠른 점검 체크리스트

배포 후 아래 순서로 확인합니다.

1. `index.php` 접속 → 카드뷰 기본 표시
2. `api.php?action=get_data` 응답 확인
3. 카드뷰 / 리스트뷰 전환 확인
4. 리스트 행 펼침 → 미리보기 스트림 + 상세 메타 확인
5. 개별 설정 저장 확인 (confirm 다이얼로그 → 드로어)
6. 일괄 설정 저장 확인 (체크 선택 → 일괄 설정)
7. 경기장 정보 엑셀 업로드 확인
8. HLS 스트림 로딩 확인 (카드·리스트·모달)

---

## 15. 한 줄 요약

> **엑셀 → JSON → MVC PHP + 클라이언트 JS SPA** 구조의 CCTV 관제 도구.  
> 카드뷰/리스트뷰 · 우측 드로어 설정 · 일괄 상태·스케줄 변경 · 경기장 정보 엑셀 업로드로 구성됩니다.
