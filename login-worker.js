const puppeteer = require('puppeteer');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// RANDOM HELPERS
// ============================================================
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay() {
    return 40 + Math.floor(Math.random() * 80);
}

function randomWait(minMs, maxMs) {
    return randomInt(minMs, maxMs);
}

// ============================================================
// API CALLS
// ============================================================
async function getRobloxUserId(page) {
    try {
        const userData = await page.evaluate(async () => {
            const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
                credentials: 'include'
            });
            if (!res.ok) return null;
            return await res.json();
        });
        return userData?.id || null;
    } catch(e) { return null; }
}

async function check2SVStatus(page, userId) {
    try {
        const data = await page.evaluate(async (uid) => {
            const res = await fetch(
                `https://twostepverification.roblox.com/v1/users/${uid}/configuration`,
                { credentials: 'include' }
            );
            if (!res.ok) return null;
            const json = await res.json();
            return (json.methods || []).filter(m => m.enabled).map(m => m.mediaType);
        }, userId);
        return data || [];
    } catch(e) { return []; }
}

async function checkXboxConnection(page) {
    try {
        const data = await page.evaluate(async () => {
            const res = await fetch('https://auth.roblox.com/v1/xbox/connection', {
                credentials: 'include'
            });
            if (!res.ok) return false;
            const json = await res.json();
            return json?.hasConnectedXboxAccount === true;
        });
        return data;
    } catch(e) { return false; }
}

function format2SVMethods(methods) {
    if (!methods || methods.length === 0) return '⚠️ No 2SV';
    const map = {
        'Authenticator': '📱 Auth App',
        'SMS': '📟 SMS',
        'Email': '📧 Email',
        'RecoveryCode': '🔑 Recovery Code'
    };
    return methods.map(m => map[m] || m).join(', ');
}

// ============================================================
// CHECK PAGE STATE
// ============================================================
async function checkPageState(page) {
    try {
        await wait(200);
        const result = await page.evaluate(() => {
            if (window.location.href.includes('/home')) return { state: 'home' };
            
            const homeIndicators = ['#nav-robux-amount', '.age-bracket-label-username', '#navbar-settings'];
            for (const sel of homeIndicators) {
                if (document.querySelector(sel)) return { state: 'home' };
            }
            
            const errorSelectors = [
                '#login-form-error', '.login-error', '.text-error',
                '[aria-live="polite"] .text-error', '.alert-danger', '.alert-warning'
            ];
            for (const sel of errorSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) {
                    const msg = el.textContent.trim();
                    
                    // Cek Passkey di error message
                    if (msg.includes('only has a passkey') || msg.includes('Your account only has a passkey')) {
                        return { state: 'passkey', message: msg };
                    }
                    
                    return { state: 'error', message: msg };
                }
            }
            
            // Cek overlay 2SV atau Identity Challenge
            const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]') 
                || (document.querySelector('.answer-choice-area') ? document.body : null);
            if (overlay) {
                const title = overlay.querySelector ? overlay.querySelector('.modal-title') : null;
                const titleText = title ? title.textContent.trim() : '';
                
                // Cek popup "Please Confirm Your Identity" (tebak gambar)
                const isIdentityChallenge = titleText.includes('Please Confirm Your Identity') ||
                    document.querySelector('.answer-choice-area') !== null;
                if (isIdentityChallenge) {
                    return { state: 'identity_challenge', title: titleText };
                }
                
                return { state: '2sv', title: titleText };
            }
            
            if (document.querySelector('#login-button') || document.querySelector('#login-username')) {
                return { state: 'login' };
            }
            
            return { state: 'unknown', url: window.location.href, title: document.title };
        });
        return result;
    } catch(e) {
        if (e.message.includes('Execution context was destroyed') || e.message.includes('navigation')) {
            return { state: 'navigating' };
        }
        return { state: 'error', message: e.message };
    }
}

