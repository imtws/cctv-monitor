<?php
/**
 * CctvModel
 * CCTV 데이터와 알람 설정을 읽고 쓰는 모델 클래스
 */
class CctvModel
{
    private string $cctvFile;
    private string $alertFile;

    private string $historyFile;

    public function __construct()
    {
        // 이력·스케줄 시각은 항상 KST 기준으로 기록
        date_default_timezone_set('Asia/Seoul');

        $this->cctvFile    = dirname(__DIR__, 2) . '/data/cctv_config.json';
        $this->alertFile   = dirname(__DIR__, 2) . '/data/alert_config.json';
        $this->historyFile = dirname(__DIR__, 2) . '/data/action_history.json';
    }

    // ──────────────────────────────────────────────
    // 작업 이력 관리
    // ──────────────────────────────────────────────

    public function saveHistory(string $type, string $title, string $status, array $detail = []): void
    {
        $history = $this->readJson($this->historyFile, []);
        array_unshift($history, [
            'id'        => uniqid('h', true),
            'type'      => $type,       // 'deploy' | 'env_config' | 'ddns_update'
            'title'     => $title,
            'status'    => $status,     // 'success' | 'fail' | 'partial'
            'detail'    => $detail,
            'created_at'=> date('Y-m-d H:i:s'),
        ]);
        // 최대 500건 보관
        if (count($history) > 500) {
            $history = array_slice($history, 0, 500);
        }
        $this->writeJson($this->historyFile, $history);
    }

    public function getHistory(array $filters = []): array
    {
        $history = $this->readJson($this->historyFile, []);
        if (!empty($filters['type'])) {
            $history = array_values(array_filter($history, fn($h) => $h['type'] === $filters['type']));
        }
        if (!empty($filters['status'])) {
            $history = array_values(array_filter($history, fn($h) => $h['status'] === $filters['status']));
        }
        if (!empty($filters['date_from'])) {
            $history = array_values(array_filter($history, fn($h) => $h['created_at'] >= $filters['date_from'] . ' 00:00:00'));
        }
        if (!empty($filters['date_to'])) {
            $history = array_values(array_filter($history, fn($h) => $h['created_at'] <= $filters['date_to'] . ' 23:59:59'));
        }
        return $history;
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
        $cctvs = $this->readJson($this->cctvFile, []);
        $liveFile = dirname(__DIR__, 2) . '/data/live_status.json';
        
        if (file_exists($liveFile)) {
            $liveStatus = $this->readJson($liveFile, []);
            foreach ($cctvs as &$cam) {
                $num = isset($cam['num']) ? (int)$cam['num'] : null;
                $hostName = null;
                if (isset($cam['host_name'])) {
                    $hostName = $cam['host_name'];
                } elseif ($num !== null) {
                    $suffix = sprintf("-cam-%02d", $num);
                    foreach (array_keys($liveStatus) as $liveKey) {
                        if (substr($liveKey, -strlen($suffix)) === $suffix) {
                            $hostName = $liveKey;
                            break;
                        }
                    }
                    if ($hostName === null) {
                        $hostName = sprintf("example-account-cam-%02d", $num);
                    }
                } else {
                    $hostName = isset($cam['id']) ? $cam['id'] : '';
                }
                
                if ($hostName !== null && isset($liveStatus[$hostName])) {
                    $cam['live_status'] = $liveStatus[$hostName];
                } else {
                    $cam['live_status'] = null;
                }
            }
            unset($cam);
        } else {
            foreach ($cctvs as &$cam) {
                $cam['live_status'] = null;
            }
            unset($cam);
        }
        
        return $cctvs;
    }

