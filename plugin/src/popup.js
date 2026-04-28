const MAX_TICKET_HISTORY = 30;

const selectAreaBtn = document.querySelector("#selectAreaBtn");
const selectAreaEmptyBtn = document.querySelector("#selectAreaEmptyBtn");
const selectElementBtn = document.querySelector("#selectElementBtn");
const selectElementEmptyBtn = document.querySelector("#selectElementEmptyBtn");
const settingsBtn = document.querySelector("#settingsBtn");
const sendBtn = document.querySelector("#sendBtn");
const copyTicketBtn = document.querySelector("#copyTicketBtn");
const clearCapturesBtn = document.querySelector("#clearCapturesBtn");
const tokenPanel = document.querySelector("#tokenPanel");
const serverUrlInput = document.querySelector("#serverUrlInput");
const tokenInput = document.querySelector("#tokenInput");
const saveTokenBtn = document.querySelector("#saveTokenBtn");
const commentInput = document.querySelector("#commentInput");
const attachmentsInput = document.querySelector("#attachmentsInput");
const attachmentsList = document.querySelector("#attachmentsList");
const screenshotsList = document.querySelector("#screenshotsList");
const captureHeaderLabel = document.querySelector("#captureHeaderLabel");
const previewImage = document.querySelector("#previewImage");
const emptyState = document.querySelector("#emptyState");
const emptyStateTitle = document.querySelector("#emptyStateTitle");
const emptyStateBody = document.querySelector("#emptyStateBody");
const pageTitle = document.querySelector("#pageTitle");
const ticketResult = document.querySelector("#ticketResult");
const historyViewBar = document.querySelector("#historyViewBar");
const historyViewTitle = document.querySelector("#historyViewTitle");
const historyViewMeta = document.querySelector("#historyViewMeta");
const returnToDraftBtn = document.querySelector("#returnToDraftBtn");
const ticketLookupInput = document.querySelector("#ticketLookupInput");
const ticketLookupBtn = document.querySelector("#ticketLookupBtn");
const ticketHistorySection = document.querySelector("#ticketHistorySection");
const ticketHistoryList = document.querySelector("#ticketHistoryList");
const clearTicketHistoryBtn = document.querySelector("#clearTicketHistoryBtn");
const statusNode = document.querySelector("#status");

let currentCapture = null;
let screenshots = [];
let attachments = [];
let lastTicketId = "";
let ticketHistory = [];
let serverUrl = "";
let accessToken = "";
let settingsPanelOpen = false;
let activeHistoryTicket = null;
let busy = false;

init();