async function waitForStateChange(page, maxWaitMs = 15000) {
    const startTime = Date.now();
    let lastState = null;
    
    while (Date.now() - startTime < maxWaitMs) {
        const state = await checkPageState(page);
        
        if (state.state === 'navigating') {
            if (Date.now() - startTime >= maxWaitMs) {
                return { state: 'timeout', message: 'Navigasi terlalu lama' };
            }
            await wait(randomWait(400, 600));
            continue;
        }
        
        if (!lastState || lastState.state !== state.state) {
            console.log(`  → State: ${state.state}${state.message ? ' - ' + state.message : ''}`);
            lastState = state;
        }
        
        if (state.state !== 'login') return state;
        await wait(randomWait(400, 600));
    }
    
    return { state: 'timeout', message: 'Tidak ada perubahan' };
}

async function isHome(page) {
    const state = await checkPageState(page);
    return state.state === 'home';
}

// ============================================================
// HUMAN-LIKE BEHAVIORS
// ============================================================
async function humanMoveMouse(page) {
    try {
        const startX = randomInt(100, 300);
        const startY = randomInt(100, 300);
        const endX = randomInt(400, 1200);
        const endY = randomInt(200, 600);
        
        const steps = randomInt(20, 40);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cpX = (startX + endX) / 2 + randomInt(-100, 100);
            const cpY = (startY + endY) / 2 + randomInt(-100, 100);
            
            const x = Math.pow(1-t, 2) * startX + 2 * (1-t) * t * cpX + Math.pow(t, 2) * endX;
            const y = Math.pow(1-t, 2) * startY + 2 * (1-t) * t * cpY + Math.pow(t, 2) * endY;
            
            await page.mouse.move(Math.round(x), Math.round(y));
            await wait(randomInt(5, 15));
        }
    } catch(e) {}
}

async function humanScroll(page) {
    try {
        const scrolls = randomInt(1, 3);
        for (let i = 0; i < scrolls; i++) {
            const scrollAmount = randomInt(50, 300);
            await page.evaluate((amount) => {
                window.scrollBy({ top: amount, behavior: 'smooth' });
            }, scrollAmount);
            await wait(randomWait(300, 800));
        }
    } catch(e) {}
}

// ============================================================
// DETEKSI AKUN
// ============================================================
async function detectAccountInfo(page) {
    try {
        await wait(randomWait(800, 1200));
        const userId = await getRobloxUserId(page);
        if (!userId) return { twoSV: '⚠️ Unknown', xbox: '⚠️ Unknown' };
        
        const [twoSVMethods, xboxConnected] = await Promise.all([
            check2SVStatus(page, userId),
            checkXboxConnection(page)
        ]);
        
        const twoSV = format2SVMethods(twoSVMethods);
        const xbox = xboxConnected ? '✅ Connected' : '❌ Not Connected';
        
        console.log(`  📋 2SV: ${twoSV}`);
        console.log(`  🎮 Xbox: ${xbox}`);
        
        return { twoSV, xbox };
    } catch(e) {
        return { twoSV: '⚠️ Error', xbox: '⚠️ Error' };
    }
}

