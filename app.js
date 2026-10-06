"use strict";
/* =========================================================
   DSHAN - inti aplikasi: data, stok, barang, transaksi, opname,
   laporan, pembukuan, backup. Format data sama dengan versi v5.
   Urutan skrip: config.js -> app.js -> orders.js -> sync.js
========================================================= */
const STORAGE = { products: "dshan_products_v5", transactions: "dshan_transactions_v5", opname: "dshan_opname_v5", orders: "dshan_orders_v1", bookkeeping: "dshan_bookkeeping_v1" };
const MASTER = { db: "dshan_master_storage_v1", store: "master", key: "state", local: "dshan_master_state_v1" };
const SIZES = ["S", "M", "L", "XL", "XXL", "XXXL"], CHILD = ["2", "4", "6", "8", "10", "12", "14"];
const MATERIALS = [
    { label: "Baju Lengan Panjang", type: "Lengan Panjang", part: "Panjang" },
    { label: "Baju Lengan Pendek", type: "Lengan Pendek", part: "Pendek" },
    { label: "Bahan Gortex", type: "Bahan Gortex", part: "Gortex" },
    { label: "Bahan Kulit", type: "Bahan Kulit", part: "Kulit" },
    { label: "Bahan Parasut", type: "Bahan Parasut", part: "Parasut" },
    { label: "Genuine", type: "Genuine", part: "Genuine" },
    { label: "Biasa", type: "Biasa", part: "Biasa" }
];
const MAT_BY_PART = Object.fromEntries(MATERIALS.map(m => [m.part, m]));
const SIMPLE_PARTS = ["Genuine", "Biasa", "TanpaUkuran"], GENDERS = ["Cowok", "Cewek", "Tidak Ada"];

