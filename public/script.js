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

    document.getElementById('bulkBtnPaste')?.addEventListener('click', autoPaste);
    document.getElementById('bulkBtnClear')?.addEventListener('click', clearBulk);

    // ========== HISTORY MODAL - FULL PAGE BLUR ==========
    const historyModal = document.getElementById('historyModal');
    const historyBtn = document.getElementById('historyBtn');
    const historyClose = document.getElementById('historyModalClose');

    historyBtn?.addEventListener('click', () => {
        // Tambahkan class ke body untuk blur full page
        document.body.classList.add('modal-open');
        
        historyModal.style.display = 'flex';
        // Reset animasi dengan reflow
        void historyModal.offsetHeight;
        
        document.getElementById('historySearch').value = '';
        renderHistory();
    });

    historyClose?.addEventListener('click', closeHistoryModal);

    historyModal?.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            closeHistoryModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeHistoryModal();
        }
    });

    // Init with one account card
    if (!document.querySelector('.account-card')) {
        addAccount();
    }
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
        const line = lines[i].trim();
        const parts = line.split('\t');
        
        if (parts.length < 2) {
            errors.push(`Baris ${i + 1}: Format salah`);
            continue;
        }
        
        let username = parts[0].trim();
        let password = '';
        const backupCodes = [];
        
        // Deteksi: kolom pertama invoice? (TLOG/VILOG)
        const isInvoice = /^(TLOG|VILOG)\d{8}-[A-Z0-9]{7}$/i.test(username);
        
        if (isInvoice) {
            // Format: TLOG [TAB] username [TAB] password [TAB] Robux [TAB] code1...
            username = parts[1] ? parts[1].trim() : '';  // Kolom 2
            password = parts[2] ? parts[2].trim() : '';  // Kolom 3
            
            // Mulai dari kolom 4+ (skip Robux, ambil backup codes)
            for (let j = 3; j < parts.length && backupCodes.length < 5; j++) {
                const code = parts[j].trim();
                // Skip kolom yang mengandung "Robux"
                if (/robux/i.test(code)) continue;
                if (code && /^[a-z0-9]{8,9}$/i.test(code)) {
                    backupCodes.push(code);
                }
            }
        } else {
            // Format biasa: username [TAB] password [TAB] code1...
            password = parts[1] ? parts[1].trim() : '';
            for (let j = 2; j < parts.length && backupCodes.length < 5; j++) {
                const code = parts[j].trim();
                if (code) backupCodes.push(code);
            }
        }
        
        if (!username || !password) {
            errors.push(`Baris ${i + 1}: Username/password kosong`);
            continue;
        }
        
        accounts.push({ username, password, backupCodes });
    }
        }else {
        // Split by block (dipisah oleh garis kosong atau header DETAIL PESANAN / NOTA)
        const blocks = bulkText.split(/\n\s*\n/);

        for (let b = 0; b < blocks.length; b++) {
            const block = blocks[b].trim();
            if (!block) continue;
            
            const blockLines = block.split('\n');

            let username = null;
            let password = null;
            const backupCodes = [];

            for (const line of blockLines) {
                const trimmed = line.trim();

                // Skip non-account lines
                if (/^(Invoice ID|Terbayar|Tanggal|Mohon|Harap|⌗|—|Pesanan|MinMayo|@|http)/i.test(trimmed)) continue;
                if (/^(TLOG|VILOG)\d{8}-[A-Z0-9]{7}$/i.test(trimmed)) continue;
                if (/Jumlah Robux/i.test(trimmed)) continue;
                if (/\b(Rp|IDR)\s*[\d.,]+/i.test(trimmed)) continue;

                // Username detection
                if (/👤\s*Username/i.test(trimmed)) {
                    username = trimmed.replace(/.*Username\s*[:`']\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/^(usn|username|user|akun|id)\s*[:=]/i.test(trimmed)) {
                    username = trimmed.replace(/^(usn|username|user|akun|id)\s*[:=]\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                const usnMatch = trimmed.match(/^usn\s*:\s*(.+)/i);
                if (usnMatch) { username = usnMatch[1].trim(); continue; }

                // Password detection
                if (/🔑\s*Password/i.test(trimmed)) {
                    password = trimmed.replace(/.*Password\s*[:`']\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                if (/^(pw|pass|password|pwd|sandi)\s*[:=]/i.test(trimmed)) {
                    password = trimmed.replace(/^(pw|pass|password|pwd|sandi)\s*[:=]\s*/i, '').replace(/['`"]/g, '').trim();
                    continue;
                }
                const pwMatch = trimmed.match(/^pw\s*:\s*(.+)/i);
                if (pwMatch) { password = pwMatch[1].trim(); continue; }

                // Backup Code detection
                if (/🛡\s*Backup/i.test(trimmed)) {
                    const codeText = trimmed.replace(/.*Backup[^:]*\s*[:`']\s*/i, '').replace(/['`"]/g, '');
                    const codes = codeText.split(/[,;\s]+/).map(c => c.trim()).filter(c => /^[a-z0-9]{8,9}$/i.test(c));
                    backupCodes.push(...codes);
                    continue;
                }
                if (/^(backup|code|kode|backup code|backupcode)\s*[:=]/i.test(trimmed)) {
                    const codeText = trimmed.replace(/^(backup|code|kode|backup code|backupcode)\s*[:=]\s*/i, '').replace(/['`"]/g, '');
                    const codes = codeText.split(/[,;\s]+/).map(c => c.trim()).filter(c => /^[a-z0-9]{8,9}$/i.test(c));
                    backupCodes.push(...codes);
                    continue;
                }

                // Backup code standalone (8-9 char alphanumeric)
                if (/^[a-z0-9]{8,9}$/i.test(trimmed)) {
                    backupCodes.push(trimmed);
                    continue;
                }
            }

            // Fallback: cari di baris setelah label
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
                // Skip duplicate accounts
                const exists = accounts.find(a => a.username === username);
                if (!exists) {
                    accounts.push({ username, password, backupCodes: backupCodes.slice(0, 5) });
                }
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
    } catch (e) {
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
            backupInputs.push(`<input type="text" class="backup-code" maxlength="9" placeholder="Code ${i + 1}" value="${val}">`);
        }

        card.innerHTML = `
            <div class="account-header" onclick="toggleCard(this)">
                <h3>▾ ${acc.username}</h3>
                <button class="btn-remove" onclick="event.stopPropagation(); removeAccount(${idx})">✕</button>
            </div>
            <div class="card-body">
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
            </div>
        `;
        container.appendChild(card);
    });

    accountCount = accounts.length;
}

// Toggle card collapse
function toggleCard(header) {
    const body = header.nextElementSibling;
    const isCollapsed = body.classList.toggle('collapsed');
    const h3 = header.querySelector('h3');
    const username = h3.textContent.replace(/^[▸▾]\s*/, '');
    h3.textContent = isCollapsed ? `▸ ${username}` : `▾ ${username}`;
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
        <div class="account-header" onclick="toggleCard(this)">
            <h3>▾ Account #${accountCount}</h3>
            <button class="btn-remove" onclick="event.stopPropagation(); removeAccount(${accountCount - 1})">✕</button>
        </div>
        <div class="card-body">
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
    if (accounts.length === 0) {
        alert('Minimal 1 akun harus diisi!');
        return;
    }

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
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Gagal memulai');
        }
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
        } catch (error) {
            console.error('Polling error:', error);
        }
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
            if (r.challenge === 'passkey') extraInfo += `<span class="result-badge badge-challenge">🔑 Passkey</span>`;
            if (r.challenge === 'captcha') extraInfo += `<span class="result-badge badge-challenge">🤖 Verif Bot</span>`;  // ← TAMBAHIN INI

            return `
                <div class="result-item ${statusClass}">
                    <span class="result-icon">${icon}</span>
                    <span class="result-username" onclick="copyToClipboard('${r.username}')" title="Click to copy">${r.username}</span>
                    <span class="result-status">${r.status}</span>
                    <span class="result-message">${r.message || ''}</span>
                    ${extraInfo}
                </div>
            `;
        }).join('');

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

    if (failedAccounts.length === 0) {
        alert('Tidak ada akun yang perlu diulang');
        return;
    }

    await fetch('/api/reset', { method: 'POST' });
    document.getElementById('resultsContainer').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    document.getElementById('btnRetry').style.display = 'none';

    try {
        const res = await fetch('/api/process-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts: failedAccounts })
        });
        if (res.ok) startPolling();
    } catch (error) {
        alert('Error: ' + error.message);
    }
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
    } catch (e) {
        historyData = [];
    }
}

