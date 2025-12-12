const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');

const app = express();
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root',
    database: process.env.DB_NAME || 'global_economy',
    multipleStatements: true,
    infileStreamFactory: (path) => fs.createReadStream(path)
};

let pool = null;

async function initDB() {
    try {
        const tempPool = mysql.createPool(dbConfig);
        const connection = await tempPool.getConnection();
        console.log("✅ Connected to MySQL successfully!");
        pool = tempPool;
        
        // (省略 ETL 檢查程式碼以節省篇幅，這部分與之前相同)
        const [rows] = await connection.query("SELECT count(*) as count FROM countries");
        if (rows[0].count === 0) {
           // ... ETL Code ...
        }
        connection.release();
    } catch (err) {
        console.error("❌ DB Failed:", err.message);
        setTimeout(initDB, 5000);
    }
}
initDB();

// === Helpers ===
const renderTable = (headers, rows, rowMapper) => `
    <table class="data-table">
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
            ${rows.length > 0 ? rows.map(rowMapper).join('') : '<tr><td colspan="100%" style="text-align:center;padding:20px;">No data found</td></tr>'}
        </tbody>
    </table>
`;

async function getCountryOptions() {
    if (!pool) return '<option>DB Initializing...</option>';
    const [rows] = await pool.query('SELECT alpha_3, name FROM countries ORDER BY name ASC');
    return '<option value="">-- Select from List --</option>' + 
           rows.map(c => `<option value="${c.alpha_3}">${c.name}</option>`).join('');
}

// [新增] 智慧搜尋 Helper：將輸入字串解析為 Country Code
// 回傳: { success: true, code: 'USA' } 或 { success: false, error: 'Reason' }
async function resolveCountry(input) {
    if (!input || input.trim() === '') return { success: false, error: 'Input is empty' };
    
    // 1. 先嘗試精確比對名稱或代碼
    const [exact] = await pool.query('SELECT alpha_3, name FROM countries WHERE name = ? OR alpha_3 = ?', [input, input]);
    if (exact.length === 1) return { success: true, code: exact[0].alpha_3, name: exact[0].name };

    // 2. 模糊比對
    const [partial] = await pool.query('SELECT alpha_3, name FROM countries WHERE name LIKE ?', [`%${input}%`]);
    
    if (partial.length === 0) {
        return { success: false, error: `Country "${input}" not found.` };
    } else if (partial.length > 1) {
        // 如果找到多筆 (例如輸入 "United")，回傳第一筆或報錯，這裡我們選擇比較友善的報錯
        return { success: false, error: `Ambiguous search "${input}". Found ${partial.length} matches (e.g., ${partial[0].name}). Please be more specific.` };
    }
    
    return { success: true, code: partial[0].alpha_3, name: partial[0].name };
}

// === Routes ===

app.get('/country-options', async (req, res) => { res.send(await getCountryOptions()); });

// --- Feature 1: Country Trend (完整修復版) ---

// 1. 回傳表單介面
app.get('/features/f1', async (req, res) => {
    // 確保這裡有呼叫 getCountryOptions (這在 Feature 5 正常運作代表此函式沒問題)
    const options = await getCountryOptions();
    
    res.send(`
        <div class="feature-box">
            <h4>1. Country Income Trend</h4>
            
            <p class="feature-description">
                View the complete historical timeline of income inequality for a specific nation. 
                Select a country to see how its Top 1% income share has evolved over the years.
            </p>

            <div class="control-group">
                <label>Method A: Dropdown</label>
                <select name="country_code" 
                        id="f1-dropdown"
                        onchange="document.getElementById('f1-search').value=''"
                        hx-get="/reports/f1" 
                        hx-target="#f1-result" 
                        hx-trigger="change">
                    ${options}
                </select>
            </div>

            <div class="divider-text">OR</div>

            <div class="control-group">
                <label>Method B: Manual Search</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" 
                           name="manual_search" 
                           id="f1-search"
                           placeholder="Type country name (e.g. United)..."
                           oninput="document.getElementById('f1-dropdown').value=''">
                    
                    <button class="btn btn-primary" 
                            hx-get="/reports/f1" 
                            hx-include="[name='manual_search']" 
                            hx-target="#f1-result">
                        Search
                    </button>
                </div>
            </div>
            
            <div id="f1-result"></div>
        </div>
    `);
});