/* ---------- Utilitas ---------- */
const $ = id => document.getElementById(id);
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const n = v => Math.max(0, num(v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const curMonth = () => today().slice(0, 7);
const fmt = v => num(v).toLocaleString("id-ID");
const rupiah = v => "Rp " + fmt(v);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const formatDate = d => d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const setText = (id, t) => { const e = $(id); if (e) e.textContent = t; };
const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const clone = v => JSON.parse(JSON.stringify(v));
const csvText = rows => "\ufeff" + rows.map(r => r.map(c => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
function fillTable(id, rows, cols, emptyText) {
    $(id).innerHTML = rows.length ? rows.join("") : `<tr><td colspan="${cols}" class="empty">${emptyText}</td></tr>`;
}
let toastTimer;
function showToast(msg, type = "success") {
    const t = $("toast");
    t.textContent = msg; t.className = "toast show " + (type === "error" ? "error" : "success");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = "toast", 3800);
}
const openModal = id => $(id)?.classList.add("show");
const closeModal = id => $(id)?.classList.remove("show");
function compressImage(file) {
    return new Promise(resolve => {
        const r = new FileReader();
        r.onload = () => {
            const img = new Image();
            img.onload = () => {
                const s = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement("canvas");
                c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL("image/jpeg", 0.78));
            };
            img.onerror = () => resolve(""); img.src = r.result;
        };
        r.onerror = () => resolve(""); r.readAsDataURL(file);
    });
}

/* ---------- Data & penyimpanan ---------- */
let products = load(STORAGE.products) || [];
let transactions = load(STORAGE.transactions) || [];
let opname = load(STORAGE.opname) || [];
let orders = load(STORAGE.orders) || [];
let bk = load(STORAGE.bookkeeping) || {};
window.ready = new Promise(r => { window.__readyResolve = r; });

function normalize() {
    products = (products || []).filter(p => p && p.id).map(p => ({ ...p, variants: p.variants || {}, variantLabels: p.variantLabels || {}, variantSizeModes: p.variantSizeModes || {} }));
    transactions = (transactions || []).filter(t => t && t.id).map(t => {
        const p = products.find(x => x.id === t.productId);
        return { ...t, qty: n(t.qty), size: t.size || "ALL", variantKey: t.variantKey || `${t.gender || p?.gender || "Cowok"}-${t.garmentType || p?.garmentType || "Panjang"}` };
    });
    transactions.forEach(t => { const p = products.find(x => x.id === t.productId); if (p && !p.variants[t.variantKey]) p.variants[t.variantKey] = { enabled: true, sizes: {} }; });
    opname = (opname || []).filter(Boolean);
    orders = (orders || []).filter(Boolean);
    bk = { capital: bk?.capital || {}, production: bk?.production || [], expenses: bk?.expenses || [], debts: bk?.debts || [] };
}
normalize();

/* Salinan cadangan di IndexedDB (dipulihkan bila penyimpanan utama kosong/lebih lama). */
const idb = (mode, fn) => new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") return rej(new Error("IndexedDB tidak tersedia"));
    const r = indexedDB.open(MASTER.db, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(MASTER.store)) r.result.createObjectStore(MASTER.store); };
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
        const t = r.result.transaction(MASTER.store, mode), q = fn(t.objectStore(MASTER.store));
        t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error);
    };
});
const mirror = () => idb("readwrite", s => s.put({ version: 2, savedAt: Date.now(), products, transactions, opname, orders, bookkeeping: bk }, MASTER.key)).catch(() => { });
async function restoreMaster() {
    const fromIdb = await idb("readonly", s => s.get(MASTER.key)).catch(() => null);
    const m = [fromIdb, load(MASTER.local)].filter(x => x && Array.isArray(x.products)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
    const localAt = Number(localStorage.getItem("dshan_saved_at")) || 0;
    if (!m || (m.savedAt || 0) <= localAt + 5000 || (products.length && m.products.length < products.length)) return;
    products = clone(m.products); transactions = clone(m.transactions || []); opname = clone(m.opname || []);
    if (m.orders) orders = clone(m.orders);
    if (m.bookkeeping) bk = clone(m.bookkeeping);
    normalize(); save();
}
function save() {
    const d = { products, transactions, opname, orders, bookkeeping: bk };
    try {
        Object.keys(STORAGE).forEach(k => localStorage.setItem(STORAGE[k], JSON.stringify(d[k])));
        localStorage.setItem("dshan_saved_at", String(Date.now()));
    } catch (e) {
        showToast(e?.name === "QuotaExceededError" ? "Penyimpanan browser penuh. Kurangi foto atau jumlah data." : "Data gagal disimpan.", "error");
        return false;
    }
    mirror();
    return true;
}

/* ---------- Varian, ukuran, stok ---------- */
const genderOf = k => String(k).split("-")[0];
const partOf = k => String(k).split("-").slice(1).join("-");
const findProduct = id => products.find(p => p.id === id);
const enabledVariants = p => Object.keys(p?.variants || {}).filter(k => p.variants[k]?.enabled !== false);
const kindOf = (p, k) => partOf(k) === "Anak" ? "anak" : (SIMPLE_PARTS.includes(partOf(k)) || p?.variantSizeModes?.[k] === "TIDAK_ADA") ? "simple" : "dewasa";
const allSizesFor = (p, k) => ({ anak: CHILD, simple: ["ALL"], dewasa: SIZES }[kindOf(p, k)]);
/* Hanya ukuran yang terdaftar untuk varian itu. Varian baru memakai v.sizeList (dipilih saat tambah/edit barang);
   data lama: ukuran yang punya stok awal atau riwayat transaksi; bila belum ada sama sekali, tampilkan semua. */
function sizesFor(p, k) {
    const all = allSizesFor(p, k);
    if (all.length === 1) return all;
    const v = p?.variants?.[k];
    const used = s => initialOf(p, k, s) > 0 || (p && transactions.some(t => t.productId === p.id && t.variantKey === k && t.size === s));
    const list = Array.isArray(v?.sizeList) ? v.sizeList : [];
    const picked = all.filter(s => list.includes(s) || used(s));
    return picked.length ? picked : all;
}
const materialLabel = (p, k) => p?.variantLabels?.[k] || (partOf(k) === "Anak" ? "Ukuran Anak-anak" : MAT_BY_PART[partOf(k)]?.type) || "Tidak Ada";
const variantText = (p, k) => `${materialLabel(p, k)} • ${genderOf(k)}`;
const sizeText = s => s === "ALL" ? "Tanpa Ukuran" : CHILD.includes(s) ? "Anak " + s : s;
const initialOf = (p, k, s) => { const v = p?.variants?.[k] || {}; return n(kindOf(p, k) === "anak" ? v.childSizes?.[s] : v.sizes?.[s]); };
const txOf = (p, k, s) => transactions.filter(t => t.productId === p.id && t.variantKey === k && (s == null || t.size === s));
const signed = t => t.type === "Masuk" ? n(t.qty) : -n(t.qty);
const stock = (p, k, s) => initialOf(p, k, s) + txOf(p, k, s).reduce((a, t) => a + signed(t), 0);
const variantStock = (p, k) => sizesFor(p, k).reduce((a, s) => a + initialOf(p, k, s), 0) + txOf(p, k).reduce((a, t) => a + signed(t), 0);
const productStock = p => enabledVariants(p).reduce((a, k) => a + variantStock(p, k), 0);
const sumQty = (p, type, cat, k, withOpname) => transactions.filter(t => t.productId === p.id && t.type === type && (!cat || t.category === cat) && (!k || t.variantKey === k) && (withOpname || !t.opnameId)).reduce((a, t) => a + n(t.qty), 0);

/* ---------- Harga & keuangan ---------- */
const modalOf = p => n(p?.initialCost);
const priceR = p => n(p?.resellerPrice ?? p?.price);
const priceP = p => n(p?.pemakaiPrice ?? p?.price);
const unitPriceFor = (p, type, cat) => type === "Masuk" ? modalOf(p) : cat === "Reseller" ? priceR(p) : priceP(p);
const trxUnit = (t, p) => t.unitPrice != null && t.unitPrice !== "" ? n(t.unitPrice) : unitPriceFor(p, t.type, t.category);
const trxCost = (t, p) => t.type === "Keluar" ? n(t.qty) * (n(t.modalPrice) || modalOf(p)) : n(t.qty) * trxUnit(t, p);
function summarize(list) {
    const s = { inQty: 0, outQty: 0, rQty: 0, pQty: 0, inValue: 0, revenue: 0, cogs: 0, rNet: 0, pNet: 0 };
    list.forEach(t => {
        const p = findProduct(t.productId);
        if (!p || t.opnameId) return;
        const q = n(t.qty);
        if (t.type === "Masuk") { s.inQty += q; s.inValue += q * trxUnit(t, p); return; }
        const rev = q * trxUnit(t, p), cost = trxCost(t, p);
        s.outQty += q; s.revenue += rev; s.cogs += cost;
        if (t.category === "Reseller") { s.rQty += q; s.rNet += rev - cost; }
        else if (t.category === "Pemakai") { s.pQty += q; s.pNet += rev - cost; }
    });
    s.net = s.revenue - s.cogs;
    return s;
}

/* ---------- Pilihan barang/varian/ukuran (dipakai transaksi, opname, pesanan) ---------- */
function fillProductSelect(sel, selected) {
    sel.innerHTML = products.map(p => `<option value="${esc(p.id)}">${esc(p.code || "")} - ${esc(p.name)}</option>`).join("") || '<option value="">(belum ada barang)</option>';
    if (selected) sel.value = selected;
}
function fillVariantSelect(sel, p, selected) {
    const ks = enabledVariants(p);
    sel.innerHTML = ks.map(k => `<option value="${esc(k)}">${esc(variantText(p, k))}</option>`).join("");
    if (selected && ks.includes(selected)) sel.value = selected;
}
function fillSizeSelect(sel, p, k, selected) {
    const ss = p && k ? sizesFor(p, k) : [];
    sel.innerHTML = ss.map(s => `<option value="${s}">${sizeText(s)} (stok ${stock(p, k, s)})</option>`).join("");
    if (selected && ss.includes(selected)) sel.value = selected;
}

/* ---------- Navigasi & kartu ---------- */
const TITLES = { dashboard: "Dashboard", stock: "Data Stok", transactions: "Transaksi", orders: "Pesanan", debts: "Hutang", opname: "Stok Opname", reports: "Laporan Bulanan", bookkeeping: "Pembukuan" };
function showPage(page) {
    document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === "page-" + page));
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
    setText("pageTitle", TITLES[page] || "DSHAN");
    $("sidebar")?.classList.remove("open");
    refreshAll();
}
const toggleSidebar = () => $("sidebar")?.classList.toggle("open");
const CARDS = {
    dash: [["blue", "📦", "Total Barang", "dashProducts"], ["green", "⬆️", "Total Masuk", "dashIncoming"], ["red", "⬇️", "Total Keluar", "dashOutgoing"], ["purple", "📊", "Stok Saat Ini", "dashCurrentStock"], ["blue", "🏪", "Keluar Reseller", "dashResellerStock"], ["purple", "👕", "Keluar Pemakai", "dashPemakaiStock"], ["orange", "💰", "Nilai Persediaan", "dashInventoryValue"], ["cyan", "💵", "Total Nilai Transaksi", "dashTransactionValue"], ["green", "📈", "Total Keuntungan", "dashProfit"], ["red", "📉", "Total Kerugian", "dashLoss"], ["yellow", "⚠️", "Total Kurang", "dashShortage"], ["pink", "➕", "Total Lebih", "dashExcess"]],
    trx: [["green", "⬆️", "Barang Masuk", "trxIncoming"], ["red", "⬇️", "Barang Keluar", "trxOutgoing"], ["purple", "💰", "Total Nilai", "trxValue"], ["blue", "🏪", "Keluar Reseller", "trxReseller"], ["purple", "👕", "Keluar Pemakai", "trxPemakai"], ["green", "📈", "Keuntungan", "trxProfit"], ["red", "📉", "Kerugian", "trxLoss"]],
    order: [["yellow", "📥", "Diterima", "qDiterima"], ["blue", "📦", "Dikemas", "qDikemas"], ["purple", "🚚", "Dikirim", "qDikirim"]],
    opname: [["yellow", "⚠️", "Total Kurang", "opnameShortage"], ["pink", "➕", "Total Lebih", "opnameExcess"]],
    report: [["green", "⬆️", "Total Masuk", "reportIncoming"], ["red", "⬇️", "Total Keluar", "reportOutgoing"], ["blue", "🏪", "Keluar Reseller", "reportReseller"], ["purple", "👕", "Keluar Pemakai", "reportPemakai"], ["cyan", "💰", "Nilai Masuk", "reportIncomingValue"], ["orange", "💵", "Nilai Keluar", "reportOutgoingValue"], ["green", "📈", "Keuntungan", "reportProfit"], ["red", "📉", "Kerugian", "reportLoss"]]
};
function buildCards() {
    Object.entries(CARDS).forEach(([k, list]) => {
        $(k + "Cards").innerHTML = list.map(([c, i, l, id]) => `<div class="stat-card"><div class="stat-icon ${c}">${i}</div><div><span>${l}</span><strong id="${id}">0</strong></div></div>`).join("");
    });
    const mats = '<option value="">Semua Jenis Bahan</option>' + MATERIALS.map(m => `<option>${m.type}</option>`).join("") + "<option>Ukuran Anak-anak</option>";
    $("stockGarmentFilter").innerHTML = mats; $("transactionGarmentFilter").innerHTML = mats;
    $("transactionSize").innerHTML = '<option value="">Semua Ukuran</option>' + SIZES.map(s => `<option>${s}</option>`).join("") + CHILD.map(s => `<option value="${s}">Anak ${s}</option>`).join("") + '<option value="ALL">Tanpa Ukuran</option>';
}

