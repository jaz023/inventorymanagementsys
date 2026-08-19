/* =========================
   ✅ 設定：改成你的 GAS Web App URL（/exec）
========================= */
const API_BASE = "https://script.google.com/macros/s/AKfycbxWrSPLy1xWPKcGi7Ltskk88e7Nlpqv4UnfGu4QEcEq6NgEtzkHSDVTPQ655T65U9mo/exec";

const IS_DEMO_MODE = new URLSearchParams(location.search).get("demo") === "1" || location.protocol === "file:";
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

function displayToolStatus_(status) {
  const value = String(status || "").trim();
  if (value === "借出" || value === "借出中") return "貸出中";
  if (value === "已歸還") return "返却済み";
  if (value === "未登錄") return "未登録";
  return value || "-";
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
    throw new Error(data?.message || "履歴の読み込みに失敗しました");
  }

  return Array.isArray(data.logs) ? data.logs : [];
}

async function renderHomeLogs() {
  const tbody = document.getElementById("homeLogBody");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center; color:#666;">読み込み中...</td>
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
        <td colspan="6" style="text-align:center; color:red;">読み込みに失敗しました</td>
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

  if (pageId === "history-page") {
    await searchStockHistory();
  }

  if (pageId === "tool-page") {
    await searchRentalHistory();
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
    throw new Error("サーバー応答がJSONではありません（GAS Web Appのデプロイ、権限、URLを確認してください）");
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
    showMessage("QRコードを識別できません（DRW / Drawing NO. がありません）", false);
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

    showMessage("✅ 入庫対象を取得しました。QR情報を自動入力しました。", true);

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

    showMessage("🆕 Inventory に存在しない新規品です。QR情報を自動入力しました。", true);
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
    showOutMessage("QRコードを識別できません（DRW / Drawing NO. がありません）", false);
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

  showOutMessage("✅ 出庫対象を取得しました。QR情報を自動入力しました。", true);

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
    showMessage("❌ 入庫担当者を選択してください。", false);
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("入庫数量は1以上で指定してください。");
    return;
  }

  const serialManaged = isSerialManaged_(currentIn.serialManaged) ? "YES" : "NO";
  const partSerialsText = document.getElementById("stockInPartSerials")?.value || "";
  const partSerials = getPartSerialsFromTextarea_("stockInPartSerials");

  if (serialManaged === "YES" && partSerials.length !== qty) {
    alert("PartSerialNoの件数は入庫数量と一致させてください。");
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
    showMessage(`❌ 入庫に失敗しました：${e.message || e}`, false);
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
    showMessage("❌ 入庫担当者を選択してください。", false);
    return;
  }

  if (!code) {
    alert("先にQRコードをスキャンしてください。");
    return;
  }

  if (!nameJP) {
    alert("PartsName JPを入力してください。");
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("入庫数量は1以上で指定してください。");
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
    alert("PartSerialNoの件数は入庫数量と一致させてください。");
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
    if (res.status !== "ok") throw new Error(res.message || "新規入庫に失敗しました");

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
    showMessage(`❌ 新規入庫に失敗しました：${e.message || e}`, false);
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
    showOutMessage("❌ 出庫担当者を選択してください。", false);
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    alert("出庫数量は1以上で指定してください。");
    return;
  }

  const serialManaged = isSerialManaged_(currentOut.serialManaged) ? "YES" : "NO";
  const partSerialsText = document.getElementById("stockOutPartSerials")?.value || "";
  const partSerials = getPartSerialsFromTextarea_("stockOutPartSerials");

  if (serialManaged === "YES" && partSerials.length !== qty) {
    alert("PartSerialNoの件数は出庫数量と一致させてください。");
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
    showOutMessage(`❌ 出庫に失敗しました：${e.message || e}`, false);
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

  await stopScanner(toolRentalHtml5Qrcode);
  toolRentalHtml5Qrcode = null;
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
    resultBox.innerHTML = "検索キーワードを入力してください";
    return;
  }

  resultBox.innerHTML = "検索中...";

  try {
    const res = await fetch(`${API_BASE}?action=item&code=${encodeURIComponent(keyword)}&_t=${Date.now()}`, {
      cache: "no-store"
    });

    const data = await res.json();

    if (data && Object.keys(data).length > 0) {
      resultBox.innerHTML = `
        <div style="border:1px solid #ccc; padding:10px;">
          <b>✅ 在庫あり</b><br>
          品名: ${escapeHtml(data["PartsName JP"] || "-")}<br>
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
          <b>⚠️ 過去の履歴にあります（在庫を確認してください）</b><br>
          品名: ${escapeHtml(match.productName)}<br>
          最終操作: ${escapeHtml(match.type)}<br>
          時間: ${escapeHtml(match.timeText)}
        </div>
      `;
    } else {
      resultBox.innerHTML = `<span style="color:red;">❌ 該当する備品が見つかりません</span>`;
    }

  } catch (e) {
    console.error(e);
    resultBox.innerHTML = "検索に失敗しました";
  }
}

