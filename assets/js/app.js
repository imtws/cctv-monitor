/* ==========================================================
   CCTV 관제 시스템 - 메인 애플리케이션 JS
   ========================================================== */

/* ── 전역 상태 ─────────────────────────────────────────── */
let allCctvs          = [];
let alertConfig       = {};
let activePageFilter  = 'all';
let selectedCamIds    = new Set();
let hlsInstances      = {};
let listPreviewHls    = {};
let listExpandedIds   = new Set();
let modalHls          = null;
let settingsDrawerMode = 'batch';
let settingsDrawerIds  = [];
let currentViewMode   = 'card';
let lastFragLoaded    = {}; // 각 캠 ID별 마지막 세그먼트 로드 타임스탬프 저장
let cardObserver      = null; // IntersectionObserver for lazy HLS
let isInitialLoad     = true; // 첫 데이터 로드 여부


/* ═══════════════════════════════════════════════════════════
   레이아웃 / 뷰 모드
   ═══════════════════════════════════════════════════════════ */

function updateStickyOffsets() {
    const header          = document.querySelector('header');
    const topChrome       = document.querySelector('.top-chrome');
    const listHeader      = document.querySelector('.list-header');
    const listVeil        = document.querySelector('.list-veil');
    const root            = document.documentElement;

    const headerHeight    = header       ? header.offsetHeight       : 0;
    const topChromeHeight = topChrome    ? topChrome.offsetHeight    : 0;
    const listHeaderHeight = listHeader  ? listHeader.offsetHeight   : 0;
    const listHeaderTop   = headerHeight + topChromeHeight;

    root.style.setProperty('--sticky-header-top', `${headerHeight}px`);
    root.style.setProperty('--sticky-list-top',   `${listHeaderTop}px`);
    root.style.setProperty('--list-veil-top',     `${listHeaderTop}px`);
    root.style.setProperty('--list-veil-height',  `${listHeaderHeight + 16}px`);

    if (listVeil) {
        listVeil.style.top    = `${listHeaderTop}px`;
        listVeil.style.height = `${listHeaderHeight + 16}px`;
    }
}

function setViewMode(mode) {
    currentViewMode = mode;
    
    const btnCard    = document.getElementById('btn-card-view');
    const btnList    = document.getElementById('btn-list-view');
    const btnDeploy  = document.getElementById('btn-deploy-view');
    const btnHistory = document.getElementById('btn-history-view');
    
    btnCard?.classList.toggle('active', mode === 'card');
    btnList?.classList.toggle('active', mode === 'list');
    btnDeploy?.classList.toggle('active', mode === 'deploy');
    btnHistory?.classList.toggle('active', mode === 'history');

    const cardPanel    = document.getElementById('card-panel');
    const listPanel    = document.getElementById('list-panel');
    const deployPanel  = document.getElementById('deploy-panel');
    const historyPanel = document.getElementById('history-panel');

    if (cardPanel)    cardPanel.style.display    = (mode === 'card')    ? 'block' : 'none';
    if (listPanel)    listPanel.style.display    = (mode === 'list')    ? 'block' : 'none';
    if (deployPanel)  deployPanel.style.display  = (mode === 'deploy')  ? 'block' : 'none';
    if (historyPanel) historyPanel.style.display = (mode === 'history') ? 'block' : 'none';

    // 툴바 표시/숨김
    const historyBar    = document.getElementById('history-filter-bar');
    const camTopBar     = document.getElementById('cam-filter-top-bar');
    const camSearchBar  = document.getElementById('cam-filter-search-bar');
    const isHistory     = (mode === 'history');
    const isDeploy      = (mode === 'deploy');
    if (historyBar)   historyBar.style.display   = isHistory ? 'flex' : 'none';
    if (camTopBar)    camTopBar.style.display     = (isHistory || isDeploy) ? 'none' : '';
    if (camSearchBar) camSearchBar.style.display  = (isHistory || isDeploy) ? 'none' : '';

    Object.values(hlsInstances).forEach(hls => hls.destroy());
    hlsInstances = {};
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }

    if (mode === 'card') {
        document.body.classList.remove('list-mode');
        document.body.classList.remove('deploy-mode');
        document.body.classList.add('card-mode');
        renderVideoGrid();
    } else if (mode === 'list') {
        document.body.classList.add('list-mode');
        document.body.classList.remove('card-mode');
        document.body.classList.remove('deploy-mode');
        renderTable();
    } else if (mode === 'deploy') {
        document.body.classList.remove('list-mode');
        document.body.classList.remove('card-mode');
        document.body.classList.add('deploy-mode');
        const subTab = document.getElementById('btn-sub-deploy-relay')?.classList.contains('active') ? 'relay' : 'info';
        if (subTab === 'relay') {
            loadRelayRestartData();
        } else {
            loadDeployTableData();
        }
    } else if (mode === 'history') {
        document.body.classList.remove('list-mode');
        document.body.classList.remove('card-mode');
        document.body.classList.remove('deploy-mode');
        // 탭 상태 초기화 후 데이터 로드
        currentHistTab = '';
        ['hist-tab-all','hist-tab-deploy','hist-tab-ddns','hist-tab-env','hist-tab-restart'].forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', i === 0);
        });
        loadHistoryData();
    }
    requestAnimationFrame(updateStickyOffsets);
}

/* ═══════════════════════════════════════════════════════════
   페이징 / 필터
   ═══════════════════════════════════════════════════════════ */

function renderPagingButtons() {
    const container = document.getElementById('paging-buttons');
    container.innerHTML = '';

    let maxNum = 0;
    allCctvs.forEach(c => { if (c.num > maxNum) maxNum = c.num; });
    if (maxNum === 0) return;

    const allBtn = document.createElement('button');
    allBtn.className = `btn ${activePageFilter === 'all' ? 'btn-primary' : ''}`;
    allBtn.textContent = '전체 보기';
    allBtn.onclick = () => setPageFilter('all');
    container.appendChild(allBtn);

    const totalPages = Math.ceil(maxNum / 10);
    for (let i = 0; i < totalPages; i++) {
        const start = i * 10 + 1;
        let   end   = (i + 1) * 10;
        if (end > maxNum) end = maxNum;

        const filterStr = `${start}-${end}`;
        const btn = document.createElement('button');
        btn.className  = `btn ${activePageFilter === filterStr ? 'btn-primary' : ''}`;
        btn.textContent = `CAM ${start}~${end}`;
        btn.onclick = () => setPageFilter(filterStr);
        container.appendChild(btn);
    }
}

function setPageFilter(filter) {
    activePageFilter = filter;
    renderPagingButtons();
    if (currentViewMode === 'card') renderVideoGrid();
    else renderTable();
}

function setStatusFilter(status) {
    document.getElementById('status-filter').value = status;
    applyFilters();
}

function getSegmentStatus(cam) {
    if (!cam || !cam.live_status) return 'WAITING';
    const status = cam.live_status;
    const diffSec = Math.floor(Date.now() / 1000) - status.checked_at;
    const elapsedSec = (status.file_age !== null) ? (status.file_age + diffSec) : diffSec;
    if (status.rc === 2 || status.rc === 3 || elapsedSec >= 300) {
        return 'CRITICAL';
    } else if (elapsedSec >= 120) {
        return 'WARNING';
    } else {
        return 'OK';
    }
}

function resetFilters() {
    activePageFilter = 'all';
    const statusFilter  = document.getElementById('status-filter');
    const searchInput   = document.getElementById('search-input');
    const stadiumFilter = document.getElementById('stadium-filter');
    const segmentFilter = document.getElementById('segment-filter');
    if (statusFilter)  statusFilter.value  = '';
    if (searchInput)   searchInput.value   = '';
    if (stadiumFilter) stadiumFilter.value = '';
    if (segmentFilter) segmentFilter.value = '';
    renderPagingButtons();
    renderCurrentView();
}

function applyFilters() { renderCurrentView(); }

function getFilteredCctvs() {
    let list = [...allCctvs];
    if (activePageFilter !== 'all') {
        const [start, end] = activePageFilter.split('-').map(Number);
        list = list.filter(c => c.num >= start && c.num <= end);
    }

    const sStatus = document.getElementById('status-filter').value;
    if (sStatus) list = list.filter(c => c.status === sStatus);

    const sSegment = document.getElementById('segment-filter') ? document.getElementById('segment-filter').value : '';
    if (sSegment) list = list.filter(c => getSegmentStatus(c) === sSegment);

    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (query) {
        list = list.filter(c => {
            const haystack = [c.id, c.num, c.category, c.ddns, getStatusLabel(c.status)]
                .map(v => String(v || '').toLowerCase()).join(' ');
            return haystack.includes(query);
        });
    }

    const stadiumFilter = document.getElementById('stadium-filter');
    const stadiumValue  = stadiumFilter ? stadiumFilter.value : '';
    if (stadiumValue) list = list.filter(c => c.stadium === stadiumValue);
    return list;
}

/* ═══════════════════════════════════════════════════════════
   데이터 로드
   ═══════════════════════════════════════════════════════════ */

async function loadData(forceFullRender = false) {
    try {
        const res  = await fetch('api.php?action=get_data&_t=' + new Date().getTime());
        const data = await res.json();
        if (data.success) {
            const prevCctvs = allCctvs;
            allCctvs    = data.cctvs;
            alertConfig = data.alert;
            const validIds = new Set(allCctvs.map(c => c.id));
            selectedCamIds = new Set(Array.from(selectedCamIds).filter(id => validIds.has(id)));

            updateSummaryBadges();
            populateStadiumFilter();
            renderPagingButtons();

            if (isInitialLoad || forceFullRender === true) {
                // 최초 로드 또는 수동 새로고침: 전체 렌더 (HLS 재연결)
                isInitialLoad = false;
                renderCurrentView();
            } else {
                // 폴링 갱신: DOM/HLS 유지하면서 변경된 부분만 패치
                if (currentViewMode === 'card') {
                    patchCardView(prevCctvs, allCctvs);
                } else if (currentViewMode === 'list') {
                    renderTable(); // 리스트는 HLS를 펼쳤을 때만 로드하므로 재렌더 OK
                } else {
                    renderCurrentView();
                }
            }

            updateStickyOffsets();
            return true;
        }
    } catch (e) {
        showToast('데이터 로딩 실패');
    }
    return false;
}

/** 툴바 '캠 새로고침': 최신 상태를 받아 화면을 다시 그리고 스트림을 재연결 */
async function manualRefreshCameras() {
    const ok = await loadData(true);
    if (ok) showToast('카메라 상태를 새로고침했습니다.');
}

/**
 * 카드뷰에서 폴링 시 변경된 카드의 배지·상태만 업데이트.
 * HLS 인스턴스는 건드리지 않아 재생이 끊기지 않음.
 */
function patchCardView(prevCctvs, nextCctvs) {
    const prevMap = Object.fromEntries(prevCctvs.map(c => [c.id, c]));
    const filtered = getFilteredCctvs();
    const filteredIds = new Set(filtered.map(c => c.id));

    // 필터 결과 집합이 바뀌었으면 전체 재렌더
    const prevFiltered = getFilteredCctvsList(prevCctvs);
    const prevFilteredIds = new Set(prevFiltered.map(c => c.id));
    if (filteredIds.size !== prevFilteredIds.size ||
        ![...filteredIds].every(id => prevFilteredIds.has(id))) {
        renderVideoGrid();
        return;
    }

    // 변경된 카드만 업데이트
    nextCctvs.forEach(cam => {
        const old = prevMap[cam.id];
        const card = document.querySelector(`.video-card[data-cam-id="${cam.id}"]`);
        if (!card) return;

        // 상태 클래스 갱신
        if (!old || old.status !== cam.status) {
            card.className = `video-card status-${(cam.status || 'ACTIVE').toLowerCase()}`;
            const statusChip = card.querySelector('.status-chip');
            if (statusChip) statusChip.innerHTML = getStatusMarkup(cam.status);
        }

        // 스케줄 뱃지 갱신
        if (!old || old.suppress_until !== cam.suppress_until) {
            const scheduleChip = card.querySelector('.schedule-chip');
            if (scheduleChip) scheduleChip.innerHTML = getScheduleMarkup(cam);
        }

        // 세그먼트 배지 갱신
        updateSegmentUI(cam.id);

        // stale 상태 전환 체크 (정상→stale 또는 stale→정상)
        const wasStale = old ? (isCamStaleFromData(old) || !old.ddns || !old.ddns.trim()) : false;
        const nowStale = isCamStale(cam.id) || !cam.ddns || !cam.ddns.trim();
        if (wasStale !== nowStale) {
            // stale 상태가 바뀐 경우만 wrapper 내부 재렌더 후 HLS 재연결
            refreshCardWrapper(cam);
        }
    });
}

/** patchCardView에서 이전 데이터로 stale 여부를 판단할 때 사용 */
function isCamStaleFromData(cam) {
    if (!cam || !cam.live_status) return false;
    const status = cam.live_status;
    const diffSec = Math.floor(Date.now() / 1000) - status.checked_at;
    const elapsedSec = (status.file_age !== null) ? (status.file_age + diffSec) : diffSec;
    return elapsedSec >= 300;
}

/** stale 상태가 전환된 카드의 wrapper(영상 영역)만 교체하고 HLS 재연결 */
function refreshCardWrapper(cam) {
    const wrapper = document.getElementById(`wrapper-${cam.id}`);
    if (!wrapper) return;

    // 기존 HLS 정리
    if (hlsInstances[cam.id]) {
        hlsInstances[cam.id].destroy();
        delete hlsInstances[cam.id];
    }

    const streamUrl = getStreamUrl(cam.id);
    const isStale   = isCamStale(cam.id) || !cam.ddns || !cam.ddns.trim();
    const checkbox  = wrapper.querySelector('.cam-multi-check');
    const isChecked = checkbox ? checkbox.checked : selectedCamIds.has(cam.id);

    wrapper.innerHTML = `
        <input type="checkbox" class="cam-multi-check" value="${cam.id}" ${isChecked ? 'checked' : ''} onchange="toggleCameraSelection(this)" style="position: absolute; top: 10px; left: 10px; z-index: 10; width: 20px; height: 20px; cursor: pointer;">
        ${isStale ? `
            <div class="video-stale-placeholder" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1a1a1a; color: #888; font-size: 0.85rem; gap: 6px;">
                <i class="fa-solid fa-video-slash" style="font-size: 1.2rem;"></i>
                <span>5분 이상 cam 서버 내 ffmpeg 미갱신(영상 Load X)</span>
            </div>
        ` : `
            <video id="vid-${cam.id}" autoplay muted controls playsinline></video>
        `}
    `;

    if (!isStale) {
        const videoEl = document.getElementById(`vid-${cam.id}`);
        if (videoEl && Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true });
            hls.loadSource(streamUrl);
            hls.attachMedia(videoEl);
            hlsInstances[cam.id] = hls;
        } else if (videoEl && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = streamUrl;
        }
    }
}

/** 이전 allCctvs 기준으로 필터 결과 반환 (patchCardView 내부용) */
function getFilteredCctvsList(cctvList) {
    let list = [...cctvList];
    if (activePageFilter !== 'all') {
        const [start, end] = activePageFilter.split('-').map(Number);
        list = list.filter(c => c.num >= start && c.num <= end);
    }
    const sStatus = document.getElementById('status-filter')?.value || '';
    if (sStatus) list = list.filter(c => c.status === sStatus);
    const sSegment = document.getElementById('segment-filter')?.value || '';
    if (sSegment) list = list.filter(c => getSegmentStatus(c) === sSegment);
    const query = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    if (query) {
        list = list.filter(c => {
            const h = [c.id, c.num, c.category, c.ddns, getStatusLabel(c.status)]
                .map(v => String(v || '').toLowerCase()).join(' ');
            return h.includes(query);
        });
    }
    const sv = document.getElementById('stadium-filter')?.value || '';
    if (sv) list = list.filter(c => c.stadium === sv);
    return list;
}

function updateSummaryBadges() {
    let active = 0, stopped = 0, inspection = 0;
    allCctvs.forEach(c => {
        if (c.status === 'ACTIVE')      active++;
        else if (c.status === 'STOPPED')    stopped++;
        else if (c.status === 'INSPECTION') inspection++;
    });
    // 필요 시 헤더 배지에 표시 가능
    void active; void stopped; void inspection;
}

function populateStadiumFilter() {
    const stadiums = [...new Set(allCctvs.map(c => c.stadium))];
    const select   = document.getElementById('stadium-filter');
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '<option value="">-- 경기장 선택 (전체) --</option>';
    stadiums.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        select.appendChild(opt);
    });
    if (previousValue && stadiums.includes(previousValue)) select.value = previousValue;
    syncMasterSelection();
}

/* ═══════════════════════════════════════════════════════════
   선택 관리
   ═══════════════════════════════════════════════════════════ */

function getVisibleSelectionCheckboxes() {
    const panelSelector = currentViewMode === 'card' ? '#card-panel' : '#list-panel';
    const panel = document.querySelector(panelSelector);
    if (!panel || panel.style.display === 'none') return [];
    return Array.from(panel.querySelectorAll('.cam-multi-check'));
}

function syncMasterCheckboxes(checked, indeterminate) {
    ['select-all-cb', 'table-select-all'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.checked       = !!checked;
        el.indeterminate = !!indeterminate;
    });
}

function updateSelectAllLabel(checkedCount, visibleCount) {
    const label = document.getElementById('select-all-label');
    const meta  = document.getElementById('select-all-meta');
    if (!label || !meta) return;
    if (visibleCount === 0) {
        label.textContent = '현재 페이지 모두 선택';
        meta.textContent  = '';
        return;
    }
    if (checkedCount > 0 && checkedCount < visibleCount) {
        label.textContent = `현재 페이지 ${checkedCount}/${visibleCount} 선택`;
        meta.textContent  = '부분 선택';
        return;
    }
    label.textContent = '현재 페이지 모두 선택';
    meta.textContent  = checkedCount === visibleCount && visibleCount > 0 ? `${visibleCount}개 전체` : '';
}

