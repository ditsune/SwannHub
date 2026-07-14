const express = require('express');
const path = require('path');
const fs = require('fs');
const { processAccounts } = require('./login-worker');
const notifier = require('./notifier');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const RESULTS_LOG_FILE = path.join(__dirname, 'results.log');
const RESULTS_LOG_DIR = __dirname;
const LOG_RETENTION_DAYS = 14;
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 jam, sama kayak Sheet Worker Python

// Kalau di-set (lewat env var), semua request ke /api/* WAJIB kirim
// header x-api-key yang cocok. Kalau env var ini KOSONG, endpoint
// tetap terbuka tanpa auth (backward compatible buat lo yang cuma
// akses dari localhost sendiri) -- tapi kalau server ini pernah
// diakses dari luar PC sendiri, WAJIB di-set.
const API_KEY = process.env.SWANNHUB_API_KEY || '';

function requireApiKey(req, res, next) {
    if (!API_KEY) return next(); // auth gak di-enforce kalau API key gak di-set
    const provided = req.header('x-api-key');
    if (provided !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: x-api-key salah/hilang' });
    }
    next();
}

// ============================================================
// CRASH HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err);
    appendResultLog(`[FATAL] uncaughtException: ${err.stack || err.message}`);
    notifier.notifyCrash('uncaughtException', err).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason);
    appendResultLog(`[FATAL] unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`);
    notifier.notifyCrash('unhandledRejection', reason);
});

// ============================================================
// FILE LOGGING + ROTASI HARIAN
// ============================================================
// (fix) Sebelumnya results.log numpuk terus tanpa batas. Sekarang:
// tiap append, dicek dulu apakah tanggal hari ini beda dari tanggal
// file log terakhir kali ditulis -- kalau beda, file lama di-rename
// jadi "results-YYYY-MM-DD.log" dan file baru dimulai kosong. File
// yang lebih tua dari LOG_RETENTION_DAYS otomatis dihapus.
let lastRotateCheckDate = null;

function todayStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function rotateLogIfNeeded() {
    const today = todayStr();
    if (lastRotateCheckDate === today) return; // udah dicek hari ini, skip biar murah
    lastRotateCheckDate = today;

    try {
        if (!fs.existsSync(RESULTS_LOG_FILE)) return;

        const stat = fs.statSync(RESULTS_LOG_FILE);
        const fileDate = stat.mtime.toISOString().slice(0, 10);

        if (fileDate !== today) {
            const rotatedName = path.join(RESULTS_LOG_DIR, `results-${fileDate}.log`);
            if (!fs.existsSync(rotatedName)) {
                fs.renameSync(RESULTS_LOG_FILE, rotatedName);
            }
        }

        cleanupOldLogs();
    } catch (e) {
        console.warn('Gagal rotasi results.log:', e.message);
    }
}

function cleanupOldLogs() {
    try {
        const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(RESULTS_LOG_DIR).filter(f => /^results-\d{4}-\d{2}-\d{2}\.log$/.test(f));
        for (const f of files) {
            const full = path.join(RESULTS_LOG_DIR, f);
            const stat = fs.statSync(full);
            if (stat.mtimeMs < cutoff) {
                fs.unlinkSync(full);
                console.log(`[log-rotation] Hapus log lama: ${f}`);
            }
        }
    } catch (e) {
        console.warn('Gagal cleanup log lama:', e.message);
    }
}

function appendResultLog(line) {
    try {
        rotateLogIfNeeded();
        const ts = new Date().toISOString();
        fs.appendFileSync(RESULTS_LOG_FILE, `[${ts}] ${line}\n`);
    } catch (e) {
        console.warn('Gagal nulis results.log:', e.message);
    }
}

// Store results dan status
let processingStatus = {
    isProcessing: false,
    accounts: [],
    results: [],
    currentIndex: -1,
    total: 0
};