/* =========================
   備品検索：模糊搜尋 Inventory
========================= */
let inventorySearchController = null;

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
    if (inventorySearchController) inventorySearchController.abort();
    inventorySearchController = new AbortController();
    const url = `${API_BASE}?action=search_inventory&q=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store", signal: inventorySearchController.signal });
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
      body.innerHTML = `<div class="empty-message">該当する備品がありません</div>`;
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
    if (e && e.name === "AbortError") return;
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

    toolId: pickQrValue(qr, [
      "ToolID",
      "TOOLID",
      "toolId",
      "ID"
    ]),

    sid: pickQrValue(qr, [
      "SID",
      "Sid",
      "sid"
    ]),

    boxId: pickQrValue(qr, [
      "BoxID",
      "BOXID",
      "boxId"
    ]),

    category: pickQrValue(qr, [
      "CAT",
      "CATEGORY",
      "Category",
      "分類"
    ]),

    boxName: pickQrValue(qr, [
      "BoxName",
      "BOXNAME",
      "boxName",
      "箱名",
      "工具箱名稱"
    ]),

    toolName: pickQrValue(qr, [
      "ToolName",
      "TOOLNAME",
      "NAME",
      "Name",
      "工具名稱"
    ]),

    tana: pickQrValue(qr, [
      "Tana",
      "TANA",
      "棚",
      "保管棚",
      "B"
    ]),

    remark: pickQrValue(qr, [
      "Remark",
      "REMARK",
      "備註"
    ])
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
    let fuzzySearchTimer = null;
    input.addEventListener("input", () => {
      clearTimeout(fuzzySearchTimer);
      const keyword = String(input.value || "").trim();
      if (!keyword) {
        clearInventorySearchResult();
        return;
      }
      fuzzySearchTimer = setTimeout(() => searchInventoryItems(), 220);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        clearTimeout(fuzzySearchTimer);
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
    throw new Error(data?.message || "工具箱データの取得に失敗しました");
  }

  return data;
}

async function startToolBoxScan() {
  toolInventoryMode = "box";
  await startToolCamera();
  showToolMessage("工具箱QRをスキャン中...");
}

async function startToolScan() {
  if (!currentToolBoxId) {
    showToolMessage("先に工具箱QRをスキャンしてください。", false);
    return;
  }

  toolInventoryMode = "tool";
  await startToolCamera();
  showToolMessage("工具QRをスキャン中...");
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

    showToolMessage(`✅ 工具箱 ${boxId} を読み込みました。登録工具：${Object.keys(expectedToolMap).length} 件`, true);

  } catch (e) {
    console.error(e);
    showToolMessage(`❌ 工具箱の読み込みに失敗しました：${e.message || e}`, false);
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
    showToolMessage(`✅ スキャン済み：${id}`, true);
  } else {
    showToolMessage(`⚠️ 余分な工具：${id} は ${currentToolBoxId} に属しません`, false);
  }
}

function renderScannedToolList() {
  const ul = document.getElementById("scannedToolList");
  if (!ul) return;

  if (!scannedToolIds.length) {
    ul.innerHTML = "<li>まだ工具をスキャンしていません</li>";
    return;
  }

  ul.innerHTML = scannedToolIds.map(id => {
    const ok = !!expectedToolMap[id];
    return `<li style="color:${ok ? "green" : "red"};">${escapeHtml(id)} ${ok ? "" : "（余分）"}</li>`;
  }).join("");
}

function finishToolInventory() {
  if (!currentToolBoxId) {
    showToolMessage("先に工具箱QRをスキャンしてください。", false);
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
      <p><b>登録数：</b>${expectedIds.length}</p>
      <p><b>スキャン数：</b>${scannedIds.length}</p>
      <p><b>不足：</b>${missingIds.length}</p>
      <p><b>余分：</b>${extraIds.length}</p>
      <p><b>貸出中：</b>${borrowedTools.length}</p>

      <h4>不足工具</h4>
      ${missingIds.length ? missingIds.map(id => {
        const t = expectedToolMap[id] || {};
        return `<div style="color:red;">- ${escapeHtml(id)} ${escapeHtml(t.toolName || "")}</div>`;
      }).join("") : "<div>なし</div>"}

      <h4>余分な工具</h4>
      ${extraIds.length ? extraIds.map(id => `
        <div style="color:red;">- ${escapeHtml(id)}</div>
      `).join("") : "<div>なし</div>"}

      <h4>貸出中の工具</h4>
      ${borrowedTools.length ? borrowedTools.map(t => `
        <div style="color:#d97706;">
          - ${escapeHtml(t.toolId)} ${escapeHtml(t.toolName || "")}
          / 借用者：${escapeHtml(t.borrower || "-")}
        </div>
      `).join("") : "<div>なし</div>"}
    </div>
  `;

  showToolMessage("✅ 棚卸が完了しました。", missingIds.length === 0 && extraIds.length === 0);
}

