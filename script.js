/* =========================
   ✅ 設定：改成你的 GAS Web App URL（/exec）
========================= */
const API_BASE = "https://script.google.com/macros/s/AKfycbwSoD1JFU2oPlICj4MmmoU39gafORQv5cXzJR0JVHq97c_dcV13QZH9PlbyacK1oV_F/exec";

/* =========================
   基本工具
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

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "");
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = String(val ?? "");
}

function getOperatorValue(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  return String(el.value || "").trim();
}

/* =========================
   Home Logs
========================= */
async function fetchHomeLogs() {
  const res = await fetch(`${API_BASE}?action=logs&_t=${Date.now()}`, {
    cache: "no-store"
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("logs 回傳不是 JSON：" + text.slice(0, 200));
  }

  if (!data || data.status !== "ok") {
    throw new Error(data?.message || "讀取 logs 失敗");
  }

  return Array.isArray(data.logs) ? data.logs : [];
}

async function renderHomeLogs() {
  const tbody = document.getElementById("homeLogBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center; color:#666;">讀取中...</td>
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
    console.error(e);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:red;">讀取失敗</td>
      </tr>
    `;
  }
}

/* =========================
   Home Stats
========================= */
async function refreshHomeStats() {
  try {
    const res = await fetch(`${API_BASE}?action=stats&_t=${Date.now()}`, {
      cache: "no-store"
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("stats 回傳不是 JSON");
    }

    setText("itemCount", typeof data.itemCount === "number" ? data.itemCount : "-");
    setText("totalStock", typeof data.totalStock === "number" ? data.totalStock : "-");

  } catch (e) {
    console.warn("refreshHomeStats failed", e);
    setText("itemCount", "-");
    setText("totalStock", "-");
  }
}

/* =========================
   Page Control
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
    renderHomeLogs();
  }

  if (pageId === "search-page") {
    clearInventorySearchResult();
  }

  if (pageId === "sidTracker") {
    clearSidResult(false);
  }
}

/* =========================
   Message
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
   QR Parser
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
    nameEN: pickQrValue(qr, ["EN", "PartsName EN"]),
    seiban: pickQrValue(qr, ["製番", "SEIBAN", "Seiban"]),
    model: pickQrValue(qr, ["MDL", "MODEL", "Model"]),
    drawing: pickQrValue(qr, ["DRW", "DRAWING", "Drawing NO.", "Drawing NO", "DrawingNO"]),
    tana: pickQrValue(qr, ["TANA", "棚", "保管棚"]),
    location: pickQrValue(qr, ["LOCATION", "Location", "使用場所", "PLACE", "UsagePlace"]),
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
   Operators
========================= */
async function loadOperatorsTo(elId) {
  const el = document.getElementById(elId);
  if (!el || el.tagName !== "SELECT") return;

  const defaultOperators = ["山口", "Jason", "Jeffrey", "Phil"];

  const current = el.value;
  el.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "選択してください";
  el.appendChild(opt0);

  defaultOperators.forEach(name => {
    const op = document.createElement("option");
    op.value = name;
    op.textContent = name;
    el.appendChild(op);
  });

  if (current) el.value = current;
}

/* =========================
   Inventory Item
========================= */
async function fetchInventoryItem(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;

  const url = `${API_BASE}?action=item&code=${encodeURIComponent(c)}&_t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
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
    category: data["StokeCategory"] || data["Category"] || "",
    seiban: data["製番"] || data["SEIBAN"] || data["Seiban"] || "",
    model: data["Model"] || "",
    tana: data["Tana"] || data["保管棚"] || "",
    location: data["使用場所"] || data["UsagePlace"] || data["Location"] || "",
    stock: Number(data["Stock"] || 0)
  };
}

/* =========================
   Current Scan Data
========================= */
let currentIn = null;
let currentOut = null;

/* =========================
   入庫：掃描成功
========================= */
async function onScanInSuccess(decodedText) {
  const operator = getOperatorValue("operatorIn");
  if (!operator) {
    showMessage("❌ 先にメンバー名前を選択してください。", false);
    return;
  }

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
  }

  currentIn = {
    code,
    no: q.no,
    category: q.category || item?.category || "",
    nameJP: q.nameJP || item?.nameJP || "",
    nameEN: q.nameEN || item?.nameEN || "",
    seiban: q.seiban || item?.seiban || "",
    model: q.model || item?.model || "",
    drawing: q.drawing || item?.code || code,
    tana: q.tana || item?.tana || "",
    location: q.location || item?.location || "",
    sid: q.sid,
    stock: item?.stock || 0
  };

  const itemInfo = document.getElementById("itemInfo");
  const newForm = document.getElementById("newItemForm");

  if (item) {
    if (itemInfo) itemInfo.style.display = "block";
    if (newForm) newForm.style.display = "none";

    setText("itemName", currentIn.nameJP || code);
    setValue("editCategoryIn", currentIn.category || "");
    setValue("editTanaIn", currentIn.tana || "");
    setValue("editUsagePlaceIn", currentIn.location || "");
    setText("itemStock", currentIn.stock);
    setValue("editStockIn", currentIn.stock);

    showMessage("✅ 入庫対象を取得しました。QR資訊已自動帶入。", true);

  } else {
    if (itemInfo) itemInfo.style.display = "none";
    if (newForm) newForm.style.display = "block";

    setValue("newItemCode", code);
    setValue("newItemName", currentIn.nameJP);
    setValue("newItemCategory", currentIn.category);
    setValue("newItemTana", currentIn.tana);
    setValue("newItemLocation", currentIn.location);
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
    category: q.category || item.category || "",
    nameJP: q.nameJP || item.nameJP || "",
    nameEN: q.nameEN || item.nameEN || "",
    seiban: q.seiban || item.seiban || "",
    model: q.model || item.model || "",
    drawing: q.drawing || item.code || code,
    tana: q.tana || item.tana || "",
    location: q.location || item.location || "",
    sid: q.sid,
    stock: item.stock
  };

  const outInfo = document.getElementById("outItemInfo");
  if (outInfo) outInfo.style.display = "block";

  setText("outItemName", currentOut.nameJP || code);
  setValue("editCategoryOut", currentOut.category || "");
  setValue("editTanaOut", currentOut.tana || "");
  setValue("editUsagePlaceOut", currentOut.location || "");
  setText("outItemStock", currentOut.stock);
  setValue("editStockOut", currentOut.stock);

  showOutMessage("✅ 出庫対象を取得しました。QR資訊已自動帶入。", true);

  setTimeout(() => document.getElementById("stockOutQty")?.focus(), 200);
  refreshOutConfirmState();
}

