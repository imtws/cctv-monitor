<!-- Header -->
<header>
    <div class="header-title">
        <i class="fa-solid fa-video"></i>
        <h1>CCTV 관제</h1>
    </div>

    <div class="header-actions">
        <div class="switch-container">
            <button id="btn-card-view" class="switch-btn active" onclick="setViewMode('card')"><i class="fa-solid fa-border-all"></i> 카드</button>
            <button id="btn-list-view" class="switch-btn" onclick="setViewMode('list')"><i class="fa-solid fa-list"></i> 리스트</button>
        </div>
        <button class="btn btn-sms-open" onclick="openSmsDrawer()" id="btn-sms-form"><i class="fa-solid fa-message"></i> 문자 발송폼</button>
        <button class="btn" onclick="openBatchSettingsModal()"><i class="fa-solid fa-wrench"></i> 선택 일괄 수정</button>
        <button class="btn" onclick="openEnvSettings()"><i class="fa-solid fa-cogs"></i> 모니터링 환경 설정</button>
    </div>
</header>

<script>
function openEnvSettings() {
    // Open settings drawer in "env" mode for monitoring environment settings
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

    // ── 환경 설정 모드: 수신 메일만 표시 ──
    const footerEl = document.getElementById('settings-drawer-footer');
    if (settingsDrawerMode === 'env') {
        if (footerEl) footerEl.style.display = 'none';
        const currentRecipient = alertConfig?.recipient || '';
        content.innerHTML = `
            <section class="drawer-section">
                <div class="drawer-section-title"><i class="fa-solid fa-envelope" style="margin-right:6px;"></i>수신 메일 주소</div>
                <p style="font-size:0.82rem;color:var(--text-sub);margin:8px 0 12px;">캠 모니터링 알람 발송 대상 메일 주소를 설정합니다.</p>
                <input type="email" class="text-input" id="settings-email"
                    placeholder="example@domain.com"
                    value="${escapeHtml(currentRecipient)}"
                    style="width:100%;margin-bottom:12px;"/>
                <button class="btn btn-success" onclick="saveEnvSettings()" style="width:100%;justify-content:center;">
                    <i class="fa-solid fa-floppy-disk"></i> 저장
                </button>
            </section>
        `;
        return;
    }

    if (footerEl) footerEl.style.display = 'block';
    // ── 개별 / 일괄 수정 모드 ──
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
</script>