/* =========================
   工具借出 / 返還
========================= */
let toolRentalHtml5Qrcode = null;
let currentRentalTool = null;

async function startToolRentalScan() {
  const id = "toolRentalReader";
  const target = document.getElementById(id);

  if (!target) {
    alert("找不到 toolRentalReader");
    return;
  }

  await stopAllCameras();

  target.innerHTML = "";
  toolRentalHtml5Qrcode = new Html5Qrcode(id);

  const formats = getFormatsToSupport();

  const config = {
    fps: 10,
    qrbox: { width: 280, height: 280 },
    ...(formats ? { formatsToSupport: formats } : {}),
    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
  };

  try {
    await toolRentalHtml5Qrcode.start(
      { facingMode: "environment" },
      config,
      async decodedText => {
        console.log("[TOOL RENTAL SCAN OK]", decodedText);
        await onToolRentalScanSuccess(decodedText);
        await stopScanner(toolRentalHtml5Qrcode);
        toolRentalHtml5Qrcode = null;
      },
      () => {}
    );
  } catch (err) {
    console.error(err);
    showToolRentalMessage("❌ 工具貸出／返却カメラの起動に失敗しました：" + (err?.message || err), false);
  }
}

async function onToolRentalScanSuccess(decodedText) {
  const qrRaw = parseQrText(decodedText);
  const q = normalizeToolQr(qrRaw);

  const toolId = String(q.toolId || decodedText || "").trim();

  if (!toolId) {
    showToolRentalMessage("❌ ToolID を取得できません。", false);
    return;
  }

  setText("rentalToolId", toolId);
  setText("rentalToolName", "-");
  setText("rentalToolStatus", "読み込み中...");
  currentRentalTool = null;

  try {
    const url = `${API_BASE}?action=tool_item&toolId=${encodeURIComponent(toolId)}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("tool_item 回傳不是 JSON：" + text.slice(0, 200));
    }

    if (!data || data.status !== "ok") {
      const form = document.getElementById("newToolForm");
        if (form) form.style.display = "block";

        setText("newToolId", toolId);
        setText("rentalToolId", toolId);
        setText("rentalToolName", "-");
        setText("rentalToolStatus", "未登録");

        setValue("newToolName", q.toolName || "");
        setValue("newToolBoxId", q.boxId || "");
        setValue("newToolBoxName", q.boxName || q.boxId || "");
        setValue("newToolCategory", q.category || "");
        setValue("newToolTana", q.tana || "");
        setValue("newToolRemark", q.remark || "");

        currentRentalTool = {
          toolId,
          sid: q.sid || "",
          boxId: q.boxId || "",
          boxName: q.boxName || q.boxId || "",
          category: q.category || "",
          toolName: q.toolName || "",
          tana: q.tana || "",
          remark: q.remark || ""
        };

        showToolRentalMessage("⚠️ 工具が未登録です。先に登録してください。", false);
        return;
    }

    currentRentalTool = data.tool || {};

    setText("rentalToolId", currentRentalTool.toolId || toolId);
    setText("rentalToolName", currentRentalTool.toolName || "-");
    setText("rentalToolStatus", displayToolStatus_(currentRentalTool.status));
    setValue("rentalToolDescription", currentRentalTool.toolName || "");
    updateRentalMode_(currentRentalTool.status);

    showToolRentalMessage("✅ 工具を読み込みました。", true);

  } catch (e) {
    console.error(e);
    showToolRentalMessage("❌ 工具の読み込みに失敗しました：" + (e.message || e), false);
  }
}

async function borrowToolAction() {
  if (!currentRentalTool || !currentRentalTool.toolId) {
    showToolRentalMessage("❌ 請先掃描工具 QR。", false);
    return;
  }

  const borrower = String(document.getElementById("toolBorrower")?.value || "").trim();

  if (!borrower) {
    showToolRentalMessage("❌ 請輸入借用人。", false);
    return;
  }

  try {
    const res = await postForm_(API_BASE, {
      action: "tool_borrow",
      toolId: currentRentalTool.toolId,
      borrower
    });

    if (res.status !== "ok") {
      throw new Error(res.message || "借出失敗");
    }

    currentRentalTool.status = "借出";
    currentRentalTool.borrower = borrower;

    setText("rentalToolStatus", "借出");
    showToolRentalMessage("✅ 借出成功。", true);

  } catch (e) {
    console.error(e);
    showToolRentalMessage("❌ 借出失敗：" + (e.message || e), false);
  }
}

async function returnToolAction() {
  if (!currentRentalTool || !currentRentalTool.toolId) {
    showToolRentalMessage("❌ 請先掃描工具 QR。", false);
    return;
  }

  const borrower = String(document.getElementById("toolBorrower")?.value || "").trim();

  if (!borrower) {
    showToolRentalMessage("❌ 請輸入借用/返還人姓名。", false);
    return;
  }

  try {
    const res = await postForm_(API_BASE, {
      action: "tool_return",
      toolId: currentRentalTool.toolId,
      borrower
    });

    if (res.status !== "ok") {
      throw new Error(res.message || "返還失敗");
    }

    currentRentalTool.status = "在庫";
    setText("rentalToolStatus", "在庫");
    showToolRentalMessage("✅ 返還成功。", true);

  } catch (e) {
    console.error(e);
    showToolRentalMessage("❌ 返還失敗：" + (e.message || e), false);
  }
}

function showToolRentalMessage(message, success = true) {
  const el = document.getElementById("toolRentalMessage");
  if (!el) return;
  el.innerHTML = `<p style="color:${success ? "green" : "red"};">${escapeHtml(message)}</p>`;
}

/* =========================
   工具搜尋：目前先支援 ToolID 單筆查詢
========================= */
async function searchTools() {
  const input = document.getElementById("toolSearchInput");
  const result = document.getElementById("toolSearchResult");
  const keyword = String(input?.value || "").trim();

  if (!result) return;

  if (!keyword) {
    result.innerHTML = `<span style="color:red;">検索キーワードを入力してください。</span>`;
    return;
  }

  result.innerHTML = "検索中...";

  try {
    const url = `${API_BASE}?action=tool_item&toolId=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("tool_item 回傳不是 JSON：" + text.slice(0, 200));
    }

    if (!data || data.status !== "ok") {
      result.innerHTML = `<span style="color:red;">該当する工具はありません。</span>`;
      return;
    }

    const t = data.tool || {};

    result.innerHTML = `
      <div style="border:1px solid #ccc; padding:12px; margin-top:10px;">
        <b>${escapeHtml(t.toolName || "-")}</b><br>
        ToolID：${escapeHtml(t.toolId || "-")}<br>
        SID：${escapeHtml(t.sid || "-")}<br>
        BoxID：${escapeHtml(t.boxId || "-")}<br>
        保管棚：${escapeHtml(t.tana || "-")}<br>
        状態：<b>${escapeHtml(displayToolStatus_(t.status))}</b><br>
        借用者：${escapeHtml(t.borrower || "-")}
      </div>
    `;

  } catch (e) {
    console.error(e);
    result.innerHTML = `<span style="color:red;">検索失敗：${escapeHtml(e.message || e)}</span>`;
  }
}