function getVisibleCctvs() { return getFilteredCctvs(); }

function getVisibleSelectedIds() {
    return getVisibleSelectionCheckboxes().filter(cb => cb.checked).map(cb => cb.value);
}

function syncMasterSelection() {
    const visibleCheckboxes = getVisibleSelectionCheckboxes();
    const checkedCount      = visibleCheckboxes.filter(cb => cb.checked).length;
    const allChecked        = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
    const partialChecked    = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
    syncMasterCheckboxes(allChecked, partialChecked);
    updateSelectAllLabel(checkedCount, visibleCheckboxes.length);
}

function toggleCameraSelection(cb) {
    if (!cb) return;
    if (cb.checked) selectedCamIds.add(cb.value);
    else            selectedCamIds.delete(cb.value);
    syncMasterSelection();
}

function toggleSelectAllVisible() {
    const master    = document.getElementById('select-all-cb');
    const isChecked = !!(master && master.checked);
    setVisibleSelectionState(isChecked);
    syncMasterSelection();
}

function setVisibleSelectionState(isChecked) {
    getVisibleSelectionCheckboxes().forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) selectedCamIds.add(cb.value);
        else           selectedCamIds.delete(cb.value);
    });
}

function toggleCheckAll(master) {
    const isChecked = !!(master && master.checked);
    setVisibleSelectionState(isChecked);
    syncMasterSelection();
}

/* ═══════════════════════════════════════════════════════════
   렌더링
   ═══════════════════════════════════════════════════════════ */

function renderCurrentView() {
    if (currentViewMode === 'card') renderVideoGrid();
    else if (currentViewMode === 'list') renderTable();
    else if (currentViewMode === 'deploy') {
        const subTab = document.getElementById('btn-sub-deploy-relay')?.classList.contains('active') ? 'relay' : 'info';
        if (subTab === 'relay') loadRelayRestartData();
        else loadDeployTableData();
    }
}

function getStreamUrl(camId) {
    return `http://${camId}.example.com:8080/hls/webcam.m3u8`;
}

function getSafeExternalUrl(url) {
    const value = String(url || '').trim();
    return /^https?:\/\//i.test(value) ? value : '';
}

function renderVideoGrid() {
    const container = document.getElementById('video-grid-container');
    if (!container) return;
    if (currentViewMode !== 'card') { container.innerHTML = ''; return; }
    clearListPreviews();

    // 기존 Observer 및 HLS 인스턴스 정리
    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }
    Object.values(hlsInstances).forEach(hls => hls.destroy());
    hlsInstances = {};

    const filtered = getFilteredCctvs();
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-sub);">해당하는 카메라가 없습니다.</div>';
        return;
    }

    // IntersectionObserver: 카드가 뷰포트에 들어오면 HLS 시작, 나가면 정지
    cardObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const camId = entry.target.dataset.camId;
            if (!camId) return;
            const cam = allCctvs.find(c => c.id === camId);
            if (!cam) return;
            const isStale = isCamStale(camId) || !cam.ddns || !cam.ddns.trim();
            if (isStale) return; // stale 카드는 HLS 없음

            if (entry.isIntersecting) {
                // 뷰포트 진입 → HLS 시작
                if (!hlsInstances[camId]) {
                    const videoEl = document.getElementById(`vid-${camId}`);
                    if (videoEl) {
                        if (Hls.isSupported()) {
                            const hls = new Hls({ enableWorker: true });
                            hls.loadSource(getStreamUrl(camId));
                            hls.attachMedia(videoEl);
                            hlsInstances[camId] = hls;
                        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
                            videoEl.src = getStreamUrl(camId);
                        }
                    }
                }
            } else {
                // 뷰포트 이탈 → HLS 일시정지 (destroy는 하지 않아 빠른 복귀 가능)
                const videoEl = document.getElementById(`vid-${camId}`);
                if (videoEl && !videoEl.paused) videoEl.pause();
            }
        });
    }, {
        rootMargin: '300px 0px', // 스크롤 300px 전에 미리 로드
        threshold: 0
    });

    filtered.forEach(cam => {
        const card = document.createElement('div');
        const cardStatus = (cam.status || 'ACTIVE').toLowerCase();
        card.className = `video-card status-${cardStatus}`;
        card.dataset.camId = cam.id; // patchCardView / Observer 용
        const streamUrl = getStreamUrl(cam.id);
        const isStale = isCamStale(cam.id) || !cam.ddns || !cam.ddns.trim();
        card.innerHTML = `
            <div class="video-wrapper" id="wrapper-${cam.id}" style="display: block; position: relative;">
                <input type="checkbox" class="cam-multi-check" value="${cam.id}" ${selectedCamIds.has(cam.id) ? 'checked' : ''} onchange="toggleCameraSelection(this)" style="position: absolute; top: 10px; left: 10px; z-index: 10; width: 20px; height: 20px; cursor: pointer;">
                ${isStale ? `
                    <div class="video-stale-placeholder" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1a1a1a; color: #888; font-size: 0.85rem; gap: 6px;">
                        <i class="fa-solid fa-video-slash" style="font-size: 1.2rem;"></i>
                        <span>5분 이상 cam 서버 내 ffmpeg 미갱신(영상 Load X)</span>
                    </div>
                ` : `
                    <video id="vid-${cam.id}" autoplay muted controls playsinline></video>
                `}
            </div>
            <div class="card-body">
                <div class="card-header-info" style="gap: 10px; align-items: flex-start;">
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                        <div class="cam-title">CAM ${cam.num < 10 ? '0' + cam.num : cam.num} - ${cam.category}</div>
                        <div class="cam-stadium">${cam.stadium}</div>
                        <div class="status-chip">${getStatusMarkup(cam.status)}</div>
                        <div class="segment-chip" id="seg-badge-${cam.id}">${getSegmentMarkup(cam.id)}</div>
                        <div class="schedule-chip">${getScheduleMarkup(cam)}</div>
                    </div>
                    <a href="${cam.ddns}" target="_blank" class="btn" style="padding: 2px 8px; font-size: 0.75rem;" title="DDNS"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                </div>
                <div class="card-actions">
                    <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" title="설정"><i class="fa-solid fa-gear"></i></button>
                    <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')" title="확대"><i class="fa-solid fa-expand"></i></button>
                </div>
            </div>
        `;
        card.addEventListener('click', (e) => {
            if (e.target.closest('input, button, a, video')) return;
            const cb = card.querySelector('.cam-multi-check');
            if (cb) {
                cb.checked = !cb.checked;
                toggleCameraSelection(cb);
            }
        });
        container.appendChild(card);

        // HLS는 Observer에게 위임 (직접 초기화 X)
        cardObserver.observe(card);
    });

    syncMasterSelection();
    updateStickyOffsets();
}

function renderTable() {
    try {
        const tbody = document.getElementById('cam-table-body');
        if (!tbody) return;
        clearListPreviews();
        tbody.innerHTML = '';

        const filtered = getFilteredCctvs();
        filtered.forEach(cam => {
            const group = document.createElement('div');
            group.className = 'list-item-group';
            if (listExpandedIds.has(cam.id)) group.classList.add('open');
            group.dataset.camId = cam.id;
            const streamUrl = getStreamUrl(cam.id);
            group.innerHTML = `
                <div class="list-row monitor-item">
                    <div class="col-check">
                        <input type="checkbox" class="cam-checkbox cam-multi-check" value="${cam.id}" ${selectedCamIds.has(cam.id) ? 'checked' : ''} onchange="toggleCameraSelection(this)" style="width: 16px; height: 16px; cursor: pointer;">
                    </div>
                    <div class="col-camera">
                        <strong style="color:#fff;">CAM ${cam.num < 10 ? '0' + cam.num : cam.num}</strong>
                        <div class="mini-meta">
                            <span class="mini-tag">${cam.stadium}</span>
                            <span class="mini-tag">${cam.category}</span>
                        </div>
                        <div class="segment-chip" id="list-seg-badge-${cam.id}">${getSegmentMarkup(cam.id)}</div>
                        <div class="schedule-chip">${getScheduleMarkup(cam)}</div>
                    </div>
                    <div class="col-stadium">${cam.stadium}</div>
                    <div class="col-category">${cam.category}</div>
                    <div class="col-status"><span class="status-chip">${getStatusMarkup(cam.status)}</span></div>
                    <div class="col-actions">
                        <a href="${cam.ddns}" target="_blank" rel="noopener noreferrer" class="btn" title="DDNS"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                        <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" title="설정"><i class="fa-solid fa-gear"></i></button>
                        <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')" title="확대"><i class="fa-solid fa-expand"></i></button>
                        <button class="btn list-toggle" onclick="toggleListRow('${cam.id}')" title="펼치기/접기"><i class="fa-solid ${listExpandedIds.has(cam.id) ? 'fa-chevron-up' : 'fa-chevron-down'}"></i></button>
                    </div>
                </div>
                <div class="list-detail">
                    <div class="list-detail-grid">
                        <div class="list-preview" style="position: relative;">
                            <video id="list-vid-${cam.id}" autoplay muted controls playsinline></video>
                        </div>
                        <div class="list-detail-meta">
                            <div class="list-detail-hero">
                                <div class="list-detail-title">
                                    <strong>CAM ${cam.num < 10 ? '0' + cam.num : cam.num}</strong>
                                    <span>${escapeHtml(cam.id)}</span>
                                </div>
                                <div class="list-detail-subtitle">${escapeHtml(cam.category)} · ${escapeHtml(cam.stadium)}</div>
                            </div>
                            <div class="list-detail-mini">
                                <div class="detail-card"><label>상태</label><div class="value">${escapeHtml(getStatusLabel(cam.status))}</div></div>
                                <div class="detail-card"><label>세그먼트 갱신</label><div class="value small" id="detail-seg-badge-${cam.id}">${getSegmentMarkup(cam.id)}</div></div>
                                ${(() => { const sup = cam.suppress_until ? new Date(cam.suppress_until) : null; if (sup && sup > new Date()) { return `<div class="detail-card" style="border-color:rgba(245,158,11,0.4);"><label style="color:#f59e0b;">스케줄</label><div class="value small" style="color:#f59e0b;">스케줄~${sup.toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div></div>`; } return ''; })()}
                                <div class="detail-card"><label>DDNS</label><div class="value small">
                                    ${getSafeExternalUrl(cam.ddns)
                                        ? `<a href="${escapeHtml(cam.ddns)}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd; text-decoration:underline;">${escapeHtml(cam.ddns)}</a>`
                                        : '-'}
                                </div></div>
                            </div>
                        </div>
                        <div class="list-detail-actions">
                            <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" title="설정"><i class="fa-solid fa-gear"></i> 설정</button>
                            <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')"><i class="fa-solid fa-expand"></i> 확대</button>
                        </div>
                    </div>
                </div>
            `;
            tbody.appendChild(group);

            const row = group.querySelector('.list-row');
            if (row) {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input, button, a')) return;
                    const cb = row.querySelector('.cam-multi-check');
                    if (cb) {
                        cb.checked = !cb.checked;
                        toggleCameraSelection(cb);
                    }
                });
            }

            if (listExpandedIds.has(cam.id)) {
                loadListPreview(cam.id, streamUrl, false);
            }
        });

        syncMasterSelection();
        updateStickyOffsets();
    } catch (err) {
        console.error("renderTable error:", err);
        showToast("리스트 렌더링 오류: " + err.message);
    }
}

/* ═══════════════════════════════════════════════════════════
   상태 / 스케줄 헬퍼
   ═══════════════════════════════════════════════════════════ */

function getStatusLabel(s) {
    if (s === 'ACTIVE')     return '경기 진행 중';
    if (s === 'STOPPED')    return '작동 중지';
    if (s === 'INSPECTION') return '점검중';
    return s;
}

function getStatusMarkup(s) {
    const statusClass = `status-chip-${(s || '').toLowerCase()}`;
    if (s === 'ACTIVE')     return `<span class="status-badge ${statusClass}"><i class="fa-solid fa-circle status-dot"></i>경기 진행 중</span>`;
    if (s === 'STOPPED')    return `<span class="status-badge ${statusClass}"><i class="fa-solid fa-circle status-dot"></i>작동 중지</span>`;
    if (s === 'INSPECTION') return `<span class="status-badge ${statusClass}"><i class="fa-solid fa-circle status-dot"></i>점검중</span>`;
    return `<span class="status-badge">${escapeHtml(String(s || ''))}</span>`;
}

function getScheduleMarkup(cam) {
    const now = new Date();
    const sup = cam.suppress_until ? new Date(cam.suppress_until) : null;
    const isScheduled = sup && sup > now;

    if (!isScheduled) return '';

    const untilStr = sup.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
    return `<span class="schedule-pill suppressed" title="알람 스케줄: ${sup.toLocaleString('ko-KR')}까지">
        <i class="fa-regular fa-clock"></i>
        <span>스케줄~${escapeHtml(untilStr)}</span>
    </span>`;
}

/* ═══════════════════════════════════════════════════════════
   HLS / 비디오 관리
   ═══════════════════════════════════════════════════════════ */

function loadListPreview(camId, streamUrl, forceReload = false) {
    const videoEl = document.getElementById(`list-vid-${camId}`);
    if (!videoEl) return;
    if (listPreviewHls[camId] && forceReload) {
        listPreviewHls[camId].destroy();
        delete listPreviewHls[camId];
    }
    if (listPreviewHls[camId]) return;

    const cam = allCctvs.find(c => c.id === camId);
    const isStale = isCamStale(camId) || !cam || !cam.ddns || !cam.ddns.trim();

    let placeholder = videoEl.parentElement.querySelector('.list-preview-stale');

    if (isStale) {
        videoEl.style.display = 'none';
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'list-preview-stale';
            placeholder.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1a1a1a; color: #888; font-size: 0.85rem; gap: 6px;';
            placeholder.innerHTML = `
                <i class="fa-solid fa-video-slash" style="font-size: 1.2rem;"></i>
                <span>5분 이상 cam 서버 내 ffmpeg 미갱신(영상 Load X)</span>
            `;
            videoEl.parentElement.appendChild(placeholder);
        }
        placeholder.style.display = 'flex';
        return;
    } else {
        videoEl.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
    }

    if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hls.loadSource(streamUrl);
        hls.attachMedia(videoEl);
        listPreviewHls[camId] = hls;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = streamUrl;
    }
}

function stopListPreview(camId) {
    const videoEl = document.getElementById(`list-vid-${camId}`);
    if (listPreviewHls[camId]) {
        listPreviewHls[camId].destroy();
        delete listPreviewHls[camId];
    }
    if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.load();
    }
}

function clearListPreviews() {
    Object.keys(listPreviewHls).forEach(camId => stopListPreview(camId));
}

function toggleListRow(camId) {
    const group = document.querySelector(`.list-item-group[data-cam-id="${camId}"]`);
    if (!group) return;
    const isOpen = group.classList.toggle('open');
    const btn    = group.querySelector('.list-toggle i');
    if (btn) btn.className = `fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`;
    if (isOpen) {
        listExpandedIds.add(camId);
        loadListPreview(camId, getStreamUrl(camId), false);
    } else {
        listExpandedIds.delete(camId);
        stopListPreview(camId);
    }
}

/* ═══════════════════════════════════════════════════════════
   모달 (영상 팝업)
   ═══════════════════════════════════════════════════════════ */

function openModal(camId, category, streamUrl) {
    document.getElementById('modal-title').textContent = `CAM ${camId.toUpperCase()} - ${category} (실시간 원본 뷰어)`;
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('modal-video');
    modal.style.display = 'flex';

    if (modalHls) { modalHls.destroy(); modalHls = null; }

    const cam = allCctvs.find(c => c.id === camId);
    const isStale = isCamStale(camId) || !cam || !cam.ddns || !cam.ddns.trim();
    let placeholder = video.parentElement.querySelector('.modal-stale-placeholder');
    if (isStale) {
        video.style.display = 'none';
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'modal-stale-placeholder';
            placeholder.style.cssText = 'width:100%; height:400px; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#1a1a1a; color:#888; font-size:1.1rem; gap:10px; border-radius:4px;';
            placeholder.innerHTML = `<i class="fa-solid fa-video-slash" style="font-size:2rem;"></i><span>5분 이상 cam 서버 내 ffmpeg 미갱신으로 도메인 접근을 제한했습니다.(영상 Load X)</span>`;
            video.parentElement.appendChild(placeholder);
        }
        placeholder.style.display = 'flex';
        return;
    } else {
        video.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
    }

    if (Hls.isSupported()) {
        modalHls = new Hls();
        modalHls.loadSource(streamUrl);
        modalHls.attachMedia(video);
    } else {
        video.src = streamUrl;
    }
}

function closeModal() {
    const modal = document.getElementById('player-modal');
    const video = document.getElementById('modal-video');
    if (modalHls) { modalHls.destroy(); modalHls = null; }
    video.pause(); video.src = '';
    const placeholder = video.parentElement.querySelector('.modal-stale-placeholder');
    if (placeholder) placeholder.style.display = 'none';
    modal.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════
   설정 드로어
   ═══════════════════════════════════════════════════════════ */

function openBatchSettingsModal() {
    const checked = getVisibleSelectedIds();
    if (checked.length === 0) { showToast('선택한 카메라가 없습니다.'); return; }
    openSettingsDrawer('batch', checked);
}

function openItemSettingsModal(camId) {
    selectedCamIds = new Set([camId]);
    document.querySelectorAll('.cam-multi-check').forEach(cb => {
        cb.checked = cb.value === camId;
    });
    syncMasterSelection();
    openSettingsDrawer('single', [camId]);
}

function openSettingsDrawer(mode, ids = []) {
    settingsDrawerMode = mode;
    settingsDrawerIds  = [...ids];
    renderSettingsDrawer();
    const overlay = document.getElementById('settings-drawer-overlay');
    const drawer  = document.getElementById('settings-drawer');
    overlay?.classList.add('open');
    if (drawer) { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); }
}