// 2. 處理報告查詢 (包含下拉選單與手動搜尋的邏輯)
app.get('/reports/f1', async (req, res) => {
    let code = req.query.country_code;
    const manualSearch = req.query.manual_search;

    // [關鍵修正]：如果收到 manual_search，必須先解析出 code
    if (manualSearch) {
        try {
            // 呼叫 resolveCountry 函式
            const result = await resolveCountry(manualSearch);
            if (!result.success) {
                // 如果找不到國家，觸發錯誤視窗 (Error Modal)
                res.set('HX-Trigger', JSON.stringify({ showError: result.error }));
                return res.send(''); 
            }
            code = result.code; // 取得解析後的代碼 (例如 USA)
        } catch (err) {
            console.error("Resolve Error:", err);
            return res.send('<div style="color:red">Server Error during search.</div>');
        }
    }

    // 如果沒有 code (代表下拉選單沒選，搜尋框也是空的)，就不做動作
    if (!code) return res.send('');

    try {
        // 查詢歷年數據
        const [rows] = await pool.query(
            'SELECT year, richest_income_share FROM income_statistics WHERE country_code = ? ORDER BY year ASC',
            [code]
        );

        // 查詢國家全名 (為了顯示好看的標題)
        const [c] = await pool.query('SELECT name FROM countries WHERE alpha_3 = ?', [code]);
        const countryName = c.length > 0 ? c[0].name : code;
        
        // 產生 HTML 表格
        let html = `<h5 style="color:#2563eb; margin:10px 0;">Trend for: ${countryName}</h5>`;
        html += renderTable(['Year', 'Top 1% Share'], rows, r => `
            <tr><td>${r.year}</td><td>${r.richest_income_share}%</td></tr>
        `);
        res.send(html);

    } catch (e) { 
        console.error("Report Error:", e);
        res.send(`<div style="color:red">Error loading report: ${e.message}</div>`); 
    }
});

// --- Feature 2, 3, 4 (No Change, Keep as is) ---
app.get('/features/f2', async (req, res) => { /* Same as before */ 
    const [subs] = await pool.query('SELECT sub_region_code, name FROM sub_regions ORDER BY name ASC');
    const [years] = await pool.query('SELECT DISTINCT year FROM income_statistics ORDER BY year DESC');
    res.send(`
        <div class="feature-box"><h4>2. Sub-Region Comparison</h4>
        <p class="feature-description">
                Compare inequality levels among neighbors. Select a sub-region (e.g., Eastern Asia) and a year 
                to see a ranked list of all countries within that area.
        </p>
        <form hx-get="/reports/f2" hx-target="#f2-result" class="control-row"><select name="sub_region" required><option value="">Select Sub-Region</option>${subs.map(s => `<option value="${s.sub_region_code}">${s.name}</option>`).join('')}</select><select name="year" required><option value="">Select Year</option>${years.map(y => `<option value="${y.year}">${y.year}</option>`).join('')}</select><button type="submit" class="btn btn-primary">Show</button></form><div id="f2-result"></div></div>
    `);
});
app.get('/reports/f2', async (req, res) => { /* Same as before */
    const { sub_region, year } = req.query; try { const [rows] = await pool.query(`SELECT c.name, s.richest_income_share FROM countries c JOIN income_statistics s ON c.alpha_3 = s.country_code WHERE c.sub_region_code = ? AND s.year = ? ORDER BY s.richest_income_share DESC`, [sub_region, year]); res.send(renderTable(['Country', `Share (${year})`], rows, r => `<tr><td>${r.name}</td><td><strong>${r.richest_income_share}%</strong></td></tr>`)); } catch (e) { res.send(e.message); }
});