async function registerNewToolAction() {
  const toolId = String(document.getElementById("newToolId")?.textContent || "").trim();
  const toolName = String(document.getElementById("newToolName")?.value || "").trim();
  const boxId = String(document.getElementById("newToolBoxId")?.value || "").trim();
  const boxName = String(document.getElementById("newToolBoxName")?.value || boxId || "").trim();
  const category = String(document.getElementById("newToolCategory")?.value || "").trim();
  const sid = String(currentRentalTool?.sid || "").trim();
  const tana = String(document.getElementById("newToolTana")?.value || "").trim();
  const remark = String(document.getElementById("newToolRemark")?.value || "").trim();

  if (!toolId || toolId === "-") {
    showToolRentalMessage("❌ ToolIDが不明です。先に工具QRをスキャンしてください。", false);
    return;
  }

  if (!toolName) {
    showToolRentalMessage("❌ 工具名を入力してください。", false);
    return;
  }

  try {
    const res = await postForm_(API_BASE, {
      action: "tool_register",
      toolId,
      sid,
      toolName,
      boxId,
      boxName,
      category,
      tana,
      remark
    });

    if (res.status !== "ok") {
      throw new Error(res.message || "工具の登録に失敗しました");
    }

    currentRentalTool = res.tool || {
      toolId,
      toolName,
      boxId,
      category,
      tana,
      status: "在庫"
    };

    setText("rentalToolId", toolId);
    setText("rentalToolName", toolName);
    setText("rentalToolStatus", "在庫");
    updateRentalMode_("在庫");

    const form = document.getElementById("newToolForm");
    if (form) form.style.display = "none";

    showToolRentalMessage("✅ 工具を登録しました。", true);

  } catch (e) {
    console.error(e);
    showToolRentalMessage("❌ 工具の登録に失しました：" + (e.message || e), false);
  }
}

