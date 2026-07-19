const puppeteer = require('puppeteer');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Berapa kali retry per-akun kalau hasilnya "unexplained failure" (bukan
// invalid backup / passkey / tebak gambar / error kredensial -- itu semua
// final, gak ada gunanya diulang). Cuma retry buat error yang KEMUNGKINAN
// transient: network blip, timeout goto, browser crash, dll.
const MAX_ACCOUNT_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 3000;

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

// Viewport & window size di-random dalam rentang wajar tiap sesi, biar
// gak jadi fingerprint identik di semua login (sebelumnya selalu persis
// 1366x768 / window 800x600 di semua sesi -- itu sinyal bot yang gampang
// dideteksi karena user asli viewport-nya variatif).
function randomViewport() {
    return {
        width: randomInt(1280, 1440),
        height: randomInt(720, 900)
    };
}

function randomWindowSize() {
    return {
        width: randomInt(760, 900),
        height: randomInt(560, 680)
    };
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
    } catch (e) {
        console.warn(`  [getRobloxUserId] gagal: ${e.message}`);
        return null;
    }
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
    } catch (e) {
        console.warn(`  [check2SVStatus] gagal: ${e.message}`);
        return [];
    }
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
    } catch (e) {
        console.warn(`  [checkXboxConnection] gagal: ${e.message}`);
        return false;
    }
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

            // DETEKSI FUNCAPTCHA / ARKOSELABS (verifikasi bot)
            const captchaFrame = document.querySelector('iframe[src*="arkoselabs.roblox.com"]');
            if (captchaFrame) {
                return { state: 'captcha', message: 'Verifikasi bot terdeteksi' };
            }

            const errorSelectors = [
                '#login-form-error', '.login-error', '.text-error',
                '[aria-live="polite"] .text-error', '.alert-danger', '.alert-warning'
            ];
            for (const sel of errorSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) {
                    const msg = el.textContent.trim();

                    if (msg.includes('only has a passkey') || msg.includes('Your account only has a passkey')) {
                        return { state: 'passkey', message: msg };
                    }

                    return { state: 'error', message: msg };
                }
            }

            const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]')
                || (document.querySelector('.answer-choice-area') ? document.body : null);
            if (overlay) {
                const title = overlay.querySelector ? overlay.querySelector('.modal-title') : null;
                const titleText = title ? title.textContent.trim() : '';

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
    } catch (e) {
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

            const x = Math.pow(1 - t, 2) * startX + 2 * (1 - t) * t * cpX + Math.pow(t, 2) * endX;
            const y = Math.pow(1 - t, 2) * startY + 2 * (1 - t) * t * cpY + Math.pow(t, 2) * endY;

            await page.mouse.move(Math.round(x), Math.round(y));
            await wait(randomInt(5, 15));
        }
    } catch (e) {
        console.warn(`  [humanMoveMouse] gagal (non-fatal, lanjut): ${e.message}`);
    }
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
    } catch (e) {
        console.warn(`  [humanScroll] gagal (non-fatal, lanjut): ${e.message}`);
    }
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
    } catch (e) {
        console.warn(`  [detectAccountInfo] gagal: ${e.message}`);
        return { twoSV: '⚠️ Error', xbox: '⚠️ Error' };
    }
}