function closeSettingsDrawer() {
    const overlay = document.getElementById('settings-drawer-overlay');
    const drawer  = document.getElementById('settings-drawer');
    overlay?.classList.remove('open');
    if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
}

function getCameraSummary(cam) {
    if (!cam) return '';
    return `상태: ${getStatusLabel(cam.status)}`;
}
function openEnvSettings() {
    settingsDrawerMode = 'env';
    settingsDrawerIds = [];
    renderSettingsDrawer();
    const overlay = document.getElementById('settings-drawer-overlay');
    const drawer  = document.getElementById('settings-drawer');
    overlay?.classList.add('open');
    if (drawer) { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); }
}

function renderSettingsDrawer() {
    const title   = document.getElementById('settings-drawer-title');
    const summary = document.getElementById('settings-drawer-summary');
    const content = document.getElementById('settings-drawer-content');
    if (!title || !summary || !content) return;

    const cams       = settingsDrawerIds.map(id => allCctvs.find(cam => cam.id === id)).filter(Boolean);
    const primaryCam = cams[0] || null;

    title.textContent = settingsDrawerMode === 'single'
        ? (primaryCam ? `개별 설정 - ${primaryCam.id.toUpperCase()}` : '개별 설정')
        : settingsDrawerMode === 'env'
        ? '모니터링 환경 설정'
        : '선택 일괄 수정';
    summary.textContent = settingsDrawerMode === 'single'
        ? (primaryCam ? `${primaryCam.stadium} · ${primaryCam.category}` : '선택한 카메라의 상태와 알람 스케줄을 수정합니다.')
        : settingsDrawerMode === 'env'
        ? '모니터링 시스템 전역 설정을 관리합니다.'
        : `${cams.length}개 카메라의 상태와 알람 스케줄을 한 번에 수정합니다.`;

    const footerEl = document.getElementById('settings-drawer-footer');
    if (settingsDrawerMode === 'env') {
        if (footerEl) footerEl.style.display = 'none';
        const currentRecipient = alertConfig?.recipient || '';
        const currentPassword  = alertConfig?.root_password || '';
        const currentStartTime = alertConfig?.start_time || '08:00';
        const currentEndTime   = alertConfig?.end_time   || '18:00';
        const currentWorkDays  = alertConfig?.work_days  || [1,2,3,4,5];
        const currentTrafficEnabled = !!alertConfig?.traffic_enabled;
        const currentTrafficStart   = alertConfig?.traffic_start || '';
        const currentTrafficEnd     = alertConfig?.traffic_end   || '';
        const dayLabels = ['일','월','화','수','목','금','토'];
        const dayCheckboxes = [0,1,2,3,4,5,6].map(d => `
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.85rem;user-select:none;">
                <input type="checkbox" id="settings-day-${d}" value="${d}"
                    ${currentWorkDays.includes(d) ? 'checked' : ''}
                    style="width:15px;height:15px;cursor:pointer;accent-color:#3b82f6;">
                ${dayLabels[d]}
            </label>
        `).join('');
        content.innerHTML = `
            <section class="drawer-section">
                <div class="drawer-section-title"><i class="fa-solid fa-envelope" style="margin-right:6px;"></i>수신 메일 주소</div>
                <p style="font-size:0.82rem;color:var(--text-sub);margin:8px 0 12px;">캠 모니터링 알람 발송 대상 메일 주소를 설정합니다.</p>
                <input type="email" class="text-input" id="settings-email"
                    placeholder="example@domain.com"
                    value="${escapeHtml(currentRecipient)}"
                    style="width:100%;margin-bottom:16px;"/>
            </section>

            <section class="drawer-section" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
                <div class="drawer-section-title"><i class="fa-solid fa-clock" style="margin-right:6px;"></i>알람 활성화 시간</div>
                <p style="font-size:0.82rem;color:var(--text-sub);margin:8px 0 12px;">지정한 시간대 및 요일에만 메일 알람이 발송됩니다. 범위 밖의 시간에는 발송하지 않습니다.</p>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
                    <label style="font-size:0.82rem;color:var(--text-sub);white-space:nowrap;">발송 시작</label>
                    <input type="time" class="text-input" id="settings-start-time"
                        value="${escapeHtml(currentStartTime)}"
                        style="flex:1;"/>
                    <span style="color:var(--text-sub);font-size:0.85rem;">~</span>
                    <label style="font-size:0.82rem;color:var(--text-sub);white-space:nowrap;">발송 종료</label>
                    <input type="time" class="text-input" id="settings-end-time"
                        value="${escapeHtml(currentEndTime)}"
                        style="flex:1;"/>
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:4px;">
                    ${dayCheckboxes}
                </div>
                <p style="font-size:0.78rem;color:var(--text-sub);margin:8px 0 0;">※ 체크된 요일의 지정 시간대에만 알람이 발송됩니다.</p>
            </section>

            <section class="drawer-section" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
                <div class="drawer-section-title"><i class="fa-solid fa-chart-area" style="margin-right:6px;"></i>트래픽 수집 기간</div>
                <p style="font-size:0.82rem;color:var(--text-sub);margin:8px 0 12px;">지정한 기간 동안만 각 캠 서버의 vnstat 트래픽 수집 cron이 활성화됩니다. 기간 밖에는 자동으로 비활성화됩니다.</p>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem;user-select:none;margin-bottom:14px;">
                    <input type="checkbox" id="settings-traffic-enabled"
                        ${currentTrafficEnabled ? 'checked' : ''}
                        style="width:15px;height:15px;cursor:pointer;accent-color:#3b82f6;">
                    트래픽 수집 사용
                </label>
                <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:4px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <label style="font-size:0.82rem;color:var(--text-sub);white-space:nowrap;min-width:52px;">시작</label>
                        <input type="datetime-local" class="text-input" id="settings-traffic-start"
                            value="${escapeHtml(currentTrafficStart)}"
                            style="flex:1;"/>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <label style="font-size:0.82rem;color:var(--text-sub);white-space:nowrap;min-width:52px;">종료</label>
                        <input type="datetime-local" class="text-input" id="settings-traffic-end"
                            value="${escapeHtml(currentTrafficEnd)}"
                            style="flex:1;"/>
                    </div>
                </div>
                <p style="font-size:0.78rem;color:var(--text-sub);margin:8px 0 0;">※ 저장 시 즉시 동기화되며, 이후에도 주기적으로 캠 서버 cron 상태가 맞춰집니다.</p>
            </section>
            
            <section class="drawer-section" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
                <div class="drawer-section-title"><i class="fa-solid fa-key" style="margin-right:6px;"></i>캠 서버 root 패스워드</div>
                <p style="font-size:0.82rem;color:var(--text-sub);margin:8px 0 12px;">캠 서버(cctv.info 배포 대상 서버)의 root SSH 비밀번호를 설정합니다.</p>
                <div style="position:relative; width:100%; margin-bottom:20px;">
                    <input type="password" class="text-input" id="settings-root-password"
                        placeholder="[비밀번호 입력]"
                        value="${escapeHtml(currentPassword)}"
                        style="width:100%; padding-right:40px;"/>
                    <button class="btn" onclick="togglePasswordVisibility('settings-root-password', this)" style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:var(--text-sub); padding:8px; cursor:pointer;" type="button">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </div>
            </section>

            <button class="btn btn-success" onclick="saveEnvSettings()" style="width:100%;justify-content:center;height:42px;font-weight:700;">
                <i class="fa-solid fa-floppy-disk"></i> 설정 저장
            </button>
        `;
        return;
    }

    if (footerEl) footerEl.style.display = 'block';
    content.innerHTML = `
        <section class="drawer-section">
            <div class="drawer-section-title">선택 항목</div>
            <div class="drawer-selection-list" id="settings-batch-list"></div>
        </section>
        <section class="drawer-section">
            <div class="drawer-section-title">상태 변경</div>
            <div class="drawer-status-buttons">
                <button class="btn btn-success"  onclick="applyDrawerStatus('ACTIVE')"><i class="fa-solid fa-circle-check"></i> 경기 진행 중</button>
                <button class="btn btn-danger"   onclick="applyDrawerStatus('STOPPED')"><i class="fa-solid fa-circle-xmark"></i> 작동 중지</button>
                <button class="btn btn-warning"  onclick="applyDrawerStatus('INSPECTION')"><i class="fa-solid fa-triangle-exclamation"></i> 점검중</button>
            </div>
        </section>
        <section class="drawer-section">
            <div class="drawer-section-title">알람 스케줄 <span style="font-size:0.75rem;font-weight:400;color:var(--text-sub);">지정 기간 동안 알람 발송 중지</span></div>
            <div class="suppress-quick-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                <button class="btn btn-sm" onclick="setSuppressQuick(1)">+1h</button>
                <button class="btn btn-sm" onclick="setSuppressQuick(2)">+2h</button>
                <button class="btn btn-sm" onclick="setSuppressQuick(4)">+4h</button>
                <button class="btn btn-sm" onclick="setSuppressQuick(8)">+8h</button>
                <button class="btn btn-sm" onclick="setSuppressQuick(24)">+24h</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <input type="datetime-local" class="text-input" id="settings-suppress-until" style="flex:1;">
                <button class="btn" onclick="clearSuppressInput()" title="해제" style="padding:6px 10px;flex-shrink:0;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="suppress-current-info" style="font-size:0.8rem;color:var(--text-sub);margin-bottom:10px;"></div>
            <button class="btn btn-warning" onclick="applyDrawerSuppress()" style="width:100%;justify-content:center;margin-bottom:6px;">알람 스케줄 저장</button>
            <button class="btn btn-danger" onclick="applyDrawerSuppressClear()" style="width:100%;justify-content:center;font-size:0.85rem;">스케줄 해제 (즉시 발송 재개)</button>
        </section>
    `;

    const list = document.getElementById('settings-batch-list');
    if (list) {
        list.innerHTML = cams.length === 0
            ? '<div class="selection-empty">선택된 항목이 없습니다.</div>'
            : cams.map(cam => `
                <div class="drawer-selection-item">
                    <div>
                        <strong>CAM ${cam.num < 10 ? '0' + cam.num : cam.num} - ${escapeHtml(cam.category)}</strong>
                        <span>${escapeHtml(cam.stadium)}<br>${getCameraSummary(cam)}</span>
                    </div>
                    <div style="text-align:right; font-size:0.75rem; color:var(--text-sub); font-weight:700;">${escapeHtml(cam.id)}</div>
                </div>
            `).join('');
    }

    const suppressEl   = document.getElementById('settings-suppress-until');
    const suppressInfo = document.getElementById('suppress-current-info');
    if (suppressEl) {
        suppressEl.value = '';
        const sup = primaryCam?.suppress_until;
        if (sup && suppressInfo) {
            const d = new Date(sup);
            const now = new Date();
            if (d > now) {
                suppressInfo.innerHTML = `<i class="fa-regular fa-clock" style="color:#f59e0b;"></i> 스케줄 적용 중: <strong>${d.toLocaleString('ko-KR')}</strong> 까지`;
            } else {
                suppressInfo.textContent = '스케줄 없음 (또는 만료)';
            }
        } else if (suppressInfo) {
            suppressInfo.textContent = '스케줄 없음';
        }
    }
}

function applyLocalDrawerUpdate(payload) {
    const ids = new Set(payload.ids);
    allCctvs = allCctvs.map(cam => {
        if (!ids.has(cam.id)) return cam;
        const next = { ...cam };
        if (payload.status) next.status = payload.status;
        return next;
    });
}

function buildDrawerConfirmMessage(payload, kind) {
    const cams  = payload.ids.map(id => allCctvs.find(cam => cam.id === id)).filter(Boolean);
    const lines = cams.map(cam => `- CAM ${cam.num < 10 ? '0' + cam.num : cam.num} ${cam.category} (${cam.id})`).join('\n');
    if (kind === 'status') {
        return `아래 카메라의 상태를 ${getStatusLabel(payload.status)}로 변경합니다.\n\n${lines}`;
    }
    if (kind === 'suppress') {
        const until = payload.suppress_until
            ? `${new Date(payload.suppress_until).toLocaleString('ko-KR')} 까지 스케줄`
            : `스케줄 해제 (즉시 발송 재개)`;
        return `아래 카메라의 알람 스케줄을 설정합니다.\n\n${lines}\n\n${until}`;
    }
    return `설정을 저장합니다.\n\n${lines}`;
}

async function applyDrawerStatus(status) {
    const payload = { mode: settingsDrawerMode, ids: [...settingsDrawerIds], status, enabled: null, start: '', end: '' };
    if (payload.ids.length === 0) { showToast('선택된 카메라가 없습니다.'); return; }
    if (!window.confirm(buildDrawerConfirmMessage(payload, 'status'))) return;
    try {
        const res  = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'batch_update', cam_ids: payload.ids, status })
        });
        const data = await res.json();
        if (data.success) {
            applyLocalDrawerUpdate(payload);
            renderCurrentView();
            syncMasterSelection();
            showToast(`선택 항목 상태가 ${getStatusLabel(status)}로 변경되었습니다.`);
            closeSettingsDrawer();
        } else {
            showToast(data.message || '상태 변경 실패');
        }
    } catch (e) {
        showToast('상태 변경 실패');
    }
}



/* 알람 스케줄 헬퍼 */
function setSuppressQuick(hours) {
    const el = document.getElementById('settings-suppress-until');
    if (!el) return;
    const d = new Date(Date.now() + hours * 3600 * 1000);
    // datetime-local 형식: YYYY-MM-DDTHH:MM
    const pad = n => String(n).padStart(2, '0');
    el.value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clearSuppressInput() {
    const el = document.getElementById('settings-suppress-until');
    if (el) el.value = '';
}

async function applyDrawerSuppress() {
    const ids = [...settingsDrawerIds];
    if (ids.length === 0) { showToast('선택된 카메라가 없습니다.'); return; }
    const suppressUntil = document.getElementById('settings-suppress-until')?.value || '';
    if (!suppressUntil) { showToast('억제 종료 시각을 선택하세요. (빠른 버튼 또는 직접 입력)'); return; }
    const payload = { ids, suppress_until: suppressUntil };
    if (!window.confirm(buildDrawerConfirmMessage(payload, 'suppress'))) return;
    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_suppress', scope: 'cam', cam_ids: ids, suppress_until: suppressUntil })
        });
        const data = await res.json();
        if (data.success) {
            // 로컈 상태 반영
            const idsSet = new Set(ids);
            allCctvs = allCctvs.map(cam => idsSet.has(cam.id) ? { ...cam, suppress_until: suppressUntil } : cam);
            renderCurrentView();
            showToast('알람 스케줄이 저장되었습니다.');
            closeSettingsDrawer();
        } else {
            showToast(data.message || '저장 실패');
        }
    } catch (e) {
        showToast('저장 실패');
    }
}

async function applyDrawerSuppressClear() {
    const ids = [...settingsDrawerIds];
    if (ids.length === 0) { showToast('선택된 카메라가 없습니다.'); return; }
    if (!window.confirm(`선택한 ${ids.length}개 카메라의 알람 스케줄을 해제합니다. (즉시 발송 재개)`)) return;
    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_suppress', scope: 'cam', cam_ids: ids, suppress_until: '' })
        });
        const data = await res.json();
        if (data.success) {
            const idsSet = new Set(ids);
            allCctvs = allCctvs.map(cam => idsSet.has(cam.id) ? { ...cam, suppress_until: null } : cam);
            renderCurrentView();
            showToast('스케줄이 해제되었습니다.');
            closeSettingsDrawer();
        } else {
            showToast(data.message || '해제 실패');
        }
    } catch (e) {
        showToast('해제 실패');
    }
}



/* ═══════════════════════════════════════════════════════════
   엑셀 업로드
   ═══════════════════════════════════════════════════════════ */

async function uploadExcel() {
    const fileInput = document.getElementById('excel-upload');
    if (fileInput.files.length === 0) return;

    const formData = new FormData();
    formData.append('action', 'upload_excel');
    formData.append('excel_file', fileInput.files[0]);

    showToast('엑셀 업로드 중...');
    try {
        const res  = await fetch('api.php', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast('엑셀 적용 완료! ' + (data.count || '') + '개 업데이트');
            loadData();
        } else {
            showToast('업로드 실패: ' + data.message);
        }
    } catch (e) {
        showToast('엑셀 업로드 에러');
    }
    fileInput.value = '';
}

/* ═══════════════════════════════════════════════════════════
   유틸리티
   ═══════════════════════════════════════════════════════════ */