// ============================================================
// MAIN PROCESS
// ============================================================
async function processAccounts(accounts, progressCallback) {
    const results = [];
    
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        let result = { 
            username: account.username, 
            status: 'processing', 
            message: 'Memulai...',
            twoSV: null,
            xbox: null,
            challenge: null
        };
        
        if (progressCallback) progressCallback(i, result);
        results.push(result);
        
        let browser = null;
        
        try {
            browser = await puppeteer.launch({
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--incognito',
                    '--window-position=-2000,0',   // di luar layar
                    '--window-size=800,600',        // kecil
                ]
            });
            
            const page = await browser.newPage();
            
            // === ANTI-DETECTION (FULL) ===
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                
                Object.defineProperty(navigator, 'plugins', { 
                    get: () => {
                        const plugins = [1, 2, 3];
                        plugins.item = () => null;
                        plugins.namedItem = () => null;
                        plugins.refresh = () => {};
                        return plugins;
                    }
                });
                
                Object.defineProperty(navigator, 'mimeTypes', {
                    get: () => {
                        const mime = [1, 2];
                        mime.item = () => null;
                        mime.namedItem = () => null;
                        return mime;
                    }
                });
                
                window.chrome = { 
                    runtime: {},
                    loadTimes: () => {},
                    csi: () => {},
                    app: {}
                };
                
                Object.defineProperty(window.history, 'length', {
                    get: () => 3 + Math.floor(Math.random() * 10)
                });
            });
            
            await page.setViewport({ width: 1366, height: 768 });
            
            console.log(`\n[${account.username}] 🔵 MULAI`);
            
            // === HUMAN-LIKE: random mouse move ===
            await humanMoveMouse(page);
            
            // === BUKA LOGIN PAGE ===
            result.message = 'Buka login...';
            updateResult(results, account.username, result);
            
            await page.goto('https://www.roblox.com/login', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            await wait(randomWait(800, 1500));
            
            await humanScroll(page);
            await humanMoveMouse(page);
            
            // === ISI FORM ===
            result.message = 'Isi form...';
            updateResult(results, account.username, result);
            
            await page.waitForSelector('#login-username', { timeout: 10000 });
            await page.click('#login-username', { clickCount: 3 });
            await page.type('#login-username', account.username, { delay: randomDelay() });
            
            // Random idle (simulasi mikir)
            if (Math.random() < 0.3) {
                await wait(randomWait(1000, 3000));
            }
            await wait(randomWait(150, 350));
            
            await humanMoveMouse(page);
            
            await page.waitForSelector('#login-password', { timeout: 10000 });
            await page.click('#login-password', { clickCount: 3 });
            await page.type('#login-password', account.password, { delay: randomDelay() });
            await wait(randomWait(200, 500));
            
            await humanMoveMouse(page);
            
            // === KLIK LOGIN ===
            result.message = 'Login...';
            updateResult(results, account.username, result);
            
            await page.click('#login-button');
            console.log(`[${account.username}] Login diklik...`);
            
            // === TUNGGU ===
            result.message = 'Menunggu respon...';
            updateResult(results, account.username, result);
            
            const state = await waitForStateChange(page, 15000);
            console.log(`[${account.username}] State akhir: ${state.state}`);
            
            // === HANDLE STATE ===
            if (state.state === 'home') {
                result.status = 'success';
                console.log(`[${account.username}] ✅ HOME`);
                
                result.message = '🔍 Deteksi 2SV & Xbox...';
                updateResult(results, account.username, result);
                
                const info = await detectAccountInfo(page);
                result.twoSV = info.twoSV;
                result.xbox = info.xbox;
                result.message = 'Sukses! (no code)';
                
            } else if (state.state === 'error') {
                result.status = 'skip';
                result.message = `⚠️ ${state.message}`;
                console.log(`[${account.username}] ⚠️ ${state.message}`);
                
            } else if (state.state === 'identity_challenge') {
                console.log(`[${account.username}] 🖼️ Identity Challenge (Tebak Gambar) terdeteksi - skip`);
                result.status = 'skip';
                result.message = '⚠️ Tebak Gambar';
                result.challenge = 'guess_image';
                
            } else if (state.state === 'passkey') {
                console.log(`[${account.username}] 🔑 Passkey only - skip`);
                result.status = 'skip';
                result.message = '🔑 Passkey';
                result.challenge = 'passkey';
                
            } else if (state.state === '2sv') {
                console.log(`[${account.username}] 🔐 2SV terdeteksi!`);
                result.message = 'Memproses 2SV...';
                updateResult(results, account.username, result);
                
                const twoSVResult = await handle2SV(page, account.backupCodes, account.username);
                result.status = twoSVResult.status;
                result.message = twoSVResult.message;
                result.twoSV = twoSVResult.twoSV || null;
                result.xbox = twoSVResult.xbox || null;
                
            } else {
                await wait(5000);
                const finalState = await checkPageState(page);
                
                if (finalState.state === 'home') {
                    result.status = 'success';
                    const info = await detectAccountInfo(page);
                    result.twoSV = info.twoSV;
                    result.xbox = info.xbox;
                    result.message = 'Sukses! (no code)';
                } else if (finalState.state === 'identity_challenge') {
                    console.log(`[${account.username}] 🖼️ Identity Challenge (Tebak Gambar) terdeteksi - skip`);
                    result.status = 'skip';
                    result.message = '⚠️ Tebak Gambar';
                    result.challenge = 'guess_image';
                } else if (finalState.state === 'passkey') {
                    console.log(`[${account.username}] 🔑 Passkey only - skip`);
                    result.status = 'skip';
                    result.message = '🔑 Passkey';
                    result.challenge = 'passkey';
                } else {
                    result.status = 'failed';
                    result.message = `❌ ${finalState.message || 'Timeout'}`;
                }
            }
            
        } catch (error) {
            result.status = 'failed';
            result.message = `❌ ${error.message}`;
        }
        
        // === CLEANUP ===
        if (browser) {
            try { await browser.close(); } catch(e) {}
        }
        
        updateResult(results, account.username, result);
        console.log(`[${i+1}/${accounts.length}] ${account.username} → ${result.status}\n`);
        
        // === RANDOM DELAY ANTAR AKUN ===
        if (i < accounts.length - 1) {
            const delay = randomInt(2000, 5000);
            console.log(`  ⏳ Jeda ${(delay/1000).toFixed(1)}s...`);
            await wait(delay);
        }
    }
    
    console.log('\n=== HASIL AKHIR ===');
    console.table(results.map(r => ({
        Username: r.username,
        Status: r.status,
        '2SV': r.twoSV || '-',
        Xbox: r.xbox || '-',
        Message: r.message
    })));
    
    return results;
}