/* ---------- Dashboard ---------- */
function renderDashboard() {
    const all = summarize(transactions);
    const short = opname.filter(o => o.status === "Kurang").reduce((s, o) => s + Math.abs(num(o.difference)), 0);
    const over = opname.filter(o => o.status === "Lebih").reduce((s, o) => s + num(o.difference), 0);
    const vals = {
        dashProducts: fmt(products.length), dashIncoming: fmt(all.inQty), dashOutgoing: fmt(all.outQty),
        dashCurrentStock: fmt(products.reduce((s, p) => s + productStock(p), 0)), dashResellerStock: fmt(all.rQty), dashPemakaiStock: fmt(all.pQty),
        dashInventoryValue: rupiah(products.reduce((s, p) => s + Math.max(0, productStock(p)) * modalOf(p), 0)), dashTransactionValue: rupiah(all.revenue),
        dashProfit: rupiah(Math.max(all.net, 0)), dashLoss: rupiah(Math.max(-all.net, 0)), dashShortage: fmt(short), dashExcess: fmt(over)
    };
    Object.entries(vals).forEach(([id, v]) => setText(id, v));
    const recent = [...transactions].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 8);
    $("recentTransactions").innerHTML = recent.length ? recent.map(t => {
        const p = findProduct(t.productId); if (!p) return "";
        return `<div class="recent-item"><div><strong>${esc(p.name)}</strong><small>${formatDate(t.date)} • ${esc(sizeText(t.size))} • ${esc(t.category || "Umum")}</small></div><strong class="${t.type === "Masuk" ? "text-green" : "text-red"}">${t.type === "Masuk" ? "+" : "-"}${fmt(t.qty)}</strong></div>`;
    }).join("") : '<div class="empty">Belum ada transaksi.</div>';
    const low = products.filter(p => productStock(p) <= n(p.minStock));
    $("lowStockList").innerHTML = low.length ? low.map(p => `<div class="low-stock-item"><div><strong>${esc(p.name)}</strong><small>${esc(p.code || "-")}</small></div><strong class="stock-danger">${fmt(productStock(p))} ${esc(p.unit || "pcs")}</strong></div>`).join("") : '<div class="empty">Tidak ada stok menipis.</div>';
}

/* ---------- Data Stok ---------- */
function renderStock() {
    const q = $("stockSearch").value.toLowerCase(), cat = $("stockCategory").value, mf = $("stockGarmentFilter").value, gf = $("stockGenderFilter").value, rows = [];
    products.forEach(p => enabledVariants(p).forEach(k => {
        const label = materialLabel(p, k), g = genderOf(k);
        if (q && !`${p.code} ${p.name} ${label}`.toLowerCase().includes(q)) return;
        if ((mf && label !== mf) || (gf && g !== gf) || (cat && !sumQty(p, "Keluar", cat, k))) return;
        const cur = variantStock(p, k), cls = cur <= 0 ? "stock-danger" : cur <= n(p.minStock) ? "stock-warning" : "stock-good";
        const chips = kindOf(p, k) === "simple" ? "" : allSizesFor(p, k).map(s => `<span class="size-chip"><b>${s}</b> ${fmt(stock(p, k, s))}</span>`).join(" ");
        const ek = esc(k);
        rows.push(`<tr data-product-id="${esc(p.id)}" data-variant-key="${ek}"><td class="col-photo">${p.photo ? `<img src="${esc(p.photo)}" class="table-photo" alt="foto">` : '<div class="no-photo">📦</div>'}</td>
            <td class="col-code"><strong>${esc(p.code || "-")}</strong></td><td class="col-name"><strong>${esc(p.name)}</strong><small>${esc(p.unit || "pcs")}</small></td>
            <td class="col-type"><strong>${esc(label)}</strong><small>${esc(g)}</small></td><td class="col-stock"><strong class="${cls}">${fmt(cur)}</strong></td>
            <td class="col-size"><div class="size-breakdown">${chips}</div></td><td class="text-green">+${fmt(sumQty(p, "Masuk", "", k, true))}</td>
            <td class="text-red">-${fmt(sumQty(p, "Keluar", "Reseller", k, true))}</td><td class="text-red">-${fmt(sumQty(p, "Keluar", "Pemakai", k, true))}</td>
            <td><strong>${fmt(cur)}</strong></td><td>${rupiah(modalOf(p))}</td><td>${rupiah(priceR(p))}</td><td>${rupiah(priceP(p))}</td>
            <td><div class="action-buttons"><button class="icon-btn quick-in" title="Barang masuk" onclick="openTransactionModal('${p.id}','Masuk','${ek}')">+</button>
            <button class="icon-btn quick-out" title="Barang keluar" onclick="openTransactionModal('${p.id}','Keluar','${ek}')">−</button>
            <button class="icon-btn" title="Edit" onclick="editProduct('${p.id}')">✏️</button><button class="icon-btn danger" title="Hapus" onclick="deleteProduct('${p.id}')">🗑️</button></div></td></tr>`);
    }));
    fillTable("stockTable", rows, 14, "Belum ada barang.");
}

