<!-- 설정 드로어 오버레이 -->
<div class="drawer-overlay" id="settings-drawer-overlay" onclick="closeSettingsDrawer()"></div>

<!-- 설정 드로어 -->
<aside class="drawer" id="settings-drawer" aria-hidden="true">
    <div class="drawer-header">
        <div>
            <h3 id="settings-drawer-title">설정</h3>
            <p id="settings-drawer-summary">선택한 카메라의 상태와 알람 스케줄을 조정합니다.</p>
        </div>
        <button class="btn" onclick="closeSettingsDrawer()" aria-label="닫기"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="drawer-body">
        <div id="settings-drawer-content"></div>
    </div>
    <div class="drawer-footer">
        변경 대상은 <code>선택된 항목만</code> 적용됩니다. 상태가 <code>STOPPED</code> 또는 <code>INSPECTION</code>이면 알람 경보 대상에서 제외됩니다. <b>알람 스케줄</b>을 설정하면 지정 시각까지 해당 카메라의 메일 발송이 중지됩니다.
    </div>
</aside>
