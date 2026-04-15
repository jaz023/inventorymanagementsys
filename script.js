/* =========================
   ✅ 設定：改成你的 GAS Web App URL（/exec）
========================= */
const API_BASE = "https://script.google.com/macros/s/AKfycbwSoD1JFU2oPlICj4MmmoU39gafORQv5cXzJR0JVHq97c_dcV13QZH9PlbyacK1oV_F/exec";

/* =========================
   7日間ログ（localStorage）
========================= */
function pad2(n) {
  return String(n).padStart(2, "0");
}

function getNowTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchHomeLogs() {
  const res = await fetch(`${API_BASE}?action=logs&_t=${Date.now()}`, {
    cache: "no-store"
  });

  const text = await res.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("logs 回傳不是 JSON");
  }

  if (!data || data.status !== "ok") {
    throw new Error("讀取 logs 失敗");
  }

  return Array.isArray(data.logs) ? data.logs : [];
}

async function renderHomeLogs() {
  const tbody = document.getElementById("homeLogBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6">讀取中...</td>
    </tr>
  `;

  try {
    const logs = await fetchHomeLogs();

    if (!logs.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; color:#666;">
            直近7日間の出入庫記録はありません
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${escapeHtml(l.timeText)}</td>
        <td>${escapeHtml(l.type)}</td>
        <td>${escapeHtml(l.productName)}</td>
        <td>${escapeHtml(l.qty)}</td>
        <td>${escapeHtml(l.reason)}</td>
        <td>${escapeHtml(l.operator)}</td>
      </tr>
    `).join("");

  } catch (e) {
    console.error("logs error:", e);
    tbody.innerHTML = `
      <tr>
        <td colspan="6">讀取失敗</td>
      </tr>
    `;
  }
}

/* =========================
   helper: setText / setValue
========================= */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "");
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = String(val ?? "");
}

/* =========================
   ホーム統計：品目數 / 總數量
========================= */
async function refreshHomeStats() {
  try {
    const res = await fetch(`${API_BASE}?action=stats`, {
      cache: "no-store"
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("stats 回傳不是 JSON");
    }

    if (data && typeof data.itemCount === "number") {
      setText("itemCount", data.itemCount);
    } else {
      setText("itemCount", "-");
    }

    if (data && typeof data.totalStock === "number") {
      setText("totalStock", data.totalStock);
    } else {
      setText("totalStock", "-");
    }
  } catch (e) {
    console.warn("refreshHomeStats failed", e);
    setText("itemCount", "-");
    setText("totalStock", "-");
  }
}

/* =========================
   頁面切換 + 停相機
========================= */
function setActivePage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(pageId);
  if (el) el.classList.add("active");
}

async function showPage(pageId) {
  setActivePage(pageId);
  await stopAllCameras();

  refreshInConfirmState();
  refreshOutConfirmState();

  if (pageId === "home") {
  await refreshHomeStats();
  await renderHomeLogs();
}

  if (pageId === "sidTracker") {
    clearSidResult(false);
  }
}

/* =========================
   顯示訊息
========================= */
function showMessage(message, success = true) {
  const noteLog = document.getElementById("noteLog");
  if (!noteLog) return;
  noteLog.innerHTML = `<p style="color:${success ? "green" : "red"};">${escapeHtml(message)}</p>`;
}

function showOutMessage(message, success = true) {
  const outNoteLog = document.getElementById("outNoteLog");
  if (!outNoteLog) return;
  outNoteLog.innerHTML = `<p style="color:${success ? "green" : "red"};">${escapeHtml(message)}</p>`;
}

function showSidMessage(message, success = true) {
  const el = document.getElementById("sidQueryMessage");
  if (!el) return;

  if (!message) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `<p style="color:${success ? "green" : "red"};">${escapeHtml(message)}</p>`;
}

/* =========================
   QR 解析
========================= */
function parseQrText(rawText) {
  const raw = String(rawText || "").trim();
  const obj = { _raw: raw };
  if (!raw) return obj;

  if (raw.includes("=") && raw.includes("|")) {
    raw.split("|").forEach(part => {
      const p = part.trim();
      const idx = p.indexOf("=");
      if (idx === -1) return;
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      if (k) obj[k] = v;
    });
  }

  return obj;
}