    public function saveCctvs(array $cctvs): bool
    {
        // 파일 저장 시 동적 상태 필드인 live_status는 지우고 저장
        foreach ($cctvs as &$cam) {
            if (array_key_exists('live_status', $cam)) {
                unset($cam['live_status']);
            }
        }
        unset($cam);
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
        // recipient: 명시적으로 전달된 경우만 변경, 없으면 기존값 유지
        if (!empty($fields['recipient'])) {
            $alert['recipient'] = $fields['recipient'];
        } elseif (empty($alert['recipient'])) {
            $alert['recipient'] = $defaultRecipient;
        }`r`n        // 트래픽 수집 기간
        if (array_key_exists('traffic_enabled', $fields)) {
            $raw = $fields['traffic_enabled'];
            $alert['traffic_enabled'] = ($raw === true || $raw === 1 || $raw === '1' || $raw === 'true');
        }
        if (array_key_exists('traffic_start', $fields)) {
            $alert['traffic_start'] = trim((string)$fields['traffic_start']);
        }
        if (array_key_exists('traffic_end', $fields)) {
            $alert['traffic_end'] = trim((string)$fields['traffic_end']);
        }
        $ok = $this->writeJson($this->alertFile, $alert);
        if ($ok) {
            // 이력 저장용 필드 요약 (민감정보 제외)
            $safeFields = array_diff_key($fields, ['root_password' => true]);
            $this->saveHistory(
                'env_config',
                '모니터링 환경 설정 변경',
                'success',
                ['changed_fields' => array_keys($safeFields), 'values' => $safeFields]
            );
        }
        return $ok;
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

        $scriptPath = dirname(__DIR__, 2) . '/scripts/parse_excel.py';
        $cmd    = 'python3 ' . escapeshellarg($scriptPath) . ' ' . escapeshellarg($dest) . ' ' . escapeshellarg($this->cctvFile);
        $output = shell_exec($cmd);

        $res = json_decode($output, true);
        if ($res) return $res;
        return ['success' => false, 'message' => 'Failed to execute Excel parser script', 'raw' => $output];
    }

    // ──────────────────────────────────────────────
    // cctv.info IP 및 배포 관리
    // ──────────────────────────────────────────────

    public function getCctvIps(): array
    {
        $ipsFile = dirname(__DIR__, 2) . '/data/cctv_ips.json';
        return $this->readJson($ipsFile, []);
    }

    public function saveCctvIps(array $ips): bool
    {
        $ipsFile = dirname(__DIR__, 2) . '/data/cctv_ips.json';
        $cleaned = [];
        foreach ($ips as $camId => $ip) {
            $cleaned[trim($camId)] = trim((string)$ip);
        }
        return $this->writeJson($ipsFile, $cleaned);
    }

