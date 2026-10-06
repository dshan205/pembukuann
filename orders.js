"use strict";
/* =========================================================
   Modul Pesanan: Dikemas -> Dikirim -> Selesai
   Stok otomatis berkurang saat pesanan dicatat (transaksi Keluar
   bertanda orderId), jadi status langsung "Dikemas" dan pengguna
   tinggal menekan Kirim lalu Selesai.
   Ubah ke false untuk kembali ke cara lama (stok berkurang saat Dikirim).
========================================================= */
const DEDUCT_ON_CREATE = true;
const ORDER_FLOW = ["Diterima", "Dikemas", "Dikirim", "Selesai"];
const NEXT_LABEL = { Diterima: "Kemas", Dikemas: "Kirim", Dikirim: "Selesai" };

const orderTotal = o => o.items.reduce((s, i) => {
    const p = findProduct(i.productId);
    return s + (p ? i.qty * unitPriceFor(p, "Keluar", o.category) : 0);
}, 0);
function orderItemText(i) {
    const p = findProduct(i.productId);
    return p ? `${p.name} • ${variantText(p, i.variantKey)} • ${sizeText(i.size)} x${i.qty}` : "Barang dihapus";
}
function waLink(o) {
    let phone = String(o.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "62" + phone.slice(1);
    const text = `Halo ${o.customer}, pesanan Anda:\n`
        + o.items.map(i => "- " + orderItemText(i)).join("\n")
        + `\nTotal: ${rupiah(orderTotal(o))}\nStatus: ${o.status}` + "";
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/* ---------- Stok pesanan ---------- */
function orderStockProblem(o) {
    const need = {}; // gabungkan jumlah per barang+varian+ukuran sebelum dicek
    o.items.forEach(i => { const k = [i.productId, i.variantKey, i.size].join("|"); need[k] = (need[k] || 0) + i.qty; });
    for (const k in need) {
        const [pid, vk, sz] = k.split("|"), p = findProduct(pid), have = p ? stock(p, vk, sz) : 0;
        if (!p || need[k] > have)
            return `Stok tidak cukup: ${p ? variantText(p, vk) + " " + sizeText(sz) : "barang dihapus"} (butuh ${need[k]}, ada ${have}).`;
    }
    return "";
}
function postOrderTx(o) {
    o.items.forEach(i => {
        const p = findProduct(i.productId), price = unitPriceFor(p, "Keluar", o.category);
        transactions.push({
            id: uid(), date: today(), productId: p.id, type: "Keluar", category: o.category, size: i.size, qty: i.qty,
            variantKey: i.variantKey, gender: genderOf(i.variantKey), garmentType: partOf(i.variantKey),
            unitPrice: price, modalPrice: p.initialCost, totalValue: i.qty * price,
            note: `Pesanan ${o.customer}`, orderId: o.id, createdAt: new Date().toISOString()
        });
    });
}
/* Pesanan otomatis dari transaksi Keluar di Data Stok/Transaksi (stok sudah berkurang oleh transaksi itu). */
function orderFromSale(t, customer, phone, unpaid) {
    return {
        id: uid(), date: t.date, customer: customer || "Pelanggan", phone: phone || "", category: t.category,
        items: [{ productId: t.productId, variantKey: t.variantKey, size: t.size, qty: t.qty }],
        status: "Dikemas", resi: "", paid: !unpaid, note: t.note || "", createdAt: t.createdAt
    };
}
const isDebt = o => o.paid === false && o.status !== "Batal"; // pesanan lama tanpa data bayar dianggap lunas
const paidFromForm = id => $(id) && $(id).value === "Belum";
const orderHasTx = id => transactions.some(t => t.orderId === id);

/* ---------- Form pesanan ---------- */
function openOrderModal() {
    $("orderForm").reset();
    $("orderItems").innerHTML = "";
    addOrderItem();
    openModal("orderModal");
}
function addOrderItem() {
    const row = document.createElement("div");
    row.className = "order-item";
    row.innerHTML = `<select class="o-prod"></select><select class="o-var"></select><select class="o-size"></select>
        <input type="number" class="o-qty" min="1" value="1"><button type="button" class="remove-row" onclick="this.parentElement.remove()">×</button>`;
    fillProductSelect(row.querySelector(".o-prod"));
    $("orderItems").appendChild(row);
    syncOrderRow(row, "prod");
}
function syncOrderRow(row, from) {
    const p = findProduct(row.querySelector(".o-prod").value);
    const v = row.querySelector(".o-var"), s = row.querySelector(".o-size");
    if (from === "prod") fillVariantSelect(v, p);
    fillSizeSelect(s, p, v.value, s.value);
}
$("orderItems").addEventListener("change", e => {
    if (e.target.matches(".o-prod, .o-var")) syncOrderRow(e.target.closest(".order-item"), e.target.matches(".o-prod") ? "prod" : "var");
});

function saveOrder(event) {
    event.preventDefault();
    const items = [...document.querySelectorAll("#orderItems .order-item")].map(r => ({
        productId: r.querySelector(".o-prod").value, variantKey: r.querySelector(".o-var").value,
        size: r.querySelector(".o-size").value, qty: n(r.querySelector(".o-qty").value)
    })).filter(i => i.productId);
    if (!items.length) return showToast("Tambahkan minimal satu barang.", "error");
    if (items.some(i => !i.variantKey || !i.size || i.qty <= 0)) return showToast("Lengkapi varian, ukuran, dan jumlah.", "error");
    const order = {
        id: uid(), date: today(), customer: $("orderCustomer").value.trim(), phone: $("orderPhone").value.trim(),
        category: $("orderCategory").value, items, status: DEDUCT_ON_CREATE ? "Dikemas" : "Diterima", resi: "", paid: !paidFromForm("orderPaid"), note: $("orderNote").value.trim(),
        createdAt: new Date().toISOString()
    };
    const txLen = transactions.length;
    if (DEDUCT_ON_CREATE) {
        const problem = orderStockProblem(order);
        if (problem) return showToast(problem, "error");
        postOrderTx(order);
    }
    orders.push(order);
    if (!save()) { orders.pop(); transactions.length = txLen; return; }
    closeModal("orderModal");
    refreshAll();
    showToast(DEDUCT_ON_CREATE ? "Pesanan dicatat, stok sudah dikurangi. Tinggal tekan Kirim." : "Pesanan dicatat.");
}

/* ---------- Alur status ---------- */
function advanceOrder(id) {
    try { advanceOrderRun(id); }
    catch (e) { console.error(e); showToast("Status pesanan gagal diubah: " + e.message, "error"); }
}
function advanceOrderRun(id) {
    const o = orders.find(x => x.id === id);
    const next = o && ORDER_FLOW[ORDER_FLOW.indexOf(o.status) + 1];
    if (!next) return;
    const prev = { status: o.status, txLen: transactions.length };
    if (next === "Dikirim") {
        const posted = orderHasTx(o.id); // pesanan baru: stok sudah dikurangi saat dicatat
        if (!posted) {
            const problem = orderStockProblem(o);
            if (problem) return showToast(problem, "error");
            postOrderTx(o);
        }
    }
    o.status = next;
    if (!save()) { o.status = prev.status; transactions.length = prev.txLen; return; }
    refreshAll();
    showToast(`Status pesanan: ${next}.`);
}
function cancelOrder(id) {
    const o = orders.find(x => x.id === id);
    if (!o || !confirm("Batalkan pesanan ini? Stok yang sudah keluar dikembalikan.")) return;
    const backup = { tx: transactions, status: o.status };
    transactions = transactions.filter(t => t.orderId !== id);
    o.status = "Batal";
    if (!save()) { transactions = backup.tx; o.status = backup.status; return; }
    refreshAll();
    showToast("Pesanan dibatalkan.");
}

/* ---------- Tampilan ---------- */
function renderOrders() {
    const f = $("orderStatusFilter").value;
    const list = orders.filter(o => !f || o.status === f).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    fillTable("orderTable", list.map(o => {
        const open = o.status !== "Selesai" && o.status !== "Batal";
        return `<tr><td>${formatDate(o.date)}</td>
            <td><strong>${esc(o.customer)}</strong><small>${esc(o.phone)}</small></td>
            <td>${o.items.map(i => esc(orderItemText(i))).join("<br>")}</td>
            <td><span class="badge ${o.category.toLowerCase()}">${o.category}</span></td>
            <td>${rupiah(orderTotal(o))}</td>
            <td><span class="status-pill s-${o.status.toLowerCase()}">${o.status}</span>${isDebt(o) ? '<small class="debt-flag">Belum bayar</small>' : ""}</td>
            <td><div class="action-buttons">
                ${NEXT_LABEL[o.status] ? `<button class="small-btn" onclick="advanceOrder('${o.id}')">${NEXT_LABEL[o.status]}</button>` : ""}
                ${isDebt(o) ? `<button class="small-btn" onclick="payDebt('${o.id}')">Bayar</button>` : ""}
                ${o.phone ? `<a class="small-btn" target="_blank" rel="noopener" href="${waLink(o)}">WA</a>` : ""}
                ${open ? `<button class="small-btn danger-btn" onclick="cancelOrder('${o.id}')">Batal</button>` : ""}
            </div></td></tr>`;
    }), 7, "Belum ada pesanan.");
    ["Diterima", "Dikemas", "Dikirim"].forEach(s => setText("q" + s, orders.filter(o => o.status === s).length));
}

/* =========================================================
   Hutang: pesanan dengan paid === false. Tombol "Selesai Membayar"
   menandai lunas, dan namanya hilang dari daftar.
========================================================= */
const debtList = () => orders.filter(isDebt).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
function debtLink(o) {
    let phone = String(o.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "62" + phone.slice(1);
    const text = `Halo ${o.customer}, mengingatkan pembayaran pesanan:\n` + o.items.map(i => "- " + orderItemText(i)).join("\n") + `\nTotal: ${rupiah(orderTotal(o))}\nTerima kasih.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
function payDebt(id) {
    const o = orders.find(x => x.id === id);
    if (!o || !isDebt(o) || !confirm(`Tandai pesanan ${o.customer} sebagai sudah dibayar?`)) return;
    o.paid = true; o.paidAt = new Date().toISOString();
    if (!save()) { o.paid = false; delete o.paidAt; return; }
    refreshAll();
    showToast(`${o.customer} sudah membayar. Dihapus dari daftar hutang.`);
}
/* ---------- Catat hutang langsung (terpisah dari stok/pesanan) ---------- */
const manualDebts = () => (bk.debts || []).filter(d => !d.paid);
function openDebtModal() {
    $("debtForm").reset(); $("debtDate").value = today();
    openModal("debtModal"); setTimeout(() => $("debtCustomer").focus(), 50);
}
function saveDebt(event) {
    event.preventDefault();
    const customer = $("debtCustomer").value.trim(), amount = n($("debtAmount").value);
    if (!customer) return showToast("Isi nama pelanggan.", "error");
    if (amount <= 0) return showToast("Jumlah hutang harus lebih dari 0.", "error");
    const backup = bk.debts || [];
    bk.debts = [...backup, { id: uid(), date: $("debtDate").value || today(), customer, phone: $("debtPhone").value.trim(), amount, note: $("debtNote").value.trim(), paid: false, createdAt: new Date().toISOString() }];
    if (!save()) { bk.debts = backup; return; }
    closeModal("debtModal"); refreshAll();
    showToast(`Hutang ${customer} dicatat.`);
}
function payManualDebt(id) {
    const d = (bk.debts || []).find(x => x.id === id);
    if (!d || d.paid || !confirm(`Tandai hutang ${d.customer} sebagai sudah dibayar?`)) return;
    d.paid = true; d.paidAt = new Date().toISOString();
    if (!save()) { d.paid = false; delete d.paidAt; return; }
    refreshAll();
    showToast(`${d.customer} sudah membayar. Dihapus dari daftar hutang.`);
}
function deleteManualDebt(id) {
    const d = (bk.debts || []).find(x => x.id === id);
    if (!d || !confirm(`Hapus catatan hutang ${d.customer}? (Gunakan ini bila salah input.)`)) return;
    const backup = bk.debts; bk.debts = backup.filter(x => x.id !== id);
    if (!save()) { bk.debts = backup; return; }
    refreshAll();
    showToast("Catatan hutang dihapus.");
}
function manualDebtLink(d) {
    let phone = String(d.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "62" + phone.slice(1);
    const text = `Halo ${d.customer}, mengingatkan pembayaran sebesar ${rupiah(d.amount)}${d.note ? " (" + d.note + ")" : ""}. Terima kasih.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
function renderDebts() {
    if (!$("debtTable")) return;
    const rows = [
        ...debtList().map(o => ({ date: o.date, at: o.createdAt, name: o.customer, total: orderTotal(o), html: `<tr><td>${formatDate(o.date)}</td>
            <td><strong>${esc(o.customer)}</strong><small>${esc(o.phone)}</small></td>
            <td>${o.items.map(i => esc(orderItemText(i))).join("<br>")}</td>
            <td><strong>${rupiah(orderTotal(o))}</strong></td>
            <td><span class="status-pill s-${o.status.toLowerCase()}">${o.status}</span></td>
            <td><div class="action-buttons"><button class="small-btn" onclick="payDebt('${o.id}')">Selesai Membayar</button>
                ${o.phone ? `<a class="small-btn" target="_blank" rel="noopener" href="${debtLink(o)}">Tagih WA</a>` : ""}</div></td></tr>` })),
        ...manualDebts().map(d => ({ date: d.date, at: d.createdAt, name: d.customer, total: n(d.amount), html: `<tr><td>${formatDate(d.date)}</td>
            <td><strong>${esc(d.customer)}</strong><small>${esc(d.phone)}</small></td>
            <td>${esc(d.note || "-")}</td>
            <td><strong>${rupiah(d.amount)}</strong></td>
            <td><span class="status-pill">Catatan hutang</span></td>
            <td><div class="action-buttons"><button class="small-btn" onclick="payManualDebt('${d.id}')">Selesai Membayar</button>
                ${d.phone ? `<a class="small-btn" target="_blank" rel="noopener" href="${manualDebtLink(d)}">Tagih WA</a>` : ""}
                <button class="small-btn danger-btn" onclick="deleteManualDebt('${d.id}')">Hapus</button></div></td></tr>` }))
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at).localeCompare(String(b.at)));
    fillTable("debtTable", rows.map(r => r.html), 6, "Tidak ada hutang. Semua sudah lunas.");
    setText("debtTotal", rupiah(rows.reduce((s, r) => s + r.total, 0)));
    setText("debtCount", String(new Set(rows.map(r => r.name.trim().toLowerCase())).size));
}