/* =========================
   Audit search / rental receipt (v2)
========================= */
let lastHistoryRows = [];
let lastRentalRows = [];
let currentRentalReceipt = null;
const signaturePads = {};

function toLocalInputValue_(date) {
  const d = date instanceof Date ? date : new Date(date);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function demoHistory_() {
  const now = Date.now();
  return [
    { timeText: new Date(now - 36e5).toLocaleString("ja-JP"), type: "出庫", productName: "真空ポンプシール", code: "VP-SEAL-024", serialNo: "S240081", qty: 2, stockBefore: 12, stockAfter: 10, reason: "RFエリア定期交換", operator: "Jason" },
    { timeText: new Date(now - 864e5).toLocaleString("ja-JP"), type: "入庫", productName: "M8 ステンレスボルト", code: "SUS-M8-030", serialNo: "", qty: 50, stockBefore: 18, stockAfter: 68, reason: "定期補充", operator: "山口" },
    { timeText: new Date(now - 1728e5).toLocaleString("ja-JP"), type: "出庫", productName: "加速器温度センサー", code: "TMP-PT100", serialNo: "PT-0192", qty: 1, stockBefore: 4, stockAfter: 3, reason: "故障交換", operator: "Jeffrey" }
  ];
}

async function fetchStockHistory_(filters) {
  if (IS_DEMO_MODE) return demoHistory_();
  const qs = new URLSearchParams({ action:"log_search", q:filters.keyword, type:filters.type, from:filters.from, to:filters.to, _t:Date.now() });
  const res = await fetch(`${API_BASE}?${qs}`, { cache:"no-store" });
  const data = await res.json();
  if (data.status !== "ok") throw new Error(data.message || "履歴の読み込みに失敗しました");
  return Array.isArray(data.logs) ? data.logs : [];
}

async function searchStockHistory() {
  const body = document.getElementById("historyBody");
  const filters = { keyword:document.getElementById("historyKeyword")?.value.trim() || "", type:document.getElementById("historyType")?.value || "", from:document.getElementById("historyFrom")?.value || "", to:document.getElementById("historyTo")?.value || "" };
  body.innerHTML = `<tr><td colspan="8" class="empty-cell">読み込み中...</td></tr>`;
  try {
    lastHistoryRows = await fetchStockHistory_(filters);
    document.getElementById("historySummary").textContent = `${lastHistoryRows.length} 件の操作履歴`;
    body.innerHTML = lastHistoryRows.length ? lastHistoryRows.map(r => `<tr><td>${escapeHtml(r.timeText)}</td><td><span class="type-badge ${String(r.type).includes("入") ? "type-in":"type-out"}">${escapeHtml(r.type)}</span></td><td><b>${escapeHtml(r.productName || "-")}</b></td><td>${escapeHtml(r.code || "-")}<br><small>${escapeHtml(r.serialNo || "")}</small></td><td>${escapeHtml(r.qty)}</td><td>${escapeHtml(r.stockBefore)} → ${escapeHtml(r.stockAfter)}</td><td>${escapeHtml(r.reason || "-")}</td><td>${escapeHtml(r.operator || "-")}</td></tr>`).join("") : `<tr><td colspan="8" class="empty-cell">該当するデータがありません</td></tr>`;
  } catch (e) { body.innerHTML = `<tr><td colspan="8" class="empty-cell">読み込みに失敗しました：${escapeHtml(e.message)}</td></tr>`; }
}

function exportHistoryCsv() {
  if (!lastHistoryRows.length) return alert("先に履歴を検索してください。");
  const rows = [["日時","種別","部品", "Drawing No.","Serial No.","数量","変動前在庫","変動後在庫","理由","担当者"], ...lastHistoryRows.map(r => [r.timeText,r.type,r.productName,r.code,r.serialNo,r.qty,r.stockBefore,r.stockAfter,r.reason,r.operator])];
  const csv = "\ufeff" + rows.map(row => row.map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), { href:URL.createObjectURL(new Blob([csv],{type:"text/csv"})), download:`inventory-log-${new Date().toISOString().slice(0,10)}.csv` }); a.click(); URL.revokeObjectURL(a.href);
}