app.get('/features/f3', async (req, res) => { /* Same as before */ 
    const [regions] = await pool.query('SELECT region_code, name FROM regions ORDER BY name ASC'); const [years] = await pool.query('SELECT DISTINCT year FROM income_statistics ORDER BY year DESC'); res.send(`<div class="feature-box"><h4>3. Regional Max Share</h4>
            <p class="feature-description">
                Identify the peaks of inequality. This tool aggregates data by continent/region 
                and displays the maximum income share recorded in each of its sub-regions.
            </p><form hx-get="/reports/f3" hx-target="#f3-result" class="control-row"><select name="region" required><option value="">Select Region</option>${regions.map(r => `<option value="${r.region_code}">${r.name}</option>`).join('')}</select><select name="year" required><option value="">Select Year</option>${years.map(y => `<option value="${y.year}">${y.year}</option>`).join('')}</select><button type="submit" class="btn btn-primary">Analyze</button></form><div id="f3-result"></div></div>`);
});
app.get('/reports/f3', async (req, res) => { /* Same as before */
    const { region, year } = req.query; try { const [rows] = await pool.query(`SELECT r.name as region_name, sr.name as sub_region_name, MAX(s.richest_income_share) as max_share FROM regions r JOIN sub_regions sr ON r.region_code = sr.region_code JOIN countries c ON sr.sub_region_code = c.sub_region_code JOIN income_statistics s ON c.alpha_3 = s.country_code WHERE r.region_code = ? AND s.year = ? GROUP BY sr.sub_region_code ORDER BY r.name, max_share DESC`, [region, year]); res.send(renderTable(['Sub Region', 'Max Share'], rows, r => `<tr><td>${r.sub_region_name}</td><td>${r.max_share}%</td></tr>`)); } catch (e) { res.send(e.message); }
});

app.get('/features/f4', (req, res) => { /* Same as before */ 
    res.send(`<div class="feature-box"><h4>4. Keyword Search</h4>
            <p class="feature-description">
                Quickly locate specific targets. Enter a keyword to find countries and automatically 
                retrieve their most recent available data point (Latest Year).
            </p><div class="control-row"><input type="text" name="keyword" class="search-input" placeholder="Type country name..." hx-post="/reports/f4" hx-trigger="keyup changed delay:500ms" hx-target="#f4-result"></div><div id="f4-result"></div></div>`);
});
app.post('/reports/f4', async (req, res) => { /* Same as before */
    const keyword = req.body.keyword; if (!keyword) return res.send(''); try { const [rows] = await pool.query(`SELECT c.name, s.year, s.richest_income_share FROM countries c JOIN income_statistics s ON c.alpha_3 = s.country_code WHERE c.name LIKE ? AND s.year = (SELECT MAX(year) FROM income_statistics WHERE country_code = c.alpha_3) ORDER BY s.richest_income_share DESC`, [`%${keyword}%`]); res.send(renderTable(['Country', 'Latest Year', 'Share'], rows, r => `<tr><td>${r.name}</td><td>${r.year}</td><td>${r.richest_income_share}%</td></tr>`)); } catch (e) { res.send(e.message); }
});

// --- Feature 5: Add Next Year (Modified) ---
// --- Feature 5: Add Next Year (Modified with Auto-Clear) ---
app.get('/features/f5', async (req, res) => {
    const options = await getCountryOptions();
    res.send(`
        <div class="feature-box">
            <h4>5. Add Next Year Record</h4>
            
            <p class="feature-description">
                Extend the timeline. Select a country, and the system will automatically determine 
                the next chronological year (e.g., 2024) for data entry.
            </p>

            <div class="control-group">
                <label>Select by List:</label>
                <select name="country_code" 
                        id="f5-dropdown"
                        onchange="document.getElementById('f5-search').value=''"
                        hx-get="/data/next-year-preview" 
                        hx-target="#f5-form-area" 
                        hx-trigger="change">
                    ${options}
                </select>
            </div>

            <div class="divider-text">OR</div>

            <div class="control-group">
                <label>Select by Search:</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" 
                           name="manual_search" 
                           id="f5-search"
                           placeholder="Type country name..."
                           oninput="document.getElementById('f5-dropdown').value=''">
                           
                    <button class="btn btn-primary" 
                            hx-get="/data/next-year-preview" 
                            hx-include="[name='manual_search']" 
                            hx-target="#f5-form-area">
                        Prepare Add
                    </button>
                </div>
            </div>

            <div id="f5-form-area" style="margin-top:15px; border-top:1px solid #eee; padding-top:15px;"></div>
        </div>
    `);
});

