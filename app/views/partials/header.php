<!-- Header -->
<header>
    <div class="header-title">
        <i class="fa-solid fa-video"></i>
        <h1><a href="http://cammon.example.com:1080/" style="text-decoration: none; color: inherit; font-weight: bold;">예시 행사 CCTV 관제 페이지</a></h1>
        <div class="family-site">
            <label for="family-site-select" class="family-site-label"><i class="fa-solid fa-link"></i> 패밀리사이트</label>
            <select id="family-site-select" class="family-site-select" onchange="if(this.value){window.open(this.value,'_blank'); this.selectedIndex=0;}">
                <option value="" selected>바로가기</option>
                <option value="traffic.html">트래픽 조회</option>
            </select>
        </div>
    </div>

    <div class="header-actions">
        <div class="switch-container">
            <button id="btn-card-view" class="switch-btn active" onclick="setViewMode('card')"><i class="fa-solid fa-border-all"></i> 카드</button>
            <button id="btn-list-view" class="switch-btn" onclick="setViewMode('list')"><i class="fa-solid fa-list"></i> 리스트</button>
        </div>
        <button id="btn-history-view" class="btn" onclick="setViewMode('history')"><i class="fa-solid fa-clock-rotate-left"></i> 이력 확인</button>
        <button id="btn-deploy-view" class="btn" onclick="setViewMode('deploy')"><i class="fa-solid fa-server"></i> 캠 설정 배포/재기동</button>
        <button class="btn btn-sms-open" onclick="openSmsDrawer()" id="btn-sms-form"><i class="fa-solid fa-message"></i> 문자 발송폼</button>
        <button class="btn" onclick="openBatchSettingsModal()"><i class="fa-solid fa-wrench"></i> 선택 일괄 수정</button>
        <button class="btn" onclick="openEnvSettings()"><i class="fa-solid fa-cogs"></i> 모니터링 환경 설정</button>
    </div>
</header>