// ============================================================
// HELPERS
// ============================================================
function updateResult(results, username, newResult) {
    const idx = results.findIndex(r => r.username === username);
    if (idx >= 0) results[idx] = { ...results[idx], ...newResult };
}

// ============================================================
// HANDLE 2SV
// ============================================================
async function handle2SV(page, backupCodes, username) {
    try {
        console.log(`  [${username}] === 2SV ===`);
    

// =====================================================
// STEP 1: Klik "Use another verification method"
// =====================================================
let clicked = false;

for (let attempt = 0; attempt < 5; attempt++) {
    try {
        await wait(1000 + (attempt * 500));
        
        const result = await page.evaluate(() => {
            const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
            if (!overlay) return 'no-overlay';
            
            const allElements = overlay.querySelectorAll('button, a, .modal-body-button-link, .small, p button');
            for (const el of allElements) {
                const text = (el.textContent || '').trim();
                if (text === 'Use another verification method' ||
                    text === 'Gunakan metode verifikasi lainnya') {
                    
                    // COBA 3 CARA BERBEDA
                    el.click();
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    el.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true }));
                    
                    // Focus dulu
                    el.focus();
                    
                    // Click dengan koordinat
                    const rect = el.getBoundingClientRect();
                    const x = rect.x + rect.width / 2;
                    const y = rect.y + rect.height / 2;
                    document.elementFromPoint(x, y)?.click();
                    
                    return 'clicked';
                }
            }
            return 'not-found';
        });
        
                if (result === 'clicked') {
            await wait(1000);
            const checkOverlay = await page.evaluate(() => {
                const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
                if (!overlay) return 'gone';
                const hasBackupCode = overlay.textContent.includes('Backup Code') || 
                                     overlay.textContent.includes('Email');
                return hasBackupCode ? 'changed' : 'same';
            });
            
            if (checkOverlay === 'changed') {
                clicked = true;
                break;
            }
        }
    } catch(e) {}
    await wait(1500);
}

if (!clicked) {
    if (await isHome(page)) {
        const info = await detectAccountInfo(page);
        return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
    }
    return { status: 'failed', message: '❌ STEP 1 gagal' };
}

console.log(`  [${username}] STEP 1 ✅`);
await wait(2000);

try {
    await page.waitForSelector('.foundation-web-dialog-overlay[data-state="open"]', { timeout: 8000 });
} catch(e) {
    if (await isHome(page)) {
        const info = await detectAccountInfo(page);
        return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
    }
}
await wait(1000);

