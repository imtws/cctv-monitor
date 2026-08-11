# AI 참조용 아키텍처 레퍼런스

> AI 에이전트가 이 코드베이스를 작업할 때 빠르게 읽어야 할 핵심 정보를 정리한 문서입니다.  
> 전체 운영 매뉴얼은 `README.md`를 참조하세요.

---

## 프로젝트 한 줄 요약

**예시 행사 CCTV 실시간 관제 시스템**  
PHP MVC + 클라이언트 JS SPA. 데이터는 JSON 파일로 관리, 엑셀 업로드로 카메라 목록 일괄 갱신.

---

## 파일 맵 (전체)

```
/home/www/cammon/
├── index.php                 → require app/views/layout.php (뷰 위임)
├── api.php                   → CctvController::dispatch() 호출 (JSON + multipart)
├── parse_excel.py            → python3 스크립트, shell_exec으로 실행됨
├── README.md                 → 운영·개발 매뉴얼 (사람 대상)
├── ai.md                     → 이 파일 (AI 대상 레퍼런스)
│
├── app/
│   ├── controllers/CctvController.php   → dispatch(), action 라우터
│   ├── models/CctvModel.php             → JSON CRUD, 엑셀 파서 실행
│   └── views/
│       ├── layout.php                   → HTML 뼈대, CDN 로드
│       └── partials/
│           ├── header.php               → 헤더 (뷰 전환 버튼)
│           ├── toolbar.php              → 필터·페이징·업로드 툴바
│           ├── settings_drawer.php      → 우측 설정 드로어 (overlay + panel)
│           └── modal_player.php         → 영상 팝업 모달
│
├── assets/
│   ├── css/style.css     → CSS 변수 기반 전체 스타일 (~18KB)
│   └── js/app.js         → 클라이언트 SPA 로직 (~830줄, ~38KB)
│
└── data/
    ├── cctv_config.json  → 카메라 배열 (읽기·쓰기 대상)
    ├── alert_config.json → 글로벌 알림 설정 (읽기·쓰기 대상)
    └── uploads/          → 엑셀 임시 저장 (apache 소유)
```

---

## 핵심 데이터 타입

### Camera 객체 (`cctv_config.json` 배열 원소)

```json
{
  "id": "cam01",          // string — 식별자, HLS URL·API cam_id로 사용
  "num": 1,               // int    — 표시 번호, 페이지 범위 필터(10개 단위) 기준
  "stadium": "인천기계공업고등학교 (제1경기장)",  // string
  "category": "금형",     // string — 종목명
  "ddns": "https://...",  // string — 외부 링크 (카드·리스트에 표시)
  "status": "ACTIVE",     // "ACTIVE" | "STOPPED" | "INSPECTION"
  "alert_enabled": true,  // bool
  "alert_start": "08:00", // "HH:MM"
  "alert_end": "18:00"    // "HH:MM"
}
```

### AlertConfig 객체 (`alert_config.json`)

```json
{
  "enabled": true,
  "start_time": "08:00",
  "end_time": "18:00",
  "work_days": [1, 2, 3, 4, 5],   // 1=월 ~ 7=일
  "recipient": "stw@example.com"  // 서버 사이드 고정값
}
```

---

## API 엔드포인트 일람

| action | method | 설명 | 주요 파라미터 |
|--------|--------|------|--------------|
| `get_data` | GET | 전체 카메라 + 알림 설정 조회 | — |
| `update_status` | POST/JSON | 개별 상태 변경 | `cam_id`, `status` |
| `update_cam_alert` | POST/JSON | 개별 알림 설정 변경 | `cam_id`, `alert_enabled`, `alert_start`, `alert_end` |
| `batch_update` | POST/JSON | 일괄 상태·스케줄 변경 | `cam_ids[]`, `status?`, `alert_enabled?`, `alert_start?`, `alert_end?` |
| `update_alert` | POST/JSON | 글로벌 알림 설정 저장 | `enabled`, `start_time`, `end_time` |
| `upload_excel` | POST/multipart | 엑셀 업로드 → JSON 갱신 | `excel_file` |

> `batch_update`의 각 필드는 **null이면 해당 필드를 수정하지 않습니다** (선택 적용).

---

## 컨트롤러 메서드 목록 (`CctvController.php`)

| 메서드 | 역할 |
|--------|------|
| `dispatch(method, action, postData, files)` | action 스위치 라우터 |
| `getData()` | `get_data` 처리 |
| `updateStatus(data)` | `update_status` 처리, status 검증 |
| `updateCamAlert(data)` | `update_cam_alert` 처리 |
| `batchUpdate(data)` | `batch_update` 처리 |
| `updateAlert(data)` | `update_alert` 처리, recipient 고정 주입 |
| `uploadExcel(files)` | `upload_excel` 처리 → Model 위임 |