function pickQrValue(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

function normalizeQrFields(qr) {
  return {
    no: pickQrValue(qr, ["NO", "NO.", "No", "no"]),
    category: pickQrValue(qr, ["CAT", "CATEGORY", "Category"]),
    nameJP: pickQrValue(qr, ["JP", "NAME", "PartsName JP"]),
    seiban: pickQrValue(qr, ["SEIBAN", "製番"]),
    model: pickQrValue(qr, ["MDL", "MODEL", "Model"]),
    drawing: pickQrValue(qr, ["DRW", "DRAWING", "Drawing NO.", "Drawing NO", "DrawingNO"]),
    tana: pickQrValue(qr, ["TANA", "棚", "保管棚"]),
    sid: pickQrValue(qr, ["SID", "SN", "Serial"])
  };
}

function standardizeCode(qrObjOrRaw) {
  if (!qrObjOrRaw) return "";
  if (typeof qrObjOrRaw === "string") return qrObjOrRaw.trim().toUpperCase();

  const o = qrObjOrRaw;
  const candidate =
    o["DRW"] ||
    o["DRAWING"] ||
    o["Drawing NO."] ||
    o["DrawingNO"] ||
    o["Drawing NO"] ||
    o["Drawing_No"] ||
    o["code"] ||
    o["Code"] ||
    o["NO"] ||
    o["_raw"];

  return String(candidate || "").trim().toUpperCase();
}

/* =========================
   後端同步：Operators（下拉）
========================= */
async function loadOperatorsTo(elId) {
  const el = document.getElementById(elId);
  if (!el || el.tagName !== "SELECT") return;

  try {
    const res = await fetch(`${API_BASE}?action=operators`, {
      cache: "no-store"
    });

    const text = await res.text();
    let ops;
    try {
      ops = JSON.parse(text);
    } catch {
      throw new Error("operators 回傳不是 JSON");
    }

    if (!Array.isArray(ops)) return;

    const current = el.value;
    el.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "選択してください";
    el.appendChild(opt0);

    ops.forEach(name => {
      const op = document.createElement("option");
      op.value = String(name);
      op.textContent = String(name);
      el.appendChild(op);
    });

    if (current) el.value = current;
  } catch (e) {
    console.warn("loadOperators failed", e);
  }
}

/* =========================
   後端同步：Inventory（單筆）
========================= */
async function fetchInventoryItem(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;

  const url = `${API_BASE}?action=item&code=${encodeURIComponent(c)}`;
  const res = await fetch(url, { cache: "no-store" });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error("[fetchInventoryItem] Non-JSON response:", {
      status: res.status,
      url,
      text: text.slice(0, 300)
    });
    throw new Error("後端回傳不是 JSON（請檢查 GAS WebApp 部署/權限/URL）");
  }

  if (!data || Object.keys(data).length === 0) return null;

  return {
    code: String(data["Drawing NO."] || data.code || c).toUpperCase(),
    nameJP: data["PartsName JP"] || "",
    nameEN: data["PartsName EN"] || "",
    category: data["StokeCategory"] || "",
    model: data["Model"] || "",
    tana: data["Tana"] || data["保管棚"] || "",
    stock: Number(data["Stock"] || 0)
  };
}

/* =========================
   掃描暫存
========================= */
let currentIn = null;
let currentOut = null;

