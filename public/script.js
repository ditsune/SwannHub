// ============================================================
// ROBOX ACCOUNT MANAGER - Frontend Script
// ============================================================

let accountCount = 0;
let lastAccounts = [];
let pollingInterval = null;
let autoParseTimer = null;
let historyData = [];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    
    // Auto-parse on input
    const bulkInput = document.getElementById('bulkInput');
    if (bulkInput) {
        bulkInput.addEventListener('input', () => {
            clearTimeout(autoParseTimer);
            autoParseTimer = setTimeout(() => {
                const text = bulkInput.value.trim();
                if (text.length > 10) parseBulk();
            }, 500);
        });
    }
    
    // Bulk buttons
    document.getElementById('bulkBtnPaste')?.addEventListener('click', autoPaste);
    document.getElementById('bulkBtnClear')?.addEventListener('click', clearBulk);
    
    // History modal
    document.getElementById('historyBtn')?.addEventListener('click', () => {
        document.getElementById('historyModal').style.display = 'flex';
        document.getElementById('historySearch').value = '';
        renderHistory();
    });
    
    document.getElementById('historyModalClose')?.addEventListener('click', () => {
        document.getElementById('historyModal').style.display = 'none';
    });
    
    document.getElementById('historyModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('historyModal')) {
            document.getElementById('historyModal').style.display = 'none';
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('historyModal').style.display = 'none';
        }
    });
});

// ============================================================
// BULK TOGGLE
// ============================================================
function toggleBulk() {
    const content = document.getElementById('bulkContent');
    const icon = document.getElementById('bulkToggleIcon');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.textContent = '▲';
    } else {
        content.style.display = 'none';
        icon.textContent = '▼';
    }
}