// Feature 5 Preview Logic (Updated with Dark Theme Fix)
app.get('/data/next-year-preview', async (req, res) => {
    let code = req.query.country_code;
    const manualSearch = req.query.manual_search;

    if (manualSearch) {
        const result = await resolveCountry(manualSearch);
        if (!result.success) {
            res.set('HX-Trigger', JSON.stringify({ showError: result.error }));
            return res.send('');
        }
        code = result.code;
    }

    if (!code) return res.send('');

    // Logic to find next year
    const [rows] = await pool.query('SELECT MAX(year) as max_year FROM income_statistics WHERE country_code = ?', [code]);
    const nextYear = (rows[0].max_year || 2023) + 1;
    
    // Get country name for display
    const [c] = await pool.query('SELECT name FROM countries WHERE alpha_3 = ?', [code]);

    // 👇 這裡就是產生預覽表單的地方 👇
    res.send(`
        <form hx-post="/data/add-record" 
              hx-target="#f5-form-area" 
              style="background: rgba(255, 255, 255, 0.05); border: 1px solid var(--kafka-purple); padding:15px; border-radius:8px;">
            
            <h5 style="margin-top:0; color: var(--kafka-gold);">Adding for: ${c[0].name} (${code})</h5>
            <input type="hidden" name="country_code" value="${code}">
            
            <div class="control-row">
                <span style="color: var(--text-main);">Next Year: <strong style="color: var(--kafka-magenta);">${nextYear}</strong></span>
                <input type="hidden" name="year" value="${nextYear}">
                <input type="number" step="0.01" name="share" placeholder="Top 1% Share" required style="width:150px;">
                <button type="submit" class="btn btn-success">Confirm Save</button>
            </div>
        </form>
    `);
});

app.post('/data/add-record', async (req, res) => { /* Same as before */
    const { country_code, year, share } = req.body; try { await pool.query('INSERT INTO income_statistics (country_code, year, richest_income_share) VALUES (?, ?, ?)', [country_code, year, share]); res.set('HX-Trigger', JSON.stringify({ showMessage: `Added record for ${year}` })); res.send(`<div style="color:green; padding:10px;">✅ Saved ${share}% for year ${year}.</div>`); } catch (e) { res.send(`<div style="color:red">Error: ${e.message}</div>`); }
});

// --- Feature 6: Update Existing Record (List-Based Editing) ---

// 1. Feature 6 介面：包含「編輯區」與「列表區」
// --- Feature 6: Inline Row Editing (Updated) ---

// 1. Feature 6 介面 (移除了上方的 edit-stage)
app.get('/features/f6', async (req, res) => {
    const options = await getCountryOptions();
    res.send(`
        <div class="feature-box">
            <h4>6. Update Record (Inline Edit)</h4>
            
            <p class="feature-description">
                Correct discrepancies. Select a country to view its full record history, 
                then click "Edit" on any row to modify the value directly in the list.
            </p>

            <div class="control-row">
                <label>Select Country to Edit:</label>
                <select name="country_code" 
                        required
                        hx-get="/reports/f6-preview" 
                        hx-target="#f6-list-area" 
                        hx-trigger="change">
                     ${options}
                </select>
            </div>

            <div>
                <h5 style="margin:0 0 10px 0; color: var(--text-muted);">Record List</h5>
                <div id="f6-list-area">
                    <p style="color: var(--text-muted); font-style:italic;">Select a country to view records.</p>
                </div>
            </div>
        </div>
    `);
});

// 2. 產生該國家的資料列表 (Edit 按鈕改為替換整行)
app.get('/reports/f6-preview', async (req, res) => {
    const code = req.query.country_code;
    if (!code) return res.send('<p style="color:var(--text-muted);">Please select a country.</p>');

    try {
        const [rows] = await pool.query(
            'SELECT stat_id, year, richest_income_share FROM income_statistics WHERE country_code = ? ORDER BY year ASC',
            [code]
        );

        if (rows.length === 0) return res.send('<p style="color:#ef4444;">No records found.</p>');

        let html = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 30%;">Year</th>
                        <th style="width: 40%;">Top 1% Share</th>
                        <th style="text-align:right;">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // 這裡我們抽出一個 renderRow 的小邏輯，因為後面會一直用到
        html += rows.map(r => renderReadOnlyRow(r)).join('');
        html += `</tbody></table>`;
        res.send(html);

    } catch (e) {
        res.send(`<div style="color:red">Error: ${e.message}</div>`);
    }
});

