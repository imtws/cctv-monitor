<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>예시 행사 CCTV 실시간 관제 및 상태 관리 센터</title>
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
        </div>

        <?php include __DIR__ . '/partials/settings_drawer.php'; ?>
        <?php include __DIR__ . '/partials/modal_player.php'; ?>
        <?php include __DIR__ . '/partials/sms_drawer.php'; ?>

        <div id="toast">저장되었습니다.</div>
    </div>

    <!-- 앱 스크립트 -->
    <script src="assets/js/app.js"></script>
</body>
</html>