---

## 모델 메서드 목록 (`CctvModel.php`)

| 메서드 | 역할 |
|--------|------|
| `readJson(file, default)` | JSON 파일 읽기 |
| `writeJson(file, data)` | Atomic write (tempnam + rename) + chmod 644 |
| `getAllCctvs()` | `cctv_config.json` 전체 반환 |
| `saveCctvs(cctvs)` | `cctv_config.json` 저장 |
| `updateStatus(camId, status)` | 단일 카메라 상태 변경 후 저장 |
| `updateCamAlert(camId, fields)` | 단일 카메라 알림 필드 부분 업데이트 후 저장 |
| `batchUpdate(camIds, status, alertEnabled, alertStart, alertEnd)` | 복수 카메라 일괄 업데이트 (null이면 해당 필드 skip) |
| `getAlertConfig()` | `alert_config.json` 반환 |
| `updateAlertConfig(fields, defaultRecipient)` | 글로벌 알림 설정 업데이트 |
| `processExcelUpload(fileInfo)` | 파일 저장 → `python3 parse_excel.py` 실행 → JSON 결과 반환 |

---

## 클라이언트 JS 주요 함수 (`app.js`)

### 초기화 / 데이터

| 함수 | 역할 |
|------|------|
| `loadData()` | `api.php?action=get_data` fetch → `allCctvs`, `alertConfig` 갱신 → 렌더 |
| `populateStadiumFilter()` | 경기장 드롭다운 목록 생성 |
| `updateSummaryBadges()` | 상태별 카운트 집계 (현재 미표시) |

### 뷰 / 렌더링

| 함수 | 역할 |
|------|------|
| `setViewMode(mode)` | `'card'`·`'list'` 전환, HLS 정리 |
| `renderCurrentView()` | 현재 모드에 맞게 렌더 |
| `renderVideoGrid()` | 카드뷰 렌더링 |
| `renderTable()` | 리스트뷰 렌더링 |
| `updateStickyOffsets()` | CSS 변수 (`--sticky-header-top` 등) 동적 계산 |

### 필터 / 페이징

| 함수 | 역할 |
|------|------|
| `renderPagingButtons()` | `num` 기준 10개 단위 페이지 버튼 생성 |
| `setPageFilter(filter)` | 페이지 범위 변경 → 재렌더 |
| `getFilteredCctvs()` | 페이지·상태·텍스트·경기장 필터 순서로 적용 |
| `resetFilters()` | 모든 필터 초기화 |

### 선택 관리

| 함수 | 역할 |
|------|------|
| `toggleCameraSelection(cb)` | 체크박스 개별 토글 → `selectedCamIds` 업데이트 |
| `toggleSelectAllVisible()` | 현재 뷰 전체 선택/해제 |
| `syncMasterSelection()` | 마스터 체크박스 상태 동기화 (전체·부분·미선택) |

### HLS / 비디오

| 함수 | 역할 |
|------|------|
| `loadListPreview(camId, streamUrl)` | 리스트 펼침 시 HLS 로드 |
| `stopListPreview(camId)` | HLS destroy + video 정리 |
| `clearListPreviews()` | 전체 리스트 미리보기 정리 |
| `toggleListRow(camId)` | 리스트 행 펼침/접기 토글 |
| `openModal(camId, category, streamUrl)` | 모달 팝업 열기 + HLS 시작 |
| `closeModal()` | 모달 닫기 + HLS 정리 |

### 설정 드로어

| 함수 | 역할 |
|------|------|
| `openBatchSettingsModal()` | 선택된 카메라로 일괄 드로어 열기 |
| `openItemSettingsModal(camId)` | 단일 카메라로 개별 드로어 열기 |
| `openSettingsDrawer(mode, ids)` | 드로어 오버레이 + 패널 표시 |
| `closeSettingsDrawer()` | 드로어 닫기 |
| `renderSettingsDrawer()` | 드로어 내용 렌더링 |
| `applyDrawerStatus(status)` | confirm → `batch_update` API 호출 → 로컬 갱신 |
| `applyDrawerSchedule()` | confirm → `batch_update` API 호출 → 로컬 갱신 |

### 엑셀 업로드

| 함수 | 역할 |
|------|------|
| `uploadExcel()` | FormData 구성 → `upload_excel` API 호출 → `loadData()` |

### 유틸리티