async function init() {
  const saved = await chrome.storage.local.get([
    "accessToken",
    "attachments",
    "draftScreenshots",
    "lastComment",
    "selectedCaptureId",
    "serverUrl",
    "ticketHistory"
  ]);
  serverUrl = saved.serverUrl || "";
  accessToken = saved.accessToken || "";
  serverUrlInput.value = serverUrl;
  commentInput.value = saved.lastComment || "";
  screenshots = Array.isArray(saved.draftScreenshots) ? saved.draftScreenshots : [];
  attachments = Array.isArray(saved.attachments) ? saved.attachments : [];
  ticketHistory = sanitizeTicketHistory(saved.ticketHistory);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  pageTitle.textContent = tab?.title || "Current tab";
  await updateBadge();

  selectAreaBtn.addEventListener("click", startAreaSelection);
  selectAreaEmptyBtn.addEventListener("click", startAreaSelection);
  selectElementBtn.addEventListener("click", startElementSelection);
  selectElementEmptyBtn.addEventListener("click", startElementSelection);
  settingsBtn.addEventListener("click", toggleSettingsPanel);
  sendBtn.addEventListener("click", createTicket);
  copyTicketBtn.addEventListener("click", copyTicket);
  clearCapturesBtn.addEventListener("click", clearCaptures);
  saveTokenBtn.addEventListener("click", saveToken);
  clearTicketHistoryBtn.addEventListener("click", clearTicketHistory);
  returnToDraftBtn.addEventListener("click", showCurrentDraft);
  ticketLookupBtn.addEventListener("click", openTicketFromLookup);
  ticketLookupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void openTicketFromLookup();
    }
  });
  attachmentsInput.addEventListener("change", loadAttachments);
  commentInput.addEventListener("input", saveSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes.draftScreenshots) {
      if (activeHistoryTicket) {
        const draftCount = Array.isArray(changes.draftScreenshots.newValue)
          ? changes.draftScreenshots.newValue.length
          : 0;
        void updateBadge(draftCount);
      } else {
        screenshots = Array.isArray(changes.draftScreenshots.newValue)
          ? changes.draftScreenshots.newValue
          : [];
        renderScreenshots();
        selectCapture(changes.selectedCaptureId?.newValue || currentCapture?.id || screenshots.at(-1)?.id || null);
        void updateBadge();
      }
    }

    if (changes.attachments) {
      if (!activeHistoryTicket) {
        attachments = Array.isArray(changes.attachments.newValue) ? changes.attachments.newValue : [];
        renderAttachments();
      }
    }

    if (changes.lastComment?.newValue !== undefined) {
      if (!activeHistoryTicket) {
        commentInput.value = changes.lastComment.newValue || "";
      }
    }

    if (changes.accessToken?.newValue !== undefined) {
      accessToken = changes.accessToken.newValue || "";
      renderTokenPanel();
    }

    if (changes.serverUrl?.newValue !== undefined) {
      serverUrl = changes.serverUrl.newValue || "";
      serverUrlInput.value = serverUrl;
      renderTokenPanel();
    }

    if (changes.ticketHistory) {
      ticketHistory = sanitizeTicketHistory(changes.ticketHistory.newValue);
      renderTicketHistory();
    }
  });

  renderTokenPanel();
  renderAttachments();
  renderScreenshots();
  renderTicketHistory();
  selectCapture(saved.selectedCaptureId || screenshots.at(-1)?.id || null);
}

async function startAreaSelection() {
  await startCaptureSelection("START_AREA_SELECTION", "Starting area selection...");
}

async function startElementSelection() {
  await startCaptureSelection("START_ELEMENT_SELECTION", "Starting element picker...");
}

async function startCaptureSelection(messageType, message) {
  if (activeHistoryTicket) {
    return;
  }

  setBusy(true, message);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !canAccessTab(tab.url)) {
      throw new Error("Capture is available on normal web pages.");
    }

    await sendStartSelectionMessage(tab.id, messageType);
    window.close();
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error));
  }
}

async function createTicket() {
  if (activeHistoryTicket) {
    return;
  }

  if (!screenshots.length) {
    return;
  }

  if (!serverUrl || !accessToken) {
    renderTokenPanel(true);
    setStatus("Add backend URL and token before creating a ticket.");
    return;
  }

  await saveSettings();
  setBusy(true, "Creating ticket...");

  const result = await chrome.runtime.sendMessage({
    type: "CREATE_TICKET",
    payload: {
      serverUrl,
      token: accessToken,
      comment: commentInput.value.trim(),
      screenshot: toTicketScreenshot(currentCapture || screenshots[0]),
      screenshots: screenshots.map(toTicketScreenshot),
      attachments,
      metadata: {
        screenshotCount: screenshots.length,
        primaryScreenshotId: currentCapture?.id || screenshots[0].id
      }
    }
  });

  if (!result?.ok) {
    setBusy(false, getFailureMessage(result, "Ticket creation failed."));
    return;
  }

  const ticket = normalizeTicketResponse(result.body);
  lastTicketId = ticket.id;
  showTicket(ticket);
  await saveTicketHistory(ticket);
  setBusy(false, `Created ${ticket.id}.`);
}