/* =========================
   Cancel 新品
========================= */
function cancelNewItem() {
  const newForm = document.getElementById("newItemForm");
  if (newForm) newForm.style.display = "none";

  setText("scanResult", "なし");
  setText("scanSidIn", "-");

  setValue("newItemCode", "");
  setValue("newItemName", "");
  setValue("newItemCategory", "");
  setValue("newItemTana", "");
  setValue("newItemLocation", "");
  setValue("newItemQty", 1);
  setValue("newItemNote", "");

  currentIn = null;
  refreshInConfirmState();
}

/* =========================
   入庫確定：既存品
========================= */
async function addStock() {
  if (!currentIn || !currentIn.code) {
    alert("先にQRコードをスキャンしてください（既存品）。新品は『新規部品又入庫』を使用してください。");
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
    showMessage("❌ 入庫人員を選択してください。", false);
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("入庫數量必須 >= 1");
    return;
  }

  const payload = {
    action: "stockIn",
    type: "入庫",
    code: currentIn.drawing || currentIn.code,
    no: currentIn.no || "",
    category: String(document.getElementById("editCategoryIn")?.value || currentIn.category || "").trim(),
    tana: String(document.getElementById("editTanaIn")?.value || currentIn.tana || "").trim(),
    usagePlace: document.getElementById("editUsagePlaceIn")?.value || currentIn.location || "",
    serialNo: currentIn.sid || "",
    nameJP: currentIn.nameJP || "",
    nameEN: currentIn.nameEN || "",
    seiban: currentIn.seiban || "",
    model: currentIn.model || "",
    drawing: currentIn.drawing || currentIn.code,
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
   新品入庫
========================= */
async function addNewItem() {
  const qrData = currentIn || {};

  const code = String(document.getElementById("newItemCode")?.value || "").trim().toUpperCase();
  const nameJP = String(document.getElementById("newItemName")?.value || "").trim();
  const category = String(document.getElementById("newItemCategory")?.value || "").trim();
  const tana = String(document.getElementById("newItemTana")?.value || "").trim();
  const location = String(document.getElementById("newItemLocation")?.value || "").trim();
  const qty = Number(document.getElementById("newItemQty")?.value || 0);
  const reason = String(document.getElementById("newItemNote")?.value || "").trim();
  const operator = getOperatorValue("operatorIn");

  if (!operator) {
    showMessage("❌ 入庫人員を選択してください。", false);
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

  if (!qrData.sid) {
    alert("このQRコードはシリアル番号がありませんので、入荷しないでください。");
    return;
  }

  const payload = {
    action: "stockIn",
    type: "入庫(新規)",
    code: code,
    no: qrData.no || "",
    category: category,
    nameJP: nameJP,
    nameEN: qrData.nameEN || "",
    seiban: qrData.seiban || "",
    model: qrData.model || "",
    drawing: qrData.drawing || code,
    tana: tana,
    usagePlace: location,
    quantity: qty,
    operator: operator,
    reason: reason,
    serialNo: qrData.sid || ""
  };

  disableNewItemConfirm(true);

  try {
    const res = await postForm_(API_BASE, payload);
    if (res.status !== "ok") throw new Error(res.message || "新增入庫失敗");

    await refreshHomeStats();
    await renderHomeLogs();

    showMessage("✅ 新規備品を登録し、入庫を記録しました。", true);

    const newForm = document.getElementById("newItemForm");
    if (newForm) newForm.style.display = "none";

    setValue("newItemCode", "");
    setValue("newItemName", "");
    setValue("newItemCategory", "");
    setValue("newItemTana", "");
    setValue("newItemLocation", "");
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
   出庫確定
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

  if (!operator) {
    showOutMessage("❌ 出庫人員を選択してください。", false);
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("出庫數量必須 >= 1");
    return;
  }

  const payload = {
    action: "stockOut",
    type: "出庫",
    code: currentOut.drawing || currentOut.code,
    no: currentOut.no || "",
    category: String(document.getElementById("editCategoryOut")?.value || currentOut.category || "").trim(),
    tana: String(document.getElementById("editTanaOut")?.value || currentOut.tana || "").trim(),
    usagePlace: document.getElementById("editUsagePlaceOut")?.value || currentOut.location || "",
    serialNo: currentOut.sid || "",
    nameJP: currentOut.nameJP || "",
    nameEN: currentOut.nameEN || "",
    seiban: currentOut.seiban || "",
    model: currentOut.model || "",
    drawing: currentOut.drawing || currentOut.code,
    quantity: qty,
    operator,
    reason
  };

  disableOutConfirm(true);

  try {
    const res = await postForm_(API_BASE, payload);
    if (res.status !== "ok") throw new Error(res.message || "出庫失敗");

    if (typeof res.stock === "number") {
      setText("outItemStock", res.stock);
      setValue("editStockOut", res.stock);
      currentOut.stock = res.stock;
    }

    await refreshHomeStats();
    await renderHomeLogs();

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
   Button State
========================= */
function refreshInConfirmState() {
  const qty = Number(document.getElementById("stockInQty")?.value || document.getElementById("newItemQty")?.value || 0);
  const operator = getOperatorValue("operatorIn");
  const hasItem = !!(currentIn && currentIn.code);
  const ok = hasItem && operator && Number.isFinite(qty) && qty > 0;

  setBtnDisabledByOnclick("addStock()", !ok);
  setBtnDisabledByOnclick("addNewItem()", !ok);
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
  setBtnDisabledByOnclick("addNewItem()", !!disabled);
}

/* =========================
   Camera
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
      async decodedText => {
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
      async decodedText => {
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
   POST helper
========================= */
async function postForm_(url, payload) {
  const form = new URLSearchParams();

  Object.entries(payload).forEach(([k, v]) => {
    form.append(k, v ?? "");
  });

  await fetch(url, {
    method: "POST",
    mode: "no-cors",
    body: form
  });

  return {
    status: "ok",
    message: "送信しました"
  };
}

/* =========================
   Input Events
========================= */
function bindInputEvents_() {
  const ids = [
    "operatorIn",
    "stockInQty",
    "newItemQty",
    "operatorOut",
    "stockOutQty"
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
   搜尋備品
========================= */
async function searchItem() {
  const keyword = document.getElementById("searchInput")?.value.trim();
  const resultBox = document.getElementById("searchResult");

  if (!resultBox) return;

  if (!keyword) {
    resultBox.innerHTML = "請輸入搜尋內容";
    return;
  }

  resultBox.innerHTML = "搜尋中...";

  try {
    const res = await fetch(`${API_BASE}?action=item&code=${encodeURIComponent(keyword)}&_t=${Date.now()}`, {
      cache: "no-store"
    });

    const data = await res.json();

    if (data && Object.keys(data).length > 0) {
      resultBox.innerHTML = `
        <div style="border:1px solid #ccc; padding:10px;">
          <b>✅ 在庫あり</b><br>
          名稱: ${escapeHtml(data["PartsName JP"] || "-")}<br>
          Drawing: ${escapeHtml(data["Drawing NO."] || "-")}<br>
          在庫: <b>${escapeHtml(data["Stock"] ?? 0)}</b><br>
          保管棚: ${escapeHtml(data["Tana"] || data["保管棚"] || "-")}<br>
          使用場所: ${escapeHtml(data["使用場所"] || data["UsagePlace"] || "-")}
        </div>
      `;
      return;
    }

    const logs = await fetchHomeLogs();
    const match = logs.find(l =>
      String(l.productName || "").toLowerCase().includes(keyword.toLowerCase())
    );

    if (match) {
      resultBox.innerHTML = `
        <div style="border:1px solid #ccc; padding:10px;">
          <b>⚠️ 曾經出現（請確認庫存）</b><br>
          名稱: ${escapeHtml(match.productName)}<br>
          最近動作: ${escapeHtml(match.type)}<br>
          時間: ${escapeHtml(match.timeText)}
        </div>
      `;
    } else {
      resultBox.innerHTML = `<span style="color:red;">❌ 找不到此備品</span>`;
    }

  } catch (e) {
    console.error(e);
    resultBox.innerHTML = "搜尋失敗";
  }
}

/* =========================
   備品検索：模糊搜尋 Inventory
========================= */
function clearInventorySearchResult() {
  const msg = document.getElementById("inventorySearchMessage");
  const body = document.getElementById("inventorySearchBody");

  if (msg) msg.innerHTML = "";

  if (body) {
    body.innerHTML = `
      <div class="empty-message">検索してください</div>
    `;
  }
}

async function searchInventoryItems() {
  const input = document.getElementById("inventorySearchInput");
  const msg = document.getElementById("inventorySearchMessage");
  const body = document.getElementById("inventorySearchBody");

  const keyword = String(input?.value || "").trim();

  if (!body) return;

  if (!keyword) {
    if (msg) msg.innerHTML = `<span style="color:red;">検索キーワードを入力してください。</span>`;
    body.innerHTML = `<div class="empty-message">検索してください</div>`;
    return;
  }

  if (msg) msg.innerHTML = "検索中...";
  body.innerHTML = `<div class="empty-message">検索中...</div>`;

  try {
    const url = `${API_BASE}?action=search_inventory&q=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("後端回傳不是 JSON：" + text.slice(0, 200));
    }

    if (!data || data.status !== "ok") {
      throw new Error(data?.message || "検索失敗");
    }

    const items = Array.isArray(data.items) ? data.items : [];

    if (msg) msg.innerHTML = `検索結果：${items.length} 件`;

    if (!items.length) {
      body.innerHTML = `<div class="empty-message">該当する備品はありません</div>`;
      return;
    }

    body.innerHTML = items.map(item => {
      const stock = Number(item.stock || 0);
      const stockClass = stock <= 0 ? "stock-zero" : "stock-ok";

      return `
        <div class="search-card">
          <div class="search-card-header">
            <div class="item-name">${escapeHtml(item.nameJP || "-")}</div>
            <div class="${stockClass}">在庫：${escapeHtml(item.stock)}</div>
          </div>

          <div class="search-grid">
            <div><span>Drawing NO.</span><b>${escapeHtml(item.drawingNo || "-")}</b></div>
            <div><span>部品名</span><b>${escapeHtml(item.nameJP || "-")}</b></div>
            <div><span>分類</span><b>${escapeHtml(item.category || "-")}</b></div>
            <div><span>製番</span><b>${escapeHtml(item.seiban || "-")}</b></div>
            <div><span>Model</span><b>${escapeHtml(item.model || "-")}</b></div>
            <div><span>保管棚</span><b>${escapeHtml(item.tana || "-")}</b></div>
            <div><span>使用場所</span><b>${escapeHtml(item.usagePlace || "-")}</b></div>
            <div><span>入庫時間</span><b>${escapeHtml(item.time || "-")}</b></div>
            <div><span>入庫者</span><b>${escapeHtml(item.lastOperator || "-")}</b></div>
            <div><span>SafeStock</span><b>${escapeHtml(item.safeStock || "-")}</b></div>
          </div>
        </div>
      `;
    }).join("");

  } catch (e) {
    console.error(e);

    if (msg) {
      msg.innerHTML = `<span style="color:red;">検索失敗：${escapeHtml(e.message || e)}</span>`;
    }

    body.innerHTML = `<div class="empty-message">検索失敗</div>`;
  }
}

/* =========================
   初始化
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  await loadOperatorsTo("operatorIn");
  await loadOperatorsTo("operatorOut");

  bindInputEvents_();

  refreshInConfirmState();
  refreshOutConfirmState();

  await refreshHomeStats();
  renderHomeLogs();

  const input = document.getElementById("inventorySearchInput");
  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        searchInventoryItems();
      }
    });
  }
});
