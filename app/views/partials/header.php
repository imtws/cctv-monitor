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
        <button class="btn" onclick="openBatchSettingsModal()"><i class="fa-solid fa-gear"></i> 일괄 설정</button>
    </div>
</header>