function initSignaturePad_(id) {
  const canvas = document.getElementById(id); if (!canvas) return;
  const ctx = canvas.getContext("2d"); ctx.lineWidth=2.4; ctx.lineCap="round"; ctx.strokeStyle="#17212b";
  let drawing=false, signed=false;
  const point = e => { const r=canvas.getBoundingClientRect(), p=e.touches?.[0] || e; return {x:(p.clientX-r.left)*canvas.width/r.width,y:(p.clientY-r.top)*canvas.height/r.height}; };
  const start=e=>{ e.preventDefault(); drawing=true; signed=true; const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y); };
  const move=e=>{ if(!drawing)return;e.preventDefault();const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke(); };
  const end=()=>{drawing=false};
  canvas.addEventListener("pointerdown",start);canvas.addEventListener("pointermove",move);window.addEventListener("pointerup",end);
  signaturePads[id]={ canvas, clear(){ctx.clearRect(0,0,canvas.width,canvas.height);signed=false}, hasInk(){return signed}, data(){return signed?canvas.toDataURL("image/png"):""} };
}
function clearSignature(id){ signaturePads[id]?.clear(); }

function updateRentalMode_(status) {
  const isBorrowed = String(status || "").trim() === "借出";
  document.querySelectorAll(".borrow-only").forEach(el => el.classList.toggle("is-hidden", isBorrowed));
  document.querySelectorAll(".return-only").forEach(el => el.classList.toggle("is-hidden", !isBorrowed));
  document.getElementById("borrowerSignatureBox")?.classList.toggle("is-hidden", isBorrowed);
  document.getElementById("returnSignatureBox")?.classList.toggle("is-hidden", !isBorrowed);
  document.getElementById("borrowActionBtn")?.classList.toggle("is-hidden", isBorrowed);
  document.getElementById("returnActionBtn")?.classList.toggle("is-hidden", !isBorrowed);
  if (isBorrowed) setValue("actualReturnDate", toLocalInputValue_(new Date()));
}

