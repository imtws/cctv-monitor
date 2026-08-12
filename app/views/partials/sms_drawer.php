<!-- SMS 발송폼 드로어 오버레이 -->
<div class="drawer-overlay" id="sms-drawer-overlay" onclick="closeSmsDrawer()"></div>

<!-- SMS 발송폼 드로어 -->
<aside class="drawer sms-drawer" id="sms-drawer" aria-hidden="true">
    <div class="drawer-header">
        <div>
            <h3><i class="fa-solid fa-message" style="color:#3b82f6;margin-right:8px;font-size:0.95rem;"></i>모니터링 문자 발송폼</h3>
            <p>작동 중지 처리된 캠 기준으로 자동 생성됩니다.</p>
        </div>
        <button class="btn" onclick="closeSmsDrawer()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="drawer-body sms-drawer-body">

        <!-- 제목 폼 -->
        <div class="sms-field-block">
            <div class="sms-field-label">
                <span>제목</span>
                <button class="btn btn-sm sms-copy-btn" onclick="copySmsField('sms-title-field')" title="복사">
                    <i class="fa-regular fa-copy"></i> 복사
                </button>
            </div>
            <div class="sms-input-wrap">
                <input type="text" id="sms-title-field" class="sms-text-input" placeholder="예) 2025년 예시 행사 모니터링" />
            </div>
        </div>

        <!-- 내용 폼 -->
        <div class="sms-field-block sms-field-block--body">
            <div class="sms-field-label">
                <span>내용</span>
                <button class="btn btn-sm sms-copy-btn" onclick="copySmsField('sms-body-field')" title="복사">
                    <i class="fa-regular fa-copy"></i> 복사
                </button>
            </div>
            <div class="sms-textarea-wrap">
                <textarea id="sms-body-field" class="sms-textarea" rows="14" spellcheck="false"></textarea>
            </div>
        </div>

        <!-- 작동 중지 캠 목록 미리보기 -->
        <div class="sms-stopped-preview">
            <div class="sms-field-label" style="margin-bottom:8px;">
                <span><i class="fa-solid fa-circle-stop" style="color:#ef4444;font-size:0.78rem;"></i> 포함된 작동 중지 캠</span>
                <button class="btn btn-sm" onclick="buildSmsForm()" title="새로고침">
                    <i class="fa-solid fa-rotate"></i>
                </button>
            </div>
            <div id="sms-stopped-list" class="sms-stopped-list"></div>
        </div>

        <!-- SMS 발송 링크 -->
        <div class="sms-link-block">
            <i class="fa-solid fa-link" style="color:var(--text-sub);font-size:0.8rem;"></i>
            <span>SMS 발송</span>
            <a href="https://admin.example.com/member/sms/sendsms_system.php" target="_blank" class="sms-external-link">
                admin.example.com <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.75rem;"></i>
            </a>
        </div>

    </div>
</aside>
