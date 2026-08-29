<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>예시 행사 CCTV 실시간 관제 및 상태 관리 센터</title>
    <!-- favicon -->
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <!-- FontAwesome Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <!-- HLS.js Library -->
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
    <!-- 앱 스타일시트 -->
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

    <?php include __DIR__ . '/partials/header.php'; ?>

    <div class="list-veil" aria-hidden="true"></div>

    <div class="container">
        <?php include __DIR__ . '/partials/toolbar.php'; ?>

        <!-- TAB 1: CCTV Live Viewer -->
        <div id="tab-viewer" class="tab-content active">
            <div id="card-panel" style="display: block;">
                <div class="video-grid" id="video-grid-container"></div>
            </div>

            <div id="list-panel" style="display: none;">
                <div class="list-frame">
                    <div class="list-header">
                        <div class="col-check"><input type="checkbox" id="table-select-all" onclick="toggleCheckAll(this)" style="width: 16px; height: 16px; cursor: pointer;"></div>
                        <div class="col-camera">카메라</div>
                        <div class="col-stadium">경기장</div>
                        <div class="col-category">종목</div>
                        <div class="col-status">상태</div>
                        <div class="col-actions">작업</div>
                    </div>
                    <div id="cam-table-body" class="monitor-list"></div>
                </div>
            </div>

            <div id="deploy-panel" style="display: none;">
                <!-- 서브 탭바 -->
                <div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.07); padding-bottom: 12px;">
                    <button id="btn-sub-deploy-info" class="btn active" onclick="switchDeploySubTab('info')">
                        <i class="fa-solid fa-server"></i> cctv.info 배포정보 & 갱신 반영
                    </button>
                    <button id="btn-sub-deploy-relay" class="btn" onclick="switchDeploySubTab('relay')">
                        <i class="fa-solid fa-arrows-rotate"></i> cam 서버 cctv-relay 서비스 재기동
                    </button>
                </div>

                <!-- 서브뷰 1: 배포 정보 -->
                <div id="sub-deploy-info-view" style="display: block;">
                    <div class="list-frame" style="max-height: none; overflow: visible; background: transparent; border: none; box-shadow: none;">
                        <!-- Sticky Title & Button Bar -->
                        <div class="deploy-sticky-top-bar">
                            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <div>
                                    <h3 style="margin: 0; font-weight: 800; font-size: 1.15rem; color: #f8fafc; letter-spacing: -0.01em;">예시 행사 캠 cctv.info 배포정보</h3>
                                    <p style="color: #94a3b8; font-size: 0.82rem; margin-top: 4px; font-weight: 500;">
                                        엑셀의 IP 열을 세로로 복사(Ctrl+C)하여 아래 IP 입력창에 붙여넣기(Ctrl+V) 하시면 순서대로 자동 입력됩니다.<br>
                                        cctv.info 배포 간 전체 CAM 서버 cctv-relay 서비스가 재기동 됩니다.
                                    </p>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <button class="btn btn-secondary" onclick="resetDeployIps()" style="background: #dc2626; color: #fff; font-weight: 700; height: 40px; padding: 0 16px;"><i class="fa-solid fa-trash-can"></i> IP 정보 초기화</button>
                                    <button class="btn btn-primary" onclick="saveDeployIps()" style="background: #2563eb; color: #fff; font-weight: 700; height: 40px; padding: 0 16px;"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
                                    <button class="btn btn-success" onclick="runDeployProcess()" style="background: #16a34a; color: #fff; font-weight: 700; height: 40px; padding: 0 16px;"><i class="fa-solid fa-arrows-rotate"></i> cctv.info 갱신 반영</button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Table with sticky headers -->
                        <div style="overflow: visible; background: #0f172a; margin-top: 0; border: 1px solid var(--card-border); border-radius: 0 0 16px 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                                <thead>
                                    <tr class="deploy-sticky-th-bar">
                                        <th style="padding: 14px 12px; font-weight: 800; width: 80px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">순번</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 140px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">경기장 번호</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 260px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">경기장명</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 220px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">경기직종명</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 250px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">DDNS명</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 250px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">IP</th>
                                    </tr>
                                </thead>
                                <tbody id="deploy-table-body" style="background: rgba(30, 41, 59, 0.25);">
                                    <!-- Dynamic rendering -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- 서브뷰 2: cam 서버 cctv-relay 서비스 재기동 -->
                <div id="sub-deploy-relay-view" style="display: none;">
                    <div class="list-frame" style="max-height: none; overflow: visible; background: transparent; border: none; box-shadow: none;">
                        <!-- Sticky Title & Button Bar -->
                        <div class="deploy-sticky-top-bar relay-sticky-top-bar">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 16px;">
                                <div style="min-width:0; flex:1;">
                                    <h3 style="margin: 0; font-weight: 800; font-size: 1.15rem; color: #f8fafc; letter-spacing: -0.01em;">cam 서버 cctv-relay 서비스 재기동</h3>
                                    <p style="color: #94a3b8; font-size: 0.82rem; margin-top: 4px; font-weight: 500;">
                                        각 원격 카메라 서버의 cctv-relay 서비스 상태를 확인하고 재기동합니다.
                                    </p>
                                    <p style="color: #64748b; font-size: 0.78rem; margin-top: 8px; line-height: 1.55; font-weight: 500;">
                                        기본적으로 서버 내 crontab을 통해 1분마다 스트리밍 데이터 로드가 되지 않을 시 cctv-relay 서비스를 재기동합니다.<br>
                                        따라서 cctv 정상 갱신 중 상태이나, 화면이 보이지 않는 상태 등 이슈가 확인될 시 아래 기능을 통해 재기동 부탁드리겠습니다.
                                    </p>
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <button id="btn-relay-batch-restart" class="btn" onclick="restartSelectedRelays()" disabled style="background: #d97706; color: #fff; font-weight: 700; height: 40px; padding: 0 16px; opacity: 0.45;">
                                        <i class="fa-solid fa-arrows-rotate"></i> 선택 일괄 재기동 (<span id="relay-selected-count">0</span>)
                                    </button>
                                    <button id="btn-relay-refresh" class="btn" onclick="loadRelayRestartData()" style="background: #0e7490; color: #fff; font-weight: 700; height: 40px; padding: 0 16px;">
                                        <i class="fa-solid fa-rotate-right"></i> 상태 새로고침
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Table -->
                        <div style="overflow: visible; background: #0f172a; margin-top: 0; border: 1px solid var(--card-border); border-radius: 0 0 16px 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                                <thead>
                                    <tr class="deploy-sticky-th-bar">
                                        <th style="padding: 14px 12px; font-weight: 800; width: 44px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">
                                            <input type="checkbox" id="relay-select-all" onchange="toggleRelaySelectAll(this)" style="width:16px;height:16px;cursor:pointer;" title="전체 선택">
                                        </th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 60px;  color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">순번</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 120px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">캠 ID</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 220px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">경기장명</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 160px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">종목명</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 150px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">IP 주소</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 170px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7;">서비스 상태</th>
                                        <th style="padding: 14px 12px; font-weight: 800; width: 130px; color: #f8fafc; background: #111c31; border-bottom: 2px solid #18aee7; text-align: right;">원격 제어</th>
                                    </tr>
                                </thead>
                                <tbody id="relay-restart-table-body" style="background: rgba(30, 41, 59, 0.25);">
                                    <!-- JS dynamic -->
                                </tbody>
                            </table>
                            <!-- Empty state inside table wrapper -->
                            <div id="relay-restart-empty" style="display:none; text-align:center; padding:60px 24px; color:#64748b;">
                                <i class="fa-solid fa-server" style="font-size:2.5rem;margin-bottom:16px;opacity:0.3;display:block;"></i>
                                <div style="font-size:1rem;font-weight:600;">IP 정보가 없습니다</div>
                                <div style="font-size:0.85rem;margin-top:6px;">먼저 'cctv.info 배포정보' 탭에서 IP를 등록해주세요.</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB: History View -->
            <div id="history-panel" style="display: none; padding-top: 6px;">

                <!-- ── 테이블 래퍼 ── -->
                <div style="background: #0f172a; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                    <table id="history-table" style="width: 100%; border-collapse: collapse; font-size: 0.86rem; table-layout: fixed;">
                        <thead>
                            <tr id="history-table-head" style="background: #111c31; border-bottom: 2px solid rgba(24,174,231,0.45);">
                                <!-- JS가 탭에 맞게 동적 렌더 -->
                            </tr>
                        </thead>
                        <tbody id="history-table-body">
                            <!-- JS가 동적 렌더 -->
                        </tbody>
                    </table>
                </div>

                <div id="history-empty" style="display: none; text-align: center; padding: 60px 24px; color: #64748b;">
                    <i class="fa-solid fa-clock-rotate-left" style="font-size: 3rem; margin-bottom: 16px; opacity: 0.35;"></i>
                    <div style="font-size: 1rem; font-weight: 600; margin-bottom: 6px;">작업 이력이 없습니다</div>
                    <div style="font-size: 0.85rem;">배포 작업, DDNS 조회, 모니터링 환경 설정 변경 내역이 여기에 표시됩니다.</div>
                </div>
            </div>
        </div>

        <?php include __DIR__ . '/partials/settings_drawer.php'; ?>
        <?php include __DIR__ . '/partials/modal_player.php'; ?>
        <?php include __DIR__ . '/partials/sms_drawer.php'; ?>
        <?php include __DIR__ . '/partials/modal_deploy.php'; ?>

        <div id="toast">저장되었습니다.</div>

        <!-- 로딩 오버레이 -->
        <div id="loading-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); z-index: 2000; justify-content: center; align-items: center; flex-direction: column; gap: 16px; color: #f8fafc; font-weight: 600; font-size: 1.1rem; backdrop-filter: blur(4px);">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 3rem; color: #3b82f6;"></i>
            <div>cctv.info 갱신 반영중..</div>
        </div>
    </div>

    <!-- 앱 스크립트 -->
    <script src="assets/js/app.js"></script>
</body>
</html>