/* =========================
   入庫：掃描成功
========================= */
async function onScanInSuccess(decodedText) {
  const qrRaw = parseQrText(decodedText);
  const q = normalizeQrFields(qrRaw);
  const code = String(q.drawing || standardizeCode(qrRaw) || "").trim().toUpperCase();

  if (!code) {
    showMessage("QRCode 內容無法識別（缺少 DRW / Drawing NO.）", false);
    return;
  }

  setText("scanResult", code);
  setText("scanSidIn", q.sid || "-");
  showMessage("照合中...（Inventory 取得中）", true);

  let item = null;
  try {
    item = await fetchInventoryItem(code);
  } catch (e) {
    console.error(e);
    showMessage(`❌ Inventory 取得失敗：${e.message || e}`, false);

    currentIn = {
      code,
      no: q.no,
      category: q.category,
      nameJP: q.nameJP,
      nameEN: q.seiban,
      model: q.model,
      drawing: q.drawing,
      tana: q.tana,
      sid: q.sid,
      stock: 0
    };

    const itemInfo = document.getElementById("itemInfo");
    const newForm = document.getElementById("newItemForm");
    if (itemInfo) itemInfo.style.display = "none";
    if (newForm) newForm.style.display = "block";

    setValue("newItemCode", code);
    setValue("newItemName", q.nameJP);
    setValue("newItemCategory", q.category);
    setValue("newItemTana", q.tana);
    setValue("newItemQty", 1);

    refreshInConfirmState();
    return;
  }

  if (item) {
    currentIn = {
      code,
      no: q.no,
      category: q.category || item.category,
      nameJP: q.nameJP || item.nameJP,
      nameEN: q.seiban || item.nameEN,
      model: q.model || item.model,
      drawing: q.drawing || item.code,
      tana: q.tana || item.tana || "",
      sid: q.sid,
      stock: item.stock
    };

    const itemInfo = document.getElementById("itemInfo");
    const newForm = document.getElementById("newItemForm");
    if (itemInfo) itemInfo.style.display = "block";
    if (newForm) newForm.style.display = "none";

    setText("itemName", currentIn.nameJP || code);
    setValue("editCategoryIn", currentIn.category || "");
    setValue("editTanaIn", currentIn.tana || "");
    setText("itemStock", item.stock);
    setValue("editStockIn", item.stock);

    showMessage("✅ 入庫対象を取得しました。QR資訊已自動帶入。", true);
  } else {
    currentIn = {
      code,
      no: q.no,
      category: q.category,
      nameJP: q.nameJP,
      nameEN: q.seiban,
      model: q.model,
      drawing: q.drawing,
      tana: q.tana,
      sid: q.sid,
      stock: 0
    };

    const itemInfo = document.getElementById("itemInfo");
    const newForm = document.getElementById("newItemForm");
    if (itemInfo) itemInfo.style.display = "none";
    if (newForm) newForm.style.display = "block";

    setValue("newItemCode", code);
    setValue("newItemName", q.nameJP);
    setValue("newItemCategory", q.category);
    setValue("newItemTana", q.tana);
    setValue("newItemQty", 1);

    showMessage("🆕 Inventory に存在しない新品です。QR資訊已自動帶入。", true);
  }

  refreshInConfirmState();
}

/* =========================
   出庫：掃描成功
========================= */
async function onScanOutSuccess(decodedText) {
  const qrRaw = parseQrText(decodedText);
  const q = normalizeQrFields(qrRaw);
  const code = String(q.drawing || standardizeCode(qrRaw) || "").trim().toUpperCase();

  if (!code) {
    showOutMessage("QRCode 內容無法識別（缺少 DRW / Drawing NO.）", false);
    return;
  }

  setText("scanOutResult", code);
  setText("scanSidOut", q.sid || "-");
  showOutMessage("照合中...（Inventory 取得中）", true);

  let item = null;
  try {
    item = await fetchInventoryItem(code);
  } catch (e) {
    console.error(e);
    showOutMessage(`❌ Inventory 取得失敗：${e.message || e}`, false);
    refreshOutConfirmState();
    return;
  }

  if (!item) {
    currentOut = null;
    const outInfo = document.getElementById("outItemInfo");
    if (outInfo) outInfo.style.display = "none";
    showOutMessage("❌ Inventory に存在しません（出庫不可）", false);
    refreshOutConfirmState();
    return;
  }

  currentOut = {
    code,
    no: q.no,
    category: q.category || item.category,
    nameJP: q.nameJP || item.nameJP,
    nameEN: q.seiban || item.nameEN,
    model: q.model || item.model,
    drawing: q.drawing || item.code,
    tana: q.tana || item.tana || "",
    sid: q.sid,
    stock: item.stock
  };

  const outInfo = document.getElementById("outItemInfo");
  if (outInfo) outInfo.style.display = "block";

  setText("outItemName", currentOut.nameJP || code);
  setValue("editCategoryOut", currentOut.category || "");
  setValue("editTanaOut", currentOut.tana || "");
  setText("outItemStock", item.stock);
  setValue("editStockOut", item.stock);

  showOutMessage("✅ 出庫対象を取得しました。QR資訊已自動帶入。", true);

  setTimeout(() => document.getElementById("stockOutQty")?.focus(), 200);
  refreshOutConfirmState();
}

