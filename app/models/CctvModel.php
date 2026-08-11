<?php
/**
 * CctvModel
 * CCTV 데이터와 알람 설정을 읽고 쓰는 모델 클래스
 */
class CctvModel
{
    private string $cctvFile;
    private string $alertFile;

    public function __construct()
    {
        $this->cctvFile  = dirname(__DIR__, 2) . '/data/cctv_config.json';
        $this->alertFile = dirname(__DIR__, 2) . '/data/alert_config.json';
    }

    // ──────────────────────────────────────────────
    // JSON 파일 유틸리티
    // ──────────────────────────────────────────────

    public function readJson(string $file, $default = []): mixed
    {
        if (!file_exists($file)) return $default;
        $content = file_get_contents($file);
        return json_decode($content, true) ?: $default;
    }

    public function writeJson(string $file, mixed $data): bool
    {
        $dir = dirname($file);
        if (!is_dir($dir) || !is_writable($dir)) return false;

        $tmp = tempnam($dir, 'json_');
        if ($tmp === false) return false;

        $encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($encoded === false) { @unlink($tmp); return false; }

        $written = file_put_contents($tmp, $encoded, LOCK_EX);
        if ($written === false) { @unlink($tmp); return false; }

        if (!rename($tmp, $file)) { @unlink($tmp); return false; }

        @chmod($file, 0644);
        return true;
    }

    // ──────────────────────────────────────────────
    // CCTV 데이터
    // ──────────────────────────────────────────────

    public function getAllCctvs(): array
    {
        return $this->readJson($this->cctvFile, []);
    }

    public function saveCctvs(array $cctvs): bool
    {
        return $this->writeJson($this->cctvFile, $cctvs);
    }

    public function updateStatus(string $camId, string $status): bool
    {
        $cctvs   = $this->getAllCctvs();
        $updated = false;
        foreach ($cctvs as &$cam) {
            if (trim((string)($cam['id'] ?? '')) === $camId) {
                $cam['status'] = $status;
                $updated = true;
                break;
            }
        }
        unset($cam);
        return $updated && $this->saveCctvs($cctvs);
    }

    public function updateCamAlert(string $camId, array $fields): bool
    {
        $cctvs   = $this->getAllCctvs();
        $updated = false;
        foreach ($cctvs as &$cam) {
            if (trim((string)($cam['id'] ?? '')) === $camId) {
                if (isset($fields['alert_enabled']))   $cam['alert_enabled']   = (bool)$fields['alert_enabled'];
                if (isset($fields['alert_start']))     $cam['alert_start']     = $fields['alert_start'];
                if (isset($fields['alert_end']))       $cam['alert_end']       = $fields['alert_end'];
                if (array_key_exists('suppress_until', $fields)) {
                    $cam['suppress_until'] = $fields['suppress_until'] ?: null;
                }
                $updated = true;
                break;
            }
        }
        unset($cam);
        return $updated && $this->saveCctvs($cctvs);
    }

    public function batchUpdate(array $camIds, ?string $status, ?bool $alertEnabled, ?string $alertStart, ?string $alertEnd, ?string $suppressUntil = '__SKIP__'): int
    {
        $cctvs = $this->getAllCctvs();
        $count = 0;
        foreach ($cctvs as &$cam) {
            if (!in_array(trim((string)($cam['id'] ?? '')), $camIds, true)) continue;
            if ($status !== null && in_array($status, ['ACTIVE', 'STOPPED', 'INSPECTION'])) {
                $cam['status'] = $status;
            }
            if ($alertEnabled !== null) $cam['alert_enabled'] = $alertEnabled;
            if ($alertStart   !== null) $cam['alert_start']   = $alertStart;
            if ($alertEnd     !== null) $cam['alert_end']     = $alertEnd;
            if ($suppressUntil !== '__SKIP__') {
                $cam['suppress_until'] = $suppressUntil ?: null;
            }
            $count++;
        }
        unset($cam);
        $this->saveCctvs($cctvs);
        return $count;
    }

    // ──────────────────────────────────────────────
    // 알람 설정
    // ──────────────────────────────────────────────

    public function getAlertConfig(): array
    {
        return $this->readJson($this->alertFile, []);
    }

    public function updateAlertConfig(array $fields, string $defaultRecipient): bool
    {
        $alert = $this->getAlertConfig();
        if (isset($fields['enabled']))    $alert['enabled']    = (bool)$fields['enabled'];
        if (isset($fields['start_time'])) $alert['start_time'] = $fields['start_time'];
        if (isset($fields['end_time']))   $alert['end_time']   = $fields['end_time'];
        if (isset($fields['work_days']) && is_array($fields['work_days'])) {
            $alert['work_days'] = array_map('intval', $fields['work_days']);
        }
        // 글로벌 알람 스케줄 억제
        if (array_key_exists('suppress_until', $fields)) {
            $alert['suppress_until'] = $fields['suppress_until'] ?: null;
        }
        $alert['recipient'] = $defaultRecipient;
        return $this->writeJson($this->alertFile, $alert);
    }

    // ──────────────────────────────────────────────
    // 엑셀 업로드 처리
    // ──────────────────────────────────────────────

    public function processExcelUpload(array $fileInfo): array
    {
        if ($fileInfo['error'] !== UPLOAD_ERR_OK) {
            return ['success' => false, 'message' => 'File upload failed'];
        }

        $uploadDir = dirname(__DIR__, 2) . '/data/uploads/';
        if (!file_exists($uploadDir)) {
            mkdir($uploadDir, 0777, true);
        }

        $dest = $uploadDir . 'uploaded_' . time() . '.xlsx';
        if (!move_uploaded_file($fileInfo['tmp_name'], $dest)) {
            return ['success' => false, 'message' => 'Failed to save uploaded file'];
        }

        $scriptPath = dirname(__DIR__, 2) . '/parse_excel.py';
        $cmd    = 'python3 ' . escapeshellarg($scriptPath) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($this->cctvFile);
        $output = shell_exec($cmd);

        $res = json_decode($output, true);
        if ($res) return $res;
        return ['success' => false, 'message' => 'Failed to execute Excel parser script', 'raw' => $output];
    }
}