function rentalPayload_() {
  return { action:"tool_borrow_receipt", toolId:currentRentalTool?.toolId || document.getElementById("rentalToolId")?.textContent || "", toolName:document.getElementById("rentalToolDescription")?.value.trim() || currentRentalTool?.toolName || "", borrower:document.getElementById("toolBorrower")?.value.trim() || "", borrowDate:document.getElementById("borrowDate")?.value || "", expectedReturnDate:document.getElementById("expectedReturnDate")?.value || "", operator:document.getElementById("rentalOperator")?.value || "", note:document.getElementById("rentalNote")?.value.trim() || "", borrowerSignature:signaturePads.borrowerSignature?.data() || "" };
}

async function borrowToolAction() {
  const p=rentalPayload_();
  if (!p.toolId || p.toolId === "-") return showToolRentalMessage("❌ 先に工具QRをスキャンしてください。",false);
  if (!p.borrower || !p.expectedReturnDate || !p.operator) return showToolRentalMessage("❌ 借用者、返却予定日、現場担当者を入力してください。",false);
  if (!signaturePads.borrowerSignature?.hasInk()) return showToolRentalMessage("❌ 借用者が貸出署名を行ってください。",false);
  try { const res=IS_DEMO_MODE?{status:"ok",rentalId:`TR-${Date.now()}`} : await postForm_(API_BASE,p); if(res.status!=="ok")throw new Error(res.message||"貸出に失敗しました"); currentRentalReceipt={...p,rentalId:res.rentalId,status:"借出中"}; if(currentRentalTool)currentRentalTool.status="借出"; setText("rentalToolStatus","貸出中"); clearSignature("operatorSignature"); updateRentalMode_("借出"); showToolRentalMessage(`✅ 受付番号 ${res.rentalId || ""} を登録しました。返却時は受取担当者が署名してください。`,true); searchRentalHistory(); } catch(e){showToolRentalMessage(`❌ 貸出に失敗しました：${e.message}`,false)}
}

async function returnToolAction() {
  if(!currentRentalTool?.toolId && !currentRentalReceipt?.toolId)return showToolRentalMessage("❌ 先に工具をスキャンするか、貸出受付を選択してください。",false);
  const returnOperator = document.getElementById("rentalOperator")?.value || "";
  if (!returnOperator) return showToolRentalMessage("❌ 工具を受け取る現場担当者を選択してください。", false);
  if (!signaturePads.operatorSignature?.hasInk()) return showToolRentalMessage("❌ 受取担当者は検品後に署名してください。", false);
  const actual=toLocalInputValue_(new Date()); setValue("actualReturnDate",actual);
  try{const res=IS_DEMO_MODE?{status:"ok"}:await postForm_(API_BASE,{action:"tool_return_receipt",toolId:currentRentalTool?.toolId||currentRentalReceipt.toolId,actualReturnDate:actual,operator:returnOperator,operatorSignature:signaturePads.operatorSignature.data()});if(res.status!=="ok")throw new Error(res.message||"返却に失敗しました");if(currentRentalTool)currentRentalTool.status="在庫";setText("rentalToolStatus","在庫");clearSignature("borrowerSignature");clearSignature("operatorSignature");updateRentalMode_("在庫");showToolRentalMessage("✅ 受取担当者の署名と実返却日時を記録しました。",true);searchRentalHistory()}catch(e){showToolRentalMessage(`❌ 返却に失敗しました：${e.message}`,false)}
}

function demoRentals_(){return [currentRentalReceipt || {rentalId:"TR-20260818-001",toolId:"TL-TQ-018",toolName:"デジタルトルクレンチ",borrower:"山田太郎",operator:"Jason",returnOperator:"",borrowDate:"2026-08-18 09:20",expectedReturnDate:"2026-08-22",actualReturnDate:"",status:"借出中",note:"加速器Aエリア定期保守",operatorSignature:"",borrowerSignature:"署名済み"}];}

