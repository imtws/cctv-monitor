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
    document.body.classList.toggle('list-mode', mode === 'list');
    document.body.classList.toggle('card-mode', mode !== 'list');
    const btnCard  = document.getElementById('btn-card-view');
    const btnList  = document.getElementById('btn-list-view');
    const cardPanel = document.getElementById('card-panel');
    const listPanel = document.getElementById('list-panel');

    if (mode === 'list') {
        btnList?.classList.add('active');    btnList?.style && (btnList.style.background = btnList.style.color = '');
        btnCard?.classList.remove('active'); btnCard?.style && (btnCard.style.background = btnCard.style.color = '');
        if (cardPanel) cardPanel.style.display = 'none';
        if (listPanel) listPanel.style.display = 'block';
    } else {
        btnCard?.classList.add('active');   btnCard?.style && (btnCard.style.background = btnCard.style.color = '');
        btnList?.classList.remove('active'); btnList?.style && (btnList.style.background = btnList.style.color = '');
        if (cardPanel) cardPanel.style.display = 'block';
        if (listPanel) listPanel.style.display = 'none';
    }

    if (mode === 'card') {
        renderVideoGrid();
    } else {
        Object.values(hlsInstances).forEach(hls => hls.destroy());
        hlsInstances = {};
        renderTable();
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

function resetFilters() {
    activePageFilter = 'all';
    const statusFilter  = document.getElementById('status-filter');
    const searchInput   = document.getElementById('search-input');
    const stadiumFilter = document.getElementById('stadium-filter');
    if (statusFilter)  statusFilter.value  = '';
    if (searchInput)   searchInput.value   = '';
    if (stadiumFilter) stadiumFilter.value = '';
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

    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (query) {
        list = list.filter(c => {
            const haystack = [c.id, c.num, c.category, c.stadium, c.ddns, getStatusLabel(c.status)]
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

async function loadData() {
    try {
        const res  = await fetch('api.php?action=get_data&_t=' + new Date().getTime());
        const data = await res.json();
        if (data.success) {
            allCctvs    = data.cctvs;
            alertConfig = data.alert;
            const validIds = new Set(allCctvs.map(c => c.id));
            selectedCamIds = new Set(Array.from(selectedCamIds).filter(id => validIds.has(id)));

            updateSummaryBadges();
            populateStadiumFilter();
            renderPagingButtons();
            renderCurrentView();
            updateStickyOffsets();
        }
    } catch (e) {
        showToast('데이터 로딩 실패');
    }
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
    else renderTable();
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
    Object.values(hlsInstances).forEach(hls => hls.destroy());
    hlsInstances = {};

    const filtered = getFilteredCctvs();
    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-sub);">해당하는 카메라가 없습니다.</div>';
        return;
    }

    filtered.forEach(cam => {
        const card = document.createElement('div');
        card.className = 'video-card';
        const streamUrl = getStreamUrl(cam.id);
        card.innerHTML = `
            <div class="video-wrapper" id="wrapper-${cam.id}" style="display: block;">
                <input type="checkbox" class="cam-multi-check" value="${cam.id}" ${selectedCamIds.has(cam.id) ? 'checked' : ''} onchange="toggleCameraSelection(this)" style="position: absolute; top: 10px; left: 10px; z-index: 10; width: 20px; height: 20px; cursor: pointer;">
                <video id="vid-${cam.id}" autoplay muted controls playsinline></video>
            </div>
            <div class="card-body">
                <div class="card-header-info" style="gap: 10px; align-items: flex-start;">
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                        <div class="cam-title">CAM ${cam.num < 10 ? '0' + cam.num : cam.num} - ${cam.category}</div>
                        <div class="cam-stadium">${cam.stadium}</div>
                        <div class="status-chip">${getStatusMarkup(cam.status)}</div>
                        <div class="schedule-chip">${getScheduleMarkup(cam)}</div>
                    </div>
                    <a href="${cam.ddns}" target="_blank" class="btn" style="padding: 2px 8px; font-size: 0.75rem;" title="DDNS"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                </div>
                <div class="card-actions">
                    <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" title="설정"><i class="fa-solid fa-sliders"></i></button>
                    <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')" title="확대"><i class="fa-solid fa-expand"></i></button>
                </div>
            </div>
        `;
        container.appendChild(card);

        const videoEl = document.getElementById(`vid-${cam.id}`);
        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: false });
            hls.loadSource(streamUrl);
            hls.attachMedia(videoEl);
            hlsInstances[cam.id] = hls;
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = streamUrl;
        }
    });

    syncMasterSelection();
    updateStickyOffsets();
}

