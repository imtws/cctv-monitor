<?php
/**
 * index.php - 진입점 (Front Controller)
 * View 렌더링을 app/views/layout.php 에 위임
 */
date_default_timezone_set('Asia/Seoul');

require_once __DIR__ . '/app/views/layout.php';