function escapeHtml(value) {
    return String(value)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

function filterTable() { applyFilters(); }
function checkBatchSelection() { syncMasterSelection(); }

/* ═══════════════════════════════════════════════════════════
   세그먼트 수신 상태 헬퍼
   ═══════════════════════════════════════════════════════════ */

function isCamStale(camId) {
    const cam = allCctvs.find(c => c.id === camId);
    if (!cam || !cam.live_status) return false;
    const status = cam.live_status;
    const diffSec = Math.floor(Date.now() / 1000) - status.checked_at;
    const elapsedSec = (status.file_age !== null) ? (status.file_age + diffSec) : diffSec;
    return elapsedSec >= 300;
}

function getSegmentMarkup(camId) {
    const cam = allCctvs.find(c => c.id === camId);
    if (!cam || !cam.live_status) {
        return `<span class="seg-pill waiting"><i class="fa-solid fa-spinner fa-spin"></i> 진단 수신 대기중</span>`;
    }

    const status = cam.live_status;
    
    // 백엔드 체크 시점으로부터 흐른 시간(초) 계산
    const diffSec = Math.floor(Date.now() / 1000) - status.checked_at;
    // 백엔드 감지 나이 + 흐른 시간
    const elapsedSec = (status.file_age !== null) ? (status.file_age + diffSec) : diffSec;
    const elapsedMin = Math.floor(elapsedSec / 60);
    let timeStr = `${elapsedMin}분`;
    if (elapsedMin >= 60) {
        const hours = Math.floor(elapsedMin / 60);
        const mins = elapsedMin % 60;
        timeStr = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
    }

    // Nagios 결과 코드 또는 세그먼트 갱신 지연으로 판단
    if (status.rc === 2 || status.rc === 3 || elapsedSec >= 300) { // CRITICAL/UNKNOWN 또는 5분 이상 갱신 없음 (중단)
        return `<span class="seg-pill critical"><i class="fa-solid fa-circle-stop"></i> 비갱신 ${timeStr}째 (중단)</span>`;
    } else if (elapsedSec >= 120) { // 2분 이상 (지연)
        return `<span class="seg-pill warning"><i class="fa-solid fa-circle-exclamation"></i> 비갱신 ${timeStr}째 (지연)</span>`;
    } else { // 정상 (2분 미만)
        return `<span class="seg-pill ok"><i class="fa-solid fa-circle-play"></i> 정상 갱신 ${elapsedSec}초째 (OK)</span>`;
    }
}

function updateSegmentUI(camId) {
    const markup = getSegmentMarkup(camId);
    const cardEl = document.getElementById(`seg-badge-${camId}`);
    if (cardEl) cardEl.innerHTML = markup;

    const listEl = document.getElementById(`list-seg-badge-${camId}`);
    if (listEl) listEl.innerHTML = markup;

    const detailEl = document.getElementById(`detail-seg-badge-${camId}`);
    if (detailEl) detailEl.innerHTML = markup;
}

function updateAllSegmentsUI() {
    allCctvs.forEach(cam => {
        updateSegmentUI(cam.id);
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent  = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

/* ═══════════════════════════════════════════════════════════
   모니터링 환경 설정 저장
   ═══════════════════════════════════════════════════════════ */

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btnEl.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
    } else {
        input.type = 'password';
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
}

function saveEnvSettings() {
    const emailEl = document.getElementById('settings-email');
    const pwdEl = document.getElementById('settings-root-password');
    if (!emailEl) return;
    const email = emailEl.value.trim();
    const password = pwdEl ? pwdEl.value : '';
    
    if (!email) {
        showToast('메일 주소를 입력해주세요.');
        return;
    }
    // 간단 형식 검증
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast('올바른 메일 주소 형식이 아닙니다.');
        return;
    }

    // 알람 비활성화 시간 수집
    const startTimeEl = document.getElementById('settings-start-time');
    const endTimeEl   = document.getElementById('settings-end-time');
    const startTime   = startTimeEl ? startTimeEl.value : '08:00';
    const endTime     = endTimeEl   ? endTimeEl.value   : '18:00';
    const workDays    = [0,1,2,3,4,5,6].filter(d => {
        const cb = document.getElementById(`settings-day-${d}`);
        return cb && cb.checked;
    });

    // 트래픽 수집 기간 수집
    const trafficEnabledEl = document.getElementById('settings-traffic-enabled');
    const trafficStartEl   = document.getElementById('settings-traffic-start');
    const trafficEndEl     = document.getElementById('settings-traffic-end');
    const trafficEnabled   = trafficEnabledEl ? trafficEnabledEl.checked : false;
    const trafficStart     = trafficStartEl ? trafficStartEl.value : '';
    const trafficEnd       = trafficEndEl   ? trafficEndEl.value   : '';

    if (trafficEnabled) {
        if (!trafficStart || !trafficEnd) {
            showToast('트래픽 수집을 사용하려면 시작·종료 일시를 입력해주세요.');
            return;
        }
        if (trafficStart >= trafficEnd) {
            showToast('트래픽 수집 종료 일시는 시작 일시보다 이후여야 합니다.');
            return;
        }
    }

    const fd = new FormData();
    fd.append('recipient', email);
    fd.append('root_password', password);
    fd.append('start_time', startTime);
    fd.append('end_time', endTime);
    workDays.forEach(d => fd.append('work_days[]', d));
    fd.append('traffic_enabled', trafficEnabled ? '1' : '0');
    fd.append('traffic_start', trafficStart);
    fd.append('traffic_end', trafficEnd);
    
    fetch('api.php?action=update_alert', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                alertConfig = data.alert || alertConfig;
                const syncMsg = data.traffic_sync?.queued
                    ? ` (트래픽 cron ${data.traffic_sync.active ? '활성화' : '비활성화'} 동기화 시작)`
                    : '';
                showToast('환경 설정이 성공적으로 저장되었습니다.' + syncMsg);
                closeSettingsDrawer();
            } else {
                showToast('저장 실패: ' + (data.message || '알 수 없는 오류'));
            }
        })
        .catch(() => showToast('저장 중 오류가 발생했습니다.'));
}

/* ═══════════════════════════════════════════════════════════
   DOMContentLoaded 초기화
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('card-mode');
    loadData();
    updateStickyOffsets();
    window.addEventListener('resize', () => {
        updateStickyOffsets();
        updateRelayStickyOffset();
    });

    // 10초마다 세그먼트 경과 시간 UI 자동 갱신 (초/분 카운트업)
    setInterval(updateAllSegmentsUI, 10000);

    // 1분(60초)마다 백엔드 상태 최신화 폴링
    setInterval(loadData, 60000);
});

/* ═══════════════════════════════════════════════════════════
   SMS 발송폼 드로어
   ═══════════════════════════════════════════════════════════ */

let currentSmsTemplate = 'critical'; // 'critical', 'ok', 'all_ok'

function openSmsDrawer() {
    document.getElementById('sms-drawer').classList.add('open');
    document.getElementById('sms-drawer-overlay').classList.add('open');
    document.getElementById('sms-drawer').setAttribute('aria-hidden', 'false');
    
    // 첫 오픈 시 기본 탭 'critical' 강제 활성화
    const firstTab = document.querySelector('.sms-tab-btn');
    if (firstTab) {
        document.querySelectorAll('.sms-tab-btn').forEach(btn => btn.classList.remove('active'));
        firstTab.classList.add('active');
    }
    currentSmsTemplate = 'critical';
    buildSmsForm();
}

function closeSmsDrawer() {
    document.getElementById('sms-drawer').classList.remove('open');
    document.getElementById('sms-drawer-overlay').classList.remove('open');
    document.getElementById('sms-drawer').setAttribute('aria-hidden', 'true');
}

function setSmsTemplate(templateName, btnEl) {
    currentSmsTemplate = templateName;
    document.querySelectorAll('.sms-tab-btn').forEach(btn => btn.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    buildSmsForm();
}

function buildSmsForm() {
    const stopped = allCctvs.filter(c => c.status === 'STOPPED');
    const activeCams = allCctvs.filter(c => c.status === 'ACTIVE');

    // 제목: 연도 자동 채움 (비어있을 때만)
    const titleEl = document.getElementById('sms-title-field');
    if (!titleEl.value.trim()) {
        const year = new Date().getFullYear();
        titleEl.value = `${year}년 예시 행사 모니터링`;
    }

    let body = '';

    if (currentSmsTemplate === 'critical') {
        const camLines = stopped.map(c => {
            const id  = c.id  || '';
            const cat = c.category || '';
            return `${id} [${cat}] 종목 CCTV`;
        }).join('\n');

        body = [
            '안녕하세요. 예시회사 입니다.',
            '',
            'CCTV 접근 불가 목록 전달 드립니다.',
            '',
            '[접근 불가 CCTV 종목 리스트]',
            camLines || '(작동 중지 캠 없음)',
            '',
            '감사합니다.',
            '예시회사 드림',
        ].join('\n');
    } else if (currentSmsTemplate === 'ok') {
        const camLines = activeCams.map(c => {
            const id  = c.id  || '';
            const cat = c.category || '';
            return `${id} [${cat}] 종목 CCTV`;
        }).join('\n');

        body = [
            '안녕하세요. 예시회사 입니다.',
            '',
            '현재 기준 CCTV 정상 출력되는 종목 리스트를 전달드립니다.',
            '',
            '[정상 출력 CCTV 종목 리스트]',
            camLines || '(정상 출력 캠 없음)',
            '',
            '나머지 CCTV에 대해서는 종료되어 있는 상태이니 참고 부탁드리겠습니다.',
            '',
            '감사합니다.',
            '예시회사 드림',
        ].join('\n');
    } else if (currentSmsTemplate === 'all_ok') {
        body = [
            '안녕하세요. 예시회사 입니다.',
            '',
            '모든 CCTV 정상 작동 중입니다.',
            '',
            '감사합니다.',
            '예시회사 드림',
        ].join('\n');
    }

    document.getElementById('sms-body-field').value = body;

    // 미리보기 목록
    const listEl = document.getElementById('sms-stopped-list');
    if (stopped.length === 0) {
        listEl.innerHTML = `<div class="sms-stopped-empty">작동 중지 처리된 캠이 없습니다.</div>`;
        return;
    }
    listEl.innerHTML = stopped.map(c => `
        <div class="sms-stopped-item">
            <span class="si-id">${c.id}</span>
            <span class="si-cat">${c.category || '-'}</span>
            <span style="color:var(--text-sub);font-size:0.75rem;white-space:nowrap;">${c.stadium || ''}</span>
        </div>
    `).join('');
}


function copySmsField(fieldId) {
    const el = document.getElementById(fieldId);
    if (!el) return;

    // 버튼은 같은 .sms-field-block 내 어딘가 있음 (textarea는 .sms-textarea-wrap 한 단계 더 안쪽)
    const block = el.closest('.sms-field-block') || el.parentElement?.closest('.sms-field-block');
    const btn   = block ? block.querySelector('.sms-copy-btn') : null;

    const text = el.value;

    const onSuccess = () => {
        showToast('복사되었습니다.');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 복사됨';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.classList.remove('copied');
            }, 2000);
        }
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
            el.select();
            document.execCommand('copy');
            onSuccess();
        });
    } else {
        el.select();
        document.execCommand('copy');
        onSuccess();
    }
}

/* ═══════════════════════════════════════════════════════════
   CCTV cctv.info 설정 배포 모달 제어
   ═══════════════════════════════════════════════════════════ */

function parseStadium(stadiumStr) {
    if (!stadiumStr) return { name: '', code: '' };
    const match = stadiumStr.match(/^(.+?)\s*\((.+?)\)$/);
    if (match) {
        return { name: match[1].trim(), code: match[2].trim() };
    }
    return { name: stadiumStr, code: '' };
}