function saveHistory() {
    try {
        localStorage.setItem('roblox_login_history', JSON.stringify(historyData));
    } catch (e) {}
}

function addToHistory(accounts, results) {
    accounts.forEach((acc) => {
        const result = results.find(r => r.username === acc.username);
        if (result) {
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

    // HAPUS LIMIT 200
    // if (historyData.length > 200) historyData = historyData.slice(0, 200);
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
                <span class="history-item-username" onclick="copyToClipboard('${h.username}')" title="Click to copy">${h.username}</span>
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

function closeHistoryModal() {
    const historyModal = document.getElementById('historyModal');
    if (historyModal) {
        historyModal.style.display = 'none';
        // Hapus class dari body untuk menghilangkan blur
        document.body.classList.remove('modal-open');
    }
}

// ============================================================
// COPY TO CLIPBOARD
// ============================================================
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        const toast = document.createElement('div');
        toast.textContent = `${text} di copy ke clipboard!`;
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            background: #3bc48b; color: #0b1018; padding: 8px 18px;
            border-radius: 30px; font-size: 0.75rem; font-weight: 600;
            z-index: 99999; pointer-events: none;
            animation: fadeInOut 1.5s ease forwards;
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 1500);
    } catch(e) {}
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
    // Ctrl+V di mana aja → append ke bulk input (kecuali lagi fokus di input lain)
    if (e.ctrlKey && e.key === 'v') {
        const activeEl = document.activeElement;
        
        // Kalo lagi fokus di input/textarea (selain bulkInput), biarin default
        if (activeEl && (
            activeEl.tagName === 'INPUT' || 
            (activeEl.tagName === 'TEXTAREA' && activeEl.id !== 'bulkInput')
        )) {
            return; // Biarin Ctrl+V normal
        }
        
        // Kalo di bulkInput atau di luar input → append
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
            if (!text.trim()) return;
            const bulk = document.getElementById('bulkInput');
            const current = bulk.value.trim();
            bulk.value = current + (current ? '\n' : '') + text;
            bulk.dispatchEvent(new Event('input'));
            showToast('📋 Data ditambahkan!', 'success');
        }).catch(() => {
            showToast('❌ Gagal baca clipboard', 'error');
        });
        return;
    }

    // Ctrl+Enter → mulai proses
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        const btnProcess = document.getElementById('btnProcess');
        if (btnProcess && !btnProcess.disabled) {
            processAccounts();
        }
    }
});

// ============================================================
// TOAST HELPER
// ============================================================
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: ${type === 'success' ? '#3bc48b' : '#f05b6b'}; color: #0b1018;
        padding: 8px 18px; border-radius: 30px; font-size: 0.75rem; font-weight: 600;
        z-index: 99999; pointer-events: none;
        animation: fadeInOut 1.5s ease forwards;
        font-family: 'Inter', sans-serif;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
}