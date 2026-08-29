
<!-- Diff Modal: Show changes before deploying -->
<div class="modal" id="diff-modal" style="z-index: 1100;">
    <div class="modal-content" style="max-width: 900px; width: 90%; background: #1e293b; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); padding: 24px; color: #f8fafc; display: flex; flex-direction: column;">
        <span class="modal-close" onclick="closeDiffModal()" style="position: absolute; top: 16px; right: 20px; font-size: 1.5rem; color: #94a3b8; cursor: pointer;">&times;</span>
        
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <i class="fa-solid fa-triangle-exclamation" style="color: #eab308; font-size: 1.25rem;"></i>
            <h3 style="margin: 0; font-weight: 700; font-size: 1.15rem; letter-spacing: -0.02em;">cctv.info 변경 정보 감지</h3>
        </div>
        <p style="color: #cbd5e1; font-size: 0.88rem; margin-bottom: 16px; line-height: 1.5;">
            갱신된 DDNS 주소를 조회한 결과, 다음과 같은 변경사항이 감지되었습니다. 이 정보를 전체 캠 서버에 배포하시겠습니까?<br>
            <span style="color: #94a3b8; font-size: 0.82rem;">배포 시 전체 CAM 서버 cctv-relay 서비스가 재기동됩니다.</span>
        </p>

        <div style="max-height: 40vh; overflow-y: auto; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; background: #0f172a; padding: 16px; margin-bottom: 20px; font-family: 'Consolas', 'Courier New', monospace; font-size: 0.85rem; line-height: 1.6;">
            <div id="diff-content" style="white-space: pre-wrap; color: #e2e8f0;">
                <!-- Diff list generated dynamically -->
            </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button class="btn" onclick="cancelDeployProcess()" style="background: rgba(255,255,255,0.06); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); font-weight: 600; padding: 10px 18px; border-radius: 8px; cursor: pointer;">취소 (cctv.info 복구)</button>
            <button class="btn btn-success" onclick="confirmDeployProcess()" style="background: #16a34a; color: #fff; font-weight: 600; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer;"><i class="fa-solid fa-paper-plane"></i> 변경 배포 적용</button>
        </div>
    </div>
</div>