function cancelNewItem() {
  const newForm = document.getElementById("newItemForm");
  if (newForm) newForm.style.display = "none";

  setText("scanResult", "なし");
  setValue("newItemCode", "");
  setValue("newItemName", "");
  setValue("newItemCategory", "");
  setValue("newItemTana", "");
  setValue("newItemQty", 1);
  setValue("newItemNote", "");

  currentIn = null;
  refreshInConfirmState();
}

/* =========================
   ✅ 入庫確定（既存品）
========================= */
async function addStock() {
  if (!currentIn || !currentIn.code) {
    alert("先にQRコードをスキャンしてください（既存品）。新品は『新增備品並入庫』を使用してください。");
    return;
  }

  if (!currentIn.sid) {
    alert("このQRコードはシリアル番号がありませんので、入荷しないでください。");
    return;
  }

  const qty = Number(document.getElementById("stockInQty")?.value || 0);
  const reason = String(document.getElementById("stockInNote")?.value || "").trim();
  const operator = getOperatorValue("operatorIn");

  if (!operator) {
    alert("請輸入/選擇 入庫人員名稱");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    alert("入庫數量必須 >= 1");
    return;
  }

  const payload = {
    type: "入庫",
    code: currentIn.drawing || currentIn.code,
    no: currentIn.no || "",
    category: String(document.getElementById("editCategoryIn")?.value || currentIn.category || "").trim(),
    tana: String(document.getElementById("editTanaIn")?.value || currentIn.tana || "").trim(),
    serialNo: currentIn.sid || "",
    nameJP: currentIn.nameJP || "",
    nameEN: currentIn.nameEN || "",
    model: currentIn.model || "",
    quantity: qty,
    operator,
    reason
  };

  disableInConfirm(true);

  try {
    const res = await postForm_(API_BASE, payload);
    if (res.status !== "ok") throw new Error(res.message || "入庫失敗");

    if (typeof res.stock === "number") {
      setText("itemStock", res.stock);
      setValue("editStockIn", res.stock);
      currentIn.stock = res.stock;
    }

    await refreshHomeStats();
    await renderHomeLogs();

    showMessage("✅ 入庫を記録しました。", true);

    currentIn = null;
    refreshInConfirmState();
  } catch (e) {
    console.error(e);
    showMessage(`❌ 入庫失敗：${e.message || e}`, false);
  } finally {
    disableInConfirm(false);
  }
}
/* =========================
   ✅ 新品入庫
========================= */
async function addNewItem() {
  const qrData = currentIn || {};

  const code = String(document.getElementById("newItemCode")?.value || "").trim().toUpperCase();
  const nameJP = String(document.getElementById("newItemName")?.value || "").trim();
  const category = String(document.getElementById("newItemCategory")?.value || "").trim();
  const tana = String(document.getElementById("newItemTana")?.value || "").trim();
  const qty = Number(document.getElementById("newItemQty")?.value || 0);
  const reason = String(document.getElementById("newItemNote")?.value || "").trim();
  const operator = getOperatorValue("operatorIn");

  if (!operator) {
    alert("請輸入/選擇 入庫人員名稱");
    return;
  }
  if (!code) {
    alert("請先掃描 QRCode");
    return;
  }
  if (!nameJP) {
    alert("請輸入 PartsName JP");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    alert("入庫數量必須 >= 1");
    return;
  }

  const payload = {
    type: "入庫(新規)",
    code,
    no: qrData.no || "",
    category: category || qrData.category || "",
    tana: tana || qrData.tana || "",
    serialNo: qrData.sid || "",
    nameJP: nameJP || qrData.nameJP || "",
    nameEN: qrData.nameEN || "",
    model: qrData.model || "",
    quantity: qty,
    operator,
    reason
  };

  disableNewItemConfirm(true);

  try {
    const res = await postForm_(API_BASE, payload);
    if (res.status !== "ok") throw new Error(res.message || "新增入庫失敗");

    // ✅ 雲端同步刷新
    await refreshHomeStats();
    await renderHomeLogs();

    showMessage("✅ 新規備品を登録し、入庫を記録しました。", true);

    const newForm = document.getElementById("newItemForm");
    if (newForm) newForm.style.display = "none";

    setValue("newItemCode", "");
    setValue("newItemName", "");
    setValue("newItemCategory", "");
    setValue("newItemTana", "");
    setValue("newItemQty", 1);
    setValue("newItemNote", "");

    currentIn = null;
    refreshInConfirmState();
  } catch (e) {
    console.error(e);
    showMessage(`❌ 新規入庫失敗：${e.message || e}`, false);
  } finally {
    disableNewItemConfirm(false);
  }
}