async function clearCaptures() {
  if (activeHistoryTicket) {
    return;
  }

  screenshots = [];
  attachments = [];
  attachmentsInput.value = "";
  commentInput.value = "";
  currentCapture = null;
  previewImage.hidden = true;
  previewImage.removeAttribute("src");
  emptyState.hidden = false;
  renderAttachments();
  renderScreenshots();
  await persistDraft();
  await chrome.action.setBadgeText({ text: "" });
  resetTicket();
  setBusy(false, "Draft cleared.");
}

async function clearTicketHistory() {
  ticketHistory = [];
  await chrome.storage.local.set({ ticketHistory });
  renderTicketHistory();
  setStatus("Ticket history cleared.");
}

async function saveSettings() {
  if (activeHistoryTicket) {
    return;
  }

  await persistDraft();
}

async function saveToken() {
  const nextServerUrl = normalizeServerUrl(serverUrlInput.value);
  const token = tokenInput.value.trim();
  if (!nextServerUrl) {
    setStatus("Enter a backend URL, for example https://frami.example.com or frami.example.com.");
    serverUrlInput.focus();
    return;
  }

  if (!token) {
    setStatus("Paste a token before saving.");
    tokenInput.focus();
    return;
  }

  serverUrl = nextServerUrl;
  accessToken = token;
  await chrome.storage.local.set({ accessToken, serverUrl });
  tokenInput.value = accessToken;
  renderTokenPanel();
  setStatus("Backend settings saved.");
}

function toggleSettingsPanel() {
  renderTokenPanel(!settingsPanelOpen);
}

async function persistDraft() {
  if (activeHistoryTicket) {
    return;
  }

  await chrome.storage.local.set({
    attachments,
    draftScreenshots: screenshots,
    lastComment: commentInput.value,
    selectedCaptureId: currentCapture?.id || screenshots.at(-1)?.id || null
  });
  await updateBadge();
}

async function loadAttachments() {
  if (activeHistoryTicket) {
    attachmentsInput.value = "";
    return;
  }

  const files = Array.from(attachmentsInput.files || []);
  attachments = await Promise.all(files.map(readImageFile));
  renderAttachments();
  await persistDraft();
}

async function copyTicket() {
  if (!lastTicketId) {
    return;
  }

  await copyText(lastTicketId);
  setStatus(`Copied ${lastTicketId}.`);
}

async function copyTicketFromHistory(ticket) {
  await copyText(ticket.id);
  setStatus(`Copied ${ticket.id}.`);
}

async function viewTicketFromHistory(ticket) {
  await viewTicket(ticket, { remember: false });
}

async function openTicketFromLookup() {
  const id = normalizeTicketId(ticketLookupInput.value);
  if (!id) {
    setStatus("Enter a ticket ID like FRAMI-ABC123.");
    ticketLookupInput.focus();
    return;
  }

  await viewTicket({ id, serverUrl }, { remember: true });
}