    /**
     * 카메라별 DDNS명(단축명)을 업데이트합니다.
     * $ddnsMap = ['cam01' => 'mold8088', 'cam02' => 'mcdw8088', ...]
     * cctv_config.json의 ddns URL 끝 경로를 교체하고,
     * /root/scripts/hanhwa_bulk_rtsp.sh의 DDNS_IDS 배열도 순번 순서로 재작성합니다.
     */
    public function updateDdnsNames(array $ddnsMap): array
    {
        // 1) cctv_config.json 업데이트
        $cctvs = $this->readJson($this->cctvFile, []);
        foreach ($cctvs as &$cam) {
            $camId = trim((string)($cam['id'] ?? ''));
            if (!isset($ddnsMap[$camId])) continue;
            $newDdns = trim($ddnsMap[$camId]);
            if ($newDdns === '') continue;

            $cam['ddns'] = $newDdns;
        }
        unset($cam);
        $saved = $this->writeJson($this->cctvFile, $cctvs);

        // 2) hanhwa_bulk_rtsp.sh DDNS_IDS 배열 업데이트 (sudo cat → 파싱 → sudo tee)
        $scriptFile = '/root/scripts/hanhwa_bulk_rtsp.sh';
        $content = shell_exec('sudo /usr/bin/cat ' . escapeshellarg($scriptFile) . ' 2>/dev/null') ?: '';
        if ($content === '') {
            return ['success' => $saved, 'script_updated' => false, 'message' => 'hanhwa_bulk_rtsp.sh를 읽을 수 없습니다.'];
        }

        // cctv_config.json의 num 순으로 DDNS ID 목록 생성
        usort($cctvs, fn($a, $b) => ($a['num'] ?? 999) <=> ($b['num'] ?? 999));
        $ids = [];
        foreach ($cctvs as $cam) {
            $ddnsUrl = $cam['ddns'] ?? '';
            // URL 끝 경로 추출
            if (preg_match('/\/([^\/\?#]+)$/', $ddnsUrl, $m)) {
                $ids[] = $m[1];
            } elseif ($ddnsUrl !== '') {
                $ids[] = $ddnsUrl;
            }
        }

        if (empty($ids)) {
            return ['success' => $saved, 'script_updated' => false, 'message' => 'DDNS ID 목록이 비어 있습니다.'];
        }

        // DDNS_IDS=( ... ) 블록 재작성 (8개씩 줄바꿈)
        $chunks = array_chunk($ids, 8);
        $lines = [];
        foreach ($chunks as $chunk) {
            $lines[] = '  ' . implode(' ', $chunk);
        }
        $idsBlock = "DDNS_IDS=(\n" . implode("\n", $lines) . "\n)";

        // 기존 DDNS_IDS=( ... ) 블록 교체
        $newContent = preg_replace('/DDNS_IDS=\([\s\S]*?\)/', $idsBlock, $content);
        if ($newContent === null || $newContent === $content) {
            return ['success' => $saved, 'script_updated' => false, 'message' => 'hanhwa_bulk_rtsp.sh에서 DDNS_IDS 블록을 찾지 못했습니다.'];
        }

        // sudo tee로 파일 쓰기
        $tmpFile = tempnam('/tmp', 'ddns_');
        file_put_contents($tmpFile, $newContent);
        $rc = 0;
        system('sudo /usr/bin/tee ' . escapeshellarg($scriptFile) . ' < ' . escapeshellarg($tmpFile) . ' > /dev/null 2>&1', $rc);
        @unlink($tmpFile);

        $scriptUpdated = ($rc === 0);
        return [
            'success'        => $saved,
            'script_updated' => $scriptUpdated,
            'message'        => $scriptUpdated ? 'DDNS명 및 배포 스크립트가 업데이트되었습니다.' : 'cctv_config.json은 저장됐으나 스크립트 업데이트 실패.',
        ];
    }

    private function parseCctvInfoFile(string $filePath): array
    {
        // apache 유저가 /root 하위의 파일을 직접 읽지 못하므로 sudo /usr/bin/cat을 사용합니다.
        $output = shell_exec("sudo /usr/bin/cat " . escapeshellarg($filePath) . " 2>/dev/null");
        if (!$output) return [];
        $lines = explode("\n", $output);
        $result = [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') continue;
            if (preg_match('/^(#\s*)?(cam\d+)/i', $line, $matches)) {
                $camId = strtolower($matches[2]);
                $result[$camId] = $line;
            }
        }
        return $result;
    }

    public function runDdnsUpdate(): array
    {
        // DDNS 조회는 카메라 50대 × 최대 10초 = 최대 500초 소요
        // PHP 기본 타임아웃(30초)에 끊기지 않도록 이 함수 내에서만 해제
        set_time_limit(0);

        shell_exec('sudo /root/scripts/cctv_manager.sh update 2>&1');

        $oldMap = $this->parseCctvInfoFile('/root/scripts/cctv.info');
        $newMap = $this->parseCctvInfoFile('/root/scripts/cctv.info.tmp');

        $changes = [];
        $allKeys = array_unique(array_merge(array_keys($oldMap), array_keys($newMap)));
        sort($allKeys);

        foreach ($allKeys as $camId) {
            $oldLine = $oldMap[$camId] ?? '';
            $newLine = $newMap[$camId] ?? '';
            if ($oldLine !== $newLine) {
                $changes[] = [
                    'cam_id' => $camId,
                    'old' => $oldLine,
                    'new' => $newLine
                ];
            }
        }

        $stats = [
            'total' => count($newMap),
            'success' => 0,
            'fail' => 0,
            'failures' => []
        ];

        foreach ($newMap as $camId => $line) {
            if (strpos(trim($line), '#') === 0) {
                $stats['fail']++;
                $stats['failures'][] = [
                    'cam_id' => $camId,
                    'error' => preg_replace('/^#\s*cam\d+\s+\w+\s*:\s*/i', '', $line)
                ];
            } else {
                $stats['success']++;
            }
        }

        $newContent = shell_exec("sudo /usr/bin/cat /root/scripts/cctv.info.tmp 2>/dev/null") ?: '';

        // DDNS 조회 이력 저장
        $histStatus = ($stats['total'] === 0) ? 'fail' : ($stats['fail'] > 0 ? 'partial' : 'success');
        $this->saveHistory(
            'ddns_update',
            'DDNS 주소 조회',
            $histStatus,
            [
                'total'    => $stats['total'],
                'success'  => $stats['success'],
                'fail'     => $stats['fail'],
                'failures' => $stats['failures'],
                'changes'  => $changes,
            ]
        );

        return [
            'success'     => true,
            'changes'     => $changes,
            'stats'       => $stats,
            'new_content' => $newContent
        ];
    }