/* ---------- Edit barang ---------- */
let ed = null; // { gender, modes, active:Set("Cowok-Parasut"), vals: { key: {sizes|childSizes, pick:[ukuran]} } }
const hasHistory = k => { const id = $("productId").value; return Boolean(id) && transactions.some(t => t.productId === id && t.variantKey === k); };
const sizesWithHistory = k => { const id = $("productId").value; return new Set(id ? transactions.filter(t => t.productId === id && t.variantKey === k).map(t => t.size) : []); };
function renderEditor() {
    const g = ed.gender, shown = [...ed.active].filter(k => genderOf(k) === g).map(partOf);
    const partTitle = part => part === "Anak" ? "Ukuran Anak-anak" : MAT_BY_PART[part]?.label || part;
    const sec = part => {
        const key = `${g}-${part}`, v = ed.vals[key] || {}, isChild = part === "Anak";
        const simple = !isChild && (SIMPLE_PARTS.includes(part) || ed.modes[key] === "TIDAK_ADA");
        const src = (isChild ? v.childSizes : v.sizes) || {}, all = isChild ? CHILD : simple ? ["ALL"] : SIZES;
        const locked = sizesWithHistory(key), pick = simple ? ["ALL"] : all.filter(s => (v.pick || []).includes(s) || locked.has(s));
        const picker = simple ? "" : `<div class="size-picker">${all.map(s => `<label class="size-pick${pick.includes(s) ? " on" : ""}"><input type="checkbox" data-pick="${s}"${pick.includes(s) ? " checked" : ""}${locked.has(s) ? " disabled" : ""}><span>${s}</span></label>`).join("")}</div>`;
        const inputs = pick.length ? `<div class="edit-v6-size-grid${isChild ? " edit-v6-child-grid" : ""}">${pick.map(s => `<label>${s === "ALL" ? "Jumlah Stok" : (isChild ? "Anak " + s : s)}<input type="number" min="0" data-s="${s}" value="${n(src[s])}"></label>`).join("")}</div>`
            : '<div class="size-empty">Centang ukuran yang mau dipakai di atas.</div>';
        return `<div class="edit-v6-section" data-part="${part}"><div class="edit-v6-section-title"><strong>${partTitle(part)}</strong>
            <button type="button" class="small-btn danger-btn" data-remove="${part}"${hasHistory(key) ? ' disabled title="Sudah punya riwayat transaksi"' : ""}>Hapus jenis ini</button></div>${picker}${inputs}</div>`;
    };
    const free = [...MATERIALS.map(m => m.part), "Anak"].filter(p => !shown.includes(p));
    $("variantEditor").innerHTML = `<div class="variant-manager-head"><div><strong>Jenis Barang & Bahan</strong><small>Pilih jenis bahan, lalu centang hanya ukuran yang dipakai. Kolom stok hanya muncul untuk ukuran yang dicentang. Genuine dan Biasa cukup jumlah stok.</small></div></div>
        <div class="form-grid"><label>Jenis Kelamin<select id="edGender">${GENDERS.map(x => `<option${x === g ? " selected" : ""}>${x}</option>`).join("")}</select></label>
        <label>Tambah Jenis Bahan<select id="edAdd"><option value="">+ Pilih bahan…</option>${free.map(p => `<option value="${p}">${partTitle(p)}</option>`).join("")}</select></label></div>`
        + (shown.length ? shown.map(sec).join("") : '<div class="size-empty">Belum ada jenis bahan. Pilih dari "Tambah Jenis Bahan".</div>');
}
function captureEditor() {
    document.querySelectorAll("#variantEditor .edit-v6-section").forEach(sec => {
        const part = sec.dataset.part, key = `${ed.gender}-${part}`, vals = {}, prev = ed.vals[key] || {};
        sec.querySelectorAll("input[data-s]").forEach(i => vals[i.dataset.s] = n(i.value));
        const pick = [...sec.querySelectorAll("input[data-pick]")].filter(i => i.checked || i.disabled).map(i => i.dataset.pick);
        const merged = { ...((part === "Anak" ? prev.childSizes : prev.sizes) || {}), ...vals };
        ed.vals[key] = part === "Anak" ? { childSizes: merged, pick } : { sizes: merged, pick: sec.querySelector("[data-pick]") ? pick : ["ALL"] };
    });
}
function onEditorChange(e) {
    const t = e.target;
    if (t.id === "edGender") { captureEditor(); ed.gender = t.value; renderEditor(); }
    else if (t.id === "edAdd" && t.value) {
        captureEditor(); const key = `${ed.gender}-${t.value}`; ed.active.add(key);
        if (!ed.vals[key]) ed.vals[key] = { sizes: {}, childSizes: {}, pick: SIMPLE_PARTS.includes(t.value) ? ["ALL"] : [] };
        renderEditor();
    } else if (t.matches("input[data-pick]")) { captureEditor(); renderEditor(); }
}
function onEditorClick(e) {
    const b = e.target.closest("[data-remove]"); if (!b || b.disabled) return;
    captureEditor(); ed.active.delete(`${ed.gender}-${b.dataset.remove}`); renderEditor();
}
function openProductModal(p = null) {
    const first = p ? enabledVariants(p)[0] : null;
    ed = { gender: first ? genderOf(first) : "Cowok", vals: {}, modes: { ...(p?.variantSizeModes || {}) }, active: new Set() };
    if (p) enabledVariants(p).forEach(k => { const v = p.variants[k]; ed.active.add(k); ed.vals[k] = { sizes: { ...(v.sizes || {}) }, childSizes: { ...(v.childSizes || {}) }, pick: sizesFor(p, k) }; });
    $("productModalTitle").textContent = p ? "Edit Barang" : "Tambah Barang";
    $("productId").value = p?.id || ""; $("productCode").value = p?.code || ""; $("productName").value = p?.name || "";
    $("productMinStock").value = n(p?.minStock); $("productUnit").value = p?.unit || "pcs";
    $("productResellerPrice").value = priceR(p); $("productPemakaiPrice").value = priceP(p); $("productInitialCost").value = modalOf(p);
    $("productPhoto").value = ""; $("productPhotoPreview").innerHTML = p?.photo ? `<img src="${esc(p.photo)}" alt="preview">` : "";
    renderEditor(); openModal("productModal");
}
const editProduct = id => { const p = findProduct(id); if (p) openProductModal(p); };
async function saveProduct(event) {
    event.preventDefault();
    captureEditor();
    const id = $("productId").value, existing = findProduct(id), code = $("productCode").value.trim(), name = $("productName").value.trim();
    if (!code || !name) return showToast("Kode dan nama wajib diisi.", "error");
    if (products.some(p => p.id !== id && String(p.code || "").trim().toLowerCase() === code.toLowerCase())) return showToast(`Kode ${code} sudah digunakan.`, "error");
    const variants = {}, labels = {}, modes = {};
    for (const k of ed.active) {
        const v = ed.vals[k] || {}, part = partOf(k), isChild = part === "Anak";
        const simple = !isChild && (SIMPLE_PARTS.includes(part) || ed.modes[k] === "TIDAK_ADA");
        const pick = simple ? ["ALL"] : (v.pick || []), data = (isChild ? v.childSizes : v.sizes) || {};
        if (!pick.length) return showToast(`${genderOf(k)} • ${isChild ? "Ukuran Anak-anak" : MAT_BY_PART[part]?.label || part}: pilih minimal satu ukuran.`, "error");
        const chosen = Object.fromEntries(pick.map(s => [s, n(data[s])]));
        variants[k] = isChild ? { enabled: true, sizes: {}, childSizes: chosen, sizeList: pick } : { enabled: true, sizes: chosen, sizeList: pick };
        labels[k] = existing?.variantLabels?.[k] || (isChild ? "Ukuran Anak-anak" : MAT_BY_PART[part]?.type || part);
        modes[k] = isChild ? "ANAK" : SIMPLE_PARTS.includes(part) ? "TIDAK_ADA" : (existing?.variantSizeModes?.[k] || "DEWASA");
    }
    const keys = Object.keys(variants);
    if (!keys.length) return showToast("Tambahkan minimal satu jenis bahan dan pilih ukurannya.", "error");
    let photo = existing?.photo || "";
    const file = $("productPhoto").files?.[0];
    if (file) photo = await compressImage(file);
    const data = {
        ...(existing || {}), id: id || uid(), code, name, gender: genderOf(keys[0]), garmentType: partOf(keys[0]), variants, variantLabels: labels, variantSizeModes: modes,
        minStock: n($("productMinStock").value), unit: $("productUnit").value || "pcs", resellerPrice: n($("productResellerPrice").value),
        pemakaiPrice: n($("productPemakaiPrice").value), price: n($("productPemakaiPrice").value), initialCost: n($("productInitialCost").value),
        photo, itemType: labels[keys[0]], itemTypeLabel: labels[keys[0]], materialOptions: [...new Set(Object.values(labels))], createdAt: existing?.createdAt || new Date().toISOString()
    };
    const backup = existing ? clone(existing) : null;
    if (existing) Object.assign(existing, data); else products.push(data);
    if (!save()) { if (existing) Object.assign(existing, backup); else products.pop(); return; }
    closeModal("productModal"); refreshAll(); showToast("Data barang disimpan.");
}
function deleteProduct(id) {
    const p = findProduct(id); if (!p) return;
    if (transactions.some(t => t.productId === id) || opname.some(o => o.productId === id) || orders.some(o => o.items.some(i => i.productId === id)))
        return showToast("Barang tidak bisa dihapus karena sudah punya transaksi, opname, atau pesanan.", "error");
    if (!confirm(`Hapus barang ${p.name}?`)) return;
    const backup = products; products = products.filter(x => x.id !== id);
    if (!save()) { products = backup; return; }
    refreshAll(); showToast("Barang dihapus.");
}