function renderTable() {
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
                    <div class="schedule-chip">${getScheduleMarkup(cam)}</div>
                </div>
                <div class="col-stadium">${cam.stadium}</div>
                <div class="col-category">${cam.category}</div>
                <div class="col-status"><span class="status-chip">${getStatusMarkup(cam.status)}</span></div>
                <div class="col-actions">
                    <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" style="padding: 4px 8px; font-size: 0.75rem;" title="설정"><i class="fa-solid fa-sliders"></i></button>
                    <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')" style="padding: 4px 8px; font-size: 0.75rem;" title="확대"><i class="fa-solid fa-expand"></i></button>
                    <button class="btn list-toggle" onclick="toggleListRow('${cam.id}')" title="펼치기/접기"><i class="fa-solid ${listExpandedIds.has(cam.id) ? 'fa-chevron-up' : 'fa-chevron-down'}"></i></button>
                </div>
            </div>
            <div class="list-detail">
                <div class="list-detail-grid">
                    <div class="list-preview">
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
                            <div class="detail-card"><label>스케줄</label><div class="value small">${escapeHtml(cam.alert_start || '08:00')} ~ ${escapeHtml(cam.alert_end || '18:00')}</div></div>
                            <div class="detail-card"><label>알림</label><div class="value small">${cam.alert_enabled ? '사용' : '미사용'}</div></div>
                            <div class="detail-card"><label>DDNS</label><div class="value small">
                                ${getSafeExternalUrl(cam.ddns)
                                    ? `<a href="${escapeHtml(cam.ddns)}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd; text-decoration:underline;">${escapeHtml(cam.ddns)}</a>`
                                    : '-'}
                            </div></div>
                        </div>
                    </div>
                    <div class="list-detail-actions">
                        <button class="btn btn-primary" onclick="openItemSettingsModal('${cam.id}')" title="설정"><i class="fa-solid fa-sliders"></i> 설정</button>
                        <button class="btn" onclick="openModal('${cam.id}', '${cam.category}', '${streamUrl}')"><i class="fa-solid fa-expand"></i> 확대</button>
                    </div>
                </div>
            </div>
        `;
        tbody.appendChild(group);

        if (listExpandedIds.has(cam.id)) {
            loadListPreview(cam.id, streamUrl, false);
        }
    });

    syncMasterSelection();
    updateStickyOffsets();
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
    if (s === 'ACTIVE')     return '<i class="fa-solid fa-circle-check status-icon-active"></i><span>경기 진행 중</span>';
    if (s === 'STOPPED')    return '<i class="fa-solid fa-circle-xmark status-icon-stopped"></i><span>작동 중지</span>';
    if (s === 'INSPECTION') return '<i class="fa-solid fa-triangle-exclamation status-icon-inspection"></i><span>점검중</span>';
    return `<span>${escapeHtml(String(s || ''))}</span>`;
}

function getScheduleMarkup(cam) {
    const enabled = cam.alert_enabled ? 'ON' : 'OFF';
    const start   = cam.alert_start || '08:00';
    const end     = cam.alert_end   || '18:00';
    return `
        <span class="schedule-pill ${cam.alert_enabled ? 'enabled' : 'disabled'}">
            <i class="fa-solid fa-bell"></i>
            <span>${enabled}</span>
        </span>
        <span class="schedule-pill">
            <i class="fa-regular fa-clock"></i>
            <span>${escapeHtml(start)}~${escapeHtml(end)}</span>
        </span>
    `;
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

    if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: false });
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
    return [
        `상태: ${getStatusLabel(cam.status)}`,
        `알람: ${cam.alert_enabled ? '사용' : '미사용'}`,
        `스케줄: ${cam.alert_start || '08:00'} ~ ${cam.alert_end || '18:00'}`
    ].join(' · ');
}

function renderSettingsDrawer() {
    const title   = document.getElementById('settings-drawer-title');
    const summary = document.getElementById('settings-drawer-summary');
    const content = document.getElementById('settings-drawer-content');
    if (!title || !summary || !content) return;

    const cams       = settingsDrawerIds.map(id => allCctvs.find(cam => cam.id === id)).filter(Boolean);
    const primaryCam = cams[0] || null;

    title.textContent   = settingsDrawerMode === 'single'
        ? (primaryCam ? `개별 설정 - ${primaryCam.id.toUpperCase()}` : '개별 설정')
        : '일괄 설정';
    summary.textContent = settingsDrawerMode === 'single'
        ? (primaryCam ? `${primaryCam.stadium} · ${primaryCam.category}` : '선택한 카메라의 상태와 알람 스케줄을 수정합니다.')
        : `${cams.length}개 카메라의 상태와 알람 스케줄을 한 번에 수정합니다.`;

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
            <div class="drawer-section-title">알람 스케줄</div>
            <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; margin-bottom:12px;">
                <input type="checkbox" id="settings-enabled">
                <span>알림 사용</span>
            </label>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
                <input type="time" class="text-input" id="settings-start" value="08:00" style="flex:1; min-width: 120px;">
                <span>~</span>
                <input type="time" class="text-input" id="settings-end" value="18:00" style="flex:1; min-width: 120px;">
            </div>
            <button class="btn btn-primary" onclick="applyDrawerSchedule()" style="width:100%; justify-content:center;">스케줄 저장</button>
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

    const enabledEl = document.getElementById('settings-enabled');
    const startEl   = document.getElementById('settings-start');
    const endEl     = document.getElementById('settings-end');
    if (enabledEl) enabledEl.checked = primaryCam ? primaryCam.alert_enabled !== false : true;
    if (startEl)   startEl.value    = primaryCam ? (primaryCam.alert_start || '08:00') : '08:00';
    if (endEl)     endEl.value      = primaryCam ? (primaryCam.alert_end   || '18:00') : '18:00';
}

function collectDrawerPayload() {
    return {
        mode:    settingsDrawerMode,
        ids:     [...settingsDrawerIds],
        enabled: document.getElementById('settings-enabled')?.checked ?? null,
        start:   document.getElementById('settings-start')?.value   ?? '',
        end:     document.getElementById('settings-end')?.value     ?? ''
    };
}

function applyLocalDrawerUpdate(payload) {
    const ids = new Set(payload.ids);
    allCctvs = allCctvs.map(cam => {
        if (!ids.has(cam.id)) return cam;
        const next = { ...cam };
        if (payload.status)         next.status        = payload.status;
        if (payload.enabled !== null) next.alert_enabled = payload.enabled;
        if (payload.start)          next.alert_start   = payload.start;
        if (payload.end)            next.alert_end     = payload.end;
        return next;
    });
}

function buildDrawerConfirmMessage(payload, kind) {
    const cams  = payload.ids.map(id => allCctvs.find(cam => cam.id === id)).filter(Boolean);
    const lines = cams.map(cam => `- CAM ${cam.num < 10 ? '0' + cam.num : cam.num} ${cam.category} (${cam.id})`).join('\n');
    if (kind === 'status') {
        return `아래 카메라의 상태를 ${getStatusLabel(payload.status)}로 변경합니다.\n\n${lines}`;
    }
    if (kind === 'schedule') {
        const alertLine = `알람: ${payload.enabled ? '사용' : '미사용'} / ${payload.start} ~ ${payload.end}`;
        return `아래 카메라의 알람 스케줄을 저장합니다.\n\n${lines}\n\n${alertLine}`;
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

async function applyDrawerSchedule() {
    const payload = collectDrawerPayload();
    if (payload.ids.length === 0) { showToast('선택된 카메라가 없습니다.'); return; }
    if (!window.confirm(buildDrawerConfirmMessage(payload, 'schedule'))) return;
    try {
        const res  = await fetch('api.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'batch_update',
                cam_ids: payload.ids,
                alert_enabled: payload.enabled,
                alert_start:   payload.start,
                alert_end:     payload.end
            })
        });
        const data = await res.json();
        if (data.success) {
            applyLocalDrawerUpdate(payload);
            renderCurrentView();
            syncMasterSelection();
            showToast('스케줄이 저장되었습니다.');
            closeSettingsDrawer();
        } else {
            showToast(data.message || '스케줄 저장 실패');
        }
    } catch (e) {
        showToast('스케줄 저장 실패');
    }
}

async function saveSettingsDrawer() { await applyDrawerSchedule(); }

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

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent  = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

/* ═══════════════════════════════════════════════════════════
   DOMContentLoaded 초기화
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('card-mode');
    loadData();
    updateStickyOffsets();
    window.addEventListener('resize', updateStickyOffsets);
});