/* =========================
   ✅ 出庫確定
========================= */
async function submitStockOut() {
  if (!currentOut || !currentOut.code) {
    alert("先にQRコードをスキャンしてください。");
    return;
  }

  if (!currentOut.sid) {
    alert("このQRコードのシリアル番号がありませんので、出荷できません。");
    return;
  }

  const qty = Number(document.getElementById("stockOutQty")?.value || 0);
  const reason = String(document.getElementById("stockOutReason")?.value || "").trim();
  const operator = getOperatorValue("operatorOut");
  const nowTime = getNowTime();

  if (!operator) {
    alert("請輸入/選擇 出庫人員名稱");
    return;
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    alert("出庫數量必須 >= 1");
    return;
  }

  const payload = {
    type: "出庫",
    code: currentOut.drawing || currentOut.code,
    no: currentOut.no || "",
    category: String(document.getElementById("editCategoryOut")?.value || currentOut.category || "").trim(),
    tana: String(document.getElementById("editTanaOut")?.value || currentOut.tana || "").trim(),
    serialNo: currentOut.sid || "",
    nameJP: currentOut.nameJP || "",
    nameEN: currentOut.nameEN || "",
    model: currentOut.model || "",
    quantity: qty,
    operator,
    reason
  };

  disableOutConfirm(true);

  try {
    const res = await postForm_(API_BASE, payload);
    if (res.status !== "ok") throw new Error(res.message || "出庫失敗");

  await refreshHomeStats();
  await renderHomeLogs();

    if (typeof res.stock === "number") {
      setText("outItemStock", res.stock);
      setValue("editStockOut", res.stock);
      currentOut.stock = res.stock;
    }

    await refreshHomeStats();
    showOutMessage("✅ 出庫を記録しました。", true);

    currentOut = null;
    refreshOutConfirmState();
  } catch (e) {
    console.error(e);
    showOutMessage(`❌ 出庫失敗：${e.message || e}`, false);
  } finally {
    disableOutConfirm(false);
  }
}

/* =========================
   UI：按鈕 disabled 控制
========================= */
function getOperatorValue(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  return String(el.value || "").trim();
}

function refreshInConfirmState() {
  const qty = Number(document.getElementById("stockInQty")?.value || 0);
  const operator = getOperatorValue("operatorIn");
  const hasItem = !!(currentIn && currentIn.code);
  const ok = hasItem && operator && Number.isFinite(qty) && qty > 0;
  setBtnDisabledByOnclick("addStock()", !ok);
}

function refreshOutConfirmState() {
  const qty = Number(document.getElementById("stockOutQty")?.value || 0);
  const operator = getOperatorValue("operatorOut");
  const hasItem = !!(currentOut && currentOut.code);
  const ok = hasItem && operator && Number.isFinite(qty) && qty > 0;
  setBtnDisabledByOnclick("submitStockOut()", !ok);
}