/* ---------- Tambah banyak barang ---------- */
function parseList(text, keys) {
    const vals = String(text || "").split(/[\/,;\s]+/).filter(Boolean).map(n), out = {};
    keys.forEach((k, i) => out[k] = vals[i] || 0); return out;
}
function addBulkRow() {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><input class="b-code" placeholder="BRG001"></td><td><input class="b-name" placeholder="Nama barang"></td>
        <td><select class="b-type">${MATERIALS.map(m => `<option>${m.type}</option>`).join("")}</select></td>
        <td><select class="b-gender">${GENDERS.map(g => `<option>${g}</option>`).join("")}</select></td>
        <td><select class="b-mode"><option value="DEWASA">Ukuran Dewasa</option><option value="ANAK">Ukuran Anak-anak</option><option value="TIDAK_ADA">Tanpa Ukuran</option></select>
        <input class="b-vals" placeholder="0/0/0/0/0/0"><small class="b-hint">S / M / L / XL / XXL / XXXL</small></td>
        <td><input class="b-unit" value="pcs"></td><td><input type="number" class="b-r" value="0" min="0"></td><td><input type="number" class="b-p" value="0" min="0"></td>
        <td><input type="number" class="b-c" value="0" min="0"></td><td><input type="file" class="b-photo" accept="image/*"></td>
        <td><button type="button" class="remove-row" onclick="this.closest('tr').remove()">×</button></td>`;
    $("bulkProductRows").appendChild(tr); updateBulkRow(tr);
}
function updateBulkRow(tr) {
    const type = tr.querySelector(".b-type").value, mode = tr.querySelector(".b-mode"), vals = tr.querySelector(".b-vals"), hint = tr.querySelector(".b-hint");
    const simple = SIMPLE_PARTS.includes(MATERIALS.find(m => m.type === type)?.part);
    if (simple) mode.value = "TIDAK_ADA";
    mode.disabled = simple;
    const t = { DEWASA: ["0/0/0/0/0/0", "S / M / L / XL / XXL / XXXL"], ANAK: ["0/0/0/0/0/0/0", "2 / 4 / 6 / 8 / 10 / 12 / 14"], TIDAK_ADA: ["Jumlah stok", "Tanpa ukuran"] }[mode.value];
    vals.placeholder = t[0]; hint.textContent = t[1];
}
function openBulkProductModal() {
    $("bulkProductRows").innerHTML = "";
    for (let i = 0; i < 3; i++) addBulkRow();
    openModal("bulkProductModal");
}
async function saveBulkProducts(event) {
    event.preventDefault();
    const existing = new Set(products.map(p => String(p.code || "").trim().toLowerCase())), batch = new Set(), pending = [], errors = [];
    [...$("bulkProductRows").querySelectorAll("tr")].forEach((r, i) => {
        const code = r.querySelector(".b-code").value.trim(), name = r.querySelector(".b-name").value.trim();
        if (!code && !name) return;
        if (!code || !name) return errors.push(`Baris ${i + 1}: ${!code ? "kode" : "nama"} belum diisi.`);
        const key = code.toLowerCase();
        if (existing.has(key) || batch.has(key)) return errors.push(`Baris ${i + 1}: kode ${code} sudah ada/duplikat.`);
        batch.add(key); pending.push({ r, code, name });
    });
    if (errors.length) return showToast(errors.slice(0, 3).join(" "), "error");
    if (!pending.length) return showToast("Isi minimal satu barang.", "error");
    const added = [];
    for (const { r, code, name } of pending) {
        const q = c => r.querySelector("." + c), gender = q("b-gender").value, mode = q("b-mode").value, raw = q("b-vals").value;
        const m = MATERIALS.find(x => x.type === q("b-type").value), key = mode === "ANAK" ? `${gender}-Anak` : `${gender}-${m.part}`;
        const listOf = (l, vals) => { const used = l.filter(s => vals[s] > 0); return used.length ? { sizeList: used } : {}; };
        const cv = parseList(raw, CHILD), dv = parseList(raw, SIZES);
        const v = mode === "ANAK" ? { enabled: true, sizes: {}, childSizes: cv, ...listOf(CHILD, cv) }
            : mode === "TIDAK_ADA" ? { enabled: true, sizes: { ALL: n(raw) } } : { enabled: true, sizes: dv, ...listOf(SIZES, dv) };
        const label = mode === "ANAK" ? "Ukuran Anak-anak" : m.type, file = q("b-photo").files?.[0];
        added.push({
            id: uid(), code, name, gender, garmentType: partOf(key), variants: { [key]: v }, variantLabels: { [key]: label }, variantSizeModes: { [key]: mode },
            minStock: 0, unit: q("b-unit").value || "pcs", resellerPrice: n(q("b-r").value), pemakaiPrice: n(q("b-p").value), price: n(q("b-p").value),
            initialCost: n(q("b-c").value), photo: file ? await compressImage(file) : "", itemType: label, itemTypeLabel: label, materialOptions: [label], createdAt: new Date().toISOString()
        });
    }
    products.push(...added);
    if (!save()) { products.splice(products.length - added.length, added.length); return; }
    closeModal("bulkProductModal"); refreshAll(); showToast(`${added.length} barang disimpan.`);
}

/* ---------- Transaksi ---------- */
function syncTx(from, vk) {
    const p = findProduct($("transactionProduct").value), V = $("transactionVariant"), S = $("transactionSizeInput");
    if (from === "prod") fillVariantSelect(V, p, vk);
    const k = V.value; fillSizeSelect(S, p, k, S.value);
    $("transactionMaterial").value = p && k ? materialLabel(p, k) : ""; $("transactionGender").value = k ? genderOf(k) : "";
    const type = $("transactionTypeInput").value;
    $("transactionCategoryInput").disabled = type === "Masuk";
    document.querySelectorAll(".tx-sale-only").forEach(e => e.hidden = type !== "Keluar");
    const price = p ? unitPriceFor(p, type, $("transactionCategoryInput").value) : 0;
    $("transactionPrice").value = price; setText("transactionTotalPreview", rupiah(n($("transactionQty").value) * price));
    setText("stockInfo", p && k ? `Stok ${variantText(p, k)} ${sizeText(S.value)}: ${fmt(stock(p, k, S.value))} • Total motif: ${fmt(productStock(p))} ${p.unit || "pcs"}` : "");
}
function openTransactionModal(pid = "", type = "Masuk", vk = "") {
    if (!products.length) return showToast("Tambahkan barang terlebih dahulu.", "error");
    $("transactionForm").reset(); $("transactionDate").value = today();
    fillProductSelect($("transactionProduct"), pid); $("transactionTypeInput").value = type;
    syncTx("prod", vk); openModal("transactionModal");
}
function saveTransaction(event) {
    event.preventDefault();
    const p = findProduct($("transactionProduct").value), k = $("transactionVariant").value, s = $("transactionSizeInput").value;
    const type = $("transactionTypeInput").value, qty = n($("transactionQty").value), cat = type === "Masuk" ? "Umum" : $("transactionCategoryInput").value;
    if (!p || !k || !s) return showToast("Pilih barang, varian, dan ukuran.", "error");
    if (qty <= 0) return showToast("Jumlah harus lebih dari 0.", "error");
    if (type === "Keluar" && qty > stock(p, k, s)) return showToast(`Stok ${variantText(p, k)} ${sizeText(s)} hanya ${fmt(stock(p, k, s))}.`, "error");
    const unpaid = type === "Keluar" && $("transactionPaid")?.value === "Belum";
    if (unpaid && !$("transactionCustomer").value.trim()) return showToast("Isi nama pelanggan untuk mencatat hutang.", "error");
    const price = unitPriceFor(p, type, cat);
    const tx = {
        id: uid(), date: $("transactionDate").value || today(), productId: p.id, type, category: cat, size: s, qty, variantKey: k, gender: genderOf(k), garmentType: partOf(k),
        unitPrice: price, modalPrice: modalOf(p), totalValue: qty * price, note: $("transactionNote").value.trim(), createdAt: new Date().toISOString()
    };
    transactions.push(tx);
    let order = null; // barang keluar ke pelanggan otomatis masuk ke menu Pesanan (status Dikemas, tinggal Kirim)
    if (type === "Keluar" && typeof orderFromSale === "function") {
        order = orderFromSale(tx, $("transactionCustomer").value.trim(), $("transactionPhone").value.trim(), unpaid);
        tx.orderId = order.id; orders.push(order);
    }
    if (!save()) { transactions.pop(); if (order) orders.pop(); return; }
    closeModal("transactionModal"); refreshAll();
    showToast(order ? `Keluar ${qty} ${p.unit || "pcs"} disimpan dan masuk ke Pesanan. Tinggal tekan Kirim.` : `${type} ${qty} ${p.unit || "pcs"} disimpan.`);
}
function renderTransactions() {
    const q = $("transactionSearch").value.trim().toLowerCase(), type = $("transactionType").value, cat = $("transactionCustomerType").value;
    const mf = $("transactionGarmentFilter").value, gf = $("transactionGenderFilter").value, sf = $("transactionSize").value, mo = $("transactionMonth").value;
    const list = transactions.filter(t => {
        const p = findProduct(t.productId), mat = materialLabel(p, t.variantKey);
        return `${p?.code} ${p?.name} ${mat} ${t.note} ${t.category} ${t.type} ${genderOf(t.variantKey)}`.toLowerCase().includes(q)
            && (!type || t.type === type) && (!cat || t.category === cat) && (!mf || mat === mf) && (!gf || genderOf(t.variantKey) === gf)
            && (!sf || t.size === sf) && (!mo || String(t.date || "").startsWith(mo));
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const s = summarize(list);
    Object.entries({ trxIncoming: fmt(s.inQty), trxOutgoing: fmt(s.outQty), trxValue: rupiah(s.revenue), trxReseller: fmt(s.rQty), trxPemakai: fmt(s.pQty), trxProfit: rupiah(Math.max(s.net, 0)), trxLoss: rupiah(Math.max(-s.net, 0)) }).forEach(([id, v]) => setText(id, v));
    fillTable("transactionTable", list.map(t => {
        const p = findProduct(t.productId), op = Boolean(t.opnameId), keluar = t.type === "Keluar" && !op;
        const rev = keluar ? n(t.qty) * trxUnit(t, p) : 0, cost = trxCost(t, p), net = keluar ? rev - cost : 0, cat2 = op ? "Opname" : (t.category || "Umum");
        return `<tr><td>${formatDate(t.date)}</td><td><strong>${esc(p?.name || "Barang dihapus")}</strong><small>${esc(p?.code || "")}</small></td><td>${esc(materialLabel(p, t.variantKey))}</td>
            <td>${esc(genderOf(t.variantKey))}</td><td><strong>${esc(sizeText(t.size))}</strong></td><td><span class="badge ${esc(cat2.toLowerCase())}">${esc(cat2)}</span></td>
            <td><span class="trx-type ${t.type.toLowerCase()}">${t.type}</span></td><td><strong>${fmt(t.qty)}</strong></td><td>${rupiah(trxUnit(t, p))}</td><td><strong>${rupiah(keluar ? rev : cost)}</strong></td>
            <td class="text-green">${rupiah(Math.max(net, 0))}</td><td class="text-red">${t.type === "Masuk" && !op ? rupiah(cost) : rupiah(Math.max(-net, 0))}</td>
            <td>${esc(t.note || "-")}</td><td><button class="small-btn danger-btn" onclick="deleteTransaction('${t.id}')">${op ? "Hapus Opname" : "Hapus"}</button></td></tr>`;
    }), 14, "Tidak ada transaksi sesuai filter.");
}
function deleteTransaction(id) {
    const t = transactions.find(x => x.id === id); if (!t) return;
    if (t.orderId) return showToast("Transaksi ini berasal dari pesanan. Batalkan lewat menu Pesanan.", "error");
    const p = findProduct(t.productId);
    if (t.type === "Masuk" && p && stock(p, t.variantKey, t.size) - n(t.qty) < 0) return showToast("Tidak bisa dihapus: stok akan menjadi negatif karena barang sudah keluar.", "error");
    if (!confirm(t.opnameId ? "Hapus penyesuaian opname ini? Data opname terkait ikut dihapus." : "Hapus transaksi ini? Stok dan laporan dihitung ulang.")) return;
    const b = { tx: transactions, op: opname };
    if (t.opnameId) opname = opname.filter(o => o.id !== t.opnameId);
    transactions = transactions.filter(x => x.id !== id);
    if (!save()) { transactions = b.tx; opname = b.op; return; }
    refreshAll(); showToast("Data dihapus.");
}

/* ---------- Opname ---------- */
function syncOp(from) {
    const p = findProduct($("opnameProduct").value), V = $("opnameVariant"), S = $("opnameSize");
    if (from === "prod") fillVariantSelect(V, p);
    fillSizeSelect(S, p, V.value, S.value);
    const sys = p && V.value ? stock(p, V.value, S.value) : 0, d = n($("opnamePhysicalStock").value) - sys, el = $("opnameDifference");
    setText("opnameSystemStock", fmt(sys)); el.textContent = (d > 0 ? "+" : "") + fmt(d); el.className = d < 0 ? "text-red" : d > 0 ? "text-green" : "";
}
function openOpnameModal() {
    if (!products.length) return showToast("Tambahkan barang terlebih dahulu.", "error");
    $("opnameForm").reset(); $("opnameDate").value = today(); fillProductSelect($("opnameProduct")); syncOp("prod"); openModal("opnameModal");
}
function saveOpname(event) {
    event.preventDefault();
    const p = findProduct($("opnameProduct").value), k = $("opnameVariant").value, s = $("opnameSize").value;
    if (!p || !k) return showToast("Pilih barang dan varian.", "error");
    const system = stock(p, k, s), physical = n($("opnamePhysicalStock").value), diff = physical - system, date = $("opnameDate").value || today(), note = $("opnameNote").value.trim();
    if (diff === 0) { closeModal("opnameModal"); return showToast("Stok sudah sesuai. Tidak ada penyesuaian."); }
    const oid = uid(), now = new Date().toISOString();
    opname.push({ id: oid, date, productId: p.id, variantKey: k, garmentType: partOf(k), gender: genderOf(k), size: s, systemStock: system, physicalStock: physical, difference: diff, status: diff < 0 ? "Kurang" : "Lebih", category: "Opname", note });
    transactions.push({
        id: uid(), date, productId: p.id, type: diff < 0 ? "Keluar" : "Masuk", category: "Opname", variantKey: k, garmentType: partOf(k), gender: genderOf(k), size: s, qty: Math.abs(diff),
        unitPrice: modalOf(p), modalPrice: modalOf(p), totalValue: Math.abs(diff) * modalOf(p), note: `Stok opname ${diff < 0 ? "kurang" : "lebih"}${note ? ": " + note : ""}`, opnameId: oid, createdAt: now
    });
    if (!save()) { opname.pop(); transactions.pop(); return; }
    closeModal("opnameModal"); refreshAll(); showToast(`Stok disesuaikan ${diff > 0 ? "bertambah" : "berkurang"} ${fmt(Math.abs(diff))}.`);
}
function renderOpname() {
    const rows = [...opname].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    fillTable("opnameTable", rows.map(o => {
        const p = findProduct(o.productId), d = num(o.difference);
        return `<tr><td>${formatDate(o.date)}</td><td><strong>${esc(p?.name || "Barang dihapus")}</strong><small>${esc(p?.code || "")} • ${esc(variantText(p, o.variantKey))}</small></td>
            <td><strong>${esc(sizeText(o.size))}</strong></td><td><span class="badge opname">Opname</span></td><td>${fmt(o.systemStock)}</td><td>${fmt(o.physicalStock)}</td>
            <td class="${d < 0 ? "text-red" : d > 0 ? "text-green" : ""}">${d > 0 ? "+" : ""}${fmt(d)}</td><td><span class="status ${o.status === "Kurang" ? "danger" : "success"}">${esc(o.status || "Sesuai")}</span></td>
            <td>${esc(o.note || "-")}</td><td><button class="small-btn danger-btn" onclick="deleteOpname('${o.id}')">Hapus</button></td></tr>`;
    }), 10, "Belum ada data stok opname.");
    setText("opnameShortage", fmt(rows.filter(o => num(o.difference) < 0).reduce((s, o) => s + Math.abs(num(o.difference)), 0)));
    setText("opnameExcess", fmt(rows.filter(o => num(o.difference) > 0).reduce((s, o) => s + num(o.difference), 0)));
}
function deleteOpname(id) {
    if (!opname.some(o => o.id === id) || !confirm("Hapus opname dan penyesuaian stoknya? Stok kembali seperti sebelum opname.")) return;
    const b = { op: opname, tx: transactions };
    opname = opname.filter(o => o.id !== id); transactions = transactions.filter(t => t.opnameId !== id);
    if (!save()) { opname = b.op; transactions = b.tx; return; }
    refreshAll(); showToast("Opname dihapus dan stok dikembalikan.");
}

/* ---------- Laporan bulanan ---------- */
const monthTx = m => transactions.filter(t => String(t.date || "").startsWith(m));
function renderReport() {
    const m = $("reportMonth").value || curMonth(), list = monthTx(m), s = summarize(list), max = Math.max(s.inQty, s.outQty, 1);
    Object.entries({ reportIncoming: fmt(s.inQty), reportOutgoing: fmt(s.outQty), reportReseller: fmt(s.rQty), reportPemakai: fmt(s.pQty), reportIncomingValue: rupiah(s.inValue), reportOutgoingValue: rupiah(s.revenue),
        reportProfit: rupiah(Math.max(s.net, 0)), reportLoss: rupiah(Math.max(-s.net, 0)), chartIncoming: fmt(s.inQty), chartOutgoing: fmt(s.outQty),
        reportInventoryValue: rupiah(products.reduce((a, p) => a + Math.max(0, productStock(p)) * modalOf(p), 0)) }).forEach(([id, v]) => setText(id, v));
    $("barIncoming").style.width = (s.inQty / max * 100) + "%"; $("barOutgoing").style.width = (s.outQty / max * 100) + "%";
    fillTable("reportTable", products.map(p => {
        const x = summarize(list.filter(t => t.productId === p.id)), ks = enabledVariants(p);
        return `<tr><td><strong>${esc(p.name)}</strong><small>${esc(p.code || "")}</small></td><td>${esc([...new Set(ks.map(k => materialLabel(p, k)))].join(", "))}</td>
            <td>${esc([...new Set(ks.map(genderOf))].join(", "))}</td><td>${fmt(x.inQty)}</td><td class="text-red">${fmt(x.outQty)}</td><td><strong>${fmt(Math.max(0, productStock(p)))}</strong></td>
            <td>${fmt(x.rQty)}</td><td>${fmt(x.pQty)}</td><td>${rupiah(x.rNet)}</td><td>${rupiah(x.pNet)}</td><td><strong>${rupiah(x.net)}</strong></td></tr>`;
    }), 11, "Belum ada barang.");
    const days = {};
    list.filter(t => !t.opnameId && findProduct(t.productId)).forEach(t => {
        const p = findProduct(t.productId), d = days[t.date] = days[t.date] || { i: 0, o: 0, iv: 0, ov: 0, net: 0 };
        if (t.type === "Masuk") { d.i += n(t.qty); d.iv += n(t.qty) * trxUnit(t, p); }
        else { d.o += n(t.qty); d.ov += n(t.qty) * trxUnit(t, p); d.net += n(t.qty) * trxUnit(t, p) - trxCost(t, p); }
    });
    fillTable("dailyReportTable", Object.keys(days).sort().map(k => `<tr><td><strong>${formatDate(k)}</strong></td><td>${fmt(days[k].i)}</td><td>${fmt(days[k].o)}</td><td>${rupiah(days[k].iv)}</td><td>${rupiah(days[k].ov)}</td><td><strong>${rupiah(days[k].net)}</strong></td></tr>`), 6, "Belum ada transaksi pada bulan ini.");
}
function exportCSV() {
    const m = $("reportMonth").value || curMonth(), rows = [["Tanggal", "Kode", "Barang", "Jenis Bahan", "Kelamin", "Ukuran", "Kategori", "Tipe", "Qty", "Harga", "Nilai", "Modal", "Bersih", "Keterangan"]];
    monthTx(m).filter(t => !t.opnameId).forEach(t => {
        const p = findProduct(t.productId), val = n(t.qty) * trxUnit(t, p), cost = trxCost(t, p);
        rows.push([t.date, p?.code || "-", p?.name || "-", materialLabel(p, t.variantKey), genderOf(t.variantKey), sizeText(t.size), t.category, t.type, t.qty, trxUnit(t, p), val, cost, t.type === "Keluar" ? val - cost : -cost, t.note || ""]);
    });
    download(`laporan-dshan-${m}.csv`, csvText(rows), "text/csv;charset=utf-8");
}

/* ---------- Pembukuan ---------- */
const bkMonth = () => $("bkMonthFilter").value || curMonth();
const bkLabel = m => { const [y, mo] = m.split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" }); };
function bkCalc(m) {
    const sales = monthTx(m).filter(t => t.type === "Keluar" && !t.opnameId && findProduct(t.productId));
    const r = { rev: 0, cogs: 0, qty: 0, res: 0, pem: 0, daily: {} };
    sales.forEach(t => {
        const p = findProduct(t.productId), v = n(t.qty) * trxUnit(t, p);
        r.rev += v; r.cogs += trxCost(t, p); r.qty += n(t.qty);
        if (t.category === "Reseller") r.res += v; if (t.category === "Pemakai") r.pem += v;
        const d = String(t.date).slice(-2); r.daily[d] = (r.daily[d] || 0) + v;
    });
    const prod = bk.production.filter(x => String(x.date).startsWith(m)), exp = bk.expenses.filter(x => String(x.date).startsWith(m));
    r.prodRows = prod; r.expRows = exp; r.prodQty = prod.reduce((a, x) => a + n(x.qty), 0); r.prodCost = prod.reduce((a, x) => a + n(x.totalCost), 0);
    r.expTotal = exp.reduce((a, x) => a + n(x.amount), 0); r.capital = n(bk.capital[m]);
    r.gross = r.rev - r.cogs; r.net = r.gross - r.expTotal; r.cash = r.capital + r.rev - r.expTotal - r.prodCost;
    return r;
}
function renderBookkeeping() {
    const m = bkMonth(), r = bkCalc(m), stockValue = products.reduce((a, p) => a + Math.max(0, productStock(p)) * modalOf(p), 0);
    $("bkCards").innerHTML = [["💰 Modal Awal", "bkSummaryModal", rupiah(r.capital), bkLabel(m)], ["👕 Produksi", "bkSummaryProduction", fmt(r.prodQty) + " pcs", "Modal " + rupiah(r.prodCost)], ["🛒 Omzet", "bkSummarySales", rupiah(r.rev), fmt(r.qty) + " pcs terjual"],
        ["📦 HPP Terjual", "bkSummaryCOGS", rupiah(r.cogs), "Modal barang terjual"], ["📈 Laba Kotor", "bkSummaryGross", rupiah(r.gross), "Omzet − HPP"], ["✨ Laba Bersih", "bkSummaryNet", rupiah(r.net), "Laba kotor − pengeluaran"]]
        .map(([l, id, v, note]) => `<div class="bk-stat-card"><span>${l}</span><strong id="${id}">${v}</strong><small>${note}</small></div>`).join("");
    $("bkReportGrid").innerHTML = [["Modal Awal", r.capital], ["Modal Produksi", r.prodCost], ["Omzet", r.rev], ["HPP Barang Terjual", r.cogs], ["Pengeluaran Lain", r.expTotal], ["Laba Bersih", r.net, "profit"], ["Saldo Kas Perkiraan", r.cash, "balance"], ["Nilai Stok Saat Ini", stockValue]]
        .map(([l, v, c]) => `<div${c ? ` class="${c}"` : ""}><span>${l}</span><strong>${rupiah(v)}</strong></div>`).join("");
    Object.entries({ bkModalHighlight: rupiah(r.capital), bkMiniProductionCost: rupiah(r.prodCost), bkMiniExpenses: rupiah(r.expTotal), bkMiniCash: rupiah(r.cash), bkResellerSales: rupiah(r.res), bkPemakaiSales: rupiah(r.pem), bkSalesQty: fmt(r.qty) + " pcs", bkNetHighlight: rupiah(r.net) }).forEach(([id, v]) => setText(id, v));
    const act = (e, d) => `<td><div class="action-buttons"><button class="icon-btn" onclick="${e}('')">✏️</button><button class="icon-btn danger" onclick="${d}('')">🗑️</button></div></td>`;
    fillTable("bkProductionTable", r.prodRows.map(x => `<tr><td>${esc(x.date)}</td><td><strong>${esc(x.name)}</strong></td><td>${fmt(x.qty)} pcs</td><td>${rupiah(x.unitCost)}</td><td><strong>${rupiah(x.totalCost)}</strong></td><td>${esc(x.note || "-")}</td>${act("bkEditProduction", "bkDeleteProduction").replaceAll("('')", `('${x.id}')`)}</tr>`), 7, "Belum ada data produksi pada bulan ini.");
    fillTable("bkExpenseTable", r.expRows.map(x => `<tr><td>${esc(x.date)}</td><td><strong>${esc(x.note)}</strong></td><td>${esc(x.category)}</td><td><strong>${rupiah(x.amount)}</strong></td>${act("bkEditExpense", "bkDeleteExpense").replaceAll("('')", `('${x.id}')`)}</tr>`), 5, "Belum ada pengeluaran pada bulan ini.");
    const days = Object.entries(r.daily).sort((a, b) => a[0] - b[0]), mx = Math.max(...days.map(d => d[1]), 1);
    $("bkDailyChart").innerHTML = days.length ? days.map(([d, v]) => `<div class="bk-bar-row"><span class="bk-bar-day">${d}</span><div class="bk-bar-track"><div class="bk-bar-fill" style="width:${Math.max(5, v / mx * 100)}%"></div></div><strong>${rupiah(v)}</strong></div>`).join("") : '<div class="bk-chart-empty">Belum ada penjualan pada bulan ini.</div>';
}
function bkCommit(modal) { if (save()) { closeModal(modal); refreshAll(); return true; } return false; }
function bkOpenModalForm() { $("bkModalMonth").value = bkMonth(); $("bkModalAmount").value = bk.capital[bkMonth()] || ""; openModal("bkModalForm"); }
function bkSaveModal(e) {
    e.preventDefault(); const m = $("bkModalMonth").value, old = bk.capital[m];
    bk.capital[m] = n($("bkModalAmount").value);
    if (!bkCommit("bkModalForm")) bk.capital[m] = old; else $("bkMonthFilter").value = m, renderBookkeeping();
}
function bkOpenProductionForm(x) {
    $("bkProductionFormElement").reset(); $("bkProductionId").value = x?.id || ""; $("bkProductionDate").value = x?.date || today(); $("bkProductionName").value = x?.name || "";
    $("bkProductionQty").value = x?.qty || ""; $("bkProductionUnitCost").value = x?.unitCost ?? ""; $("bkProductionNote").value = x?.note || "";
    setText("bkProductionTotalPreview", rupiah(x?.totalCost || 0)); openModal("bkProductionForm");
}
const bkEditProduction = id => bkOpenProductionForm(bk.production.find(x => x.id === id));
function bkSaveProduction(e) {
    e.preventDefault(); const id = $("bkProductionId").value, qty = n($("bkProductionQty").value), unitCost = n($("bkProductionUnitCost").value);
    if (qty <= 0) return showToast("Jumlah produksi harus lebih dari 0.", "error");
    const row = { id: id || uid(), date: $("bkProductionDate").value || today(), name: $("bkProductionName").value.trim(), qty, unitCost, totalCost: qty * unitCost, note: $("bkProductionNote").value.trim() };
    const backup = bk.production; bk.production = id ? bk.production.map(x => x.id === id ? row : x) : [...bk.production, row];
    if (!bkCommit("bkProductionForm")) bk.production = backup;
}
function bkDeleteProduction(id) {
    if (!confirm("Hapus data produksi ini?")) return;
    const b = bk.production; bk.production = b.filter(x => x.id !== id); if (!save()) bk.production = b; else refreshAll();
}
function bkOpenExpenseForm(x) {
    $("bkExpenseFormElement").reset(); $("bkExpenseId").value = x?.id || ""; $("bkExpenseDate").value = x?.date || today(); $("bkExpenseNote").value = x?.note || "";
    $("bkExpenseCategory").value = x?.category || "Operasional"; $("bkExpenseAmount").value = x?.amount || ""; openModal("bkExpenseForm");
}
const bkEditExpense = id => bkOpenExpenseForm(bk.expenses.find(x => x.id === id));
function bkSaveExpense(e) {
    e.preventDefault(); const id = $("bkExpenseId").value, amount = n($("bkExpenseAmount").value);
    if (amount <= 0) return showToast("Jumlah pengeluaran harus lebih dari 0.", "error");
    const row = { id: id || uid(), date: $("bkExpenseDate").value || today(), note: $("bkExpenseNote").value.trim(), category: $("bkExpenseCategory").value, amount };
    const backup = bk.expenses; bk.expenses = id ? bk.expenses.map(x => x.id === id ? row : x) : [...bk.expenses, row];
    if (!bkCommit("bkExpenseForm")) bk.expenses = backup;
}
function bkDeleteExpense(id) {
    if (!confirm("Hapus pengeluaran ini?")) return;
    const b = bk.expenses; bk.expenses = b.filter(x => x.id !== id); if (!save()) bk.expenses = b; else refreshAll();
}
function bkExportCSV() {
    const m = bkMonth(), r = bkCalc(m);
    const rows = [["LAPORAN PEMBUKUAN DSHAN", bkLabel(m)], [], ["RINGKASAN", "NILAI"], ["Modal Awal", r.capital], ["Modal Produksi", r.prodCost], ["Omzet", r.rev], ["HPP Barang Terjual", r.cogs], ["Pengeluaran Lain", r.expTotal], ["Laba Bersih", r.net], ["Saldo Kas Perkiraan", r.cash], [],
        ["PRODUKSI"], ["Tanggal", "Jenis Barang", "Jumlah", "Modal/Baju", "Total Modal", "Keterangan"], ...r.prodRows.map(x => [x.date, x.name, x.qty, x.unitCost, x.totalCost, x.note || ""]), [],
        ["PENGELUARAN"], ["Tanggal", "Keterangan", "Kategori", "Jumlah"], ...r.expRows.map(x => [x.date, x.note, x.category, x.amount])];
    download(`laporan-pembukuan-dshan-${m}.csv`, csvText(rows), "text/csv;charset=utf-8");
}
function bkPrint() {
    const m = bkMonth(), r = bkCalc(m), w = window.open("", "_blank", "width=1000,height=800");
    if (!w) return showToast("Popup diblokir browser. Izinkan popup untuk mencetak.", "error");
    const box = (l, v) => `<div class="box">${l}<b>${rupiah(v)}</b></div>`;
    w.document.write(`<!doctype html><html><head><title>Laporan DSHAN</title><style>body{font-family:Arial,sans-serif;padding:30px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:8px;text-align:left}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.box{border:1px solid #ddd;padding:12px;border-radius:8px}.box b{display:block;font-size:18px;margin-top:4px}</style></head><body>
        <h1>DSHAN — Laporan Pembukuan</h1><p>Periode: ${esc(bkLabel(m))}</p><div class="grid">${box("Modal Awal", r.capital)}${box("Modal Produksi", r.prodCost)}${box("Omzet", r.rev)}${box("HPP Terjual", r.cogs)}${box("Pengeluaran", r.expTotal)}${box("Laba Bersih", r.net)}${box("Saldo Kas Perkiraan", r.cash)}</div>
        <h2>Produksi</h2><table><tr><th>Tanggal</th><th>Jenis Barang</th><th>Qty</th><th>Modal/Baju</th><th>Total</th></tr>${r.prodRows.map(x => `<tr><td>${esc(x.date)}</td><td>${esc(x.name)}</td><td>${x.qty}</td><td>${rupiah(x.unitCost)}</td><td>${rupiah(x.totalCost)}</td></tr>`).join("") || '<tr><td colspan="5">Tidak ada data</td></tr>'}</table>
        <script>window.onload=()=>window.print();<\/script></body></html>`);
    w.document.close();
}

/* ---------- Backup, restore, reset ---------- */
function bkBackup() {
    download(`backup-dshan-${today()}.json`, JSON.stringify({ app: "DSHAN", version: 2, exportedAt: new Date().toISOString(), dshan: { products, transactions, opname, orders }, bookkeeping: bk }, null, 2), "application/json");
}
function bkRestore(input) {
    const file = input.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
        try {
            const d = JSON.parse(r.result);
            if (d?.app !== "DSHAN" || !Array.isArray(d.dshan?.products)) return showToast("File backup DSHAN tidak valid.", "error");
            if (!confirm("Restore akan mengganti SEMUA data saat ini (stok, pesanan, pembukuan). Lanjutkan?")) return;
            const prev = { products, transactions, opname, orders, bk };
            products = d.dshan.products; transactions = d.dshan.transactions || []; opname = d.dshan.opname || []; orders = d.dshan.orders || orders; bk = d.bookkeeping || {};
            normalize();
            if (!save()) { ({ products, transactions, opname, orders, bk } = prev); return; }
            refreshAll(); showToast("Backup berhasil dipulihkan.");
        } catch { showToast("File backup tidak dapat dibaca.", "error"); }
        finally { input.value = ""; }
    };
    r.readAsText(file);
}
function resetAllData() {
    const cloud = Boolean(window.DSHAN_CLOUD?.url);
    if (!confirm(`PERINGATAN! Semua barang, transaksi, opname, dan pesanan akan dihapus.${cloud ? " Data di cloud juga ikut terhapus untuk semua pengguna." : ""} Lanjutkan?`)) return;
    const prev = { products, transactions, opname, orders };
    products = []; transactions = []; opname = []; orders = [];
    if (!save()) { ({ products, transactions, opname, orders } = prev); return; }
    refreshAll(); showToast("Semua data dihapus.");
}

/* ---------- Muat ulang tampilan & inisialisasi ---------- */
function refreshAll() {
    renderDashboard(); renderStock(); renderTransactions(); renderOrders(); if (typeof renderDebts === "function") renderDebts(); renderOpname(); renderReport(); renderBookkeeping();
}
function init() {
    buildCards();
    setText("todayText", new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
    $("reportMonth").value = curMonth(); $("bkMonthFilter").value = curMonth();
    document.querySelectorAll(".modal-overlay").forEach(m => m.addEventListener("mousedown", e => { if (e.target === m && !m.dataset.lock) closeModal(m.id); }));
    document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
    const txSync = e => syncTx(e.target.id === "transactionProduct" ? "prod" : "var");
    $("transactionForm").addEventListener("change", txSync); $("transactionForm").addEventListener("input", txSync);
    const opSync = e => syncOp(e.target.id === "opnameProduct" ? "prod" : "var");
    $("opnameForm").addEventListener("change", opSync); $("opnameForm").addEventListener("input", opSync);
    $("bulkProductRows").addEventListener("change", e => { const r = e.target.closest("tr"); if (r) updateBulkRow(r); });
    $("variantEditor").addEventListener("change", onEditorChange); $("variantEditor").addEventListener("click", onEditorClick);
    $("productPhoto").addEventListener("change", async e => { const f = e.target.files?.[0]; if (f) $("productPhotoPreview").innerHTML = `<img src="${esc(await compressImage(f))}" alt="preview">`; });
    ["bkProductionQty", "bkProductionUnitCost"].forEach(id => $(id).addEventListener("input", () => setText("bkProductionTotalPreview", rupiah(n($("bkProductionQty").value) * n($("bkProductionUnitCost").value)))));
    showPage("dashboard");
    restoreMaster().catch(() => { }).finally(() => { refreshAll(); window.__readyResolve(); });
}
document.addEventListener("DOMContentLoaded", init);