// [Helper] 產生唯讀行 HTML (減少重複程式碼)
function renderReadOnlyRow(r) {
    return `
        <tr>
            <td>${r.year}</td>
            <td>${r.richest_income_share}%</td>
            <td style="text-align:right;">
                <button class="btn btn-primary"
                        style="padding: 4px 12px; font-size: 0.8rem;"
                        hx-get="/data/load-record/${r.stat_id}"
                        hx-target="closest tr"
                        hx-swap="outerHTML">
                    Edit
                </button>
            </td>
        </tr>
    `;
}

// 3. 載入單筆資料 -> 變身為「編輯行 (<tr>)」
app.get('/data/load-record/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await pool.query('SELECT * FROM income_statistics WHERE stat_id = ?', [id]);
        if (rows.length === 0) return res.send('<tr><td colspan="3">Error</td></tr>');
        const record = rows[0];

        // 回傳一個帶有 input 的 tr
        // 注意：我們給這個 tr 加了特別的背景色，讓使用者知道正在編輯
        res.send(`
            <tr style="background: rgba(139, 92, 246, 0.1); box-shadow: inset 0 0 10px rgba(0,0,0,0.2);">
                <td style="vertical-align: middle; font-weight:bold; color:var(--kafka-gold);">
                    ${record.year}
                    <input type="hidden" name="id" value="${record.stat_id}">
                    <input type="hidden" name="country_code" value="${record.country_code}">
                </td>
                <td style="vertical-align: middle;">
                    <div style="display:flex; align-items:center; gap:5px;">
                        <input type="number" step="0.01" name="share" 
                               value="${record.richest_income_share}" 
                               style="width: 100px; border: 1px solid var(--kafka-magenta);" autofocus>
                        <span>%</span>
                    </div>
                </td>
                <td style="text-align:right; vertical-align: middle;">
                    <div style="display:flex; justify-content:flex-end; gap:5px;">
                        <button class="btn btn-success"
                                style="padding: 4px 10px; font-size: 0.8rem;"
                                hx-put="/data/update-record"
                                hx-include="closest tr"
                                hx-target="closest tr"
                                hx-swap="outerHTML">
                            Save
                        </button>
                        
                        <button class="btn btn-del"
                                style="padding: 4px 10px; font-size: 0.8rem;"
                                hx-get="/data/get-row/${record.stat_id}"
                                hx-target="closest tr"
                                hx-swap="outerHTML">
                            Cancel
                        </button>
                    </div>
                </td>
            </tr>
        `);
    } catch (e) {
        res.send(`<tr><td colspan="3" style="color:red">Error: ${e.message}</td></tr>`);
    }
});

// 4. [新增] 重新撈取單一唯讀行 (給 Cancel 按鈕用)
app.get('/data/get-row/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await pool.query('SELECT stat_id, year, richest_income_share FROM income_statistics WHERE stat_id = ?', [id]);
        if (rows.length > 0) {
            res.send(renderReadOnlyRow(rows[0]));
        } else {
            res.send('');
        }
    } catch (e) { res.send('Error'); }
});

// 5. 執行更新 -> 變回「唯讀行 (<tr>)」
app.put('/data/update-record', async (req, res) => {
    const { id, share } = req.body;
    try {
        // 更新資料庫
        await pool.query('UPDATE income_statistics SET richest_income_share = ? WHERE stat_id = ?', [share, id]);
        
        // 重新查詢更新後的資料
        const [rows] = await pool.query('SELECT stat_id, year, richest_income_share FROM income_statistics WHERE stat_id = ?', [id]);
        
        // 觸發右上角成功提示
        res.set('HX-Trigger', JSON.stringify({ showMessage: `Updated ${rows[0].year} to ${rows[0].richest_income_share}%` }));
        
        // 回傳一般的唯讀行 (這樣介面就無縫變回去了)
        // 為了讓使用者知道更新成功，我們可以加一點 style (例如文字稍微亮一下)，這裡先保持簡單
        res.send(renderReadOnlyRow(rows[0]));

    } catch (e) { 
        // 保持在編輯狀態並顯示錯誤
        res.status(500).send(`
            <tr><td colspan="3" style="color:red; padding:10px;">Update Failed: ${e.message} <button onclick="this.closest('tr').remove()">Close</button></td></tr>
        `); 
    }
});