// ============================================================
// SATU KALI PERCOBAAN LOGIN (dipanggil dari retry wrapper di bawah)
// ============================================================
async function attemptLogin(account) {
    let result = {
        username: account.username,
        status: 'processing',
        message: 'Memulai...',
        twoSV: null,
        xbox: null,
        challenge: null,
        expectedFailure: false
    };

    let browser = null;

    try {
        const winSize = randomWindowSize();
        const viewport = randomViewport();

        browser = await puppeteer.launch({
            headless: false,
            executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            args: [
                '--no-sandbox',
                '--incognito',
                '--window-position=-2000,0',
                '--window-size=800,600',
            ]
        });

        const page = await browser.newPage(); // JANGAN pake createIncognitoBrowserContext()

        await page.setViewport({ width: 1366, height: 768 }); // Fixed viewport

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

        await page.setViewport(viewport);

        console.log(`\n[${account.username}] 🔵 MULAI`);

        await humanMoveMouse(page);

        result.message = 'Buka login...';

        await page.goto('https://www.roblox.com/login', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await wait(randomWait(800, 1500));

        await humanScroll(page);
        await humanMoveMouse(page);

        result.message = 'Isi form...';

        await page.waitForSelector('#login-username', { timeout: 10000 });
        await page.click('#login-username', { clickCount: 3 });
        await page.type('#login-username', account.username, { delay: randomDelay() });

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

        result.message = 'Login...';

        await page.click('#login-button');
        console.log(`[${account.username}] Login diklik...`);

        result.message = 'Menunggu respon...';

        const state = await waitForStateChange(page, 15000);
        console.log(`[${account.username}] State akhir: ${state.state}`);

        if (state.state === 'home') {
            result.status = 'success';
            console.log(`[${account.username}] ✅ HOME`);

            const info = await detectAccountInfo(page);
            result.twoSV = info.twoSV;
            result.xbox = info.xbox;
            result.message = 'Sukses! (no code)';

        } else if (state.state === 'error') {
            result.status = 'skip';
            result.message = `⚠️ ${state.message}`;
            result.expectedFailure = true;
            console.log(`[${account.username}] ⚠️ ${state.message}`);

        } else if (state.state === 'identity_challenge') {
            console.log(`[${account.username}] 🖼️ Identity Challenge (Tebak Gambar) terdeteksi - skip`);
            result.status = 'skip';
            result.message = '⚠️ Tebak Gambar';
            result.challenge = 'guess_image';
            result.expectedFailure = true;

        } else if (state.state === 'captcha') {
            console.log(`[${account.username}] 🤖 CAPTCHA terdeteksi - retry`);
            result.status = 'failed';
            result.message = '🤖 Verifikasi Bot';
            result.challenge = 'captcha';
            // expectedFailure = false → bakal di-retry

        } else if (state.state === 'passkey') {
            console.log(`[${account.username}] 🔑 Passkey only - skip`);
            result.status = 'skip';
            result.message = '🔑 Passkey';
            result.challenge = 'passkey';
            result.expectedFailure = true;

        } else if (state.state === '2sv') {
            console.log(`[${account.username}] 🔐 2SV terdeteksi!`);

            const twoSVResult = await handle2SV(page, account.backupCodes, account.username);
            result.status = twoSVResult.status;
            result.message = twoSVResult.message;
            result.twoSV = twoSVResult.twoSV || null;
            result.xbox = twoSVResult.xbox || null;
            result.expectedFailure = twoSVResult.expectedFailure || false;

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
                result.expectedFailure = true;
            } else if (finalState.state === 'passkey') {
                console.log(`[${account.username}] 🔑 Passkey only - skip`);
                result.status = 'skip';
                result.message = '🔑 Passkey';
                result.challenge = 'passkey';
                result.expectedFailure = true;
            } else {
                result.status = 'failed';
                result.message = `❌ ${finalState.message || 'Timeout'}`;
            }
        }

    } catch (error) {
        result.status = 'failed';
        result.message = `❌ ${error.message}`;
    }

    if (browser) {
        try {
            await browser.close();
        } catch (e) {
            console.warn(`[${account.username}] Gagal nutup browser: ${e.message}`);
        }
    }

    return result;
}

