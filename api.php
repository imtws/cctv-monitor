<?php
/**
 * api.php - API 엔드포인트 (Front Controller → CctvController)
 */
require_once __DIR__ . '/app/controllers/CctvController.php';

$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action   = $_GET['action'] ?? $_POST['action'] ?? '';

// POST 요청: JSON body 혹은 form-data 모두 처리
$postData = [];
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    if ($raw === '' && PHP_SAPI === 'cli') {
        $stdin = fopen('php://stdin', 'r');
        if ($stdin) { $raw = stream_get_contents($stdin); fclose($stdin); }
    }
    $postData = json_decode($raw, true) ?: $_POST;
    if (isset($postData['action'])) {
        $action = $postData['action'];
    }
}

$controller = new CctvController();
$controller->dispatch($method, $action, $postData, $_FILES);