function setBtnDisabledByOnclick(onclickText, disabled) {
  const btn = document.querySelector(`button[onclick="${onclickText}"]`);
  if (btn) btn.disabled = !!disabled;
}

function disableInConfirm(disabled) {
  setBtnDisabledByOnclick("addStock()", !!disabled);
}

function disableOutConfirm(disabled) {
  setBtnDisabledByOnclick("submitStockOut()", !!disabled);
}

function disableNewItemConfirm(disabled) {
  const btn = document.querySelector(`button[onclick="addNewItem()"]`);
  if (btn) btn.disabled = !!disabled;
}

/* =========================
   相機（QRCode + Code128）
========================= */
function getFormatsToSupport() {
  if (typeof Html5QrcodeSupportedFormats === "undefined") return undefined;
  return [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128
  ];
}

let inHtml5Qrcode = null;
let outHtml5Qrcode = null;

async function stopScanner(scanner) {
  if (!scanner) return;
  try { await scanner.stop(); } catch {}
  try { await scanner.clear(); } catch {}
}

async function stopAllCameras() {
  await stopScanner(inHtml5Qrcode);
  inHtml5Qrcode = null;

  await stopScanner(outHtml5Qrcode);
  outHtml5Qrcode = null;
}

async function startInCamera() {
  const id = "inReader";
  const target = document.getElementById(id);
  if (!target) {
    alert("找不到 inReader");
    return;
  }

  await stopAllCameras();
  target.innerHTML = "";

  inHtml5Qrcode = new Html5Qrcode(id);

  const formats = getFormatsToSupport();
  const config = {
    fps: 10,
    qrbox: { width: 280, height: 280 },
    ...(formats ? { formatsToSupport: formats } : {}),
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  try {
    await inHtml5Qrcode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        console.log("[SCAN IN OK]", decodedText);
        await onScanInSuccess(decodedText);
        await stopScanner(inHtml5Qrcode);
        inHtml5Qrcode = null;
      },
      () => {}
    );
  } catch (err) {
    console.error(err);
    alert("❌ 入庫カメラ起動失敗: " + (err?.message || err));
  }
}

async function startOutCamera() {
  const id = "outReader";
  const target = document.getElementById(id);
  if (!target) {
    alert("找不到 outReader");
    return;
  }

  await stopAllCameras();
  target.innerHTML = "";

  outHtml5Qrcode = new Html5Qrcode(id);

  const formats = getFormatsToSupport();
  const config = {
    fps: 10,
    qrbox: { width: 280, height: 280 },
    ...(formats ? { formatsToSupport: formats } : {}),
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  try {
    await outHtml5Qrcode.start(
      { facingMode: "environment" },
      config,
      async (decodedText) => {
        console.log("[SCAN OUT OK]", decodedText);
        await onScanOutSuccess(decodedText);
        await stopScanner(outHtml5Qrcode);
        outHtml5Qrcode = null;
      },
      () => {}
    );
  } catch (err) {
    console.error(err);
    alert("❌ 出庫カメラ起動失敗: " + (err?.message || err));
  }
}

/* =========================
   ✅ POST helper（form-urlencoded）
========================= */
async function postForm_(url, payload) {
  const form = new URLSearchParams();
  Object.entries(payload).forEach(([k, v]) => form.append(k, v ?? ""));

  const res = await fetch(url, {
    method: "POST",
    body: form
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("後端回傳不是 JSON：" + text);
  }
}

/* =========================
   事件綁定：輸入變更 → 刷新 disabled 狀態
========================= */
function bindInputEvents_() {
  const ids = [
    "operatorIn", "stockInQty",
    "operatorOut", "stockOutQty"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", () => {
      refreshInConfirmState();
      refreshOutConfirmState();
    });

    el.addEventListener("change", () => {
      refreshInConfirmState();
      refreshOutConfirmState();
    });
  });
}

/* =========================
   初始化
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  await renderHomeLogs();

  await loadOperatorsTo("operatorIn");
  await loadOperatorsTo("operatorOut");

  bindInputEvents_();
  refreshInConfirmState();
  refreshOutConfirmState();

  await refreshHomeStats();
});
