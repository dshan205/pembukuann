"use strict";
/* =========================================================
   Login + sinkron cloud (Supabase REST). Aktif bila config.js terisi.
   Satu baris 'main' berisi seluruh data. Penulisan memakai pengecekan
   updated_at, jadi jika orang lain sudah mengubah data, penulisan ditolak
   dan data terbaru dimuat (tidak saling menimpa diam-diam).
========================================================= */
const CLOUD = window.DSHAN_CLOUD || {};
const cloudOn = Boolean(CLOUD.url && CLOUD.key);
const localSave = save;
let session = JSON.parse(localStorage.getItem("dshan_session") || "null");
let base = null, pushTimer = null, busy = false;

const snapshot = () => ({ products, transactions, opname, orders, bookkeeping: bk });
const keepSession = s => { session = s; s ? localStorage.setItem("dshan_session", JSON.stringify(s)) : localStorage.removeItem("dshan_session"); };

async function api(path, opt = {}, retry = true) {
    const r = await fetch(`${CLOUD.url}/${path}`, {
        ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined,
        headers: { apikey: CLOUD.key, Authorization: `Bearer ${session?.access_token || CLOUD.key}`, "Content-Type": "application/json", ...opt.headers }
    });
    if (r.status === 401 && session && retry && !path.startsWith("auth/")) { await refresh(); return api(path, opt, false); }
    if (!r.ok) throw new Error(r.status === 401 ? "Sesi berakhir" : await r.text());
    return r.json();
}
async function refresh() {
    const token = session.refresh_token;
    keepSession(null);
    try { keepSession(await api("auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: token } }, false)); }
    catch { showLogin(); throw new Error("Sesi berakhir"); }
}

/* ---------- Login ---------- */
function showLogin() { $("loginModal").dataset.lock = "1"; openModal("loginModal"); }
async function login(event) {
    event.preventDefault();
    try {
        keepSession(await api("auth/v1/token?grant_type=password", { method: "POST", body: { email: $("loginEmail").value.trim(), password: $("loginPassword").value } }));
        closeModal("loginModal");
        await cloudPull(true);
        showToast("Berhasil masuk.");
    } catch { showToast("Email atau password salah.", "error"); }
}
function logout() { keepSession(null); showLogin(); }

/* ---------- Sinkron ---------- */
async function cloudPull(force = false) {
    if ((busy || pushTimer) && !force) return;
    const row = (await api("rest/v1/dshan_state?id=eq.main&select=data,updated_at"))[0];
    if (!row || (row.updated_at === base && !force)) return;
    base = row.updated_at;
    const d = row.data || {};
    if (!Array.isArray(d.products)) { if (products.length) await cloudPush(); return; } // cloud masih kosong: unggah data lokal
    products = d.products; transactions = d.transactions || []; opname = d.opname || []; orders = d.orders || []; bk = d.bookkeeping || bk;
    normalize(); localSave(); refreshAll();
}
async function cloudPush() {
    if (!base) { await cloudPull(true); return; } // belum pernah tarik data: tarik dulu
    busy = true;
    try {
        const rows = await api(`rest/v1/dshan_state?id=eq.main&updated_at=eq.${encodeURIComponent(base)}`,
            { method: "PATCH", headers: { Prefer: "return=representation" }, body: { data: snapshot(), updated_at: new Date().toISOString() } });
        if (rows.length) base = rows[0].updated_at;
        else { await cloudPull(true); showToast("Data sudah diubah pengguna lain. Data terbaru dimuat, ulangi aksi Anda.", "error"); }
    } catch (e) { showToast("Gagal sinkron ke cloud: " + e.message, "error"); }
    busy = false;
}

if (cloudOn) {
    // simpan lokal dulu, lalu kirim ke cloud (ditunda 0,6 detik agar tidak berulang)
    window.save = function () {
        const ok = localSave();
        if (ok && session) { clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushTimer = null; cloudPush(); }, 600); }
        return ok;
    };
    $("logoutBtn").hidden = false;
    window.ready.then(() => { if (session) cloudPull(true).catch(() => {}); else showLogin(); });
    setInterval(() => { if (session) cloudPull().catch(() => {}); }, 20000);
}