async function loadDeployTableData() {
    try {
        const res = await fetch('api.php?action=get_deploy_info&_t=' + new Date().getTime());
        const data = await res.json();
        if (!data.success) {
            showToast('설정 정보를 불러오지 못했습니다.');
            return;
        }

        const tbody = document.getElementById('deploy-table-body');
        tbody.innerHTML = '';

        data.cctvs.forEach(c => {
            const sInfo = parseStadium(c.stadium);
            const ip = data.ips[c.id] || '';
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
            
            let ddnsName = c.ddns || '';

            tr.innerHTML = `
                <td style="padding: 10px 12px; vertical-align: middle;">${c.num}</td>
                <td style="padding: 10px 12px; vertical-align: middle; color: #94a3b8;">${sInfo.code}</td>
                <td style="padding: 10px 12px; vertical-align: middle;">${sInfo.name}</td>
                <td style="padding: 10px 12px; vertical-align: middle; color: #3b82f6; font-weight: 500;">${c.category}</td>
                <td style="padding: 6px 12px; vertical-align: middle;">
                    <input type="text" class="text-input deploy-ddns-input" data-cam-id="${c.id}" value="${ddnsName}" style="width: 100%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 6px 10px; color: #fff;" placeholder="[DDNS URL을 입력하세요.]">
                </td>
                <td style="padding: 6px 12px; vertical-align: middle;">
                    <input type="text" class="text-input deploy-ip-input" data-cam-id="${c.id}" value="${ip}" style="width: 100%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 6px 10px; color: #fff;" placeholder="[IP 정보를 입력하세요.]" onpaste="handleIpPaste(event, this)">
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        showToast('설정 로딩 중 오류가 발생했습니다.');
    }
}

function handleIpPaste(e, input) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text) return;

    if (text.includes('\n') || text.includes('\r')) {
        e.preventDefault();
        const lines = text.split(/\r?\n/).map(l => l.trim());
        const inputs = Array.from(document.querySelectorAll('.deploy-ip-input'));
        const startIndex = inputs.indexOf(input);
        if (startIndex === -1) return;

        let lineIdx = 0;
        for (let i = startIndex; i < inputs.length && lineIdx < lines.length; i++) {
            if (lineIdx === lines.length - 1 && lines[lineIdx] === '') {
                break;
            }
            inputs[i].value = lines[lineIdx];
            lineIdx++;
        }
    }
}

async function resetDeployIps() {
    if (!confirm('정말 초기화 하시겠습니까?')) return;
    
    const inputs = document.querySelectorAll('.deploy-ip-input');
    inputs.forEach(inp => inp.value = '');

    const ips = {};
    inputs.forEach(inp => {
        const camId = inp.getAttribute('data-cam-id');
        ips[camId] = '';
    });

    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_cctv_ips', ips })
        });
        const data = await res.json();
        if (data.success) {
            showToast('cctv.info 내 IP 정보가 초기화 되었습니다.');
        } else {
            showToast('초기화 저장 실패');
        }
    } catch (e) {
        showToast('초기화 중 오류 발생');
    }
}

async function saveDeployIps() {
    if (!confirm('해당 정보로 저장하시겠습니까?')) return;

    const ipInputs = document.querySelectorAll('.deploy-ip-input');
    const ddnsInputs = document.querySelectorAll('.deploy-ddns-input');
    
    const ips = {};
    ipInputs.forEach(inp => {
        const camId = inp.getAttribute('data-cam-id');
        ips[camId] = inp.value.trim();
    });

    const ddnsMap = {};
    ddnsInputs.forEach(inp => {
        const camId = inp.getAttribute('data-cam-id');
        ddnsMap[camId] = inp.value.trim();
    });

    try {
        // 1) DDNS명 및 배포 스크립트 수정 요청
        const resDdns = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_ddns_names', ddns_map: ddnsMap })
        });
        const dataDdns = await resDdns.json();

        // 2) IP 정보 저장
        const resIps = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_cctv_ips', ips })
        });
        const dataIps = await resIps.json();

        if (dataDdns.success && dataIps.success) {
            showToast('cctv.info 파일 내 DDNS 및 IP 정보가 성공적으로 저장되었습니다.');
        } else {
            let msg = '';
            if (!dataDdns.success) msg += 'DDNS 저장 실패: ' + dataDdns.message + ' ';
            if (!dataIps.success) msg += 'IP 저장 실패: ' + dataIps.message;
            showToast(msg);
        }
    } catch (e) {
        showToast('저장 중 오류 발생');
    }
}

let pendingChanges = [];

async function runDeployProcess() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';
    
    try {
        const res = await fetch('api.php?action=run_ddns_update');
        const data = await res.json();
        
        if (overlay) overlay.style.display = 'none';
        
        if (data.success) {
            pendingChanges = data.changes || [];
            
            const diffContent = document.getElementById('diff-content');
            let html = '';

            // ── 1. DDNS 조회 결과 요약 ──────────────────────────────
            if (data.stats) {
                const total = data.stats.total || 0;
                const success = data.stats.success || 0;
                const fail = data.stats.fail || 0;
                
                let statusColor = '#10b981';
                let statusBg = 'rgba(16, 185, 129, 0.08)';
                let icon = '<i class="fa-solid fa-circle-check" style="margin-right: 6px;"></i>';
                
                if (total === 0) {
                    statusColor = '#ef4444';
                    statusBg = 'rgba(239, 68, 68, 0.08)';
                    icon = '<i class="fa-solid fa-circle-xmark" style="margin-right: 6px;"></i>';
                } else if (fail > 0) {
                    statusColor = '#f59e0b';
                    statusBg = 'rgba(245, 158, 11, 0.08)';
                    icon = '<i class="fa-solid fa-triangle-exclamation" style="margin-right: 6px;"></i>';
                }

                html += `<div style="margin-bottom: 20px; padding: 14px 18px; border-radius: 10px; background: ${statusBg}; border: 1px solid rgba(255,255,255,0.05); border-left: 4px solid ${statusColor}; display: flex; align-items: center; justify-content: space-between;">`;
                html += `<div>`;
                html += `<div style="font-weight: 700; font-size: 0.95rem; margin-bottom: 4px; color: ${statusColor}; display: flex; align-items: center;">${icon}DDNS 조회 결과 요약</div>`;
                if (total === 0) {
                    html += `<div style="color: #ef4444; font-size: 0.85rem;">조회된 카메라 정보가 없습니다.</div>`;
                } else {
                    html += `<div style="font-size: 0.85rem; color: #cbd5e1;">`;
                    html += `총 <span style="font-weight: bold; color: #60a5fa;">${total}</span>대 중 &nbsp;`;
                    html += `성공 <span style="font-weight: bold; color: #10b981;">${success}</span>대, &nbsp;`;
                    html += `실패 <span style="font-weight: bold; color: #ef4444;">${fail}</span>대`;
                    html += `</div>`;
                }
                html += `</div>`;
                html += `</div>`;
            }

            // ── 2. cctv.info에 반영될 내용 (전체 미리보기) ──────────
            if (data.new_content) {
                html += `<div style="margin-bottom: 20px;">`;
                html += `<div style="font-weight: bold; color: #38bdf8; margin-bottom: 8px; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">`;
                html += `<i class="fa-solid fa-file-lines"></i> <span>생성 예정인 cctv.info 파일 전문 미리보기</span>`;
                html += `</div>`;
                html += `<pre style="margin: 0; max-height: 200px; overflow-y: auto; background: #0b0f19; padding: 12px 16px; border-radius: 10px; color: #94a3b8; font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.8rem; white-space: pre-wrap; text-align: left; border: 1px solid rgba(255,255,255,0.06); line-height: 1.5; box-shadow: inset 0 2px 8px rgba(0,0,0,0.8);">${escapeHtml(data.new_content)}</pre>`;
                html += `</div>`;
            }

            // ── 3. DDNS 주소 변경점 (이전 조회 대비) ────────────────
            html += `<div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; margin-bottom: 20px;">`;
            if (pendingChanges.length === 0) {
                html += `<div style="padding: 12px; border-radius: 8px; background: rgba(255,255,255,0.02); text-align: center; border: 1px dashed rgba(255,255,255,0.1);">`;
                html += `<span style="color: #94a3b8; font-size: 0.85rem;"><i class="fa-solid fa-circle-info" style="margin-right:6px;"></i> 이전 조회 결과와 감지된 주소 변경점이 없습니다.</span>`;
                html += `</div>`;
            } else {
                html += `<details open style="outline: none;">`;
                html += `<summary style="cursor: pointer; color: #38bdf8; font-weight: bold; outline: none; margin-bottom: 12px; font-size: 0.9rem; display: flex; align-items: center; gap: 6px; user-select: none;">`;
                html += `<i class="fa-solid fa-arrow-right-arrow-left"></i> <span>DDNS 주소 변경 감지 목록 (${pendingChanges.length}건)</span>`;
                html += `</summary>`;
                html += `<div style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; padding-right: 4px;">`;
                pendingChanges.forEach(ch => {
                    html += `<div style="padding: 10px 14px; border-radius: 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-left: 3px solid #38bdf8;">`;
                    html += `<div style="font-weight: 700; color: #f8fafc; font-size: 0.85rem; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">`;
                    html += `<span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem;">${ch.cam_id.toUpperCase()}</span>`;
                    html += `</div>`;
                    html += `<div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px;">`;
                    html += `<div style="color: #f87171; text-decoration: line-through; opacity: 0.85; display: flex; align-items: center; gap: 8px;"><span style="width: 32px; font-weight: 600;">이전</span><span>${escapeHtml(ch.old || '(없음)')}</span></div>`;
                    html += `<div style="color: #4ade80; display: flex; align-items: center; gap: 8px;"><span style="width: 32px; font-weight: 600;">이후</span><span>${escapeHtml(ch.new || '(없음)')}</span></div>`;
                    html += `</div>`;
                    html += `</div>`;
                });
                html += `</div>`;
                html += `</details>`;
            }
            html += `</div>`;

            // ── 4. 실패/타임아웃 목록 ────────────────────────────────
            if (data.stats && data.stats.failures && data.stats.failures.length > 0) {
                html += `<details open style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; margin-bottom: 8px;">`;
                html += `<summary style="cursor: pointer; color: #ef4444; font-weight: bold; outline: none; font-size: 0.9rem; display: flex; align-items: center; gap: 6px; user-select: none;">`;
                html += `<i class="fa-solid fa-triangle-exclamation"></i> <span>실패/타임아웃 장비 목록 (${data.stats.failures.length}대) - 프로파일 부재 위험</span>`;
                html += `</summary>`;
                html += `<div style="margin-top: 10px; max-height: 180px; overflow-y: auto; background: rgba(239, 68, 68, 0.05); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.15); display: flex; flex-direction: column; gap: 6px;">`;
                data.stats.failures.forEach(f => {
                    html += `<div style="font-size: 0.8rem; color: #cbd5e1; display: flex; align-items: flex-start; gap: 8px;">`;
                    html += `<strong style="color: #f87171; background: rgba(248,113,113,0.1); padding: 1px 4px; border-radius: 4px; font-size: 0.75rem;">${f.cam_id.toUpperCase()}</strong>`;
                    html += `<span style="color: #f87171; font-family: monospace;">${escapeHtml(f.error)}</span>`;
                    html += `</div>`;
                });
                html += `</div></details>`;
            }
            
            diffContent.innerHTML = html;
            document.getElementById('diff-modal').style.display = 'flex';
        } else {
            showToast('DDNS 조회 갱신 중 실패했습니다: ' + data.message);
        }
    } catch (e) {
        if (overlay) overlay.style.display = 'none';
        showToast('DDNS 갱신 중 오류가 발생했습니다.');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function closeDiffModal() {
    document.getElementById('diff-modal').style.display = 'none';
}

async function cancelDeployProcess() {
    closeDiffModal();
    showToast('cctv.info 복구 중...');
    try {
        await fetch('api.php?action=rollback_ddns_update');
        showToast('갱신 반영을 취소하고 원본 cctv.info 파일을 복구했습니다.');
    } catch (e) {
        showToast('복구 중 오류가 발생했습니다.');
    }
}

/* ── 배포 작업 중 UI 잠금 ──────────────────────────────── */

let _deployLockOverlay = null;

function showDeployLock(message = '배포 작업 진행 중...') {
    if (_deployLockOverlay) return;
    const overlay = document.createElement('div');
    overlay.id = 'deploy-lock-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
        animation: fadeIn 0.2s ease;
    `;
    overlay.innerHTML = `
        <div style="width:52px; height:52px; border-radius:50%; border:3px solid rgba(255,255,255,0.1); border-top-color:#3b82f6; animation:spin 0.9s linear infinite;"></div>
        <div data-lock-msg style="color:#f8fafc; font-size:1rem; font-weight:700; letter-spacing:-0.01em;">${escapeHtml(message)}</div>
        <div data-lock-sub style="color:#64748b; font-size:0.82rem;">페이지 이동 및 조작이 일시 차단됩니다</div>
        <style>@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }</style>
    `;
    document.body.appendChild(overlay);
    _deployLockOverlay = overlay;

    // 뒤로가기 / 앞으로가기 이동 차단
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', _blockPopState);
    // 페이지 이탈(새로고침/닫기) 차단
    window.addEventListener('beforeunload', _blockBeforeUnload);
}

function _blockPopState() {
    window.history.pushState(null, '', window.location.href);
}

function _blockBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '배포 작업이 진행 중입니다. 페이지를 떠나면 배포가 중단될 수 있습니다.';
    return e.returnValue;
}

function hideDeployLock() {
    if (_deployLockOverlay) {
        _deployLockOverlay.remove();
        _deployLockOverlay = null;
    }
    window.removeEventListener('popstate', _blockPopState);
    window.removeEventListener('beforeunload', _blockBeforeUnload);
}

function updateDeployLockMessage(message, sub) {
    if (!_deployLockOverlay) {
        showDeployLock(message);
    }
    const msgEl = _deployLockOverlay.querySelector('[data-lock-msg]');
    const subEl = _deployLockOverlay.querySelector('[data-lock-sub]');
    if (msgEl) msgEl.textContent = message;
    if (subEl && sub != null) subEl.textContent = sub;
}

async function confirmDeployProcess() {
    closeDiffModal();

    showDeployLock('cctv.info 배포 진행 중...');

    try {
        const res = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'deploy_cctv_info',
                pending_changes: pendingChanges
            })
        });
        const data = await res.json();

        hideDeployLock();

        if (!data.success) {
            // 치명적 오류 (패스워드 미설정 등)
            showDeployResultPopup('error', data.message || '배포 실패');
            return;
        }

        const failCount    = data.fail_count    ?? 0;
        const successCount = data.success_count ?? 0;
        const totalCount   = data.total         ?? 0;
        const changeCount  = pendingChanges.length;

        let deployStatus;
        if (totalCount === 0) {
            deployStatus = 'success'; // 배포 대상 없어도 성공 처리
        } else if (failCount > 0 && successCount > 0) {
            deployStatus = 'partial';
        } else if (failCount > 0 && successCount === 0) {
            deployStatus = 'fail';
        } else {
            deployStatus = 'success';
        }

        if (deployStatus === 'success') {
            showDeployCompleteNotification(changeCount, pendingChanges, data);
        } else if (deployStatus === 'partial') {
            showDeployCompleteNotification(changeCount, pendingChanges, data);
        } else {
            // 전체 실패
            showDeployResultPopup('fail', null, data);
        }
    } catch (e) {
        hideDeployLock();
        showDeployResultPopup('error', '배포 중 네트워크 오류가 발생했습니다.');
    }
}

/* ── 배포 실패 / 오류 팝업 ─────────────────────────────── */

function showDeployResultPopup(type, message, data) {
    const existing = document.getElementById('deploy-complete-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'deploy-complete-popup';
    popup.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 3000;
        background: #111827; border: 1px solid rgba(239,68,68,0.35);
        border-radius: 16px; padding: 20px 24px; min-width: 320px; max-width: 460px;
        box-shadow: 0 20px 60px rgba(239,68,68,0.18); animation: slideInUp 0.3s ease;
        display: flex; flex-direction: column; gap: 12px;
    `;

    const failedHosts  = data?.failed_hosts  || [];
    const totalCount   = data?.total         ?? 0;
    const failCount    = data?.fail_count    ?? 0;
    const successCount = data?.success_count ?? 0;

    let bodyHtml = '';

    if (message) {
        bodyHtml += `
            <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; padding:12px 14px; font-size:0.84rem; color:#fca5a5; line-height:1.6;">
                <i class="fa-solid fa-circle-xmark" style="margin-right:6px; color:#ef4444;"></i>${escapeHtml(message)}
            </div>`;
    }

    if (totalCount > 0) {
        bodyHtml += `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:12px 14px; font-size:0.82rem;">
                <div style="display:flex; gap:20px; margin-bottom:${failedHosts.length ? '10px' : '0'};">
                    <span style="color:#94a3b8;">전체 <strong style="color:#60a5fa;">${totalCount}</strong>대</span>
                    <span style="color:#94a3b8;">성공 <strong style="color:#10b981;">${successCount}</strong>대</span>
                    <span style="color:#94a3b8;">실패 <strong style="color:#ef4444;">${failCount}</strong>대</span>
                </div>
                ${failedHosts.length > 0 ? `
                <div style="font-size:0.78rem; color:#64748b; font-weight:600; margin-bottom:6px;">접근 실패 서버</div>
                <div style="display:flex; flex-wrap:wrap; gap:5px;">
                    ${failedHosts.slice(0, 10).map(h => `<span style="background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.2); border-radius:5px; padding:2px 7px; font-size:0.74rem; font-family:monospace;">${escapeHtml(h)}</span>`).join('')}
                    ${failedHosts.length > 10 ? `<span style="color:#64748b; font-size:0.74rem;">+${failedHosts.length - 10}대</span>` : ''}
                </div>` : ''}
            </div>`;
    }

    popup.innerHTML = `
        <style>@keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }</style>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:2px;">
            <div style="width:36px; height:36px; border-radius:50%; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <i class="fa-solid fa-circle-xmark" style="color:#ef4444; font-size:1.1rem;"></i>
            </div>
            <div>
                <div style="font-weight:800; font-size:0.98rem; color:#f8fafc; letter-spacing:-0.01em;">배포 실패</div>
                <div style="font-size:0.78rem; color:#94a3b8; margin-top:1px;">cctv.info 배포 중 오류가 발생했습니다</div>
            </div>
            <button onclick="document.getElementById('deploy-complete-popup').remove()" style="margin-left:auto; background:none; border:none; color:#64748b; cursor:pointer; font-size:1.2rem; line-height:1; padding:0 2px;">&times;</button>
        </div>
        ${bodyHtml}
        <button onclick="setViewMode('history'); document.getElementById('deploy-complete-popup').remove();" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.25); color:#f87171; border-radius:8px; padding:8px 14px; font-size:0.82rem; font-weight:600; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px; transition:all 0.15s;" onmouseover="this.style.background='rgba(239,68,68,0.18)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>이력에서 상세 오류 확인</span>
            <i class="fa-solid fa-chevron-right" style="margin-left:auto; font-size:0.75rem;"></i>
        </button>
    `;

    document.body.appendChild(popup);

    setTimeout(() => {
        if (document.getElementById('deploy-complete-popup')) {
            popup.style.opacity = '0';
            popup.style.transform = 'translateY(10px)';
            popup.style.transition = 'all 0.3s ease';
            setTimeout(() => popup.remove(), 300);
        }
    }, 18000);
}

function showDeployCompleteNotification(changeCount, changes, data) {
    // 기존 팝업 제거
    const existing = document.getElementById('deploy-complete-popup');
    if (existing) existing.remove();

    const totalCount    = data?.total          ?? 0;
    const failCount     = data?.fail_count     ?? 0;
    const successCount  = data?.success_count  ?? 0;
    const failedHosts   = data?.failed_hosts   || [];
    const isPartial     = failCount > 0 && successCount > 0;

    const popup = document.createElement('div');
    popup.id = 'deploy-complete-popup';
    const borderColor = isPartial ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.12)';
    const shadowColor = isPartial ? 'rgba(245,158,11,0.12)' : 'rgba(0,0,0,0.6)';
    popup.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 3000;
        background: #111827; border: 1px solid ${borderColor};
        border-radius: 16px; padding: 20px 24px; min-width: 320px; max-width: 440px;
        box-shadow: 0 20px 60px ${shadowColor}; animation: slideInUp 0.3s ease;
        display: flex; flex-direction: column; gap: 12px;
    `;

    // 변경 요약 문자열
    let changeSummary = '';
    if (changes && changes.length > 0) {
        changeSummary = changes.slice(0, 3).map(ch => {
            const newParts = (ch.new || '').split('@');
            const host = newParts.length > 1 ? newParts[1] : ch.new;
            return `<span style="color:#38bdf8; font-weight:700;">${ch.cam_id.toUpperCase()}</span> → ${escapeHtml(host)}`;
        }).join('<br>');
        if (changes.length > 3) {
            changeSummary += `<br><span style="color:#64748b; font-size:0.78rem;">외 ${changes.length - 3}건 더...</span>`;
        }
    }

    const iconColor    = isPartial ? '#f59e0b' : '#10b981';
    const iconBg       = isPartial ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)';
    const iconBorder   = isPartial ? 'rgba(245,158,11,0.3)'  : 'rgba(16,185,129,0.3)';
    const iconClass    = isPartial ? 'fa-triangle-exclamation' : 'fa-circle-check';
    const titleText    = isPartial ? '부분 배포 완료' : '배포 완료';
    const subtitleText = isPartial
        ? `${successCount}대 성공 / ${failCount}대 실패 — 이력을 확인하세요`
        : 'cctv.info 전체 캠 서버 배포 성공';

    let statsHtml = '';
    if (isPartial && totalCount > 0) {
        statsHtml = `
        <div style="background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.15); border-radius:10px; padding:10px 14px; font-size:0.82rem;">
            <div style="display:flex; gap:20px; margin-bottom:${failedHosts.length ? '8px' : '0'};">
                <span style="color:#94a3b8;">전체 <strong style="color:#60a5fa;">${totalCount}</strong>대</span>
                <span style="color:#94a3b8;">성공 <strong style="color:#10b981;">${successCount}</strong>대</span>
                <span style="color:#94a3b8;">실패 <strong style="color:#ef4444;">${failCount}</strong>대</span>
            </div>
            ${failedHosts.length > 0 ? `
            <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:4px;">
                ${failedHosts.slice(0, 8).map(h => `<span style="background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.2); border-radius:5px; padding:2px 7px; font-size:0.73rem; font-family:monospace;">${escapeHtml(h)}</span>`).join('')}
                ${failedHosts.length > 8 ? `<span style="color:#64748b; font-size:0.73rem;">+${failedHosts.length - 8}대</span>` : ''}
            </div>` : ''}
        </div>`;
    }

    popup.innerHTML = `
        <style>@keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }</style>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:2px;">
            <div style="width:36px; height:36px; border-radius:50%; background:${iconBg}; border:1px solid ${iconBorder}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <i class="fa-solid ${iconClass}" style="color:${iconColor}; font-size:1.1rem;"></i>
            </div>
            <div>
                <div style="font-weight:800; font-size:0.98rem; color:#f8fafc; letter-spacing:-0.01em;">${titleText}</div>
                <div style="font-size:0.78rem; color:#64748b; margin-top:1px;">${subtitleText}</div>
            </div>
            <button onclick="document.getElementById('deploy-complete-popup').remove()" style="margin-left:auto; background:none; border:none; color:#64748b; cursor:pointer; font-size:1.2rem; line-height:1; padding:0 2px;">&times;</button>
        </div>
        ${statsHtml}
        ${changeCount > 0 && !isPartial ? `
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:12px 14px; font-size:0.82rem; color:#cbd5e1; line-height:1.7;">
            <div style="font-size:0.72rem; font-weight:800; color:#64748b; letter-spacing:0.04em; text-transform:uppercase; margin-bottom:8px;">변경 내용 (${changeCount}건)</div>
            ${changeSummary}
        </div>` : (changeCount === 0 && !isPartial ? `
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:10px 14px; font-size:0.82rem; color:#94a3b8;">
            <i class="fa-solid fa-circle-info" style="margin-right:6px;"></i>변경사항 없이 배포 완료
        </div>` : '')}
        <button onclick="setViewMode('history'); document.getElementById('deploy-complete-popup').remove();" style="background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); color:#60a5fa; border-radius:8px; padding:8px 14px; font-size:0.82rem; font-weight:600; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px; transition:all 0.15s;" onmouseover="this.style.background='rgba(59,130,246,0.22)'" onmouseout="this.style.background='rgba(59,130,246,0.12)'">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>이력 확인 페이지에서 상세 보기</span>
            <i class="fa-solid fa-chevron-right" style="margin-left:auto; font-size:0.75rem;"></i>
        </button>
    `;

    document.body.appendChild(popup);

    // 12초 후 자동 닫힘
    setTimeout(() => {
        if (document.getElementById('deploy-complete-popup')) {
            popup.style.animation = 'none';
            popup.style.opacity = '0';
            popup.style.transform = 'translateY(10px)';
            popup.style.transition = 'all 0.3s ease';
            setTimeout(() => popup.remove(), 300);
        }
    }, 12000);
}

/* ═══════════════════════════════════════════════════════════
   이력 조회
   ═══════════════════════════════════════════════════════════ */

let cachedHistory    = [];
let currentHistTab   = '';          // '' | 'deploy' | 'ddns_update' | 'env_config'

/* ── 탭 전환 ─────────────────────────────────────────────── */
function setHistoryTab(type) {
    currentHistTab = type;

    // 탭 버튼 active 처리
    const tabMap = {
        '':                   'hist-tab-all',
        'deploy':             'hist-tab-deploy',
        'ddns_update':        'hist-tab-ddns',
        'env_config':         'hist-tab-env',
        'cctv_relay_restart': 'hist-tab-restart',
    };
    Object.entries(tabMap).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', k === type);
    });

    loadHistoryData();
}

/* ── 필터 / 리셋 ─────────────────────────────────────────── */
async function loadHistoryData() {
    const status   = document.getElementById('history-status-filter')?.value || '';
    const dateFrom = document.getElementById('history-date-from')?.value     || '';
    const dateTo   = document.getElementById('history-date-to')?.value       || '';

    try {
        const res = await fetch('api.php', {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ action: 'get_history', type: currentHistTab, status, date_from: dateFrom, date_to: dateTo })
        });
        const data = await res.json();
        if (data.success) {
            cachedHistory = data.history || [];
            renderHistoryTable(cachedHistory);
        }
    } catch (e) {
        console.error('이력 로딩 오류:', e);
    }
}

function applyHistoryFilters() {
    if (currentViewMode === 'history') loadHistoryData();
}

function resetHistoryFilters() {
    const sf = document.getElementById('history-status-filter');
    const df = document.getElementById('history-date-from');
    const dt = document.getElementById('history-date-to');
    if (sf) sf.value = '';
    if (df) df.value = '';
    if (dt) dt.value = '';
    loadHistoryData();
}

/* ── 공통 메타 ───────────────────────────────────────────── */
const HISTORY_TYPE_LABEL = {
    deploy:      { label: 'cctv.info 배포 작업',   icon: 'fa-server',        color: '#3b82f6' },
    ddns_update: { label: 'DDNS 주소 조회',         icon: 'fa-arrows-rotate', color: '#8b5cf6' },
    env_config:  { label: '모니터링 환경 설정 변경', icon: 'fa-cogs',          color: '#f59e0b' },
    cctv_relay_restart: { label: 'cctv-relay 서비스 재기동', icon: 'fa-arrows-spin', color: '#10b981' },
};

const HISTORY_STATUS_LABEL = {
    success: { label: '성공',      color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
    partial: { label: '부분 성공', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)'  },
    fail:    { label: '실패',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)'   },
};

function getFormattedCamName(camId) {
    if (!camId) return '-';
    const cleanId = camId.trim().toLowerCase();
    const cam = allCctvs.find(c => String(c.id || '').trim().toLowerCase() === cleanId);
    const upperId = camId.toUpperCase();
    if (cam) {
        return `<strong style="color:#ffffff; font-family:monospace; font-size:0.78rem;">${upperId}</strong><span style="color:#94a3b8; font-size:0.7rem; font-weight:normal; margin-left:4px;">(${cam.stadium}/${cam.category})</span>`;
    }
    return `<strong style="color:#ffffff; font-family:monospace; font-size:0.78rem;">${upperId}</strong>`;
}

function getCamStadium(camId) {
    if (!camId) return '-';
    const cleanId = camId.trim().toLowerCase();
    const cam = allCctvs.find(c => String(c.id || '').trim().toLowerCase() === cleanId);
    return cam ? cam.stadium : '-';
}

function getCamCategory(camId) {
    if (!camId) return '-';
    const cleanId = camId.trim().toLowerCase();
    const cam = allCctvs.find(c => String(c.id || '').trim().toLowerCase() === cleanId);
    return cam ? cam.category : '-';
}

function statusBadge(status) {
    const m = HISTORY_STATUS_LABEL[status] || { label: status || '-', color: '#94a3b8', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };
    return `<span style="display:inline-block; padding:2px 10px; border-radius:999px; font-size:0.73rem; font-weight:700; color:${m.color}; background:${m.bg}; border:1px solid ${m.border};">${m.label}</span>`;
}

function typeBadge(type) {
    const m = HISTORY_TYPE_LABEL[type] || { label: type, icon: 'fa-circle', color: '#94a3b8' };
    return `<span style="display:inline-flex; align-items:center; gap:5px; font-size:0.75rem; font-weight:600; color:${m.color};"><i class="fa-solid ${m.icon}"></i>${m.label}</span>`;
}

/* ── 컬럼 정의 ───────────────────────────────────────────── */
// 각 함수는 (item) => td HTML string 반환
const COLUMNS = {

    /* 전체 뷰 */
    '': [
        { label: '시각',    width: '148px', render: r => `<span style="color:#94a3b8; font-size:0.8rem;">${escapeHtml(r.created_at || '')}</span>` },
        { label: '구분',    width: '200px', render: r => typeBadge(r.type) },
        { label: '제목',    width: '',      render: r => `<span style="font-weight:600; color:#f1f5f9;">${escapeHtml(r.title || '')}</span>` },
        { label: '결과',    width: '100px', render: r => statusBadge(r.status) },
        { label: '요약',    width: '340px', render: r => renderSummaryCell(r) },
    ],

    /* 배포 작업 */
    deploy: [
        { label: '시각',        width: '148px', render: r => `<span style="color:#94a3b8; font-size:0.8rem;">${escapeHtml(r.created_at || '')}</span>` },
        { label: '제목',        width: '',      render: r => `<span style="font-weight:600; color:#f1f5f9;">${escapeHtml(r.title || '')}</span>` },
        { label: '결과',        width: '100px', render: r => statusBadge(r.status) },
        { label: '전체',        width: '64px',  render: r => `<span style="color:#60a5fa; font-weight:700;">${r.detail?.total ?? '-'}</span>` },
        { label: '성공',        width: '64px',  render: r => `<span style="color:#10b981; font-weight:700;">${r.detail?.success ?? '-'}</span>` },
        { label: '실패',        width: '64px',  render: r => failCell(r.detail?.fail) },
        { label: '변경 카메라', width: '',      render: r => deployChangesCell(r.detail) },
        { label: '실패 호스트', width: '240px', render: r => failedHostsCell(r.detail?.failed_hosts) },
    ],

    /* DDNS 주소 조회 */
    ddns_update: [
        { label: '시각',      width: '148px', render: r => `<span style="color:#94a3b8; font-size:0.8rem;">${escapeHtml(r.created_at || '')}</span>` },
        { label: '제목',      width: '',      render: r => `<span style="font-weight:600; color:#f1f5f9;">${escapeHtml(r.title || '')}</span>` },
        { label: '결과',      width: '100px', render: r => statusBadge(r.status) },
        { label: '총 대수',   width: '72px',  render: r => `<span style="color:#60a5fa; font-weight:700;">${r.detail?.total ?? '-'}</span>` },
        { label: '성공',      width: '64px',  render: r => `<span style="color:#10b981; font-weight:700;">${r.detail?.success ?? '-'}</span>` },
        { label: '실패',      width: '64px',  render: r => failCell(r.detail?.fail) },
        { label: '주소 변경', width: '80px',  render: r => {
            const cnt = r.detail?.changes?.length ?? 0;
            return cnt > 0
                ? `<span style="color:#38bdf8; font-weight:700;">${cnt}건</span>`
                : `<span style="color:#475569;">-</span>`;
        }},
        { label: '실패 캠',   width: '260px', render: r => ddnsFailuresCell(r.detail?.failures) },
    ],

    /* 모니터링 환경 설정 변경 */
    env_config: [
        { label: '시각',      width: '148px', render: r => `<span style="color:#94a3b8; font-size:0.8rem;">${escapeHtml(r.created_at || '')}</span>` },
        { label: '제목',      width: '',      render: r => `<span style="font-weight:600; color:#f1f5f9;">${escapeHtml(r.title || '')}</span>` },
        { label: '결과',      width: '100px', render: r => statusBadge(r.status) },
        { label: '변경 항목', width: '',      render: r => envFieldsCell(r.detail) },
    ],

    /* cctv-relay 서비스 재기동 */
    cctv_relay_restart: [
        { label: '시각',        width: '148px', render: r => `<span style="color:#94a3b8; font-size:0.8rem;">${escapeHtml(r.created_at || '')}</span>` },
        { label: '카메라',      width: '220px', render: r => getFormattedCamName(r.detail?.cam_id) },
        { label: 'IP',          width: '140px', render: r => `<span style="font-family:monospace; font-size:0.8rem; color:#94a3b8;">${escapeHtml(r.detail?.ip || '-')}</span>` },
        { label: '제목',        width: '',      render: r => `<span style="font-weight:600; color:#f1f5f9;">${escapeHtml(r.title || '')}</span>` },
        { label: '결과',        width: '100px', render: r => statusBadge(r.status) },
        { label: '출력 메시지', width: '280px', render: r => `<span style="color:#cbd5e1; font-family:monospace; font-size:0.8rem;">${escapeHtml(r.detail?.output || '-')}</span>` },
    ],
};

/* ── 셀 렌더 헬퍼 ────────────────────────────────────────── */
function failCell(n) {
    if (n == null) return `<span style="color:#475569;">-</span>`;
    return n > 0
        ? `<span style="color:#ef4444; font-weight:700;">${n}</span>`
        : `<span style="color:#475569;">0</span>`;
}

function deployChangesCell(d) {
    if (!d) return '-';
    const cnt = d.change_count || 0;
    if (!d.changes || d.changes.length === 0) {
        return cnt > 0
            ? `<span style="color:#38bdf8; font-weight:700;">${cnt}건</span>`
            : `<span style="color:#475569;">-</span>`;
    }
    const chips = d.changes.slice(0, 4).map(ch =>
        `<div style="display:inline-flex; align-items:center; background:rgba(56,189,248,0.06); border:1px solid rgba(56,189,248,0.18); border-radius:6px; padding:3px 8px; font-size:0.8rem; margin:1px 0; max-width:max-content;">${getFormattedCamName(ch.cam_id)}</div>`
    ).join(' ');
    const more = d.changes.length > 4 ? `<span style="color:#64748b; font-size:0.73rem; margin-left:4px;">외 ${d.changes.length-4}대</span>` : '';
    return `<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${chips}${more}</div>`;
}

function failedHostsCell(hosts) {
    if (!hosts || hosts.length === 0) return `<span style="color:#475569;">-</span>`;
    const chips = hosts.slice(0, 5).map(h =>
        `<span style="display:inline-block; background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.2); border-radius:5px; padding:1px 7px; font-size:0.72rem; font-family:monospace;">${escapeHtml(h)}</span>`
    ).join(' ');
    const more = hosts.length > 5 ? `<span style="color:#64748b; font-size:0.73rem;"> +${hosts.length-5}</span>` : '';
    return `<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${chips}${more}</div>`;
}

function ddnsFailuresCell(failures) {
    if (!failures || failures.length === 0) return `<span style="color:#475569;">-</span>`;
    const rows = failures.slice(0, 4).map(f => {
        const nameHtml = getFormattedCamName(f.cam_id);
        const errHtml = f.error ? `<span style="display:inline-block; background:rgba(239,68,68,0.15); color:#fca5a5; border:1px solid rgba(239,68,68,0.25); border-radius:4px; padding:1px 6px; font-size:0.7rem; font-family:sans-serif; margin-left:6px; letter-spacing:-0.01em;">${escapeHtml(f.error)}</span>` : '';
        return `<div style="display:flex; align-items:center; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:3px 8px; max-width:max-content; margin:1px 0;">${nameHtml}${errHtml}</div>`;
    }).join('');
    const more = failures.length > 4 ? `<div style="color:#64748b; font-size:0.73rem; margin-top:2px; padding-left:4px;">외 ${failures.length-4}대 더보기</div>` : '';
    return `<div style="display:flex; flex-direction:column; gap:3px;">${rows}${more}</div>`;
}

function envFieldsCell(d) {
    if (!d) return '-';
    const fieldNames = {
        enabled: '알람 활성화', start_time: '시작 시간', end_time: '종료 시간',
        work_days: '작업 요일', recipient: '수신 이메일', suppress_until: '억제 시간',
    };
    const fields = d.changed_fields || [];
    const vals   = d.values || {};
    if (fields.length === 0) return `<span style="color:#475569;">-</span>`;

    const chips = fields.map(f => {
        const name = fieldNames[f] || f;
        let val = vals[f];
        let valStr = '';
        if (f === 'work_days' && Array.isArray(val)) {
            valStr = ['일','월','화','수','목','금','토'].filter((_,i) => val.includes(i)).join(',');
        } else if (f === 'enabled') {
            valStr = val ? '활성' : '비활성';
        } else {
            valStr = escapeHtml(String(val ?? ''));
        }
        return `<span style="display:inline-block; background:rgba(245,158,11,0.1); color:#fbbf24; border:1px solid rgba(245,158,11,0.2); border-radius:6px; padding:2px 9px; font-size:0.74rem; font-weight:700;">${escapeHtml(name)}: ${valStr}</span>`;
    }).join(' ');
    return `<div style="display:flex; flex-wrap:wrap; gap:5px;">${chips}</div>`;
}

function renderSummaryCell(r) {
    const d = r.detail || {};
    if (r.type === 'deploy') {
        if (d.total != null) {
            return `<span style="font-size:0.8rem; color:#94a3b8;">전체 <b style="color:#60a5fa;">${d.total}</b> | 성공 <b style="color:#10b981;">${d.success}</b> | 실패 <b style="color:#ef4444;">${d.fail}</b></span>`;
        }
        if (d.change_count) return `<span style="color:#38bdf8; font-size:0.8rem;">변경 ${d.change_count}건 반영</span>`;
        return '-';
    }
    if (r.type === 'ddns_update') {
        return `<span style="font-size:0.8rem; color:#94a3b8;">총 <b style="color:#60a5fa;">${d.total??'-'}</b> | 성공 <b style="color:#10b981;">${d.success??'-'}</b> | 실패 <b style="color:#ef4444;">${d.fail??'-'}</b></span>`;
    }
    if (r.type === 'env_config') {
        const cnt = (d.changed_fields||[]).length;
        return cnt > 0 ? `<span style="color:#fbbf24; font-size:0.8rem;">${cnt}개 항목 변경</span>` : '-';
    }
    if (r.type === 'cctv_relay_restart') {
        const cam = d.cam_id ? String(d.cam_id).toUpperCase() : '';
        const extra = d.ip ? ` (${d.ip})` : '';
        return `<span style="font-size:0.8rem; color:#94a3b8;">${escapeHtml(cam + extra)}${d.output ? ' · ' + escapeHtml(d.output) : ''}</span>`;
    }
    return '-';
}

/* ── 메인 렌더 ───────────────────────────────────────────── */
function renderHistoryTable(items) {
    const head  = document.getElementById('history-table-head');
    const body  = document.getElementById('history-table-body');
    const empty = document.getElementById('history-empty');
    const table = document.getElementById('history-table');
    if (!head || !body) return;

    const cols = COLUMNS[''];

    /* ── 헤더 (꺾쇄 컬럼 선행) ── */
    const TH = `padding:12px 14px; font-weight:700; font-size:0.8rem; color:#94a3b8; background:#111c31; white-space:nowrap; letter-spacing:0.02em; text-transform:uppercase;`;
    head.innerHTML =
        `<th style="${TH} width:40px; padding:12px 6px;"></th>` +
        cols.map(c => `<th style="${TH} width:${c.width||'auto'};">${c.label}</th>`).join('');

    /* ── 데이터 없음 ── */
    if (!items || items.length === 0) {
        body.innerHTML = '';
        if (empty) empty.style.display = 'block';
        if (table) table.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';
    if (table) table.style.display = '';

    const TD = `padding:11px 14px; border-bottom:1px solid rgba(255,255,255,0.045); vertical-align:middle;`;
    const colCount = cols.length + 1;

    body.innerHTML = items.map((r, idx) => {
        const bg  = idx % 2 === 0 ? 'rgba(15,23,42,0.55)' : 'rgba(17,28,49,0.45)';
        const tds = cols.map(c => `<td style="${TD}">${c.render(r)}</td>`).join('');
        const rid = r.id;
        return `<tr id="hr-${rid}" data-idx="${idx}" data-bg="${bg}" style="background:${bg}; cursor:pointer; transition:background 0.12s;"
                    onclick="toggleHistDetail('${rid}',this)"
                    onmouseover="if(!this.classList.contains('hx')){this.style.background='rgba(24,174,231,0.06)';}"
                    onmouseout="if(!this.classList.contains('hx')){this.style.background='${bg}';}">
                    <td style="${TD} width:40px; padding:11px 6px; text-align:center;">
                        <span id="hc-${rid}" style="display:inline-flex;align-items:center;justify-content:center;
                            width:26px;height:26px;border-radius:6px;background:rgba(255,255,255,0.04);
                            border:1px solid rgba(255,255,255,0.08);color:#64748b;font-size:0.72rem;
                            transition:transform 0.2s,color 0.15s,background 0.15s,border-color 0.15s;">
                            <i class="fa-solid fa-chevron-right"></i>
                        </span>
                    </td>
                    ${tds}
                </tr>
                <tr id="hd-${rid}" style="display:none;">
                    <td colspan="${colCount}" style="padding:0;border-bottom:2px solid rgba(24,174,231,0.18);background:#090f1d;">
                        <div style="padding:22px 28px 26px;">${buildDetailPanel(r)}</div>
                    </td>
                </tr>`;
    }).join('');
}

/* ── 꺾쇄 토글 ─────────────────────────────────────────────── */
function toggleHistDetail(id, rowEl) {
    const dr  = document.getElementById('hd-' + id);
    const ch  = document.getElementById('hc-' + id);
    if (!dr) return;
    const open = dr.style.display !== 'none';
    dr.style.display = open ? 'none' : 'table-row';
    rowEl.classList.toggle('hx', !open);
    if (ch) {
        if (!open) {
            ch.style.transform   = 'rotate(90deg)';
            ch.style.color       = '#18aee7';
            ch.style.background  = 'rgba(24,174,231,0.14)';
            ch.style.borderColor = 'rgba(24,174,231,0.32)';
        } else {
            ch.style.transform   = '';
            ch.style.color       = '#64748b';
            ch.style.background  = 'rgba(255,255,255,0.04)';
            ch.style.borderColor = 'rgba(255,255,255,0.08)';
        }
    }
    const defBg = rowEl.dataset.bg;
    rowEl.style.background = (!open) ? 'rgba(24,174,231,0.07)' : defBg;
    rowEl.onmouseout = () => { if (!rowEl.classList.contains('hx')) rowEl.style.background = defBg; };
}

/* ══════════════════════════════════════════════════════════
   상세 패널 빌더
   ══════════════════════════════════════════════════════════ */
function buildDetailPanel(r) {
    const d = r.detail || {};
    if (r.type === 'deploy')             return buildDeployDetail(d);
    if (r.type === 'ddns_update')        return buildDdnsDetail(d);
    if (r.type === 'env_config')         return buildEnvDetail(d);
    if (r.type === 'cctv_relay_restart') return buildRelayRestartDetail(d);
    return '<span style="color:#64748b;">상세 정보 없음</span>';
}

/* 섹션 헤더 */
function dSection(ico, title, color, body) {
    return `<div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.07);">
            <i class="fa-solid ${ico}" style="color:${color};font-size:0.85rem;"></i>
            <span style="font-size:0.78rem;font-weight:700;color:#cbd5e1;letter-spacing:0.05em;text-transform:uppercase;">${title}</span>
        </div>${body}</div>`;
}

/* 통계 카드 */
function dStat(label, val, color) {
    return `<div style="background:rgba(15,23,42,0.6);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px 18px;text-align:center;min-width:88px;">
        <div style="font-size:1.4rem;font-weight:800;color:${color};line-height:1;">${val}</div>
        <div style="font-size:0.71rem;color:#64748b;margin-top:4px;font-weight:600;">${label}</div>
    </div>`;
}

/* ── deploy 상세 ── */
function buildDeployDetail(d) {
    let h = '';

    if (d.error) {
        h += dSection('fa-circle-xmark','오류','#ef4444',
            `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#fca5a5;font-family:monospace;">${escapeHtml(d.error)}</div>`);
    }

    if (d.total != null) {
        h += dSection('fa-server','배포 결과','#3b82f6',
            `<div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${dStat('전체 서버', d.total,   '#60a5fa')}
                ${dStat('성공',      d.success, '#10b981')}
                ${dStat('실패',      d.fail,    d.fail > 0 ? '#ef4444' : '#10b981')}
            </div>`);
    }

    if (d.failed_hosts && d.failed_hosts.length > 0) {
        const chips = d.failed_hosts.map(ip =>
            `<span style="display:inline-block;background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.22);border-radius:5px;padding:3px 9px;font-size:0.78rem;font-family:monospace;">${escapeHtml(ip)}</span>`
        ).join('');
        h += dSection('fa-triangle-exclamation',`실패 호스트 (${d.failed_hosts.length}대)`,'#ef4444',
            `<div style="display:flex;flex-wrap:wrap;gap:6px;">${chips}</div>`);
    }

    if (d.changes && d.changes.length > 0) {
        const rows = d.changes.map(c =>
            `<tr onmouseover="this.style.background='rgba(56,189,248,0.06)'" onmouseout="this.style.background=''">
                <td style="padding:7px 12px;font-family:monospace;font-size:0.8rem;font-weight:700;color:#38bdf8;width:100px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml((c.cam_id||'').toUpperCase())}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamStadium(c.cam_id))}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamCategory(c.cam_id))}</td>
                <td style="padding:7px 12px;font-family:monospace;font-size:0.78rem;color:#94a3b8;word-break:break-all;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${c.old ? escapeHtml(c.old) : '<i style="color:#475569;">없음</i>'}</td>
                <td style="padding:7px 12px;text-align:center;color:#475569;width:30px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">→</td>
                <td style="padding:7px 12px;font-family:monospace;font-size:0.78rem;color:#86efac;word-break:break-all;border-bottom:1px solid rgba(255,255,255,0.06);">${c.new ? escapeHtml(c.new) : '<i style="color:#475569;">없음</i>'}</td>
            </tr>`).join('');
        h += dSection('fa-code-merge',`변경 카메라 정보 (${d.changes.length}건)`,'#38bdf8',
            `<div style="border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.07);">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                    <thead><tr style="background:#0d1726;border-bottom:1px solid rgba(255,255,255,0.08);">
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:100px;border-right:1px solid rgba(255,255,255,0.08);">캠 ID</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기장명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기종목명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;border-right:1px solid rgba(255,255,255,0.08);">이전 주소</th>
                        <th style="width:30px;border-right:1px solid rgba(255,255,255,0.08);"></th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;">변경 주소</th>
                    </tr></thead>
                    <tbody style="background:rgba(15,23,42,0.5);">${rows}</tbody>
                </table>
            </div>`);
    }

    if (d.deploy_output && d.deploy_output.trim()) {
        h += dSection('fa-terminal','배포 스크립트 출력','#94a3b8',
            `<pre style="background:#050b16;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:12px 14px;font-size:0.74rem;color:#94a3b8;overflow-x:auto;max-height:240px;overflow-y:auto;line-height:1.6;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(d.deploy_output.trim())}</pre>`);
    }

    return h || '<span style="color:#64748b;font-size:0.83rem;">저장된 세부 정보가 없습니다.</span>';
}

/* ── ddns_update 상세 ── */
function buildDdnsDetail(d) {
    let h = '';

    h += dSection('fa-arrows-rotate','조회 결과','#8b5cf6',
        `<div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${dStat('총 카메라', d.total   ?? '-', '#60a5fa')}
            ${dStat('성공',      d.success ?? '-', '#10b981')}
            ${dStat('실패',      d.fail    ?? '-', (d.fail ?? 0) > 0 ? '#ef4444' : '#10b981')}
        </div>`);

    if (d.failures && d.failures.length > 0) {
        const rows = d.failures.map(f => {
            const cam = allCctvs.find(c => String(c.id || '').trim().toLowerCase() === String(f.cam_id || '').trim().toLowerCase());
            const ddnsUrl = cam && cam.ddns ? cam.ddns : '';
            const linkHtml = ddnsUrl 
                ? `<td style="padding:7px 12px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);"><a href="${escapeHtml(ddnsUrl)}" target="_blank" class="btn" style="padding:2px 8px;font-size:0.75rem;" title="DDNS 바로가기"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>` 
                : `<td style="padding:7px 12px;text-align:center;color:#475569;border-bottom:1px solid rgba(255,255,255,0.05);">-</td>`;
            return `<tr onmouseover="this.style.background='rgba(239,68,68,0.05)'" onmouseout="this.style.background=''">
                <td style="padding:7px 12px;font-family:monospace;font-size:0.8rem;font-weight:700;color:#f87171;width:100px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml((f.cam_id||'').toUpperCase())}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamStadium(f.cam_id))}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamCategory(f.cam_id))}</td>
                <td style="padding:7px 12px;font-size:0.78rem;color:#94a3b8;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(f.error||'-')}</td>
                ${linkHtml}
            </tr>`;
        }).join('');
        h += dSection('fa-circle-xmark',`실패 카메라 (${d.failures.length}대)`,'#ef4444',
            `<div style="border-radius:8px;overflow:hidden;border:1px solid rgba(239,68,68,0.15);">
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="background:#0d1726;border-bottom:1px solid rgba(255,255,255,0.07);">
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:100px;border-right:1px solid rgba(255,255,255,0.08);">캠 ID</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기장명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기종목명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;border-right:1px solid rgba(255,255,255,0.08);">오류 메시지</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:center;width:110px;">DDNS 바로가기</th>
                    </tr></thead>
                    <tbody style="background:rgba(15,23,42,0.5);">${rows}</tbody>
                </table>
            </div>`);
    }

    if (d.changes && d.changes.length > 0) {
        const rows = d.changes.map(c =>
            `<tr onmouseover="this.style.background='rgba(139,92,246,0.05)'" onmouseout="this.style.background=''">
                <td style="padding:7px 12px;font-family:monospace;font-size:0.8rem;font-weight:700;color:#a78bfa;width:100px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml((c.cam_id||'').toUpperCase())}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamStadium(c.cam_id))}</td>
                <td style="padding:7px 12px;font-size:0.8rem;color:#cbd5e1;width:140px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(getCamCategory(c.cam_id))}</td>
                <td style="padding:7px 12px;font-family:monospace;font-size:0.78rem;color:#94a3b8;word-break:break-all;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(c.old||'-')}</td>
                <td style="padding:7px 12px;text-align:center;color:#475569;width:30px;border-right:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.06);">→</td>
                <td style="padding:7px 12px;font-family:monospace;font-size:0.78rem;color:#86efac;word-break:break-all;border-bottom:1px solid rgba(255,255,255,0.06);">${escapeHtml(c.new||'-')}</td>
            </tr>`).join('');
        h += dSection('fa-arrow-right-arrow-left',`주소 변경 감지 (${d.changes.length}건)`,'#a78bfa',
            `<div style="border-radius:8px;overflow:hidden;border:1px solid rgba(139,92,246,0.15);">
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="background:#0d1726;border-bottom:1px solid rgba(255,255,255,0.07);">
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:100px;border-right:1px solid rgba(255,255,255,0.08);">캠 ID</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기장명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;width:140px;border-right:1px solid rgba(255,255,255,0.08);">경기종목명</th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;border-right:1px solid rgba(255,255,255,0.08);">이전 주소</th>
                        <th style="width:30px;border-right:1px solid rgba(255,255,255,0.08);"></th>
                        <th style="padding:8px 12px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;">변경 주소</th>
                    </tr></thead>
                    <tbody style="background:rgba(15,23,42,0.5);">${rows}</tbody>
                </table>
            </div>`);
    } else if (!d.failures || d.failures.length === 0) {
        h += `<div style="color:#64748b;font-size:0.83rem;padding:4px 0;"><i class="fa-solid fa-circle-check" style="color:#10b981;margin-right:6px;"></i>주소 변경 없음 — 모든 카메라 정상 조회</div>`;
    }

    return h;
}

/* ── env_config 상세 ── */
function buildEnvDetail(d) {
    const FNAME = {
        enabled: '알람 활성화',
        start_time: '알람 시작 시간',
        end_time: '알람 종료 시간',
        work_days: '작업 요일',
        recipient: '수신 이메일',
        suppress_until: '알람 억제 시간',
        traffic_enabled: '트래픽 수집 사용',
        traffic_start: '트래픽 수집 시작',
        traffic_end: '트래픽 수집 종료',
    };
    const DAYS  = ['일','월','화','수','목','금','토'];
    const fmt   = (f, v) => {
        if (v === null || v === undefined) return '<i style="color:#475569;">없음</i>';
        if (f === 'work_days' && Array.isArray(v)) return v.map(i => DAYS[i]).join(', ');
        if (f === 'enabled' || f === 'traffic_enabled') return (v === true || v === '1' || v === 1) ? '활성' : '비활성';
        return escapeHtml(String(v));
    };
    const fields = d.changed_fields || [];
    const vals   = d.values || {};
    if (fields.length === 0) return '<span style="color:#64748b;font-size:0.83rem;">변경 항목이 없습니다.</span>';

    const rows = fields.map(f =>
        `<tr onmouseover="this.style.background='rgba(245,158,11,0.05)'" onmouseout="this.style.background=''">
            <td style="padding:10px 14px;font-size:0.82rem;font-weight:700;color:#fbbf24;white-space:nowrap;width:160px;">${escapeHtml(FNAME[f]||f)}</td>
            <td style="padding:10px 14px;font-size:0.82rem;color:#38bdf8;">${fmt(f, vals[f])}</td>
        </tr>`).join('');

    return dSection('fa-cogs',`변경된 설정 항목 (${fields.length}개)`,'#f59e0b',
        `<div style="border-radius:8px;overflow:hidden;border:1px solid rgba(245,158,11,0.15);max-width:520px;">
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#0d1726;border-bottom:1px solid rgba(255,255,255,0.07);">
                    <th style="padding:8px 14px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;">항목</th>
                    <th style="padding:8px 14px;font-size:0.74rem;color:#64748b;font-weight:700;text-align:left;">변경값</th>
                </tr></thead>
                <tbody style="background:rgba(15,23,42,0.5);">${rows}</tbody>
            </table>
        </div>`);
}

function buildRelayRestartDetail(d) {
    let h = '';
    if (d.cam_id) {
        const ipHtml = d.ip
            ? `<span style="color:#64748b;font-family:monospace;margin-left:8px;">${escapeHtml(d.ip)}</span>`
            : '';
        h += dSection('fa-video', '대상 카메라', '#10b981',
            `<div>${getFormattedCamName(d.cam_id)}${ipHtml}</div>`);
    }
    if (d.output && String(d.output).trim()) {
        h += dSection('fa-terminal', '출력', '#94a3b8',
            `<pre style="background:#050b16;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:12px 14px;font-size:0.74rem;color:#94a3b8;overflow-x:auto;max-height:240px;overflow-y:auto;line-height:1.6;margin:0;white-space:pre-wrap;word-break:break-all;">${escapeHtml(String(d.output).trim())}</pre>`);
    } else {
        h += `<div style="color:#64748b;font-size:0.83rem;">추가 출력 없음</div>`;
    }
    return h;
}

function switchDeploySubTab(tab) {
    const btnInfo = document.getElementById('btn-sub-deploy-info');
    const btnRelay = document.getElementById('btn-sub-deploy-relay');
    const viewInfo = document.getElementById('sub-deploy-info-view');
    const viewRelay = document.getElementById('sub-deploy-relay-view');

    if (tab === 'info') {
        btnInfo?.classList.add('active');
        btnRelay?.classList.remove('active');
        if (viewInfo) viewInfo.style.display = 'block';
        if (viewRelay) viewRelay.style.display = 'none';
        loadDeployTableData();
    } else if (tab === 'relay') {
        btnInfo?.classList.remove('active');
        btnRelay?.classList.add('active');
        if (viewInfo) viewInfo.style.display = 'none';
        if (viewRelay) viewRelay.style.display = 'block';
        loadRelayRestartData();
    }
}

let selectedRelayCamIds = new Set();
let relayRestartBusy = false;

async function loadRelayRestartData() {
    if (relayRestartBusy) {
        showToast('재기동 작업이 진행 중입니다.');
        return;
    }
    const tbody = document.getElementById('relay-restart-table-body');
    const empty = document.getElementById('relay-restart-empty');
    const tableWrap = tbody ? tbody.closest('table') : null;
    const refreshBtn = document.getElementById('btn-relay-refresh');
    if (!tbody) return;

    const refreshHtml = '<i class="fa-solid fa-rotate-right"></i> 상태 새로고침';
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 조회 중...';
    }

    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px 12px; text-align:center; color:#64748b;">
        <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i>서버 목록 불러오는 중...
    </td></tr>`;
    if (empty) empty.style.display = 'none';
    if (tableWrap) tableWrap.style.display = '';

    try {
        const res  = await fetch('api.php?action=get_deploy_info&_t=' + new Date().getTime());
        const data = await res.json();
        if (!data.success) {
            showToast('설정 정보를 불러오지 못했습니다.');
            tbody.innerHTML = `<tr><td colspan="8" style="padding:40px 12px; text-align:center; color:#ef4444;">설정 정보를 불러오지 못했습니다.</td></tr>`;
            return;
        }

        const cams = data.cctvs || [];
        if (cams.length === 0) {
            tbody.innerHTML = '';
            if (tableWrap) tableWrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            selectedRelayCamIds = new Set();
            syncRelaySelectionUI();
            return;
        }
        if (empty) empty.style.display = 'none';
        if (tableWrap) tableWrap.style.display = '';

        const validIds = new Set(cams.map(c => c.id));
        selectedRelayCamIds = new Set(Array.from(selectedRelayCamIds).filter(id => validIds.has(id) && data.ips && data.ips[id]));

        tbody.innerHTML = '';
        cams.forEach(c => {
            const ip = (data.ips && data.ips[c.id]) ? data.ips[c.id] : '';
            tbody.appendChild(buildRelayRow(c, ip, ip ? null : { status: 'no_ip', message: 'IP 정보 없음' }));
        });
        syncRelaySelectionUI();

        const statusFetches = cams.filter(c => data.ips && data.ips[c.id]).map(async c => {
            try {
                const r = await fetch(`api.php?action=get_relay_status&cam_id=${encodeURIComponent(c.id)}&_t=${Date.now()}`);
                const d = await r.json();
                updateRelayRowStatus(c.id, d);
            } catch {
                updateRelayRowStatus(c.id, { status: 'unreachable', message: '조회 오류' });
            }
        });

        await Promise.allSettled(statusFetches);
        updateRelayStickyOffset();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:40px 12px; text-align:center; color:#ef4444;">
            <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>목록 로딩 중 오류가 발생했습니다.
        </td></tr>`;
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = refreshHtml;
        }
        syncRelaySelectionUI();
    }
}