async function viewTicket(ticket, options = {}) {
  if (!ticket?.id) {
    return;
  }

  const fetchServerUrl = normalizeServerUrl(ticket.serverUrl || serverUrl);
  if (!fetchServerUrl || !accessToken) {
    renderTokenPanel(true);
    setStatus("Open Settings and check the backend URL and token before viewing history.");
    return;
  }

  setBusy(true, `Loading ${ticket.id}...`);

  try {
    const response = await fetch(`${fetchServerUrl}/tickets/${encodeURIComponent(ticket.id)}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new Error(getFailureMessage({ status: response.status, body }, `Could not load ${ticket.id}.`));
    }

    const loaded = normalizeHistoryTicket(body, ticket, fetchServerUrl);
    activeHistoryTicket = loaded;
    screenshots = loaded.screenshots;
    attachments = loaded.attachments;
    commentInput.value = loaded.comment;
    ticketLookupInput.value = loaded.id;
    currentCapture = screenshots[0] || null;
    lastTicketId = loaded.id;

    showTicket(loaded);
    renderAttachments();
    renderScreenshots();
    renderTicketHistory();
    showCurrentCapture();
    renderHistoryView();
    if (options.remember) {
      await saveLoadedTicketHistory(loaded);
    }
    setBusy(false, `Showing ${loaded.id}.`);
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error));
  }
}

async function showCurrentDraft() {
  const saved = await chrome.storage.local.get([
    "attachments",
    "draftScreenshots",
    "lastComment",
    "selectedCaptureId"
  ]);

  activeHistoryTicket = null;
  screenshots = Array.isArray(saved.draftScreenshots) ? saved.draftScreenshots : [];
  attachments = Array.isArray(saved.attachments) ? saved.attachments : [];
  commentInput.value = saved.lastComment || "";
  currentCapture = null;
  resetTicket();
  renderAttachments();
  renderScreenshots();
  renderTicketHistory();
  selectCapture(saved.selectedCaptureId || screenshots.at(-1)?.id || null);
  renderHistoryView();
  setStatus("Showing current draft.");
}

function renderAttachments() {
  attachmentsList.replaceChildren();

  for (const image of attachments) {
    const item = document.createElement("li");
    item.textContent = `${image.name} (${formatBytes(image.size)})`;
    attachmentsList.append(item);
  }
}

function renderScreenshots() {
  screenshotsList.replaceChildren();

  screenshots.forEach((screenshot, index) => {
    const item = document.createElement("li");
    item.className = "captureListItem";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "captureListButton";
    button.dataset.kind = screenshot.element ? "element" : "area";
    button.dataset.active = screenshot.id === currentCapture?.id ? "true" : "false";
    button.textContent = getCaptureLabel(screenshot, index);
    button.addEventListener("click", () => selectCapture(screenshot.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "captureDeleteButton";
    deleteButton.title = "Delete screenshot";
    deleteButton.setAttribute("aria-label", `Delete screenshot ${index + 1}`);
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteScreenshot(screenshot.id));

    item.append(button);
    if (!activeHistoryTicket) {
      item.append(deleteButton);
    }
    screenshotsList.append(item);
  });
}

async function deleteScreenshot(id) {
  const index = screenshots.findIndex((screenshot) => screenshot.id === id);
  if (index === -1) {
    return;
  }

  const wasActive = currentCapture?.id === id;
  screenshots = screenshots.filter((screenshot) => screenshot.id !== id);

  if (wasActive) {
    currentCapture = screenshots[index] || screenshots[index - 1] || screenshots.at(-1) || null;
  }

  showCurrentCapture();
  renderScreenshots();
  await persistDraft();
  resetTicket();
  setStatus("Screenshot deleted.");
}

function renderTicketHistory() {
  ticketHistoryList.replaceChildren();
  ticketHistorySection.hidden = !ticketHistory.length;

  for (const ticket of ticketHistory.slice(0, 8)) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const copyButton = document.createElement("button");
    const meta = document.createElement("span");
    const detail = document.createElement("span");

    item.className = "ticketHistoryItem";

    button.type = "button";
    button.className = "ticketHistoryButton";
    button.dataset.active = ticket.id === activeHistoryTicket?.id ? "true" : "false";
    button.addEventListener("click", () => viewTicketFromHistory(ticket));

    meta.className = "ticketHistoryMeta";
    meta.textContent = `${ticket.id} - ${formatHistoryTime(ticket.createdAt)} - ${ticket.screenshotCount || 0} shot${ticket.screenshotCount === 1 ? "" : "s"}`;

    detail.className = "ticketHistoryDetail";
    detail.textContent = getTicketHistoryDetail(ticket);

    copyButton.type = "button";
    copyButton.className = "ticketHistoryCopyButton";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => copyTicketFromHistory(ticket));

    button.append(meta, detail);
    item.append(button, copyButton);
    ticketHistoryList.append(item);
  }
}

function selectCapture(id) {
  currentCapture = screenshots.find((screenshot) => screenshot.id === id) || null;
  showCurrentCapture();
  renderScreenshots();
}

function showCurrentCapture() {
  if (!currentCapture) {
    previewImage.hidden = true;
    previewImage.removeAttribute("src");
    previewImage.alt = "No screenshot selected";
    emptyState.hidden = false;
    renderHistoryView();
    return;
  }

  previewImage.src = currentCapture.dataUrl;
  const captureIndex = screenshots.findIndex((screenshot) => screenshot.id === currentCapture?.id);
  previewImage.alt = captureIndex >= 0 ? getCaptureLabel(currentCapture, captureIndex) : "Selected screenshot";
  previewImage.hidden = false;
  emptyState.hidden = true;
  renderHistoryView();
}

function toTicketScreenshot(screenshot) {
  return {
    id: screenshot.id,
    dataUrl: screenshot.dataUrl,
    mimeType: screenshot.mimeType || "image/png",
    mode: screenshot.mode || "visible-tab",
    crop: screenshot.crop || null,
    capturedAt: screenshot.capturedAt,
    note: screenshot.note || screenshot.comment || "",
    tab: screenshot.tab,
    figma: screenshot.figma,
    page: screenshot.page,
    element: screenshot.element || null
  };
}

async function saveTicketHistory(ticket) {
  const primary = currentCapture || screenshots[0] || null;
  const nextTicket = {
    id: ticket.id,
    url: ticket.url || "",
    createdAt: new Date().toISOString(),
    comment: commentInput.value.trim(),
    screenshotCount: screenshots.length,
    attachmentCount: attachments.length,
    sourceTitle: primary?.tab?.title || primary?.page?.title || "",
    sourceUrl: primary?.tab?.url || primary?.page?.url || "",
    serverUrl
  };

  ticketHistory = [
    nextTicket,
    ...ticketHistory.filter((historyTicket) => historyTicket.id !== nextTicket.id)
  ].slice(0, MAX_TICKET_HISTORY);

  await chrome.storage.local.set({ ticketHistory });
  renderTicketHistory();
}

async function saveLoadedTicketHistory(ticket) {
  const primary = ticket.screenshots[0] || null;
  const nextTicket = {
    id: ticket.id,
    url: ticket.url || "",
    createdAt: ticket.createdAt || new Date().toISOString(),
    comment: ticket.comment || "",
    screenshotCount: ticket.screenshotCount || ticket.screenshots.length,
    attachmentCount: ticket.attachmentCount || ticket.attachments.length,
    sourceTitle: primary?.tab?.title || primary?.page?.title || "",
    sourceUrl: primary?.tab?.url || primary?.page?.url || "",
    serverUrl: ticket.serverUrl || serverUrl
  };

  ticketHistory = [
    nextTicket,
    ...ticketHistory.filter((historyTicket) => historyTicket.id !== nextTicket.id)
  ].slice(0, MAX_TICKET_HISTORY);

  await chrome.storage.local.set({ ticketHistory });
  renderTicketHistory();
}

function setBusy(isBusy, message) {
  busy = isBusy;
  renderHistoryView();
  setStatus(message);
}

function setStatus(message) {
  statusNode.textContent = message || "";
}

async function updateBadge(count = screenshots.length) {
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  if (count) {
    await chrome.action.setBadgeBackgroundColor({ color: "#1c5fca" });
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result)
      });
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function renderTokenPanel(forceOpen = false) {
  settingsPanelOpen = !Boolean(serverUrl && accessToken) || forceOpen;
  tokenPanel.hidden = !settingsPanelOpen;
  settingsBtn.textContent = settingsPanelOpen ? "Hide settings" : "Settings";
  if (!tokenPanel.hidden) {
    serverUrlInput.value = serverUrl || "";
    tokenInput.value = accessToken || "";
    window.setTimeout(() => (serverUrl ? tokenInput : serverUrlInput).focus(), 0);
  }
}

function renderHistoryView() {
  const viewingHistory = Boolean(activeHistoryTicket);

  historyViewBar.hidden = !viewingHistory;
  if (viewingHistory) {
    historyViewTitle.textContent = `Viewing ${activeHistoryTicket.id}`;
    historyViewMeta.textContent = `${activeHistoryTicket.screenshotCount || screenshots.length} shot${(activeHistoryTicket.screenshotCount || screenshots.length) === 1 ? "" : "s"}`;
    captureHeaderLabel.textContent = "Ticket assets";
    emptyStateTitle.textContent = "No screenshots on this ticket";
    emptyStateBody.textContent = "The ticket loaded, but it does not include screenshot captures.";
  } else {
    historyViewTitle.textContent = "Viewing ticket";
    historyViewMeta.textContent = "";
    captureHeaderLabel.textContent = "Draft";
    emptyStateTitle.textContent = "No screenshots yet";
    emptyStateBody.textContent = "Capture an area or pick a DOM element. You can repeat this on app and Figma tabs before creating a ticket.";
  }

  selectAreaBtn.disabled = busy || viewingHistory;
  selectAreaEmptyBtn.disabled = busy || viewingHistory;
  selectElementBtn.disabled = busy || viewingHistory;
  selectElementEmptyBtn.disabled = busy || viewingHistory;
  settingsBtn.disabled = busy;
  sendBtn.disabled = busy || viewingHistory || !currentCapture;
  copyTicketBtn.disabled = busy || !lastTicketId;
  clearCapturesBtn.disabled = busy || viewingHistory || !screenshots.length;
  clearCapturesBtn.hidden = viewingHistory;
  saveTokenBtn.disabled = busy;
  ticketLookupBtn.disabled = busy;
  ticketLookupInput.disabled = busy;
  attachmentsInput.disabled = viewingHistory;
  commentInput.disabled = viewingHistory;
}

function normalizeServerUrl(value) {
  let url = (value || "").trim().replace(/\/+$/, "");
  if (!url) {
    return "";
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function canAccessTab(url) {
  return Boolean(url && /^https?:/.test(url));
}

async function sendStartSelectionMessage(tabId, messageType) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: messageType });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: messageType });
  }
}

function getCaptureLabel(screenshot, index) {
  const source = screenshot.element ? "Element" : screenshot.figma?.fileKey ? "Figma" : "Tab";
  const title = screenshot.tab?.title || screenshot.page?.title || "Untitled";
  const note = screenshot.note || screenshot.comment || "";
  const element = screenshot.element?.selector || screenshot.element?.tag || "";
  return note
    ? `${index + 1}. ${source}: ${note}`
    : `${index + 1}. ${source}: ${element || title}`;
}

function normalizeTicketResponse(body) {
  if (typeof body === "object" && body) {
    return {
      id: body.id || body.ticketId || "ticket-created",
      url: body.url || body.ticketUrl || ""
    };
  }

  return {
    id: String(body || "ticket-created"),
    url: ""
  };
}

function normalizeTicketId(value) {
  const match = String(value || "").toUpperCase().match(/FRAMI-[A-Z0-9]{6}/);
  return match ? match[0] : "";
}

function normalizeHistoryTicket(body, historyTicket, fetchServerUrl) {
  const id = typeof body?.id === "string" && body.id ? body.id : historyTicket.id;
  const rawScreenshots = dedupeImageList([
    ...normalizeImageList(body?.screenshot),
    ...normalizeImageList(body?.screenshots)
  ]);

  const normalizedScreenshots = rawScreenshots
    .map((image, index) => normalizeHistoryScreenshot(image, id, index))
    .filter(Boolean);

  const normalizedAttachments = normalizeImageList(body?.attachments)
    .map((image, index) => normalizeHistoryAttachment(image, id, index))
    .filter(Boolean);

  return {
    id,
    url: typeof body?.url === "string" ? body.url : historyTicket.url || `${fetchServerUrl}/tickets/${id}`,
    createdAt: typeof body?.createdAt === "string" ? body.createdAt : historyTicket.createdAt || "",
    comment: typeof body?.comment === "string" ? body.comment : historyTicket.comment || "",
    screenshotCount: normalizedScreenshots.length,
    attachmentCount: normalizedAttachments.length,
    screenshots: normalizedScreenshots,
    attachments: normalizedAttachments,
    serverUrl: fetchServerUrl
  };
}

function normalizeImageList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
}

function dedupeImageList(images) {
  const seen = new Set();
  const deduped = [];

  for (const image of images) {
    const key = image.id || image.dataUrl || image.dataURL || JSON.stringify(image);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(image);
  }

  return deduped;
}

function normalizeHistoryScreenshot(image, ticketId, index) {
  const dataUrl = image.dataUrl || image.dataURL || "";
  if (typeof dataUrl !== "string" || !dataUrl) {
    return null;
  }

  return {
    ...image,
    id: typeof image.id === "string" && image.id ? image.id : `${ticketId}-screenshot-${index + 1}`,
    dataUrl,
    mimeType: image.mimeType || "image/png",
    note: image.note || image.comment || "",
    capturedAt: image.capturedAt || ""
  };
}

function normalizeHistoryAttachment(image, ticketId, index) {
  const dataUrl = image.dataUrl || image.dataURL || "";
  if (typeof dataUrl !== "string" || !dataUrl) {
    return null;
  }

  return {
    ...image,
    id: typeof image.id === "string" && image.id ? image.id : `${ticketId}-attachment-${index + 1}`,
    name: image.name || `attachment-${index + 1}`,
    dataUrl,
    mimeType: image.mimeType || "application/octet-stream",
    size: Number.isFinite(image.size) ? image.size : estimateDataUrlBytes(dataUrl)
  };
}

function showTicket(ticket) {
  ticketResult.hidden = false;
  ticketResult.textContent = ticket.url ? `${ticket.id}\n${ticket.url}` : ticket.id;
  copyTicketBtn.disabled = false;
}

function resetTicket() {
  lastTicketId = "";
  ticketResult.hidden = true;
  ticketResult.textContent = "";
  copyTicketBtn.disabled = true;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return "";
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizeTicketHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((ticket) => ticket && typeof ticket.id === "string" && ticket.id)
    .map((ticket) => ({
      id: ticket.id,
      url: typeof ticket.url === "string" ? ticket.url : "",
      createdAt: typeof ticket.createdAt === "string" ? ticket.createdAt : "",
      comment: typeof ticket.comment === "string" ? ticket.comment : "",
      screenshotCount: Number.isFinite(ticket.screenshotCount) ? ticket.screenshotCount : 0,
      attachmentCount: Number.isFinite(ticket.attachmentCount) ? ticket.attachmentCount : 0,
      sourceTitle: typeof ticket.sourceTitle === "string" ? ticket.sourceTitle : "",
      sourceUrl: typeof ticket.sourceUrl === "string" ? ticket.sourceUrl : "",
      serverUrl: typeof ticket.serverUrl === "string" ? ticket.serverUrl : ""
    }))
    .slice(0, MAX_TICKET_HISTORY);
}

function getTicketHistoryDetail(ticket) {
  if (ticket.comment) {
    return ticket.comment;
  }

  if (ticket.sourceTitle) {
    return ticket.sourceTitle;
  }

  if (ticket.sourceUrl) {
    return ticket.sourceUrl;
  }

  return "No comment";
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getFailureMessage(result, fallback) {
  if (result?.status === 401) {
    return "Unauthorized. Open Settings and check the backend URL and token.";
  }

  if (result?.error) {
    return result.error;
  }

  const body = result?.body;
  if (typeof body === "object" && body?.error) {
    return body.error;
  }

  if (typeof body === "string" && body) {
    return body;
  }

  return `${fallback} HTTP ${result?.status || "error"}.`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function formatBytes(value) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function estimateDataUrlBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    return 0;
  }

  const payload = dataUrl.slice(commaIndex + 1);
  return Math.round((payload.length * 3) / 4);
}
