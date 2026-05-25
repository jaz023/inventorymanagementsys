/* =========================
   ✅ 設定：改成你的 GAS Web App URL（/exec）
========================= */
const API_BASE = "https://script.google.com/macros/s/AKfycbxWrSPLy1xWPKcGi7Ltskk88e7Nlpqv4UnfGu4QEcEq6NgEtzkHSDVTPQ655T65U9mo/exec";

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
    tana: pickQrValue(qr, ["TANA", "棚", "保管棚", "B"]),
    location: pickQrValue(qr, ["LOCATION", "Location", "使用場所", "PLACE", "UsagePlace"]),
    sid: pickQrValue(qr, ["SID", "SN", "Serial"]),
    serialManaged: pickQrValue(qr, ["SM", "SerialManaged", "serialManaged"])
  };
}

function isSerialManaged_(value) {
  const v = String(value || "").trim().toUpperCase();
  return v === "YES" || v === "Y" || v === "1" || v === "TRUE";
}

function getPartSerialsFromTextarea_(id) {
  return String(document.getElementById(id)?.value || "")
    .split(/\r?\n|,|;/)
    .map(x => x.trim())
    .filter(Boolean);
}

function togglePartSerialBlock_(blockId, inputId, serialManaged) {
  const block = document.getElementById(blockId);
  const input = document.getElementById(inputId);

  if (!block || !input) return;

  if (isSerialManaged_(serialManaged)) {
    block.style.display = "block";
  } else {
    block.style.display = "none";
    input.value = "";
  }
}

function toggleNewItemPartSerials() {
  const checked = document.getElementById("newItemSerialManaged")?.checked;
  togglePartSerialBlock_("newItemPartSerialBlock", "newItemPartSerials", checked ? "YES" : "NO");
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

function resetInScanView_() {
  currentIn = null;

  setText("scanResult", "なし");
  setText("scanSidIn", "-");
  setText("itemName", "");
  setText("itemStock", "");

  setValue("editCategoryIn", "");
  setValue("editTanaIn", "");
  setValue("editUsagePlaceIn", "");
  setValue("editModelIn", "");
  setValue("stockInPartSerials", "");

  togglePartSerialBlock_("stockInPartSerialBlock", "stockInPartSerials", "NO");

  const itemInfo = document.getElementById("itemInfo");
  if (itemInfo) itemInfo.style.display = "none";
}

function resetOutScanView_() {
  currentOut = null;

  setText("scanOutResult", "なし");
  setText("scanSidOut", "-");
  setText("outItemName", "");
  setText("outItemStock", "");

  setValue("editCategoryOut", "");
  setValue("editTanaOut", "");
  setValue("editUsagePlaceOut", "");
  setValue("stockOutPartSerials", "");

  togglePartSerialBlock_("stockOutPartSerialBlock", "stockOutPartSerials", "NO");

  const outInfo = document.getElementById("outItemInfo");
  if (outInfo) outInfo.style.display = "none";
}

/* =========================
   入庫：掃描成功
========================= */
async function onScanInSuccess(decodedText) {
  resetInScanView_();
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

  setText("scanResult", decodedText);
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
    serialManaged: q.serialManaged || "",
    stock: item ? Number(item.stock || 0) : 0
  };

  togglePartSerialBlock_(
  "stockInPartSerialBlock",
  "stockInPartSerials",
  currentIn.serialManaged
  );
  const itemInfo = document.getElementById("itemInfo");
  const newForm = document.getElementById("newItemForm");

  if (item) {
    if (itemInfo) itemInfo.style.display = "block";
    if (newForm) newForm.style.display = "none";

     console.log("[IN STOCK DEBUG]", {
        code,
        qrRaw,
        q,
        item,
        currentInStock: currentIn.stock
     });

    setText("itemName", currentIn.nameJP || code);
    setValue("editCategoryIn", currentIn.category || "");
    setValue("editTanaIn", currentIn.tana || "");
    setValue("editUsagePlaceIn", currentIn.location || "");
    setValue("editModelIn", currentIn.model || "");
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

    const newSerialChecked = isSerialManaged_(currentIn.serialManaged);
    const newSerialCheckEl = document.getElementById("newItemSerialManaged");
    if (newSerialCheckEl) newSerialCheckEl.checked = newSerialChecked;

    togglePartSerialBlock_(
      "newItemPartSerialBlock",
      "newItemPartSerials",
      newSerialChecked ? "YES" : "NO"
    );

    showMessage("🆕 Inventory に存在しない新品です。QR資訊已自動帶入。", true);
  }

  refreshInConfirmState();
}

