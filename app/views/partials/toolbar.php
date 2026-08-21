<!-- Top Chrome: 이력 조회 필터 (history 모드) / 카메라 필터 (card/list 모드) -->
<div class="top-chrome">

    <!-- 이력 조회 필터바 (history 모드에서만 표시) -->
    <div id="history-filter-bar" style="display: none; flex-direction: column; gap: 0;">

        <!-- 타입 탭 버튼 -->
        <div style="display: flex; align-items: center; gap: 0; border-bottom: 1px solid rgba(255,255,255,0.07); padding: 0 4px;">
            <button id="hist-tab-all"    class="hist-tab-btn active" onclick="setHistoryTab('')">
                <i class="fa-solid fa-list"></i> 전체
            </button>
            <button id="hist-tab-deploy" class="hist-tab-btn" onclick="setHistoryTab('deploy')">
                <i class="fa-solid fa-server"></i> cctv.info 배포 작업
            </button>
            <button id="hist-tab-ddns"   class="hist-tab-btn" onclick="setHistoryTab('ddns_update')">
                <i class="fa-solid fa-arrows-rotate"></i> DDNS 주소 조회
            </button>
            <button id="hist-tab-env"    class="hist-tab-btn" onclick="setHistoryTab('env_config')">
                <i class="fa-solid fa-cogs"></i> 모니터링 환경 설정 변경
            </button>
            <button id="hist-tab-restart" class="hist-tab-btn" onclick="setHistoryTab('cctv_relay_restart')">
                <i class="fa-solid fa-arrows-spin"></i> cctv-relay 재기동 이력
            </button>
            <!-- 우측: 보조 필터 -->
            <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 8px 0;">
                <select class="select-input" id="history-status-filter" onchange="applyHistoryFilters()" style="height: 32px; font-size: 0.8rem; padding: 0 10px;">
                    <option value="">결과 전체</option>
                    <option value="success">성공</option>
                    <option value="partial">부분 성공</option>
                    <option value="fail">실패</option>
                </select>
                <input type="date" class="text-input" id="history-date-from" onchange="applyHistoryFilters()" style="height: 32px; font-size: 0.8rem; padding: 0 10px;">
                <span style="color: #64748b; font-size: 0.8rem;">~</span>
                <input type="date" class="text-input" id="history-date-to" onchange="applyHistoryFilters()" style="height: 32px; font-size: 0.8rem; padding: 0 10px;">
                <button class="btn" onclick="resetHistoryFilters()" style="height: 32px; font-size: 0.8rem; padding: 0 12px;">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        </div>
    </div>

    <!-- 기존 툴바 (card/list 모드) -->
    <div id="cam-filter-top-bar" class="top-bar">
        <div class="toolbar" style="flex: 1; margin-bottom: 0;">
            <div class="filter-group">
                <button class="btn" onclick="manualRefreshCameras()"><i class="fa-solid fa-rotate-left"></i> 캠 새로고침</button>
                <button class="btn" onclick="resetFilters()">필터 초기화</button>
            </div>
            <div class="filter-group" style="align-items: center;">
                <div id="paging-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
            </div>
        </div>
    </div>

    <div id="cam-filter-search-bar" class="toolbar shared-filter-bar" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div class="filter-group" style="flex: 1; max-width: 600px; margin-right: 24px;">
            <input type="text" class="text-input" id="search-input" placeholder="카메라/종목 검색" oninput="applyFilters()" style="width: 100%;">
        </div>
        <div class="filter-group" style="display: flex; gap: 10px; align-items: center; justify-content: flex-end; flex-shrink: 0;">
            <select class="select-input" id="stadium-filter" onchange="applyFilters()">
                <option value="">-- 경기장 선택 (전체) --</option>
            </select>
            <select class="select-input" id="status-filter" onchange="applyFilters()">
                <option value="">-- 상태 선택 (전체) --</option>
                <option value="ACTIVE">경기 진행 중만</option>
                <option value="STOPPED">작동 중지만</option>
                <option value="INSPECTION">점검중만</option>
            </select>
            <select class="select-input" id="segment-filter" onchange="applyFilters()">
                <option value="">-- 수신 상태 (전체) --</option>
                <option value="OK">갱신 OK만</option>
                <option value="WARNING">비갱신 (지연)만</option>
                <option value="CRITICAL">비갱신 (중단)만</option>
                <option value="WAITING">수신 대기중만</option>
            </select>
            <div class="selection-pill">
                <input type="checkbox" id="select-all-cb" onchange="toggleSelectAllVisible()" style="width: 16px; height: 16px; cursor: pointer;">
                <label for="select-all-cb" id="select-all-label">현재 페이지 모두 선택</label>
                <span class="selection-meta" id="select-all-meta"></span>
            </div>
        </div>
    </div>
</div>
