// ============================================================
// notifier.js — Discord webhook alerting buat SwannHub
// ============================================================
// Pola sama kayak notify_discord() di Sheet Worker (Python):
// heartbeat, error alert, batch summary. Ditulis sebagai modul
// terpisah biar gampang dipasang di server.js maupun login-worker.js
// tanpa bikin dua-duanya saling import berlebihan.
//
// SETUP: isi DISCORD_WEBHOOK_URL di bawah, atau lewat env var
// SWANNHUB_DISCORD_WEBHOOK biar credential gak ke-hardcode di kode
// (lebih aman buat di-commit ke git).
// ============================================================

const DISCORD_WEBHOOK_URL = process.env.SWANNHUB_DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1525053475136733226/xORTvd7LlOcPk9Do4rFxMTX5fO54oUuHi6tE7gSaNIgjZA3zyOB615_ZYDoOy0MsKtAn';

async function notifyDiscord(message) {
    if (!DISCORD_WEBHOOK_URL) return;
    try {
        const content = message.length <= 1900 ? message : message.slice(0, 1900) + '... (dipotong)';
        const res = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (!res.ok) {
            console.warn(`[notifier] Discord webhook return status ${res.status}`);
        }
    } catch (e) {
        console.warn(`[notifier] Gagal kirim notif Discord: ${e.message}`);
    }
}

// --- Helper spesifik biar pesannya konsisten formatnya ---

function notifyBatchStart(total) {
    return notifyDiscord(`▶️ SwannHub: mulai proses ${total} akun.`);
}

function notifyBatchDone(results) {
    const success = results.filter(r => r.status === 'success').length;
    const skip = results.filter(r => r.status === 'skip').length;
    const failed = results.filter(r => r.status === 'failed').length;

    // "Unexplained" failure = status failed DAN expectedFailure bukan true.
    // Kasus kayak "Invalid Backup" (kode abis/salah) itu expectedFailure:true
    // -- itu soal data akun, BUKAN indikasi Roblox ubah selector/flow, jadi
    // gak boleh ikut nge-trigger warning "kemungkinan Roblox berubah".
    const unexplainedFailed = results.filter(r => r.status === 'failed' && !r.expectedFailure);

    let msg = `✅ SwannHub: batch selesai.\n` +
        `Total: ${results.length} | Sukses: ${success} | Skip: ${skip} | Gagal: ${failed}`;

    // Tampilin breakdown alasan gagal/skip biar langsung jelas tanpa buka log
    const reasonCounts = {};
    for (const r of results) {
        if (r.status === 'skip' || r.status === 'failed') {
            reasonCounts[r.message] = (reasonCounts[r.message] || 0) + 1;
        }
    }
    const reasonLines = Object.entries(reasonCounts).map(([msg2, count]) => `  - ${msg2}: ${count}x`);
    if (reasonLines.length > 0) {
        msg += '\n' + reasonLines.join('\n');
    }

    // Warning "kemungkinan Roblox berubah" CUMA dipicu oleh failure yang
    // gak explained (bukan Invalid Backup / passkey / tebak gambar / dll
    // yang emang udah ada handle-nya masing-masing).
    const unexplainedRate = results.length > 0 ? (unexplainedFailed.length / results.length) : 0;
    if (unexplainedRate >= 0.5) {
        msg += `\n⚠️ ${unexplainedFailed.length}/${results.length} gagal dengan alasan di luar kasus yang udah di-handle -- kemungkinan ada perubahan di sisi Roblox (selector/flow beda), bukan cuma akun individual yang salah.`;
    }

    return notifyDiscord(msg);
}

function notifyCrash(context, error) {
    return notifyDiscord(`🔴 SwannHub CRASH (${context}):\n${error && error.stack ? error.stack.slice(0, 1500) : String(error)}`);
}

function notifyServerStart(port) {
    return notifyDiscord(`✅ SwannHub server START — listening di port ${port}.`);
}

function notifyHeartbeat(uptimeSec) {
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    return notifyDiscord(`💓 SwannHub masih hidup. Uptime: ${hours}j ${mins}m.`);
}

module.exports = {
    notifyDiscord,
    notifyBatchStart,
    notifyBatchDone,
    notifyCrash,
    notifyServerStart,
    notifyHeartbeat,
};