// --- Feature 7: Range Delete & List Management (Enhanced) ---

// 1. Feature 7 介面：新增了資料預覽區塊
// --- Feature 7: Range Delete & List Management (Fixed) ---

// 1. Feature 7 介面
app.get('/features/f7', async (req, res) => {
    const options = await getCountryOptions();
    res.send(`
        <div class="feature-box">
            <h4>7. Delete Records (Range & Individual)</h4>
            
            <p class="feature-description">
                Remove obsolete or incorrect data. You can delete a specific range of years 
                or remove individual records from the preview list below.
            </p>

            <form hx-delete="/data/delete-range" 
                  hx-target="#f7-msg" 
                  style="border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 20px;">
                
                <div class="control-row" style="align-items:flex-end;">
                    <div>
                        <label>Select Country</label><br>
                        <select name="country_code" 
                                required
                                hx-get="/reports/f7-preview" 
                                hx-target="#f7-preview-area" 
                                hx-trigger="change">
                             ${options}
                        </select>
                    </div>
                    <div>
                        <label>Start Year</label><br>
                        <input type="number" name="start_year" required style="width:100px;" placeholder="YYYY">
                    </div>
                    <div>
                        <label>End Year</label><br>
                        <input type="number" name="end_year" required style="width:100px;" placeholder="YYYY">
                    </div>
                    
                    <button type="submit" 
                            class="btn btn-del"
                            hx-confirm="Are you sure you want to delete records in this range?">
                        Delete Range
                    </button>
                </div>
                <div id="f7-msg" style="margin-top:10px;"></div>
            </form>

            <div>
                <h5 style="margin:0 0 10px 0; color:#4b5563;">Data Preview</h5>
                <div id="f7-preview-area">
                    <p style="color:#9ca3af; font-style:italic;">Select a country to view data.</p>
                </div>
            </div>
        </div>
    `);
});

// 2. 產生該國家的資料列表 (維持不變，但為了完整性列出)
app.get('/reports/f7-preview', async (req, res) => {
    const code = req.query.country_code;
    if (!code) return res.send('<p style="color:#9ca3af;">Please select a country.</p>');

    try {
        const [rows] = await pool.query(
            'SELECT stat_id, year, richest_income_share FROM income_statistics WHERE country_code = ? ORDER BY year ASC',
            [code]
        );

        if (rows.length === 0) {
            return res.send('<p style="color:#ef4444;">No records found for this country.</p>');
        }

        let html = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Year</th>
                        <th>Top 1% Share</th>
                        <th style="text-align:right;">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        html += rows.map(r => `
            <tr>
                <td>${r.year}</td>
                <td>${r.richest_income_share}%</td>
                <td style="text-align:right;">
                    <button class="btn btn-sm btn-del"
                            hx-delete="/data/record/${r.stat_id}"
                            hx-confirm="Delete data for year ${r.year}?"
                            hx-target="closest tr"
                            hx-swap="outerHTML swap:0.5s">
                        Delete
                    </button>
                </td>
            </tr>
        `).join('');

        html += `</tbody></table>`;
        res.send(html);

    } catch (e) {
        res.send(`<div style="color:red">Error loading list: ${e.message}</div>`);
    }
});

// 3. [新增] 單筆刪除 API
app.delete('/data/record/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await pool.query('DELETE FROM income_statistics WHERE stat_id = ?', [id]);
        
        // 觸發右上角成功提示 (Optional)
        res.set('HX-Trigger', JSON.stringify({ showMessage: "Record deleted." }));
        
        // 回傳空字串，HTMX 會把原本的 <tr> 換成這個空字串，達成移除效果
        res.send('');
    } catch (e) {
        // 若失敗，回傳錯誤訊息並保留該行，或者用 alert
        res.status(500).send(`<td colspan="3" style="color:red">Error: ${e.message}</td>`);
    }
});