app.post('/api/process-accounts', requireApiKey, async (req, res) => {
    const { accounts } = req.body;

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({ error: 'No accounts data provided' });
    }

    if (processingStatus.isProcessing) {
        return res.status(400).json({ error: 'Already processing accounts' });
    }

    processingStatus = {
        isProcessing: true,
        accounts: accounts,
        results: [],
        currentIndex: 0,
        total: accounts.length
    };

    res.json({
        message: 'Processing started',
        totalAccounts: accounts.length
    });

    appendResultLog(`Batch mulai: ${accounts.length} akun.`);
    notifier.notifyBatchStart(accounts.length);

    try {
        const results = await processAccounts(accounts, (index, result) => {
            // (fix) Sebelumnya selalu di-append -> begitu login-worker kirim
            // placeholder "processing" lalu nyusul hasil final buat akun yang
            // sama, keduanya numpuk jadi 2 entry berbeda di array. Sekarang
            // di-replace berdasarkan index-nya, jadi 1 akun = 1 slot yang
            // ke-update statusnya (processing -> success/failed/skip).
            const newResults = [...processingStatus.results];
            newResults[index] = result;
            processingStatus.results = newResults;

            // currentIndex dipakai buat progress bar ("X/total selesai") --
            // cuma maju kalau ini hasil FINAL, bukan placeholder processing,
            // biar progress bar gak keburu jalan padahal akunnya belum kelar.
            if (result.status !== 'processing') {
                processingStatus.currentIndex = index + 1;
            }
        });

        processingStatus.results = results;
        processingStatus.isProcessing = false;

        const success = results.filter(r => r.status === 'success').length;
        const skip = results.filter(r => r.status === 'skip').length;
        const failed = results.filter(r => r.status === 'failed').length;
        appendResultLog(`Batch selesai: total=${results.length} sukses=${success} skip=${skip} gagal=${failed}`);
        notifier.notifyBatchDone(results);

    } catch (error) {
        console.error('Processing error:', error);
        processingStatus.isProcessing = false;
        appendResultLog(`Batch error: ${error.stack || error.message}`);
        notifier.notifyCrash('processAccounts batch', error);
    }
});

app.get('/api/status', requireApiKey, (req, res) => {
    res.json(processingStatus);
});

app.post('/api/reset', requireApiKey, (req, res) => {
    processingStatus = {
        isProcessing: false,
        accounts: [],
        results: [],
        currentIndex: -1,
        total: 0
    };
    res.json({ message: 'Status reset' });
});

// Health-check TIDAK di-gate API key -- ini buat monitoring eksternal
// (uptime checker) yang perlu ping tanpa kredensial, cuma nunjukin
// server hidup atau nggak, gak ada data sensitif di response-nya.
app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime_sec: process.uptime(), isProcessing: processingStatus.isProcessing });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    if (!API_KEY) {
        console.warn('[warning] SWANNHUB_API_KEY belum di-set -- endpoint /api/* TERBUKA TANPA AUTH. Aman kalau cuma diakses dari localhost sendiri, tapi WAJIB di-set kalau server ini bisa diakses dari luar.');
    }
    appendResultLog(`Server start di port ${PORT}.`);
    notifier.notifyServerStart(PORT);
});

// Heartbeat berkala biar ketauan kalau server crash/mati tanpa
// nunggu ada yang coba pakai duluan (sama pola kayak heartbeat 1 jam
// di Sheet Worker Python).
setInterval(() => {
    notifier.notifyHeartbeat(process.uptime());
}, HEARTBEAT_INTERVAL_MS);

// Graceful shutdown -- biar kalau di-stop manual (CTRL+C), ada jejak
// jelas di log & Discord bahwa ini SENGAJA dimatikan, bukan crash.
process.on('SIGINT', () => {
    console.log('Dihentikan manual (CTRL+C).');
    appendResultLog('Server dihentikan manual (SIGINT).');
    notifier.notifyDiscord('🛑 SwannHub server dihentikan manual.').finally(() => process.exit(0));
});