/* =========================
   出庫：掃描成功
========================= */
async function onScanOutSuccess(decodedText) {
  resetOutScanView_();
  const qrRaw = parseQrText(decodedText);
  const q = normalizeQrFields(qrRaw);
  const code = String(q.drawing || standardizeCode(qrRaw) || "").trim().toUpperCase();

  if (!code) {
    showOutMessage("QRCode 內容無法識別（缺少 DRW / Drawing NO.）", false);
    return;
  }

  setText("scanOutResult", decodedText);
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
    serialManaged: q.serialManaged || "",
    stock: item.stock
  };

  togglePartSerialBlock_(
  "stockOutPartSerialBlock",
  "stockOutPartSerials",
  currentOut.serialManaged
  );

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
  
  const newSerialCheckEl = document.getElementById("newItemSerialManaged");
  if (newSerialCheckEl) newSerialCheckEl.checked = false;

  setValue("newItemPartSerials", "");

  togglePartSerialBlock_(
    "newItemPartSerialBlock",
    "newItemPartSerials",
    "NO"
  );

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

  const serialManaged = isSerialManaged_(currentIn.serialManaged) ? "YES" : "NO";
  const partSerialsText = document.getElementById("stockInPartSerials")?.value || "";
  const partSerials = getPartSerialsFromTextarea_("stockInPartSerials");

  if (serialManaged === "YES" && partSerials.length !== qty) {
    alert("PartSerialNo 數量必須和入庫數量一致");
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
    model: String(document.getElementById("editModelIn")?.value || currentIn.model || "").trim(),
    drawing: currentIn.drawing || currentIn.code,
    quantity: qty,
    operator,
    reason,
    serialManaged,
    partSerials: partSerialsText
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

    resetInScanView_();

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
  const model = String(document.getElementById("newItemModel")?.value || "").trim();
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

  const serialManaged = document.getElementById("newItemSerialManaged")?.checked ? "YES" : "NO";
  const partSerialsText = document.getElementById("newItemPartSerials")?.value || "";
  const partSerials = getPartSerialsFromTextarea_("newItemPartSerials");

  if (serialManaged === "YES" && partSerials.length !== qty) {
    alert("PartSerialNo 數量必須和入庫數量一致");
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
    model: model || qrData.model || "",
    drawing: qrData.drawing || code,
    tana: tana,
    usagePlace: location,
    quantity: qty,
    operator: operator,
    reason: reason,
    serialNo: qrData.sid || "",
    serialManaged: serialManaged,
    partSerials: partSerialsText
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
    setValue("newItemModel", "");
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

  const serialManaged = isSerialManaged_(currentOut.serialManaged) ? "YES" : "NO";
  const partSerialsText = document.getElementById("stockOutPartSerials")?.value || "";
  const partSerials = getPartSerialsFromTextarea_("stockOutPartSerials");

  if (serialManaged === "YES" && partSerials.length !== qty) {
    alert("PartSerialNo 數量必須和出庫數量一致");
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
    reason,
    serialManaged,
    partSerials: partSerialsText
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

    resetOutScanView_();

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
let toolHtml5Qrcode = null;

let toolInventoryMode = "";
let currentToolBoxId = "";
let expectedToolMap = {};
let scannedToolIds = [];

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

  await stopScanner(toolHtml5Qrcode);
  toolHtml5Qrcode = null;
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

  const res = await fetch(url, {
    method: "POST",
    body: form
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("後端回傳不是 JSON：" + text.slice(0, 200));
  }

  return data;
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

    const rawItems = Array.isArray(data.items) ? data.items : [];

    if (!rawItems.length) {
      if (msg) msg.innerHTML = `検索結果：0 件`;
      body.innerHTML = `<div class="empty-message">該当する備品はありません</div>`;
      return;
    }

    const groupMap = {};

    rawItems.forEach(item => {
      const drawingNo = String(item.drawingNo || "").trim();
      const tana = String(item.tana || "-").trim() || "-";
      const key = `${drawingNo}||${tana}`;

      if (!groupMap[key]) {
        groupMap[key] = {
          drawingNo,
          tana,
          nameJP: item.nameJP || "-",
          category: item.category || "-",
          seiban: item.seiban || "-",
          model: item.model || "-",
          location: item.location || "-",
          safeStock: item.safeStock || "-",
          lastOperator: item.lastOperator || "-",
          lastInTime: item.time || item.lastInTime || "-",
          stock: 0,
          serials: []
        };
      }

      const stock = Number(item.stock || 0);
      groupMap[key].stock += stock;

      const serial = String(item.serialNo || item.no || "").trim();
      if (serial) {
        groupMap[key].serials.push({
          serial,
          stock,
          time: item.time || "-",
          operator: item.lastOperator || "-"
        });
      }

      if (!groupMap[key].location || groupMap[key].location === "-") {
        groupMap[key].location = item.location || "-";
      }

      if (!groupMap[key].lastInTime || groupMap[key].lastInTime === "-") {
        groupMap[key].lastInTime = item.time || item.lastInTime || "-";
      }
    });

    const items = Object.values(groupMap).sort((a, b) => {
      const d = String(a.drawingNo).localeCompare(String(b.drawingNo));
      if (d !== 0) return d;
      return String(a.tana).localeCompare(String(b.tana));
    });

    if (msg) {
      msg.innerHTML = `検索結果：${items.length} 件（保管棚別）`;
    }

    body.innerHTML = items.map(item => {
      const stock = Number(item.stock || 0);
      const stockClass = stock <= 0 ? "stock-zero" : "stock-ok";

      const serialList = item.serials.length
        ? item.serials.map(s => `
            <div style="margin-top:4px;">
              <b>${escapeHtml(s.serial)}</b>
              <span style="color:#666;"> / 在庫 ${escapeHtml(s.stock)}</span>
            </div>
          `).join("")
        : "-";

      return `
        <div class="search-card">
          <div class="search-card-header">
            <div class="item-name">${escapeHtml(item.nameJP || "-")}</div>
            <div class="${stockClass}">在庫：${escapeHtml(stock)}</div>
          </div>

          <div class="search-grid">
            <div><span>Drawing NO.</span><b>${escapeHtml(item.drawingNo || "-")}</b></div>
            <div><span>部品名</span><b>${escapeHtml(item.nameJP || "-")}</b></div>
            <div><span>分類</span><b>${escapeHtml(item.category || "-")}</b></div>
            <div><span>製番</span><b>${escapeHtml(item.seiban || "-")}</b></div>
            <div><span>Model</span><b>${escapeHtml(item.model || "-")}</b></div>
            <div><span>保管棚</span><b>${escapeHtml(item.tana || "-")}</b></div>
            <div><span>使用場所</span><b>${escapeHtml(item.location || "-")}</b></div>
            <div><span>入庫時間</span><b>${escapeHtml(item.lastInTime || "-")}</b></div>
            <div><span>入庫者</span><b>${escapeHtml(item.lastOperator || "-")}</b></div>
            <div><span>SafeStock</span><b>${escapeHtml(item.safeStock || "-")}</b></div>
            <div style="grid-column:1 / -1;">
              <span>Serial No.</span>
              <b>${serialList}</b>
            </div>
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


function normalizeToolQr(qr) {
  return {
    type: pickQrValue(qr, ["TYPE", "Type", "type"]),
    toolId: pickQrValue(qr, ["ToolID", "TOOLID", "toolId"]),
    boxId: pickQrValue(qr, ["BoxID", "BOXID", "boxId"]),
    tana: pickQrValue(qr, ["Tana", "TANA", "棚", "保管棚", "B"])
  };
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

function showToolMessage(message, success = true) {
  const el = document.getElementById("toolInventoryMessage");
  if (!el) return;
  el.innerHTML = `<p style="color:${success ? "green" : "red"};">${escapeHtml(message)}</p>`;
}

async function fetchToolsByBox(boxId) {
  const url = `${API_BASE}?action=tool_box&boxId=${encodeURIComponent(boxId)}&_t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("tool_box 回傳不是 JSON：" + text.slice(0, 200));
  }

  if (!data || data.status !== "ok") {
    throw new Error(data?.message || "tool_box 取得失敗");
  }

  return data;
}

async function startToolBoxScan() {
  toolInventoryMode = "box";
  await startToolCamera();
  showToolMessage("工具箱 QR 掃描中...");
}

async function startToolScan() {
  if (!currentToolBoxId) {
    showToolMessage("請先掃描工具箱 QR。", false);
    return;
  }

  toolInventoryMode = "tool";
  await startToolCamera();
  showToolMessage("工具 QR 掃描中...");
}

async function startToolCamera() {
  const id = "toolReader";
  const target = document.getElementById(id);

  if (!target) {
    alert("找不到 toolReader");
    return;
  }

  await stopAllCameras();
  target.innerHTML = "";

  toolHtml5Qrcode = new Html5Qrcode(id);

  const formats = getFormatsToSupport();

  const config = {
    fps: 10,
    qrbox: { width: 280, height: 280 },
    ...(formats ? { formatsToSupport: formats } : {}),
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  try {
    await toolHtml5Qrcode.start(
      { facingMode: "environment" },
      config,
      async decodedText => {
        console.log("[TOOL SCAN OK]", decodedText);
        await onToolScanSuccess(decodedText);
        await stopScanner(toolHtml5Qrcode);
        toolHtml5Qrcode = null;
      },
      () => {}
    );
  } catch (err) {
    console.error(err);
    alert("❌ 工具カメラ起動失敗: " + (err?.message || err));
  }
}

async function onToolScanSuccess(decodedText) {
  const qrRaw = parseQrText(decodedText);
  const q = normalizeToolQr(qrRaw);

  if (toolInventoryMode === "box") {
    if (q.type !== "TOOLBOX" || !q.boxId) {
      showToolMessage("これは工具箱 QR ではありません。TYPE=TOOLBOX と BoxID が必要です。", false);
      return;
    }

    await loadToolBox(q.boxId);
    return;
  }

  if (toolInventoryMode === "tool") {
    if (q.type !== "TOOL" || !q.toolId) {
      showToolMessage("これは工具 QR ではありません。TYPE=TOOL と ToolID が必要です。", false);
      return;
    }

    addScannedTool(q.toolId, q.boxId);
    return;
  }
}

async function loadToolBox(boxId) {
  try {
    const data = await fetchToolsByBox(boxId);

    currentToolBoxId = boxId;
    expectedToolMap = {};
    scannedToolIds = [];

    (data.tools || []).forEach(t => {
      const id = String(t.toolId || "").trim().toUpperCase();
      if (id) expectedToolMap[id] = t;
    });

    setText("currentBoxId", boxId);
    setText("expectedToolCount", Object.keys(expectedToolMap).length);
    setText("scannedToolCount", "0");

    renderScannedToolList();
    document.getElementById("toolInventoryResult").innerHTML = "";

    showToolMessage(`✅ 工具箱 ${boxId} 讀取完成，應有工具 ${Object.keys(expectedToolMap).length} 件。`, true);

  } catch (e) {
    console.error(e);
    showToolMessage(`❌ 工具箱讀取失敗：${e.message || e}`, false);
  }
}

function addScannedTool(toolId, qrBoxId) {
  const id = String(toolId || "").trim().toUpperCase();

  if (!id) {
    showToolMessage("ToolID 空白。", false);
    return;
  }

  if (qrBoxId && currentToolBoxId && String(qrBoxId).toUpperCase() !== String(currentToolBoxId).toUpperCase()) {
    showToolMessage(`⚠️ ${id} 的 QR BoxID=${qrBoxId}，目前盤点箱=${currentToolBoxId}`, false);
  }

  if (!scannedToolIds.includes(id)) {
    scannedToolIds.push(id);
  }

  setText("scannedToolCount", scannedToolIds.length);
  renderScannedToolList();

  if (expectedToolMap[id]) {
    showToolMessage(`✅ 已掃描：${id}`, true);
  } else {
    showToolMessage(`⚠️ 多出工具：${id} 不屬於 ${currentToolBoxId}`, false);
  }
}

function renderScannedToolList() {
  const ul = document.getElementById("scannedToolList");
  if (!ul) return;

  if (!scannedToolIds.length) {
    ul.innerHTML = "<li>尚未掃描工具</li>";
    return;
  }

  ul.innerHTML = scannedToolIds.map(id => {
    const ok = !!expectedToolMap[id];
    return `<li style="color:${ok ? "green" : "red"};">${escapeHtml(id)} ${ok ? "" : "（多出）"}</li>`;
  }).join("");
}

function finishToolInventory() {
  if (!currentToolBoxId) {
    showToolMessage("請先掃描工具箱 QR。", false);
    return;
  }

  const expectedIds = Object.keys(expectedToolMap);
  const scannedIds = scannedToolIds;

  const missingIds = expectedIds.filter(id => !scannedIds.includes(id));
  const extraIds = scannedIds.filter(id => !expectedToolMap[id]);
  const borrowedTools = expectedIds
    .map(id => expectedToolMap[id])
    .filter(t => String(t.status || "").trim() === "借出");

  const result = document.getElementById("toolInventoryResult");

  result.innerHTML = `
    <div style="border:1px solid #ccc; padding:10px;">
      <p><b>工具箱：</b>${escapeHtml(currentToolBoxId)}</p>
      <p><b>應有：</b>${expectedIds.length}</p>
      <p><b>已掃：</b>${scannedIds.length}</p>
      <p><b>缺少：</b>${missingIds.length}</p>
      <p><b>多出：</b>${extraIds.length}</p>
      <p><b>借出中：</b>${borrowedTools.length}</p>

      <h4>缺少工具</h4>
      ${missingIds.length ? missingIds.map(id => {
        const t = expectedToolMap[id] || {};
        return `<div style="color:red;">- ${escapeHtml(id)} ${escapeHtml(t.toolName || "")}</div>`;
      }).join("") : "<div>無</div>"}

      <h4>多出工具</h4>
      ${extraIds.length ? extraIds.map(id => `
        <div style="color:red;">- ${escapeHtml(id)}</div>
      `).join("") : "<div>無</div>"}

      <h4>借出中工具</h4>
      ${borrowedTools.length ? borrowedTools.map(t => `
        <div style="color:#d97706;">
          - ${escapeHtml(t.toolId)} ${escapeHtml(t.toolName || "")}
          / 借用者：${escapeHtml(t.borrower || "-")}
        </div>
      `).join("") : "<div>無</div>"}
    </div>
  `;

  showToolMessage("✅ 盤点完成。", missingIds.length === 0 && extraIds.length === 0);
}