function updateRelayStickyOffset() {
    const bar = document.querySelector('#sub-deploy-relay-view .relay-sticky-top-bar');
    if (!bar) return;
    document.documentElement.style.setProperty('--relay-bar-h', `${bar.offsetHeight}px`);
}

function relayStatusPill(statusData) {
    if (statusData === null) {
        return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;font-size:0.75rem;font-weight:700;background:rgba(100,116,139,0.12);color:#94a3b8;border:1px solid rgba(100,116,139,0.25);">
            <i class="fa-solid fa-spinner fa-spin" style="font-size:0.7rem;"></i> 조회중...
        </span>`;
    }
    const st = statusData.status || 'unknown';
    const msg = statusData.message || st;
    const style = {
        active:      { bg:'rgba(16,185,129,0.12)',  color:'#10b981', border:'rgba(16,185,129,0.3)',   icon:'fa-circle-check' },
        inactive:    { bg:'rgba(239,68,68,0.10)',   color:'#f87171', border:'rgba(239,68,68,0.3)',    icon:'fa-circle-stop' },
        failed:      { bg:'rgba(239,68,68,0.12)',   color:'#ef4444', border:'rgba(239,68,68,0.35)',   icon:'fa-circle-xmark' },
        unreachable: { bg:'rgba(245,158,11,0.10)',  color:'#f59e0b', border:'rgba(245,158,11,0.3)',   icon:'fa-plug-circle-xmark' },
        no_ip:       { bg:'rgba(100,116,139,0.10)', color:'#64748b', border:'rgba(100,116,139,0.25)', icon:'fa-circle-question' },
        no_pw:       { bg:'rgba(100,116,139,0.10)', color:'#64748b', border:'rgba(100,116,139,0.25)', icon:'fa-key' },
        restarting:  { bg:'rgba(245,158,11,0.12)',  color:'#fbbf24', border:'rgba(245,158,11,0.35)',  icon:'fa-spinner fa-spin' },
        verifying:   { bg:'rgba(59,130,246,0.12)',  color:'#60a5fa', border:'rgba(59,130,246,0.35)',  icon:'fa-spinner fa-spin' },
        done:        { bg:'rgba(16,185,129,0.12)',  color:'#10b981', border:'rgba(16,185,129,0.3)',   icon:'fa-circle-check' },
    }[st] || { bg:'rgba(100,116,139,0.10)', color:'#94a3b8', border:'rgba(100,116,139,0.25)', icon:'fa-circle-question' };
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;font-size:0.75rem;font-weight:700;background:${style.bg};color:${style.color};border:1px solid ${style.border};">
        <i class="fa-solid ${style.icon}" style="font-size:0.7rem;"></i> ${escapeHtml(msg)}
    </span>`;
}

function relayRestartButtonHtml(camId, disabled) {
    const dis = disabled ? 'disabled' : '';
    const opacity = disabled ? 'opacity:0.45;cursor:not-allowed;' : '';
    return `<button type="button" ${dis} onclick="restartRemoteRelay('${escapeHtml(camId)}')"
        style="background:#d97706;color:#fff;font-weight:700;height:34px;padding:0 12px;border:none;border-radius:8px;cursor:pointer;white-space:nowrap;${opacity}">
        <i class="fa-solid fa-arrows-rotate"></i> 재기동
    </button>`;
}

function buildRelayRow(cam, ip, statusData) {
    const sInfo = parseStadium(cam.stadium);
    const tr = document.createElement('tr');
    tr.id = `relay-row-${cam.id}`;
    tr.dataset.camId = cam.id;
    tr.dataset.ip = ip || '';
    const hasIp = !!(ip && ip.trim());
    tr.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
    tr.style.cursor = hasIp ? 'pointer' : 'default';
    const checked = selectedRelayCamIds.has(cam.id) ? 'checked' : '';
    const cbDis = hasIp ? '' : 'disabled';
    tr.innerHTML = `
        <td style="padding:10px 12px; vertical-align:middle;">
            <input type="checkbox" class="relay-row-check" value="${escapeHtml(cam.id)}" ${checked} ${cbDis}
                onchange="toggleRelaySelection(this)" style="width:16px;height:16px;cursor:${hasIp ? 'pointer' : 'not-allowed'};">
        </td>
        <td style="padding:10px 12px; vertical-align:middle;">${cam.num}</td>
        <td style="padding:10px 12px; vertical-align:middle; font-family:monospace; font-weight:700; color:#f8fafc;">${escapeHtml(String(cam.id || '').toUpperCase())}</td>
        <td style="padding:10px 12px; vertical-align:middle;">${escapeHtml(sInfo.name || cam.stadium || '')}</td>
        <td style="padding:10px 12px; vertical-align:middle; color:#3b82f6; font-weight:500;">${escapeHtml(cam.category || '')}</td>
        <td style="padding:10px 12px; vertical-align:middle; font-family:monospace; color:${hasIp ? '#94a3b8' : '#64748b'};">${hasIp ? escapeHtml(ip) : '-'}</td>
        <td class="relay-status-cell" style="padding:10px 12px; vertical-align:middle;">${relayStatusPill(statusData)}</td>
        <td class="relay-action-cell" style="padding:10px 12px; vertical-align:middle; text-align:right;">${relayRestartButtonHtml(cam.id, !hasIp)}</td>
    `;
    tr.addEventListener('click', (e) => {
        if (e.target.closest('input, button, a')) return;
        const cb = tr.querySelector('.relay-row-check');
        if (!cb || cb.disabled) return;
        cb.checked = !cb.checked;
        toggleRelaySelection(cb);
    });
    return tr;
}

function updateRelayRowStatus(camId, statusData) {
    const row = document.getElementById(`relay-row-${camId}`);
    if (!row) return;
    const cell = row.querySelector('.relay-status-cell');
    if (cell) cell.innerHTML = relayStatusPill(statusData);
}

function resetRelayRestartButton(btn, disabled) {
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '0.45' : '1';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 재기동';
}

function setRelayRowBusy(camId, busy, statusData) {
    const row = document.getElementById(`relay-row-${camId}`);
    if (!row) return;
    const btn = row.querySelector('.relay-action-cell button');
    const cb = row.querySelector('.relay-row-check');
    if (statusData) updateRelayRowStatus(camId, statusData);
    if (btn) {
        if (busy) {
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 재기동 중...';
        } else {
            resetRelayRestartButton(btn, !row.dataset.ip);
        }
    }
    if (cb && row.dataset.ip) cb.disabled = !!busy;
}

function toggleRelaySelection(cb) {
    if (!cb) return;
    if (cb.checked) selectedRelayCamIds.add(cb.value);
    else selectedRelayCamIds.delete(cb.value);
    syncRelaySelectionUI();
}

function toggleRelaySelectAll(master) {
    const checks = document.querySelectorAll('.relay-row-check:not(:disabled)');
    const isChecked = !!(master && master.checked);
    checks.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) selectedRelayCamIds.add(cb.value);
        else selectedRelayCamIds.delete(cb.value);
    });
    syncRelaySelectionUI();
}