// =====================================================
// STEP 2: Klik "Backup Code" di overlay baru
// =====================================================
let backupClicked = false;

for (let attempt = 0; attempt < 5; attempt++) {
    try {
        await wait(500);
        
        const result = await page.evaluate(() => {
            const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
            if (!overlay) return 'no-overlay';
            
            // Cari SEMUA element yang text-nya "Backup Code"
            const allElements = overlay.querySelectorAll('*');
            for (const el of allElements) {
                if (el.children.length === 0 && el.textContent.trim() === 'Backup Code') {
                    let clickable = el.closest('button') || el.closest('li');
                    if (clickable) {
                        clickable.click();
                        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        clickable.dispatchEvent(new Event('mousedown', { bubbles: true }));
                        clickable.dispatchEvent(new Event('mouseup', { bubbles: true }));
                        return 'clicked-leaf';
                    }
                }
                if (el.tagName === 'BUTTON' && el.textContent.includes('Backup Code')) {
                    el.click();
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return 'clicked-button';
                }
            }
            
            // Fallback: cari li yang mengandung Backup Code
            const lis = overlay.querySelectorAll('li');
            for (const li of lis) {
                if (li.textContent.includes('Backup Code')) {
                    const btn = li.querySelector('button');
                    if (btn) {
                        btn.click();
                        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        return 'clicked-li';
                    }
                    li.click();
                    return 'clicked-li-fallback';
                }
            }
            
            return 'not-found';
        });
        
        console.log(`  [${username}] STEP 2 attempt ${attempt+1}: ${result}`);
        
        if (result && result.startsWith('clicked')) {
            backupClicked = true;
            break;
        }
    } catch(e) {
        console.log(`  [${username}] STEP 2 error: ${e.message}`);
    }
    await wait(1500);
}

if (!backupClicked) {
    return { status: 'failed', message: '❌ STEP 2 gagal' };
}

console.log(`  [${username}] STEP 2 ✅`);

// =====================================================
// TUNGGU INPUT BACKUP CODE MUNCUL
// =====================================================
await wait(2000);

// STEP 3: Input kode (MULAI DARI SINI TETEP KAYA SEBELUMNYA)
        
        // STEP 3: Input kode
        try {
            await page.waitForSelector('#two-step-verification-code-input', { timeout: 8000 });
        } catch(e) {
            if (await isHome(page)) {
                const info = await detectAccountInfo(page);
                return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
            }
            return { status: 'failed', message: '❌ Input tidak muncul' };
        }
        
        const validCodes = (backupCodes || []).filter(c => c.trim().length >= 8);
        console.log(`  [${username}] STEP 3: ${validCodes.length} kode`);
        
        for (let i = 0; i < validCodes.length; i++) {
            console.log(`  [${username}] #${i+1}: ${validCodes[i].trim()}`);
            
            await page.click('#two-step-verification-code-input', { clickCount: 3 });
            await page.type('#two-step-verification-code-input', validCodes[i].trim(), { delay: 80 });
            await wait(400);
            
            await page.evaluate(() => {
                const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
                if (!overlay) return;
                const btn = overlay.querySelector('.modal-modern-footer-button[aria-label="Verify"]');
                if (btn && !btn.disabled) btn.click();
            });
            
            await wait(4000);
            
            if (await isHome(page)) {
                const info = await detectAccountInfo(page);
                return { 
                    status: 'success', 
                    message: `Sukses! (kode #${i+1})`,
                    twoSV: info.twoSV,
                    xbox: info.xbox
                };
            }
        }
        
        if (await isHome(page)) {
            const info = await detectAccountInfo(page);
            return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
        }
        
        return { status: 'failed', message: `❌ Semua ${validCodes.length} kode invalid` };
        
    } catch (e) {
        if (await isHome(page)) {
            const info = await detectAccountInfo(page);
            return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
        }
        return { status: 'failed', message: `❌ ${e.message}` };
    }
}

module.exports = { processAccounts };