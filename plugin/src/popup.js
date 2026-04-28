const MAX_TICKET_HISTORY = 30;

const selectAreaBtn = document.querySelector("#selectAreaBtn");
const selectAreaEmptyBtn = document.querySelector("#selectAreaEmptyBtn");
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
const previewImage = document.querySelector("#previewImage");
const emptyState = document.querySelector("#emptyState");
const pageTitle = document.querySelector("#pageTitle");
const ticketResult = document.querySelector("#ticketResult");
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
  settingsBtn.addEventListener("click", toggleSettingsPanel);
  sendBtn.addEventListener("click", createTicket);
  copyTicketBtn.addEventListener("click", copyTicket);
  clearCapturesBtn.addEventListener("click", clearCaptures);
  saveTokenBtn.addEventListener("click", saveToken);
  clearTicketHistoryBtn.addEventListener("click", clearTicketHistory);
  attachmentsInput.addEventListener("change", loadAttachments);
  commentInput.addEventListener("input", saveSettings);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes.draftScreenshots) {
      screenshots = Array.isArray(changes.draftScreenshots.newValue)
        ? changes.draftScreenshots.newValue
        : [];
      renderScreenshots();
      selectCapture(changes.selectedCaptureId?.newValue || currentCapture?.id || screenshots.at(-1)?.id || null);
      void updateBadge();
    }

    if (changes.attachments) {
      attachments = Array.isArray(changes.attachments.newValue) ? changes.attachments.newValue : [];
      renderAttachments();
    }

    if (changes.lastComment?.newValue !== undefined) {
      commentInput.value = changes.lastComment.newValue || "";
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
  setBusy(true, "Starting area selection...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !canAccessTab(tab.url)) {
      throw new Error("Area selection is available on normal web pages.");
    }

    await sendStartAreaMessage(tab.id);
    window.close();
  } catch (error) {
    setBusy(false, error instanceof Error ? error.message : String(error));
  }
}

async function createTicket() {
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
  screenshots = [];
  attachments = [];
  attachmentsInput.value = "";
  currentCapture = null;
  previewImage.hidden = true;
  previewImage.removeAttribute("src");
  emptyState.hidden = false;
  renderAttachments();
  renderScreenshots();
  await persistDraft();
  await chrome.action.setBadgeText({ text: "" });
  resetTicket();
  setBusy(false, "Screenshots cleared.");
}

async function clearTicketHistory() {
  ticketHistory = [];
  await chrome.storage.local.set({ ticketHistory });
  renderTicketHistory();
  setStatus("Ticket history cleared.");
}

async function saveSettings() {
  await persistDraft();
}

async function saveToken() {
  const nextServerUrl = normalizeServerUrl(serverUrlInput.value);
  const token = tokenInput.value.trim();
  if (!nextServerUrl) {
    setStatus("Enter a backend URL before saving.");
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
  await chrome.storage.local.set({
    attachments,
    draftScreenshots: screenshots,
    lastComment: commentInput.value,
    selectedCaptureId: currentCapture?.id || screenshots.at(-1)?.id || null
  });
  await updateBadge();
}

async function loadAttachments() {
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

    item.append(button, deleteButton);
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
    const meta = document.createElement("span");
    const detail = document.createElement("span");

    button.type = "button";
    button.className = "ticketHistoryButton";
    button.addEventListener("click", () => copyTicketFromHistory(ticket));

    meta.className = "ticketHistoryMeta";
    meta.textContent = `${ticket.id} - ${formatHistoryTime(ticket.createdAt)} - ${ticket.screenshotCount || 0} shot${ticket.screenshotCount === 1 ? "" : "s"}`;

    detail.className = "ticketHistoryDetail";
    detail.textContent = getTicketHistoryDetail(ticket);

    button.append(meta, detail);
    item.append(button);
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
    emptyState.hidden = false;
    sendBtn.disabled = true;
    clearCapturesBtn.disabled = !screenshots.length;
    return;
  }

  previewImage.src = currentCapture.dataUrl;
  previewImage.hidden = false;
  emptyState.hidden = true;
  sendBtn.disabled = false;
  clearCapturesBtn.disabled = false;
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
    page: screenshot.page
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

function setBusy(isBusy, message) {
  selectAreaBtn.disabled = isBusy;
  selectAreaEmptyBtn.disabled = isBusy;
  settingsBtn.disabled = isBusy;
  sendBtn.disabled = isBusy || !currentCapture;
  copyTicketBtn.disabled = isBusy || !lastTicketId;
  clearCapturesBtn.disabled = isBusy || !screenshots.length;
  saveTokenBtn.disabled = isBusy;
  setStatus(message);
}

function setStatus(message) {
  statusNode.textContent = message || "";
}

async function updateBadge() {
  await chrome.action.setBadgeText({ text: screenshots.length ? String(screenshots.length) : "" });
  if (screenshots.length) {
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
    window.setTimeout(() => (serverUrl && accessToken ? serverUrlInput : tokenInput).focus(), 0);
  }
}

function normalizeServerUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function canAccessTab(url) {
  return Boolean(url && /^https?:/.test(url));
}

async function sendStartAreaMessage(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "START_AREA_SELECTION" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return chrome.tabs.sendMessage(tabId, { type: "START_AREA_SELECTION" });
  }
}

function getCaptureLabel(screenshot, index) {
  const source = screenshot.figma?.fileKey ? "Figma" : "Tab";
  const title = screenshot.tab?.title || screenshot.page?.title || "Untitled";
  const note = screenshot.note || screenshot.comment || "";
  return note
    ? `${index + 1}. ${source} area: ${note}`
    : `${index + 1}. ${source} area: ${title}`;
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