async function searchRentalHistory() {
  const el = document.getElementById("rentalHistoryList");
  const q = document.getElementById("rentalHistoryKeyword")?.value.trim() || "";
  const status = document.getElementById("rentalHistoryStatus")?.value || "";
  try {
    if (IS_DEMO_MODE) {
      lastRentalRows = demoRentals_();
    } else {
      const p = new URLSearchParams({action:"tool_rentals",q,status,_t:Date.now()});
      const d = await fetch(`${API_BASE}?${p}`,{cache:"no-store"}).then(r=>r.json());
      if (d.status !== "ok") throw new Error(d.message || "貸出・返却履歴の読み込みに失敗しました");
      lastRentalRows = Array.isArray(d.rentals) ? d.rentals : [];
    }

    el.innerHTML = lastRentalRows.length ? lastRentalRows.map(r=>`
      <article class="rental-card">
        <div class="rental-card-top"><div><b>${escapeHtml(r.toolName||"-")}</b><div>${escapeHtml(r.toolId)} · ${escapeHtml(r.rentalId||"")}</div></div><span class="type-badge ${r.status==="已歸還"?"type-in":"type-out"}">${escapeHtml(displayToolStatus_(r.status))}</span></div>
        <div class="rental-meta"><div><span>借用者</span>${escapeHtml(r.borrower)}</div><div><span>貸出担当者</span>${escapeHtml(r.operator)}</div><div><span>受取担当者</span>${escapeHtml(r.returnOperator||"未返却")}</div><div><span>貸出日時 / 返却予定日</span>${escapeHtml(r.borrowDate)}<br>${escapeHtml(r.expectedReturnDate)}</div><div><span>実返却日時</span>${escapeHtml(r.actualReturnDate||"未返却")}</div></div>
        ${r.note?`<p>${escapeHtml(r.note)}</p>`:""}
      </article>`).join("") : `<div class="empty-message">該当する貸出・返却履歴がありません</div>`;
  } catch(e) {
    lastRentalRows = [];
    el.innerHTML = `<div class="empty-message">読み込みに失敗しました：${escapeHtml(e.message)}</div>`;
  }
}

function exportRentalHistoryExcel() {
  if (!lastRentalRows.length) return alert("出力する貸出・返却履歴を先に検索してください。");
  const values = [[
    "受付番号","ToolID","工具名","借用者","貸出日時","返却予定日",
    "実返却日時","貸出担当者","受取担当者","状態","備考","受取担当者署名","借用者署名"
  ], ...lastRentalRows.map(r => [
    r.rentalId||"",r.toolId||"",r.toolName||"",r.borrower||"",r.borrowDate||"",
    r.expectedReturnDate||"",r.actualReturnDate||"",r.operator||"",r.returnOperator||"",r.status||"",r.note||"",
    r.operatorSignature?"署名済み":"未署名",r.borrowerSignature?"署名済み":"未署名"
  ])];
  const csv = "\ufeff" + values.map(row => row.map(value =>
    `"${String(value ?? "").replaceAll('"','""')}"`
  ).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  const link = Object.assign(document.createElement("a"), {
    href:url,
    download:`工具貸出返却履歴_${new Date().toISOString().slice(0,10)}.csv`
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener("DOMContentLoaded",()=>{
  ["operatorSignature","borrowerSignature"].forEach(initSignaturePad_);
  setValue("borrowDate",toLocalInputValue_(new Date()));
  const expected=new Date();expected.setDate(expected.getDate()+7);setValue("expectedReturnDate",expected.toISOString().slice(0,10));
  loadOperatorsTo("rentalOperator");
  updateRentalMode_("在庫");
  ["historyKeyword","rentalHistoryKeyword"].forEach(id=>document.getElementById(id)?.addEventListener("keydown",e=>{if(e.key==="Enter")(id==="historyKeyword"?searchStockHistory:searchRentalHistory)()}));
});
