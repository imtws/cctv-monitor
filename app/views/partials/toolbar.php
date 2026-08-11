<!-- Top Chrome: 필터 / 페이징 툴바 -->
<div class="top-chrome">
    <div class="top-bar">
        <div class="toolbar" style="flex: 1; margin-bottom: 0;">
            <div class="filter-group">
                <input type="file" id="excel-upload" accept=".xlsx" style="display: none;" onchange="uploadExcel()">
                <button class="btn btn-success" onclick="document.getElementById('excel-upload').click()"><i class="fa-solid fa-file-excel"></i> 경기장 정보 엑셀 업로드</button>
                <button class="btn" onclick="loadData()"><i class="fa-solid fa-rotate-left"></i> 캠 새로고침</button>
                <button class="btn" onclick="resetFilters()">필터 초기화</button>
            </div>
            <div class="filter-group" style="align-items: center;">
                <div id="paging-buttons" style="display: flex; gap: 6px; flex-wrap: wrap;"></div>
            </div>
            <div class="filter-group" style="align-items: center;">
                <div class="selection-pill">
                    <input type="checkbox" id="select-all-cb" onchange="toggleSelectAllVisible()" style="width: 16px; height: 16px; cursor: pointer;">
                    <label for="select-all-cb" id="select-all-label">현재 페이지 모두 선택</label>
                    <span class="selection-meta" id="select-all-meta"></span>
                </div>
                <select class="select-input" id="status-filter" onchange="applyFilters()">
                    <option value="">-- 상태 선택 (전체) --</option>
                    <option value="ACTIVE">경기 진행 중만</option>
                    <option value="STOPPED">작동 중지만</option>
                    <option value="INSPECTION">점검중만</option>
                </select>
            </div>
        </div>
    </div>

    <div class="toolbar shared-filter-bar">
        <div class="filter-group">
            <input type="text" class="text-input" id="search-input" placeholder="카메라/경기장/종목 검색" oninput="applyFilters()">
            <select class="select-input" id="stadium-filter" onchange="applyFilters()">
                <option value="">-- 경기장 선택 (전체) --</option>
            </select>
        </div>
    </div>
</div>