// ============================================================
// BULK PARSER
// ============================================================
function parseBulk() {
    const bulkText = document.getElementById('bulkInput').value.trim();
    const parseResult = document.getElementById('parseResult');
    
    if (!bulkText) {
        parseResult.textContent = '❌ Textarea kosong!';
        parseResult.className = 'parse-result error';
        return;
    }
    
    const lines = bulkText.split('\n').filter(line => line.trim() !== '');
    const accounts = [];
    const errors = [];
    
    const hasTabs = lines.some(line => line.includes('\t'));
    
    if (hasTabs) {
        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].trim().split('\t');
            if (parts.length < 2) { errors.push(`Baris ${i+1}: Format salah`); continue; }
            const username = parts[0].trim();
            const password = parts[1].trim();
            const backupCodes = parts.slice(2, 7).map(c => c.trim()).filter(c => c);
            if (!username || !password) { errors.push(`Baris ${i+1}: Username/password kosong`); continue; }
            accounts.push({ username, password, backupCodes });
        }
    } else {
        const allText = lines.join('\n');
        const blocks = allText.split(/\n\s*\n|\n-{3,}\n|\n={3,}\n/);
        
        for (let b = 0; b < blocks.length; b++) {
            const block = blocks[b].trim();
            if (!block) continue;
            const blockLines = block.split('\n');
            
            let username = null;
            let password = null;
            const backupCodes = [];
            
            for (const line of blockLines) {
                const trimmed = line.trim();
                
                if (/^(usn|username|user|akun|id)\s*[:=]/i.test(trimmed)) {
                    username = trimmed.replace(/^(usn|username|user|akun|id)\s*[:=]\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/^(pw|pass|password|pwd|sandi)\s*[:=]/i.test(trimmed)) {
                    password = trimmed.replace(/^(pw|pass|password|pwd|sandi)\s*[:=]\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/^(backup|code|kode|backup code|backupcode)\s*[:=]/i.test(trimmed)) {
                    const codeText = trimmed.replace(/^(backup|code|kode|backup code|backupcode)\s*[:=]\s*/i, '').replace(/['`"]/g, '');
                    const codes = codeText.split(/[,;\s]+/).map(c => c.trim()).filter(c => c.length >= 8);
                    backupCodes.push(...codes);
                    continue;
                }
                
                if (/^[a-z0-9]{8,9}$/i.test(trimmed)) { backupCodes.push(trimmed); continue; }
                
                if (/👤\s*Username/i.test(trimmed)) {
                    username = trimmed.replace(/.*Username\s*[:`']\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/🔑\s*Password/i.test(trimmed)) {
                    password = trimmed.replace(/.*Password\s*[:`']\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/🛡\s*Backup/i.test(trimmed)) {
                    const codeText = trimmed.replace(/.*Backup[^:]*\s*[:`']\s*/i, '').replace(/['`"]/g, '');
                    const codes = codeText.split(/[,;\s]+/).map(c => c.trim()).filter(c => c.length >= 8);
                    backupCodes.push(...codes);
                    continue;
                }
                
                const usnMatch = trimmed.match(/^usn\s*:\s*(.+)/i);
                if (usnMatch) { username = usnMatch[1].trim(); continue; }
                const pwMatch = trimmed.match(/^pw\s*:\s*(.+)/i);
                if (pwMatch) { password = pwMatch[1].trim(); continue; }
            }
            
            if (!username) {
                for (let j = 0; j < blockLines.length; j++) {
                    if (/usn|username|user|akun/i.test(blockLines[j]) && blockLines[j + 1]) {
                        username = blockLines[j + 1].trim(); break;
                    }
                }
            }
            if (!password) {
                for (let j = 0; j < blockLines.length; j++) {
                    if (/pw|pass|password|sandi/i.test(blockLines[j]) && blockLines[j + 1]) {
                        password = blockLines[j + 1].trim(); break;
                    }
                }
            }
            
            if (username && password) {
                accounts.push({ username, password, backupCodes: backupCodes.slice(0, 5) });
            } else {
                errors.push(`Blok ${b+1}: Username/password tidak ditemukan`);
            }
        }
    }
    
    if (accounts.length === 0) {
        parseResult.textContent = '❌ Tidak ada data valid! ' + errors.join('; ');
        parseResult.className = 'parse-result error';
        return;
    }
    
    fillForm(accounts);
    
    let msg = `✅ ${accounts.length} akun berhasil diparse!`;
    if (errors.length > 0) msg += ` ⚠️ ${errors.length} error`;
    parseResult.textContent = msg;
    parseResult.className = errors.length > 0 ? 'parse-result warning' : 'parse-result success';
}

// ============================================================
// AUTO PASTE
// ============================================================
async function autoPaste() {
    const parseResult = document.getElementById('parseResult');
    const bulkInput = document.getElementById('bulkInput');
    
    try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            parseResult.textContent = '⚠️ Clipboard kosong!';
            parseResult.className = 'parse-result warning';
            return;
        }
        bulkInput.value = text;
        parseResult.textContent = '📋 Data dari clipboard berhasil dipaste!';
        parseResult.className = 'parse-result success';
        bulkInput.dispatchEvent(new Event('input'));
    } catch(e) {
        parseResult.textContent = '❌ Gagal baca clipboard. Izinkan akses clipboard.';
        parseResult.className = 'parse-result error';
    }
}

// ============================================================
// CLEAR BULK
// ============================================================
function clearBulk() {
    document.getElementById('bulkInput').value = '';
    document.getElementById('parseResult').textContent = '';
    document.getElementById('parseResult').className = 'parse-result';
    
    const container = document.getElementById('accountsContainer');
    container.innerHTML = '';
    accountCount = 0;
}

// ============================================================
// FILL FORM
// ============================================================
function fillForm(accounts) {
    const container = document.getElementById('accountsContainer');
    container.innerHTML = '';
    
    if (!accounts || accounts.length === 0) {
        accountCount = 0;
        return;
    }
    
    accounts.forEach((acc, idx) => {
        const card = document.createElement('div');
        card.className = 'account-card';
        card.setAttribute('data-index', idx);
        
        const backupInputs = [];
        for (let i = 0; i < 5; i++) {
            const val = acc.backupCodes[i] || '';
            backupInputs.push(`<input type="text" class="backup-code" maxlength="9" placeholder="Code ${i+1}" value="${val}">`);
        }
        
        card.innerHTML = `
            <div class="account-header">
                <h3>Account #${idx + 1}</h3>
                <button class="btn-remove" onclick="removeAccount(${idx})">✕</button>
            </div>
            <div class="form-group">
                <label>Username</label>
                <input type="text" class="username" placeholder="Username" value="${acc.username}" required>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" class="password" placeholder="Password" value="${acc.password}" required>
            </div>
            <div class="form-group">
                <label>5 Backup Codes</label>
                <div class="backup-codes-container">${backupInputs.join('')}</div>
            </div>
        `;
        container.appendChild(card);
    });
    
    accountCount = accounts.length;
}

// ============================================================
// FORM ACTIONS
// ============================================================
function addAccount() {
    accountCount++;
    const container = document.getElementById('accountsContainer');
    const newCard = document.createElement('div');
    newCard.className = 'account-card';
    newCard.setAttribute('data-index', accountCount - 1);
    newCard.innerHTML = `
        <div class="account-header">
            <h3>Account #${accountCount}</h3>
            <button class="btn-remove" onclick="removeAccount(${accountCount - 1})">✕</button>
        </div>
        <div class="form-group">
            <label>Username</label>
            <input type="text" class="username" placeholder="Username" required>
        </div>
        <div class="form-group">
            <label>Password</label>
            <input type="password" class="password" placeholder="Password" required>
        </div>
        <div class="form-group">
            <label>5 Backup Codes</label>
            <div class="backup-codes-container">
                <input type="text" class="backup-code" maxlength="9" placeholder="Code 1">
                <input type="text" class="backup-code" maxlength="9" placeholder="Code 2">
                <input type="text" class="backup-code" maxlength="9" placeholder="Code 3">
                <input type="text" class="backup-code" maxlength="9" placeholder="Code 4">
                <input type="text" class="backup-code" maxlength="9" placeholder="Code 5">
            </div>
        </div>
    `;
    container.appendChild(newCard);
}

function removeAccount(index) {
    const cards = document.querySelectorAll('.account-card');
    if (cards.length > 1) {
        cards[index].remove();
        document.querySelectorAll('.account-card h3').forEach((h3, i) => h3.textContent = `Account #${i + 1}`);
        accountCount--;
    } else if (cards.length === 1) {
        cards[0].remove();
        accountCount = 0;
    }
}

function getAccountsFromForm() {
    const accounts = [];
    document.querySelectorAll('.account-card').forEach(card => {
        const username = card.querySelector('.username').value.trim();
        const password = card.querySelector('.password').value.trim();
        const backupCodes = Array.from(card.querySelectorAll('.backup-code'))
            .map(input => input.value.trim())
            .filter(code => code !== '');
        if (username && password) accounts.push({ username, password, backupCodes });
    });
    return accounts;
}

// ============================================================
// PROCESS ACCOUNTS
// ============================================================
async function processAccounts() {
    const accounts = getAccountsFromForm();
    if (accounts.length === 0) { alert('Minimal 1 akun harus diisi!'); return; }
    
    lastAccounts = accounts;
    
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('btnProcess').disabled = true;
    document.getElementById('btnProcess').textContent = '⏳ Memproses...';
    document.getElementById('btnRetry').style.display = 'none';
    
    try {
        const response = await fetch('/api/process-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts })
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Gagal memulai'); }
        startPolling();
    } catch (error) {
        alert('Error: ' + error.message);
        document.getElementById('btnProcess').disabled = false;
        document.getElementById('btnProcess').textContent = '▶ Mulai Proses';
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            displayResults(data);
            if (!data.isProcessing) {
                clearInterval(pollingInterval);
                document.getElementById('btnProcess').disabled = false;
                document.getElementById('btnProcess').textContent = '▶ Mulai Proses';
                const hasFailed = data.results.some(r => r.status === 'failed' || r.status === 'captcha');
                document.getElementById('btnRetry').style.display = hasFailed ? 'inline-block' : 'none';
            }
        } catch (error) { console.error('Polling error:', error); }
    }, 500);
}

function displayResults(data) {
    const { results, currentIndex, total, isProcessing } = data;
    document.getElementById('progressText').textContent = `${currentIndex}/${total}`;
    document.getElementById('progressFill').style.width = total > 0 ? (currentIndex / total) * 100 + '%' : '0%';
    
    if (results && results.length > 0) {
        document.getElementById('resultsContainer').innerHTML = results.map((r) => {
            const statusClass = r.status === 'success' ? 'success' : 
                                r.status === 'processing' ? 'processing' : 
                                r.status === 'skip' ? 'skip' : 'failed';
            const icon = r.status === 'success' ? '✅' : 
                        r.status === 'processing' ? '⏳' : 
                        r.status === 'skip' ? '⚠️' : '❌';
            
            let extraInfo = '';
            if (r.twoSV) extraInfo += `<span class="result-badge badge-2sv">${r.twoSV}</span>`;
            if (r.xbox) {
                const xboxClass = r.xbox.includes('Connected') ? 'badge-xbox-yes' : 'badge-xbox-no';
                extraInfo += `<span class="result-badge ${xboxClass}">🎮 ${r.xbox}</span>`;
            }
            if (r.challenge === 'guess_image') extraInfo += `<span class="result-badge badge-challenge">🖼️ Tebak Gambar</span>`;
            
            return `
                <div class="result-item ${statusClass}">
                    <span class="result-icon">${icon}</span>
                    <span class="result-username">${r.username}</span>
                    <span class="result-status">${r.status}</span>
                    <span class="result-message">${r.message || ''}</span>
                    ${extraInfo}
                </div>
            `;
        }).join('');
        
        // Auto save ke history setelah selesai
        if (!isProcessing && lastAccounts.length > 0) {
            addToHistory(lastAccounts, results);
        }
    }
}

async function retryFailed() {
    const response = await fetch('/api/status');
    const data = await response.json();
    const failedAccounts = data.results
        .filter(r => r.status === 'failed' || r.status === 'captcha')
        .map(r => lastAccounts.find(a => a.username === r.username))
        .filter(a => a);
    
    if (failedAccounts.length === 0) { alert('Tidak ada akun yang perlu diulang'); return; }
    
    await fetch('/api/reset', { method: 'POST' });
    document.getElementById('resultsContainer').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('btnRetry').style.display = 'none';
    
    try {
        const res = await fetch('/api/process-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: failedAccounts }) });
        if (res.ok) startPolling();
    } catch (error) { alert('Error: ' + error.message); }
}

async function resetAll() {
    await fetch('/api/reset', { method: 'POST' });
    if (pollingInterval) clearInterval(pollingInterval);
    
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('resultsContainer').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('btnProcess').disabled = false;
    document.getElementById('btnProcess').textContent = '▶ Mulai Proses';
    document.getElementById('btnRetry').style.display = 'none';
    
    clearBulk();
}

// ============================================================
// HISTORY
// ============================================================
function loadHistory() {
    try {
        const saved = localStorage.getItem('roblox_login_history');
        if (saved) historyData = JSON.parse(saved);
    } catch(e) { historyData = []; }
}

function saveHistory() {
    try {
        localStorage.setItem('roblox_login_history', JSON.stringify(historyData));
    } catch(e) {}
}

function addToHistory(accounts, results) {
    accounts.forEach((acc) => {
        const result = results.find(r => r.username === acc.username);
        if (result) {
            // Hindari duplikat
            const exists = historyData.find(h => h.username === result.username && h.time === new Date().toLocaleString('id-ID'));
            if (!exists) {
                historyData.unshift({
                    username: result.username,
                    status: result.status,
                    message: result.message || '',
                    twoSV: result.twoSV || '',
                    xbox: result.xbox || '',
                    time: new Date().toLocaleString('id-ID')
                });
            }
        }
    });
    
    if (historyData.length > 200) historyData = historyData.slice(0, 200);
    saveHistory();
    renderHistory();
}

function renderHistory(filter = '') {
    const container = document.getElementById('historyList');
    const countEl = document.getElementById('historyCount');
    
    if (!container) return;
    
    let filtered = historyData;
    if (filter) {
        filtered = historyData.filter(h => 
            h.username.toLowerCase().includes(filter.toLowerCase())
        );
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p class="history-empty">Belum ada history</p>';
    } else {
        container.innerHTML = filtered.map(h => `
        <div class="history-item ${h.status}">
            <span class="history-item-icon">${h.status === 'success' ? '✅' : h.status === 'skip' ? '⚠️' : '❌'}</span>
            <span class="history-item-username">${h.username}</span>
            <span class="history-item-message">${h.message}</span>
            <div class="history-item-badges">
                ${h.twoSV ? `<span class="result-badge badge-2sv">${h.twoSV}</span>` : ''}
                ${h.xbox ? `<span class="result-badge ${h.xbox.includes('Connected') ? 'badge-xbox-yes' : 'badge-xbox-no'}">🎮 ${h.xbox}</span>` : ''}
            </div>
        </div>
    `).join('');
    }
    
    countEl.textContent = `${filtered.length} akun`;
}

function filterHistory() {
    const search = document.getElementById('historySearch').value;
    renderHistory(search);
}

function clearHistory() {
    if (confirm('Hapus semua history?')) {
        historyData = [];
        saveHistory();
        renderHistory();
    }
}