    public function rollbackDdnsUpdate(): bool
    {
        shell_exec('sudo rm -f /root/scripts/cctv.info.tmp');
        return true;
    }

    public function deployCctvInfo(array $pendingChanges = []): array
    {
        set_time_limit(0);

        shell_exec('sudo /root/scripts/cctv_manager.sh backup 2>&1');
        shell_exec('sudo /root/scripts/cctv_manager.sh apply 2>&1');
        $out = shell_exec('sudo /root/scripts/cctv_manager.sh deploy 2>&1');
        shell_exec('sudo rm -f /root/scripts/cctv.info.tmp');

        // 배포 스크립트 출력 파싱: SUCCESS / FAILED / ERROR 패턴
        $lines        = explode("\n", (string)$out);
        $successHosts = [];
        $failedHosts  = [];
        $errorMsg     = null;

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') continue;

            // ERROR: 패스워드 없음 등 치명적 오류
            if (preg_match('/^ERROR:\s*(.+)/i', $line, $m)) {
                $errorMsg = $m[1];
                continue;
            }
            // SUCCESS <IP>
            if (preg_match('/\]\s*SUCCESS\s+(\S+)/i', $line, $m)) {
                $successHosts[] = $m[1];
                continue;
            }
            // FAILED <IP>
            if (preg_match('/\]\s*FAILED\s+(\S+)/i', $line, $m)) {
                $failedHosts[] = $m[1];
                continue;
            }
        }

        $successCount = count($successHosts);
        $failCount    = count($failedHosts);
        $totalCount   = $successCount + $failCount;

        // 치명적 오류이거나 대상 서버가 0대면 fail
        if ($errorMsg !== null && $totalCount === 0) {
            $this->saveHistory(
                'deploy',
                'cctv.info 배포 작업',
                'fail',
                [
                    'change_count'  => count($pendingChanges),
                    'changes'       => $pendingChanges,
                    'deploy_output' => $out,
                    'error'         => $errorMsg,
                ]
            );
            return [
                'success' => false,
                'message' => $errorMsg,
                'output'  => $out,
            ];
        }

        // 부분 성공 / 전체 성공 / 전체 실패
        if ($failCount > 0 && $successCount > 0) {
            $histStatus = 'partial';
        } elseif ($failCount > 0 && $successCount === 0) {
            $histStatus = 'fail';
        } else {
            $histStatus = 'success';
        }

        // 배포 후 등록된 전체 CAM 서버 cctv-relay 재기동
        $restartSummary = $this->restartAllCctvRelaysAfterDeploy();

        $changeCount = count($pendingChanges);
        $this->saveHistory(
            'deploy',
            'cctv.info 배포 작업',
            $histStatus,
            [
                'change_count'     => $changeCount,
                'changes'          => $pendingChanges,
                'total'            => $totalCount,
                'success'          => $successCount,
                'fail'             => $failCount,
                'failed_hosts'     => $failedHosts,
                'deploy_output'    => $out,
                'relay_restart'    => $restartSummary,
            ]
        );