// 4. [修改] 範圍刪除 API (加入列表自動刷新功能)
app.delete('/data/delete-range', async (req, res) => {
    const { country_code, start_year, end_year } = req.body;
    try {
        // 執行刪除
        const [result] = await pool.query(
            'DELETE FROM income_statistics WHERE country_code = ? AND year BETWEEN ? AND ?', 
            [country_code, start_year, end_year]
        );

        // --- 關鍵修改：準備 OOB 更新 ---
        // 刪除後，我們希望下方的列表也能同步更新，顯示刪除後的結果。
        // 我們重新呼叫一次撈取列表的邏輯 (這一段可以重構為函式，這裡為了方便直接寫)
        
        const [remainingRows] = await pool.query(
            'SELECT stat_id, year, richest_income_share FROM income_statistics WHERE country_code = ? ORDER BY year ASC',
            [country_code]
        );

        // 重新產生列表 HTML
        let newListHtml = '';
        if (remainingRows.length === 0) {
            newListHtml = '<p style="color:#ef4444;">No records found for this country.</p>';
        } else {
            newListHtml = `
                <table class="data-table">
                    <thead><tr><th>Year</th><th>Top 1% Share</th><th style="text-align:right;">Action</th></tr></thead>
                    <tbody>
                        ${remainingRows.map(r => `
                            <tr>
                                <td>${r.year}</td>
                                <td>${r.richest_income_share}%</td>
                                <td style="text-align:right;">
                                    <button class="btn btn-sm btn-del"
                                            hx-delete="/data/record/${r.stat_id}"
                                            hx-confirm="Delete data for year ${r.year}?"
                                            hx-target="closest tr"
                                            hx-swap="outerHTML swap:0.5s">
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        // 回傳回應：
        // 1. 主要內容：顯示在 #f7-msg 的成功訊息
        // 2. OOB內容：透過 hx-swap-oob 自動尋找 id="f7-preview-area" 並更新其內容
        res.set('HX-Trigger', JSON.stringify({ showMessage: `Deleted ${result.affectedRows} records.` }));
        
        res.send(`
            <div style="color:green; font-weight:bold;">
                ✅ Successfully deleted ${result.affectedRows} records (${start_year}-${end_year}).
            </div>

            <div id="f7-preview-area" hx-swap-oob="true">
                ${newListHtml}
            </div>
        `);

    } catch (e) { 
        res.send(`<div style="color:red">${e.message}</div>`); 
    }
});

app.get('/features/f8', async (req, res) => { /* Same as before */
    if (!pool) return res.send('DB Init...'); const [years] = await pool.query('SELECT DISTINCT year FROM income_statistics ORDER BY year DESC'); res.send(`<div class="feature-box"><h4>8. Inequality Extremes</h4>
            <p class="feature-description">
                Analyze global extremes. This report simultaneously displays the Top 5 countries with the 
                highest inequality and the Top 5 with the lowest inequality for any given year.
            </p><div class="control-row"><select name="year" hx-get="/reports/f8" hx-target="#f8-result"><option value="">Select Year</option>${years.map(y => `<option value="${y.year}">${y.year}</option>`).join('')}</select></div><div id="f8-result"></div></div>`);
});
app.get('/reports/f8', async (req, res) => { /* Same as before */
    const { year } = req.query; if (!year) return res.send(''); try { const [top5] = await pool.query(`SELECT c.name, s.richest_income_share FROM countries c JOIN income_statistics s ON c.alpha_3 = s.country_code WHERE s.year = ? ORDER BY s.richest_income_share DESC LIMIT 5`, [year]); const [bot5] = await pool.query(`SELECT c.name, s.richest_income_share FROM countries c JOIN income_statistics s ON c.alpha_3 = s.country_code WHERE s.year = ? ORDER BY s.richest_income_share ASC LIMIT 5`, [year]); const renderMini = (title, rows, color) => `<div style="flex:1"><h5 style="color:${color}; border-bottom:2px solid ${color}; padding-bottom:5px;">${title}</h5>${renderTable(['Country', 'Share'], rows, r => `<tr><td>${r.name}</td><td>${r.richest_income_share}%</td></tr>`)}</div>`; res.send(`<div style="display:flex; gap:20px;">${renderMini('Highest Inequality', top5, '#ef4444')}${renderMini('Lowest Inequality', bot5, '#10b981')}</div>`); } catch (e) { res.send(e.message); }
});

app.listen(3000, () => { console.log('Server running on port 3000'); });