function syncRelaySelectionUI() {
    const checks = Array.from(document.querySelectorAll('.relay-row-check:not(:disabled)'));
    const master = document.getElementById('relay-select-all');
    const countEl = document.getElementById('relay-selected-count');
    const batchBtn = document.getElementById('btn-relay-batch-restart');
    const n = selectedRelayCamIds.size;
    if (countEl) countEl.textContent = String(n);
    if (batchBtn) {
        const on = n > 0 && !relayRestartBusy;
        batchBtn.disabled = !on;
        batchBtn.style.opacity = on ? '1' : '0.45';
    }
    const refreshBtn = document.getElementById('btn-relay-refresh');
    if (refreshBtn) refreshBtn.disabled = !!relayRestartBusy;
    if (master) {
        if (checks.length === 0) {
            master.checked = false;
            master.indeterminate = false;
        } else {
            const selectedEnabled = checks.filter(cb => cb.checked).length;
            master.checked = selectedEnabled === checks.length;
            master.indeterminate = selectedEnabled > 0 && selectedEnabled < checks.length;
        }
    }
}

async function fetchRelayStatus(camId) {
    const r = await fetch(`api.php?action=get_relay_status&cam_id=${encodeURIComponent(camId)}&_t=${Date.now()}`);
    return r.json();
}