        return [
            'success'         => true,
            'total'           => $totalCount,
            'success_count'   => $successCount,
            'fail_count'      => $failCount,
            'failed_hosts'    => $failedHosts,
            'output'          => $out,
            'relay_restart'   => $restartSummary,
        ];
    }

    /**
     * cctv.info 배포 직후 IP가 등록된 전체 캠의 cctv-relay를 재기동합니다.
     */
    private function restartAllCctvRelaysAfterDeploy(): array
    {
        $ips = $this->getCctvIps();
        $results = [];
        $okCount = 0;
        $failCount = 0;

        foreach ($ips as $camId => $ip) {
            $camId = trim((string)$camId);
            $ip = trim((string)$ip);
            if ($camId === '' || $ip === '') {
                continue;
            }

            $r = $this->restartCctvRelay($camId, false);
            $ok = !empty($r['success']);
            if ($ok) {
                $okCount++;
            } else {
                $failCount++;
            }
            $results[] = [
                'cam_id'  => $camId,
                'ip'      => $ip,
                'success' => $ok,
                'message' => $r['message'] ?? '',
                'status'  => $r['service_status'] ?? '',
            ];
        }

        $total = count($results);
        if ($total > 0) {
            $status = ($failCount === 0) ? 'success' : (($okCount > 0) ? 'partial' : 'fail');
            $this->saveHistory(
                'cctv_relay_restart',
                "cctv.info 배포 후 전체 cctv-relay 재기동 ({$total}대)",
                $status,
                [
                    'total'   => $total,
                    'success' => $okCount,
                    'fail'    => $failCount,
                    'auto'    => false,
                    'from'    => 'deploy',
                    'results' => $results,
                ]
            );
        }

        return [
            'total'   => $total,
            'success' => $okCount,
            'fail'    => $failCount,
            'results' => $results,
        ];
    }

    public function restartCctvRelay(string $camId, bool $saveHistory = true): array
    {
        $ips = $this->getCctvIps();
        $ip = $ips[$camId] ?? '';
        if (!$ip) {
            return ['success' => false, 'message' => "IP address not found for {$camId}"];
        }

        $alertConfig = $this->getAlertConfig();
        $password = $alertConfiggetenv('CAMMON_ROOT_PASSWORD') ?: '';
        if (!$password) {
            return ['success' => false, 'message' => 'Root password is not configured in settings.'];
        }

        $sshBase = sprintf(
            "sshpass -p %s ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 root@%s",
            escapeshellarg($password),
            escapeshellarg($ip)
        );

        // 재기동 (stderr의 known_hosts 경고 억제)
        $restartCmd = $sshBase . ' "systemctl restart cctv-relay" 2>/dev/null';
        $output = [];
        $rc = 0;
        exec($restartCmd, $output, $rc);

        // 재기동 후 원격 서비스 상태 확인
        usleep(500000); // 0.5s
        $statusCmd = $sshBase . ' "systemctl is-active cctv-relay" 2>/dev/null';
        $statusOut = [];
        $statusRc = 0;
        exec($statusCmd, $statusOut, $statusRc);
        $serviceStatus = trim(implode('', $statusOut));
        if ($serviceStatus === '') {
            $serviceStatus = ($rc === 0) ? 'unknown' : 'unreachable';
        }

        $statusLabel = match ($serviceStatus) {
            'active'   => 'active (실행중)',
            'inactive' => 'inactive (중지됨)',
            'failed'   => 'failed (실패)',
            'activating' => 'activating (기동중)',
            default    => $serviceStatus,
        };

        $ok = ($rc === 0 && $serviceStatus === 'active');
        $detail = [
            'cam_id'          => $camId,
            'ip'              => $ip,
            'service_status'  => $serviceStatus,
            'output'          => $statusLabel,
        ];

        if ($saveHistory) {
            $this->saveHistory(
                'cctv_relay_restart',
                "캠 서버 {$camId} ({$ip}) cctv-relay 서비스 재기동",
                $ok ? 'success' : 'fail',
                $detail
            );
        }

        if ($ok) {
            return [
                'success'         => true,
                'message'         => "캠 서버 {$camId} ({$ip}) cctv-relay 재기동 성공",
                'output'          => $statusLabel,
                'service_status'  => $serviceStatus,
                'ip'              => $ip,
            ];
        }

        $failMsg = ($rc !== 0)
            ? "재기동 실패 (SSH/명령 오류)"
            : "재기동 후 상태: {$statusLabel}";
        return [
            'success'         => false,
            'message'         => $failMsg,
            'output'          => $statusLabel,
            'service_status'  => $serviceStatus,
            'ip'              => $ip,
        ];
    }

    public function getCctvRelayStatus(string $camId): array
    {
        $ips = $this->getCctvIps();
        $ip = $ips[$camId] ?? '';
        if (!$ip) {
            return ['success' => false, 'status' => 'no_ip', 'message' => 'IP 정보 없음'];
        }

        $alertConfig = $this->getAlertConfig();
        $password = $alertConfiggetenv('CAMMON_ROOT_PASSWORD') ?: '';
        if (!$password) {
            return ['success' => false, 'status' => 'no_pw', 'message' => '패스워드 미설정'];
        }

        $cmd = sprintf(
            "sshpass -p %s ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=6 root@%s \"systemctl is-active cctv-relay\" 2>/dev/null",
            escapeshellarg($password),
            escapeshellarg($ip)
        );

        $output = [];
        $rc = 0;
        exec($cmd, $output, $rc);
        $statusStr = trim(implode('', $output));

        // SSH connect failed → rc=255 or empty
        if ($rc === 255 || ($rc !== 0 && $statusStr === '')) {
            return ['success' => true, 'status' => 'unreachable', 'message' => '서버 접속 불가'];
        }

        if ($statusStr === 'active') {
            return ['success' => true, 'status' => 'active', 'message' => '실행중'];
        } elseif ($statusStr === 'inactive') {
            return ['success' => true, 'status' => 'inactive', 'message' => '중지됨'];
        } elseif ($statusStr === 'failed') {
            return ['success' => true, 'status' => 'failed', 'message' => '실패'];
        } else {
            return ['success' => true, 'status' => 'unknown', 'message' => $statusStr ?: '알 수 없음'];
        }
    }

    // ──────────────────────────────────────────────
    // 트래픽 수집 cron 동기화 (캠 서버 vnstat/vnstati)
    // ──────────────────────────────────────────────

    /**
     * alert_config의 트래픽 수집 기간에 맞춰 각 캠 서버 crontab의
     * vnstat / vnstati 라인을 백그라운드로 동기화한다.
     */
    public function syncTrafficCron(): array
    {
        $alert = $this->getAlertConfig();
        $active = $this->isTrafficCollectionActive($alert);
        $script = dirname(__DIR__, 2) . '/scripts/traffic_cron_sync.sh';

        if (!is_file($script)) {
            return [
                'queued'  => false,
                'active'  => $active,
                'message' => 'traffic_cron_sync.sh not found',
            ];
        }

        $logFile = dirname(__DIR__, 2) . '/data/traffic_cron_sync.log';
        $cmd = sprintf(
            'FORCE=1 nohup %s >> %s 2>&1 &',
            escapeshellarg($script),
            escapeshellarg($logFile)
        );
        exec($cmd);

        return [
            'queued'  => true,
            'active'  => $active,
            'message' => $active ? 'traffic cron enable queued' : 'traffic cron disable queued',
        ];
    }

    public function isTrafficCollectionActive(?array $alert = null): bool
    {
        $alert = $alert ?? $this->getAlertConfig();
        if (empty($alert['traffic_enabled'])) {
            return false;
        }

        $start = trim((string)($alert['traffic_start'] ?? ''));
        $end   = trim((string)($alert['traffic_end'] ?? ''));
        if ($start === '' || $end === '') {
            return false;
        }

        $startTs = strtotime(str_replace('T', ' ', $start));
        $endTs   = strtotime(str_replace('T', ' ', $end));
        if ($startTs === false || $endTs === false) {
            return false;
        }

        $now = time();
        return $now >= $startTs && $now < $endTs;
    }
}