| 함수 | 역할 |
|------|------|
| `getStreamUrl(camId)` | `http://{camId}.example.com:8080/hls/webcam.m3u8` 반환 |
| `getStatusLabel(s)` | status → 한글 라벨 |
| `getStatusMarkup(s)` | status → FontAwesome 아이콘 + 라벨 HTML |
| `getScheduleMarkup(cam)` | 알림 ON/OFF + 시간 범위 배지 HTML |
| `escapeHtml(value)` | XSS 방지 이스케이프 |
| `showToast(msg)` | 하단 토스트 메시지 3초 표시 |

---

## 글로벌 JS 상태 변수

```js
let allCctvs          = [];       // Camera[]
let alertConfig       = {};       // AlertConfig
let activePageFilter  = 'all';    // 'all' | '1-10' | '11-20' | ...
let selectedCamIds    = new Set();// Set<camId>
let hlsInstances      = {};       // { [camId]: HlsInstance } (카드뷰)
let listPreviewHls    = {};       // { [camId]: HlsInstance } (리스트 펼침)
let listExpandedIds   = new Set();// Set<camId>
let modalHls          = null;     // HlsInstance | null
let settingsDrawerMode = 'batch'; // 'single' | 'batch'
let settingsDrawerIds  = [];      // camId[]
let currentViewMode   = 'card';   // 'card' | 'list'
```

---

## 중요 구현 패턴

### JSON Atomic Write

`CctvModel::writeJson()`은 tempnam → file_put_contents(LOCK_EX) → rename 순서로  
파일 손상 없는 원자적 덮어쓰기를 보장합니다.

### 일괄 업데이트 선택 적용

`batch_update`는 `status`, `alert_enabled`, `alert_start`, `alert_end`를  
각각 독립적으로 null 체크 후 선택 적용합니다.  
UI에서는 상태 변경과 스케줄 저장을 별도 버튼으로 분리하여 각각 API를 호출합니다.

### 로컬 상태 즉시 반영

API 성공 후 `applyLocalDrawerUpdate()`로 `allCctvs`를 즉시 갱신해  
서버 재조회 없이 UI를 업데이트합니다. 전체 목록 재조회는 엑셀 업로드 후에만 수행됩니다.

### sticky 오프셋 동적 계산

헤더·툴바·리스트 헤더의 실제 높이를 `offsetHeight`로 읽어  
CSS 변수(`--sticky-header-top`, `--sticky-list-top`)에 주입합니다.  
뷰 전환·리사이즈 시마다 `updateStickyOffsets()`를 호출합니다.

### HLS 인스턴스 관리

뷰 전환 시 이전 뷰의 HLS 인스턴스를 모두 `destroy()`합니다.  
리스트 행 접기 시에도 개별 HLS를 `destroy()` + video src 초기화합니다.  
모달 열기/닫기 시 `modalHls`를 단독 관리합니다.

### 엑셀 파서 실행 흐름

```
api.php (multipart POST)
  → CctvController::uploadExcel()
    → CctvModel::processExcelUpload()
      → move_uploaded_file() → data/uploads/uploaded_{ts}.xlsx
      → shell_exec("python3 parse_excel.py {xlsx} {json}")
        → parse_excel.py (openpyxl)
          → 기존 JSON 로드 (status·alert 값 보존)
          → 새 카메라 배열 생성
          → cctv_config.json 덮어씌우기
          → {"success": true, "count": N} 출력
      → JSON 파싱 후 Controller에 반환
```

---

## 코드 수정 시 주의사항

1. **`cam_id` 형식**: 항상 `cam01`~`cam99` 형식이어야 합니다 (파서·API·HLS URL 모두 이 형식 기준).
2. **`data/` 권한**: `cctv_config.json`, `alert_config.json` 수정 시 apache가 쓸 수 있어야 합니다.
3. **`data/uploads/` 권한**: `chown apache:apache` 필요, PHP `move_uploaded_file()`이 실패합니다.
4. **HLS URL 패턴**: `getStreamUrl(camId)` 함수 하나에 집중되어 있습니다 — URL 규칙 변경 시 이 함수만 수정하면 됩니다.
5. **상태 검증**: Controller의 `updateStatus`는 허용값을 `['ACTIVE', 'STOPPED', 'INSPECTION']`으로 제한합니다.
6. **`batch_update`의 null 처리**: JS에서 변경하지 않을 필드는 아예 payload에서 제외하거나 null로 보내야 합니다.
7. **새 action 추가 시**: `api.php`의 스위치 → `CctvController::dispatch()` → 핸들러 메서드 → `CctvModel` 순으로 추가합니다.