async function verifyRelayActive(camId, attempts = 4, delayMs = 1500) {
    let last = { status: 'unknown', message: '상태 확인 실패' };
    for (let i = 0; i < attempts; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            last = await fetchRelayStatus(camId);
            updateRelayRowStatus(camId, last);
            if (last.status === 'active') return last;
        } catch {
            last = { status: 'unreachable', message: '상태 재조회 실패' };
            updateRelayRowStatus(camId, last);
        }
    }
    return last;
}

async function restartOneRelay(camId, isBatch = false) {
    setRelayRowBusy(camId, true, { status: 'restarting', message: '재기동 중...' });
    try {
        const res  = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'restart_cctv_relay', cam_id: camId, is_batch: isBatch })
        });
        const data = await res.json();
        if (!data.success) {
            updateRelayRowStatus(camId, { status: 'failed', message: data.message || '재기동 실패' });
            return { cam_id: camId, success: false, verified: false, message: data.message || '재기동 실패', status: 'failed', ip: data.ip || '' };
        }
        updateRelayRowStatus(camId, { status: 'verifying', message: '기동 확인 중...' });
        const verified = await verifyRelayActive(camId);
        const ok = verified.status === 'active';
        return {
            cam_id: camId,
            success: true,
            verified: ok,
            status: verified.status,
            ip: data.ip || '',
            message: ok ? '재기동 완료 (실행중)' : (`재기동 명령은 성공했으나 상태: ${verified.message || verified.status}`)
        };
    } catch (e) {
        updateRelayRowStatus(camId, { status: 'failed', message: '요청 오류' });
        return { cam_id: camId, success: false, verified: false, message: '재기동 요청 중 에러', status: 'failed', ip: '' };
    } finally {
        setRelayRowBusy(camId, false);
    }
}

async function restartRemoteRelay(camId) {
    if (relayRestartBusy) {
        showToast('재기동 작업이 진행 중입니다.');
        return;
    }
    if (!confirm(`정말 캠 [${camId.toUpperCase()}] 서버의 cctv-relay 서비스를 재기동하시겠습니까?`)) return;

    relayRestartBusy = true;
    syncRelaySelectionUI();
    showDeployLock(`[${camId.toUpperCase()}] cctv-relay 재기동 중...`);
    updateDeployLockMessage(`[${camId.toUpperCase()}] cctv-relay 재기동 중...`, '원격 서버에 재기동 명령을 보내고 기동 여부를 확인합니다');

    const result = await restartOneRelay(camId);
    hideDeployLock();
    relayRestartBusy = false;
    syncRelaySelectionUI();
    showRelayRestartCompletePopup([result]);
}

async function restartSelectedRelays() {
    if (relayRestartBusy) {
        showToast('재기동 작업이 진행 중입니다.');
        return;
    }
    const ids = Array.from(selectedRelayCamIds);
    if (ids.length === 0) {
        showToast('재기동할 카메라를 선택하세요.');
        return;
    }
    if (!confirm(`선택한 ${ids.length}대 서버의 cctv-relay 서비스를 일괄 재기동하시겠습니까?`)) return;

    relayRestartBusy = true;
    syncRelaySelectionUI();
    showDeployLock(`cctv-relay 일괄 재기동 0/${ids.length}`);
    updateDeployLockMessage(`cctv-relay 일괄 재기동 0/${ids.length}`, '한 대씩 재기동한 뒤 서비스가 올라왔는지 확인합니다');

    const results = [];
    for (let i = 0; i < ids.length; i++) {
        const camId = ids[i];
        updateDeployLockMessage(
            `cctv-relay 일괄 재기동 ${i + 1}/${ids.length}`,
            `[${camId.toUpperCase()}] 재기동 명령 전송 및 기동 확인 중`
        );
        results.push(await restartOneRelay(camId, true));
    }

    // 서버로 일괄 결과 모아서 한 번에 이력 로그 전송
    try {
        await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'batch_restart_cctv_relay', results: results })
        });
    } catch (e) {
        console.error('일괄 재기동 이력 기록 실패', e);
    }

    hideDeployLock();
    relayRestartBusy = false;
    syncRelaySelectionUI();
    showRelayRestartCompletePopup(results);
}

function showRelayRestartCompletePopup(results) {
    const existing = document.getElementById('deploy-complete-popup');
    if (existing) existing.remove();

    const total = results.length;
    const verified = results.filter(r => r.verified).length;
    const cmdOk = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success || !r.verified);
    const allOk = failed.length === 0;
    const isPartial = !allOk && verified > 0;

    const popup = document.createElement('div');
    popup.id = 'deploy-complete-popup';
    const borderColor = allOk ? 'rgba(16,185,129,0.4)' : (isPartial ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.35)');
    popup.style.cssText = `
        position: fixed; bottom: 24px; right: 24px; z-index: 3000;
        background: #111827; border: 1px solid ${borderColor};
        border-radius: 16px; padding: 20px 24px; min-width: 320px; max-width: 460px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6); animation: slideInUp 0.3s ease;
        display: flex; flex-direction: column; gap: 12px;
    `;

    const title = allOk ? '재기동 완료' : (isPartial ? '재기동 부분 완료' : '재기동 실패');
    const sub = allOk
        ? 'cctv-relay 서비스가 실행 중인지 확인했습니다'
        : '일부 서버는 재기동되지 않았거나 기동 확인에 실패했습니다';
    const icon = allOk ? 'fa-circle-check' : (isPartial ? 'fa-circle-exclamation' : 'fa-circle-xmark');
    const iconColor = allOk ? '#10b981' : (isPartial ? '#f59e0b' : '#ef4444');
    const iconBg = allOk ? 'rgba(16,185,129,0.15)' : (isPartial ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)');

    const failChips = failed.slice(0, 8).map(r =>
        `<span style="background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.2); border-radius:5px; padding:2px 7px; font-size:0.74rem; font-family:monospace;">${escapeHtml(String(r.cam_id || '').toUpperCase())}</span>`
    ).join('');

    popup.innerHTML = `
        <style>@keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }</style>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:2px;">
            <div style="width:36px; height:36px; border-radius:50%; background:${iconBg}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                <i class="fa-solid ${icon}" style="color:${iconColor}; font-size:1.1rem;"></i>
            </div>
            <div>
                <div style="font-weight:800; font-size:0.98rem; color:#f8fafc; letter-spacing:-0.01em;">${title}</div>
                <div style="font-size:0.78rem; color:#94a3b8; margin-top:1px;">${sub}</div>
            </div>
            <button onclick="document.getElementById('deploy-complete-popup').remove()" style="margin-left:auto; background:none; border:none; color:#64748b; cursor:pointer; font-size:1.2rem; line-height:1; padding:0 2px;">&times;</button>
        </div>
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:12px 14px; font-size:0.82rem;">
            <div style="display:flex; gap:16px; flex-wrap:wrap;">
                <span style="color:#94a3b8;">대상 <strong style="color:#60a5fa;">${total}</strong>대</span>
                <span style="color:#94a3b8;">기동 확인 <strong style="color:#10b981;">${verified}</strong>대</span>
                <span style="color:#94a3b8;">명령 성공 <strong style="color:#38bdf8;">${cmdOk}</strong>대</span>
                <span style="color:#94a3b8;">미확인/실패 <strong style="color:#ef4444;">${failed.length}</strong>대</span>
            </div>
            ${failed.length ? `<div style="font-size:0.78rem; color:#64748b; font-weight:600; margin:10px 0 6px;">미확인/실패</div>
            <div style="display:flex; flex-wrap:wrap; gap:5px;">${failChips}${failed.length > 8 ? `<span style="color:#64748b; font-size:0.74rem;">+${failed.length - 8}대</span>` : ''}</div>` : ''}
        </div>
        <button onclick="setViewMode('history'); setHistoryTab('cctv_relay_restart'); document.getElementById('deploy-complete-popup').remove();" style="background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); color:#34d399; border-radius:8px; padding:8px 14px; font-size:0.82rem; font-weight:600; cursor:pointer; text-align:left; display:flex; align-items:center; gap:8px;">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>재기동 이력 확인</span>
            <i class="fa-solid fa-chevron-right" style="margin-left:auto; font-size:0.75rem;"></i>
        </button>
    `;
    document.body.appendChild(popup);
    setTimeout(() => {
        if (document.getElementById('deploy-complete-popup')) {
            popup.style.opacity = '0';
            popup.style.transform = 'translateY(10px)';
            popup.style.transition = 'all 0.3s ease';
            setTimeout(() => popup.remove(), 300);
        }
    }, 14000);
}

