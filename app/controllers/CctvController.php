<?php
require_once __DIR__ . '/../models/CctvModel.php';

/**
 * CctvController
 * API 요청을 처리하고 Model에 위임, JSON 응답 반환
 */
class CctvController
{
    private CctvModel $model;

    public function __construct()
    {
        $this->model = new CctvModel();
    }

    // ──────────────────────────────────────────────
    // 진입점: action 라우팅
    // ──────────────────────────────────────────────

    public function dispatch(string $method, string $action, array $postData, array $files): void
    {
        header('Content-Type: application/json; charset=utf-8');

        switch ($action) {
            case 'get_data':
                $this->getData();
                break;
            case 'update_status':
                $this->updateStatus($postData);
                break;
            case 'update_cam_alert':
                $this->updateCamAlert($postData);
                break;
            case 'batch_update':
                $this->batchUpdate($postData);
                break;
            case 'update_alert':
                $this->updateAlert($postData);
                break;
            case 'update_suppress':
                $this->updateSuppress($postData);
                break;
            case 'upload_excel':
                $this->uploadExcel($files);
                break;
            case 'get_deploy_info':
                $this->getDeployInfo();
                break;
            case 'save_cctv_ips':
                $this->saveCctvIps($postData);
                break;
            case 'run_ddns_update':
                $this->runDdnsUpdate();
                break;
            case 'rollback_ddns_update':
                $this->rollbackDdnsUpdate();
                break;
            case 'deploy_cctv_info':
                $this->deployCctvInfo($postData);
                break;
            case 'update_ddns_names':
                $this->updateDdnsNames($postData);
                break;
            case 'restart_cctv_relay':
                $this->restartCctvRelay($postData);
                break;
            case 'batch_restart_cctv_relay':
                $this->batchRestartCctvRelay($postData);
                break;
            case 'get_relay_status':
                $this->getRelayStatus($postData ?: $_GET);
                break;
            case 'get_history':
                $this->getHistory($postData);
                break;
            default:
                echo json_encode(['success' => false, 'message' => 'Unknown action']);
        }
    }

    // ──────────────────────────────────────────────
    // 액션 핸들러
    // ──────────────────────────────────────────────

    private function getData(): void
    {
        $cctvs = $this->model->getAllCctvs();
        $alert = $this->model->getAlertConfig();
        echo json_encode(['success' => true, 'cctvs' => $cctvs, 'alert' => $alert], JSON_UNESCAPED_UNICODE);
    }