// ============================================================
// MAIN PROCESS (dengan retry per-akun buat unexplained failure)
// ============================================================
async function processAccounts(accounts, progressCallback) {
    const results = [];

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        let result = null;

        // (fix) Kirim placeholder status "processing" begitu akun ini mulai
        // dikerjakan, SEBELUM attemptLogin jalan. Sebelumnya callback cuma
        // dipanggil setelah akun selesai, jadi card "sedang diproses" di UI
        // gak pernah muncul -- cuma langsung loncat dari "belum ada" ke
        // "sukses/gagal".
        if (progressCallback) {
            progressCallback(i, { username: account.username, status: 'processing', message: '⏳ Sedang diproses...' });
        }

        for (let attempt = 1; attempt <= MAX_ACCOUNT_ATTEMPTS; attempt++) {
            if (attempt > 1) {
                console.log(`[${account.username}] 🔁 Retry attempt ${attempt}/${MAX_ACCOUNT_ATTEMPTS} (percobaan sebelumnya gagal dengan alasan yang gak dikenal)...`);
                await wait(RETRY_BACKOFF_MS * (attempt - 1));
            }

            result = await attemptLogin(account);

            // Berhenti retry kalau: sukses, skip (kasus yang udah
            // di-handle: error kredensial, passkey, tebak gambar), atau
            // failed TAPI expectedFailure (misal semua backup code
            // invalid -- ngulang gak akan ngubah apa-apa karena datanya
            // emang gitu). Cuma failed & UNEXPECTED yang di-retry, karena
            // itu kemungkinan besar network blip / timeout sesaat.
            const isUnexplainedFailure = result.status === 'failed' && !result.expectedFailure;
            if (!isUnexplainedFailure) break;
        }

        if (progressCallback) progressCallback(i, result);
        results.push(result);

        console.log(`[${i + 1}/${accounts.length}] ${account.username} → ${result.status}\n`);

        if (i < accounts.length - 1) {
            const delay = randomInt(2000, 5000); // 2-5 detik
            console.log(`  ⏳ Jeda ${(delay / 1000).toFixed(1)}s...`);
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

                const clickResult = await page.evaluate(() => {
                    const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
                    if (!overlay) return 'no-overlay';

                    const allElements = overlay.querySelectorAll('button, a, .modal-body-button-link, .small, p button');
                    for (const el of allElements) {
                        const text = (el.textContent || '').trim();
                        if (text === 'Use another verification method' ||
                            text === 'Gunakan metode verifikasi lainnya') {

                            el.click();
                            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                            el.dispatchEvent(new PointerEvent('click', { bubbles: true, cancelable: true }));

                            el.focus();

                            const rect = el.getBoundingClientRect();
                            const x = rect.x + rect.width / 2;
                            const y = rect.y + rect.height / 2;
                            document.elementFromPoint(x, y)?.click();

                            return 'clicked';
                        }
                    }
                    return 'not-found';
                });

                if (clickResult === 'clicked') {
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
            } catch (e) {
                console.warn(`  [${username}] STEP 1 attempt ${attempt + 1} error: ${e.message}`);
            }
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
        } catch (e) {
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

                const clickResult = await page.evaluate(() => {
                    const overlay = document.querySelector('.foundation-web-dialog-overlay[data-state="open"]');
                    if (!overlay) return 'no-overlay';

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

                console.log(`  [${username}] STEP 2 attempt ${attempt + 1}: ${clickResult}`);

                if (clickResult && clickResult.startsWith('clicked')) {
                    backupClicked = true;
                    break;
                }
            } catch (e) {
                console.warn(`  [${username}] STEP 2 error: ${e.message}`);
            }
            await wait(1500);
        }

        if (!backupClicked) {
            return { status: 'failed', message: '❌ STEP 2 gagal' };
        }

        console.log(`  [${username}] STEP 2 ✅`);

        // =====================================================
        // STEP 3: Input kode backup satu-satu sampai berhasil/habis
        // =====================================================
        await wait(2000);

        try {
            await page.waitForSelector('#two-step-verification-code-input', { timeout: 8000 });
        } catch (e) {
            if (await isHome(page)) {
                const info = await detectAccountInfo(page);
                return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
            }
            return { status: 'failed', message: '❌ Input tidak muncul' };
        }

        const validCodes = (backupCodes || []).filter(c => c.trim().length >= 8);
        console.log(`  [${username}] STEP 3: ${validCodes.length} kode`);

        for (let i = 0; i < validCodes.length; i++) {
            const code = validCodes[i].trim();
            console.log(`  [${username}] #${i + 1}: ${code.slice(0, 2)}${'*'.repeat(Math.max(code.length - 2, 0))} (masked)`);

            await page.click('#two-step-verification-code-input', { clickCount: 3 });
            await page.type('#two-step-verification-code-input', code, { delay: 80 });
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
                    message: `Sukses! (kode #${i + 1})`,
                    twoSV: info.twoSV,
                    xbox: info.xbox
                };
            }
        }

        if (await isHome(page)) {
            const info = await detectAccountInfo(page);
            return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
        }

        return { status: 'failed', message: '❌ Invalid Backup', expectedFailure: true };

    } catch (e) {
        if (await isHome(page)) {
            const info = await detectAccountInfo(page);
            return { status: 'success', message: '✅ Login sukses!', twoSV: info.twoSV, xbox: info.xbox };
        }
        return { status: 'failed', message: `❌ ${e.message}` };
    }
}

module.exports = { processAccounts };