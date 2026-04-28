chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_VISIBLE_TAB") {
    captureVisibleTab(sendResponse);
    return true;
  }

  if (message?.type === "CREATE_TICKET") {
    createTicket(message.payload, sendResponse);
    return true;
  }

  if (message?.type === "AREA_SELECTED") {
    captureSelectedArea(sender.tab, message.rect, message.page, message.comment, null, sendResponse);
    return true;
  }

  if (message?.type === "ELEMENT_SELECTED") {
    captureSelectedArea(sender.tab, message.rect, message.page, message.comment, message.element, sendResponse);
    return true;
  }

  return false;
});

async function captureVisibleTab(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.windowId) {
      throw new Error("No active tab found.");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    const page = await getPageContext(tab);
    sendResponse({
      ok: true,
      screenshot: {
        dataUrl,
        capturedAt: new Date().toISOString(),
        tab: getTabMetadata(tab),
        figma: parseFigmaUrl(tab.url),
        page
      }
    });
  } catch (error) {
    sendResponse({ ok: false, error: getErrorMessage(error) });
  }
}

async function captureSelectedArea(tab, rect, page, comment, element, sendResponse) {
  try {
    if (!tab?.windowId) {
      throw new Error("No active tab found.");
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });

    const cropped = await cropDataUrl(dataUrl, rect);
    const capture = {
      id: createCaptureId(),
      dataUrl: cropped.dataUrl,
      originalDataUrl: dataUrl,
      mimeType: "image/png",
      mode: element ? "selected-element" : "selected-area",
      crop: cropped.crop,
      element: element || null,
      note: comment || "",
      capturedAt: new Date().toISOString(),
      tab: getTabMetadata(tab),
      figma: parseFigmaUrl(tab.url),
      page
    };

    const saved = await chrome.storage.local.get(["draftScreenshots"]);
    const draftScreenshots = Array.isArray(saved.draftScreenshots) ? saved.draftScreenshots : [];
    const nextScreenshots = [...draftScreenshots, capture];

    await chrome.storage.local.set({
      draftScreenshots: nextScreenshots,
      selectedCaptureId: capture.id
    });
    await chrome.action.setBadgeText({ text: String(nextScreenshots.length) });
    await chrome.action.setBadgeBackgroundColor({ color: "#1c5fca" });

    sendResponse?.({ ok: true, id: capture.id });
  } catch (error) {
    sendResponse?.({ ok: false, error: getErrorMessage(error) });
  }
}

async function getPageContext(tab) {
  if (!tab.id || !canAccessTab(tab.url)) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
  } catch {
    return null;
  }
}

async function createTicket(payload, sendResponse) {
  try {
    const serverUrl = normalizeServerUrl(payload?.serverUrl);
    const response = await fetch(`${serverUrl}/tickets`, {
      method: "POST",
      headers: getHeaders(payload?.token),
      body: JSON.stringify({
        source: "frami-chrome-extension",
        version: chrome.runtime.getManifest().version,
        comment: payload.comment || "",
        screenshot: payload.screenshot,
        screenshots: payload.screenshots || [],
        attachments: payload.attachments || [],
        metadata: payload.metadata || {}
      })
    });

    const body = await parseResponse(response);
    sendResponse({
      ok: response.ok,
      status: response.status,
      body
    });
  } catch (error) {
    sendResponse({ ok: false, error: getErrorMessage(error) });
  }
}

function canAccessTab(url) {
  return Boolean(url && /^(https?|file):/.test(url));
}

function getHeaders(token) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getTabMetadata(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url
  };
}

async function cropDataUrl(dataUrl, rect) {
  const blob = await (await fetch(dataUrl)).blob();
  const image = await createImageBitmap(blob);
  const viewport = rect.viewport || {
    width: image.width,
    height: image.height
  };
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.max(0, Math.round(rect.x * scaleX));
  const y = Math.max(0, Math.round(rect.y * scaleY));
  const width = Math.min(image.width - x, Math.round(rect.width * scaleX));
  const height = Math.min(image.height - y, Math.round(rect.height * scaleY));

  if (width < 1 || height < 1) {
    throw new Error("Selected area is too small.");
  }

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);

  const output = await canvas.convertToBlob({ type: "image/png" });
  const buffer = await output.arrayBuffer();

  return {
    dataUrl: `data:image/png;base64,${arrayBufferToBase64(buffer)}`,
    crop: {
      x,
      y,
      width,
      height,
      sourceWidth: image.width,
      sourceHeight: image.height,
      viewport
    }
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function createCaptureId() {
  return `shot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeServerUrl(value) {
  const serverUrl = (value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(serverUrl)) {
    throw new Error("Server URL must start with http:// or https://.");
  }
  return serverUrl;
}

async function parseResponse(response) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function parseFigmaUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("figma.com")) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const fileKey = parts[0] === "design" || parts[0] === "file" ? parts[1] : null;
    const rawNodeId = parsed.searchParams.get("node-id");

    return {
      fileKey,
      nodeId: rawNodeId ? rawNodeId.replace(/-/g, ":") : null,
      url
    };
  } catch {
    return null;
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