    private function updateStatus(array $data): void
    {
        $camId  = trim((string)($data['cam_id'] ?? ''));
        $status = $data['status'] ?? '';

        if (!$camId || !in_array($status, ['ACTIVE', 'STOPPED', 'INSPECTION'])) {
            echo json_encode(['success' => false, 'message' => 'Invalid parameters']);
            return;
        }

        if ($this->model->updateStatus($camId, $status)) {
            echo json_encode(['success' => true, 'message' => "Cam {$camId} status updated to {$status}"]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Cam ID not found or save failed']);
        }
    }

    private function updateCamAlert(array $data): void
    {
        $camId = trim((string)($data['cam_id'] ?? ''));
        if (!$camId) {
            echo json_encode(['success' => false, 'message' => 'Invalid Cam ID']);
            return;
        }

        $fields = array_intersect_key($data, array_flip(['alert_enabled', 'alert_start', 'alert_end']));

        if ($this->model->updateCamAlert($camId, $fields)) {
            echo json_encode(['success' => true, 'message' => "Cam {$camId} alert schedule updated"]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Cam ID not found or save failed']);
        }
    }

    private function batchUpdate(array $data): void
    {
        $camIds = $data['cam_ids'] ?? [];
        if (!is_array($camIds)) {
            echo json_encode(['success' => false, 'message' => 'Invalid parameters']);
            return;
        }

        $camIds        = array_map(fn($id) => trim((string)$id), $camIds);
        $status        = $data['status'] ?? null;
        $alertEnabled  = isset($data['alert_enabled']) ? (bool)$data['alert_enabled'] : null;
        $alertStart    = $data['alert_start'] ?? null;
        $alertEnd      = $data['alert_end'] ?? null;
        // suppress_until: 명시적으로 키가 있을 때만 전달 (null = 해제, 문자열 = 설정)
        $suppressUntil = array_key_exists('suppress_until', $data) ? ($data['suppress_until'] ?: null) : '__SKIP__';

        $count = $this->model->batchUpdate($camIds, $status, $alertEnabled, $alertStart, $alertEnd, $suppressUntil);
        echo json_encode(['success' => true, 'message' => "Updated {$count} cameras"]);
    }

    /**
     * update_suppress: 글로벌 또는 카메라별 suppress_until 설정/해제
     * body: { scope: 'global'|'cam', cam_ids?: [...], suppress_until: 'YYYY-MM-DDTHH:MM' | '' }
     */
    private function updateSuppress(array $data): void
    {
        $scope         = $data['scope'] ?? 'cam';
        $suppressUntil = $data['suppress_until'] ?? null;  // 빈 문자열이면 해제
        $suppressUntil = $suppressUntil ?: null;

        if ($scope === 'global') {
            $ok = $this->model->updateAlertConfig(
                ['suppress_until' => $suppressUntil],
                $this->defaultAlertRecipient
            );
            $alert = $this->model->getAlertConfig();
            echo json_encode(['success' => $ok, 'alert' => $alert], JSON_UNESCAPED_UNICODE);
        } else {
            $camIds = $data['cam_ids'] ?? [];
            if (!is_array($camIds) || empty($camIds)) {
                echo json_encode(['success' => false, 'message' => 'cam_ids required']);
                return;
            }
            $camIds = array_map(fn($id) => trim((string)$id), $camIds);
            $count  = $this->model->batchUpdate($camIds, null, null, null, null, $suppressUntil);
            echo json_encode(['success' => true, 'message' => "Suppress updated for {$count} cameras"]);
        }
    }

    private function updateAlert(array $data): void
    {
        if ($this->model->updateAlertConfig($data, 'stw@example.com')) {
            $alert = $this->model->getAlertConfig();
            $trafficSync = $this->model->syncTrafficCron();
            echo json_encode([
                'success'      => true,
                'message'      => 'Global alert settings saved',
                'alert'        => $alert,
                'traffic_sync' => $trafficSync,
            ], JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode(['success' => false, 'message' => 'Failed to save alert config']);
        }
    }

    private function uploadExcel(array $files): void
    {
        if (!isset($files['excel_file'])) {
            echo json_encode(['success' => false, 'message' => 'No file provided']);
            return;
        }
        $result = $this->model->processExcelUpload($files['excel_file']);
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }

    private function getDeployInfo(): void
    {
        $cctvs = $this->model->getAllCctvs();
        $ips = $this->model->getCctvIps();
        echo json_encode(['success' => true, 'cctvs' => $cctvs, 'ips' => $ips], JSON_UNESCAPED_UNICODE);
    }

    private function saveCctvIps(array $data): void
    {
        $ips = $data['ips'] ?? [];
        if (!is_array($ips)) {
            echo json_encode(['success' => false, 'message' => 'Invalid parameters']);
            return;
        }
        $ok = $this->model->saveCctvIps($ips);
        echo json_encode(['success' => $ok, 'message' => $ok ? 'Saved' : 'Failed to save IPs']);
    }

    private function runDdnsUpdate(): void
    {
        $result = $this->model->runDdnsUpdate();
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }

    private function rollbackDdnsUpdate(): void
    {
        $ok = $this->model->rollbackDdnsUpdate();
        echo json_encode(['success' => $ok]);
    }

    private function deployCctvInfo(array $data): void
    {
        $pendingChanges = $data['pending_changes'] ?? [];
        $result = $this->model->deployCctvInfo($pendingChanges);
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }

    private function updateDdnsNames(array $data): void
    {
        $ddnsMap = $data['ddns_map'] ?? [];
        if (!is_array($ddnsMap)) {
            echo json_encode(['success' => false, 'message' => 'Invalid parameters']);
            return;
        }
        $result = $this->model->updateDdnsNames($ddnsMap);
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }

    private function getHistory(array $data): void
    {
        $filters = [
            'type'      => $data['type']      ?? '',
            'status'    => $data['status']    ?? '',
            'date_from' => $data['date_from'] ?? '',
            'date_to'   => $data['date_to']   ?? '',
        ];
        $history = $this->model->getHistory($filters);
        echo json_encode(['success' => true, 'history' => $history], JSON_UNESCAPED_UNICODE);
    }

    private function restartCctvRelay(array $data): void
    {
        $camId = trim((string)($data['cam_id'] ?? ''));
        if (!$camId) {
            echo json_encode(['success' => false, 'message' => 'Invalid Cam ID']);
            return;
        }
        $isBatch = isset($data['is_batch']) ? (bool)$data['is_batch'] : false;

        $result = $this->model->restartCctvRelay($camId, !$isBatch);
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }

    private function batchRestartCctvRelay(array $data): void
    {
        $results = $data['results'] ?? [];
        if (!is_array($results) || empty($results)) {
            echo json_encode(['success' => false, 'message' => 'No results to log']);
            return;
        }

        // 전체 결과 중 성공 및 실패 개수 파악
        $total = count($results);
        $successCount = 0;
        $failCount = 0;
        $failedCams = [];

        foreach ($results as $r) {
            // verified가 true이거나 success가 true인 경우 성공 판정 (JS와 동치)
            $ok = ($r['verified'] ?? false) || ($r['success'] ?? false);
            if ($ok) {
                $successCount++;
            } else {
                $failCount++;
                $failedCams[] = strtoupper($r['cam_id'] ?? '');
            }
        }

        $status = ($failCount === 0) ? 'success' : (($successCount > 0) ? 'partial' : 'fail');
        $camsStr = implode(', ', array_map(fn($r) => strtoupper($r['cam_id'] ?? ''), $results));

        $this->model->saveHistory(
            'cctv_relay_restart',
            "캠 서버 일괄 재기동 ({$total}대: {$camsStr})",
            $status,
            [
                'total' => $total,
                'success' => $successCount,
                'fail' => $failCount,
                'failed_cams' => $failedCams,
                'results' => $results
            ]
        );

        echo json_encode(['success' => true]);
    }

    private function getRelayStatus(array $data): void
    {
        $camId = trim((string)($data['cam_id'] ?? ''));
        if (!$camId) {
            echo json_encode(['success' => false, 'message' => 'Invalid Cam ID']);
            return;
        }

        $result = $this->model->getCctvRelayStatus($camId);
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
    }
}

