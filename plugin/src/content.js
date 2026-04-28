if (!globalThis.__framiContentScriptReady) {
  globalThis.__framiContentScriptReady = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "GET_PAGE_CONTEXT") {
      sendResponse(getPageContext());
      return false;
    }

    if (message?.type === "START_AREA_SELECTION") {
      startAreaSelection();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "START_ELEMENT_SELECTION") {
      startElementSelection();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
}

function getPageContext() {
  return {
    title: document.title,
    url: location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY
    },
    selection: window.getSelection()?.toString() || "",
    activeElement: describeElement(document.activeElement)
  };
}

function startAreaSelection() {
  removeSelectionOverlays();

  const overlay = document.createElement("div");
  overlay.id = "frami-area-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "crosshair",
    background: "rgba(11, 18, 32, 0.18)",
    userSelect: "none"
  });

  const tip = document.createElement("div");
  tip.textContent = "Click to start, move to size, click again to lock. Press Esc to cancel.";
  Object.assign(tip.style, {
    position: "fixed",
    left: "50%",
    top: "18px",
    transform: "translateX(-50%)",
    borderRadius: "8px",
    padding: "9px 12px",
    color: "#ffffff",
    background: "rgba(11, 18, 32, 0.9)",
    font: "600 13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    boxShadow: "0 8px 28px rgba(11, 18, 32, 0.28)"
  });

  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "fixed",
    border: "2px solid #1c5fca",
    background: "rgba(28, 95, 202, 0.18)",
    boxShadow: "0 0 0 9999px rgba(11, 18, 32, 0.38)",
    display: "none",
    pointerEvents: "none"
  });

  overlay.append(tip, selection);
  document.documentElement.append(overlay);

  let start = null;
  let rect = null;
  let isDrawing = false;
  let isLocked = false;

  const keyHandler = (event) => {
    if (event.key === "Escape") {
      cleanup();
    }
  };

  const pointerDownHandler = (event) => {
    if (isLocked) {
      return;
    }

    if (isDrawing) {
      lockSelection();
      event.preventDefault();
      return;
    }

    start = getPoint(event);
    rect = { x: start.x, y: start.y, width: 0, height: 0 };
    isDrawing = true;
    tip.textContent = "Move to size the area, then click to lock it.";
    renderSelection(selection, rect);
    selection.style.display = "block";
    event.preventDefault();
  };

  const pointerMoveHandler = (event) => {
    if (!isDrawing || !start) {
      return;
    }

    rect = normalizeRect(start, getPoint(event));
    renderSelection(selection, rect);
  };

  function lockSelection() {
    if (!start || !rect) {
      return;
    }

    const selectedRect = rect;

    if (selectedRect.width < 8 || selectedRect.height < 8) {
      cleanup();
      return;
    }

    isDrawing = false;
    isLocked = true;
    overlay.style.cursor = "default";
    showCommentPrompt(overlay, tip, selectedRect, cleanup, saveSelection, {
      title: "Save selected area",
      tip: "Add a comment, then save this area."
    });
  }

  async function saveSelection(selectedRect, comment) {
    cleanup();

    window.setTimeout(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "AREA_SELECTED",
        comment,
        rect: {
          ...selectedRect,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          },
          scroll: {
            x: window.scrollX,
            y: window.scrollY
          }
        },
        page: getPageContext()
      });

      if (response?.ok) {
        showSavedToast();
      }
    }, 80);
  }

  function cleanup() {
    document.removeEventListener("keydown", keyHandler, true);
    overlay.removeEventListener("pointerdown", pointerDownHandler);
    overlay.removeEventListener("pointermove", pointerMoveHandler);
    overlay.remove();
  }

  document.addEventListener("keydown", keyHandler, true);
  overlay.addEventListener("pointerdown", pointerDownHandler);
  overlay.addEventListener("pointermove", pointerMoveHandler);
}

function startElementSelection() {
  removeSelectionOverlays();

  const overlay = document.createElement("div");
  overlay.id = "frami-element-overlay";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
    userSelect: "none"
  });

  const tip = document.createElement("div");
  tip.textContent = "Hover to inspect DOM elements. Click one to attach HTML context. Press Esc to cancel.";
  Object.assign(tip.style, {
    position: "fixed",
    left: "50%",
    top: "18px",
    transform: "translateX(-50%)",
    borderRadius: "8px",
    padding: "9px 12px",
    color: "#ffffff",
    background: "rgba(11, 18, 32, 0.92)",
    font: "600 13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    boxShadow: "0 8px 28px rgba(11, 18, 32, 0.28)"
  });

  const highlight = document.createElement("div");
  Object.assign(highlight.style, {
    position: "fixed",
    border: "2px solid #0f7f63",
    background: "rgba(15, 127, 99, 0.14)",
    boxShadow: "0 0 0 9999px rgba(11, 18, 32, 0.28)",
    display: "none",
    pointerEvents: "none"
  });

  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "fixed",
    zIndex: "2147483647",
    display: "none",
    maxWidth: "420px",
    overflow: "hidden",
    borderRadius: "6px",
    padding: "5px 8px",
    color: "#ffffff",
    background: "rgba(15, 127, 99, 0.94)",
    font: "700 12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    pointerEvents: "none"
  });

  overlay.append(tip, highlight, label);
  document.documentElement.append(overlay);

  let selectedElement = null;
  let selectedRect = null;

  const keyHandler = (event) => {
    if (event.key === "Escape") {
      cleanup();
    }
  };

  const pointerMoveHandler = (event) => {
    const target = getInspectableElement(event.clientX, event.clientY);
    if (!target) {
      highlight.style.display = "none";
      label.style.display = "none";
      selectedElement = null;
      selectedRect = null;
      return;
    }

    selectedElement = target;
    selectedRect = clampRectToViewport(target.getBoundingClientRect());
    renderSelection(highlight, selectedRect);
    highlight.style.display = "block";
    label.textContent = getElementLabel(target);
    const labelPosition = getElementLabelPosition(selectedRect, label);
    label.style.left = `${labelPosition.x}px`;
    label.style.top = `${labelPosition.y}px`;
    label.style.display = "block";
  };

  const clickHandler = (event) => {
    if (!selectedElement || !selectedRect || selectedRect.width < 1 || selectedRect.height < 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener("pointermove", pointerMoveHandler, true);
    document.removeEventListener("click", clickHandler, true);
    tip.textContent = "Add a comment, then save this element.";
    const elementContext = describeSelectedElement(selectedElement, selectedRect);
    showCommentPrompt(overlay, tip, selectedRect, cleanup, saveSelection, {
      title: "Save selected element",
      tip: "Add a comment, then save this element."
    }, elementContext);
  };

  async function saveSelection(rect, comment, elementContext) {
    cleanup();

    window.setTimeout(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "ELEMENT_SELECTED",
        comment,
        rect: {
          ...rect,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio
          },
          scroll: {
            x: window.scrollX,
            y: window.scrollY
          }
        },
        element: elementContext,
        page: getPageContext()
      });

      if (response?.ok) {
        showSavedToast();
      }
    }, 80);
  }

  function cleanup() {
    document.removeEventListener("keydown", keyHandler, true);
    document.removeEventListener("pointermove", pointerMoveHandler, true);
    document.removeEventListener("click", clickHandler, true);
    overlay.remove();
  }

  document.addEventListener("keydown", keyHandler, true);
  document.addEventListener("pointermove", pointerMoveHandler, true);
  document.addEventListener("click", clickHandler, true);
}

function showCommentPrompt(overlay, tip, selectedRect, cleanup, saveSelection, options = {}, context = null) {
  document.querySelector("#frami-comment-prompt")?.remove();
  tip.textContent = options.tip || "Add a comment, then save this capture.";
  overlay.style.pointerEvents = "auto";

  const prompt = document.createElement("div");
  prompt.id = "frami-comment-prompt";
  const promptPosition = getPromptPosition(selectedRect, 320, 168);
  Object.assign(prompt.style, {
    position: "fixed",
    left: `${promptPosition.x}px`,
    top: `${promptPosition.y}px`,
    zIndex: "2147483647",
    width: "320px",
    boxSizing: "border-box",
    border: "1px solid #cfd6e4",
    borderRadius: "8px",
    padding: "12px",
    color: "#18212f",
    background: "#ffffff",
    colorScheme: "light",
    boxShadow: "0 16px 42px rgba(11, 18, 32, 0.24)",
    font: "13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  });

  prompt.addEventListener("pointerdown", (event) => event.stopPropagation());
  prompt.addEventListener("pointermove", (event) => event.stopPropagation());
  prompt.addEventListener("pointerup", (event) => event.stopPropagation());
  prompt.addEventListener("click", (event) => event.stopPropagation());

  const title = document.createElement("div");
  title.textContent = options.title || "Save capture";
  Object.assign(title.style, {
    marginBottom: "8px",
    fontWeight: "700"
  });

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Add a note for this screenshot...";
  Object.assign(textarea.style, {
    display: "block",
    width: "100%",
    maxWidth: "100%",
    minHeight: "72px",
    boxSizing: "border-box",
    border: "1px solid #cfd6e4",
    borderRadius: "8px",
    padding: "8px",
    resize: "vertical",
    color: "#18212f",
    font: "13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  });
  textarea.style.setProperty("background-color", "#ffffff", "important");
  textarea.style.setProperty("color", "#18212f", "important");
  textarea.style.setProperty("caret-color", "#18212f", "important");
  textarea.style.setProperty("color-scheme", "light", "important");

  const style = document.createElement("style");
  style.textContent = `
    #frami-comment-prompt textarea::placeholder {
      color: #667085 !important;
      opacity: 1 !important;
    }
  `;

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    gap: "8px",
    justifyContent: "flex-end",
    marginTop: "8px"
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Cancel";
  stylePromptButton(dismiss, false);

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save";
  stylePromptButton(save, true);

  dismiss.addEventListener("click", cleanup);
  save.addEventListener("click", async () => {
    await saveSelection(selectedRect, textarea.value, context);
  });

  actions.append(dismiss, save);
  prompt.append(style, title, textarea, actions);
  overlay.append(prompt);
  textarea.focus();
}

function getPromptPosition(rect, promptWidth, promptHeight) {
  const gap = 12;
  const margin = 12;
  const placements = [
    {
      x: rect.x + rect.width + gap,
      y: rect.y
    },
    {
      x: rect.x,
      y: rect.y + rect.height + gap
    },
    {
      x: rect.x - promptWidth - gap,
      y: rect.y
    },
    {
      x: rect.x,
      y: rect.y - promptHeight - gap
    }
  ];

  const fit = placements.find((placement) => (
    placement.x >= margin &&
    placement.y >= margin &&
    placement.x + promptWidth <= window.innerWidth - margin &&
    placement.y + promptHeight <= window.innerHeight - margin
  ));

  const placement = fit || placements[1];

  return {
    x: clamp(placement.x, margin, window.innerWidth - promptWidth - margin),
    y: clamp(placement.y, margin, window.innerHeight - promptHeight - margin)
  };
}

function showSavedToast() {
  const toast = document.createElement("div");
  toast.textContent = "Saved to Frami";
  Object.assign(toast.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "2147483647",
    borderRadius: "8px",
    padding: "10px 12px",
    color: "#ffffff",
    background: "rgba(11, 18, 32, 0.92)",
    boxShadow: "0 12px 32px rgba(11, 18, 32, 0.24)",
    font: "700 13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  });

  document.documentElement.append(toast);
  window.setTimeout(() => toast.remove(), 1600);
}

function stylePromptButton(button, primary) {
  Object.assign(button.style, {
    minHeight: "32px",
    border: primary ? "1px solid #1c5fca" : "1px solid #cfd6e4",
    borderRadius: "8px",
    padding: "0 10px",
    color: primary ? "#ffffff" : "#18212f",
    background: primary ? "#1c5fca" : "#ffffff",
    cursor: "pointer",
    font: "700 12px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  });
}

function removeSelectionOverlays() {
  document.querySelector("#frami-area-overlay")?.remove();
  document.querySelector("#frami-element-overlay")?.remove();
}

function getPoint(event) {
  return {
    x: clamp(event.clientX, 0, window.innerWidth),
    y: clamp(event.clientY, 0, window.innerHeight)
  };
}

function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function renderSelection(selection, rect) {
  Object.assign(selection.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
}

function getInspectableElement(x, y) {
  let element = document.elementFromPoint(x, y);
  if (!element || element === document.documentElement || element === document.body) {
    return null;
  }

  if (element.closest?.("#frami-element-overlay, #frami-area-overlay, #frami-comment-prompt")) {
    return null;
  }

  return element;
}

function clampRectToViewport(rect) {
  const x = clamp(rect.left, 0, window.innerWidth);
  const y = clamp(rect.top, 0, window.innerHeight);
  const right = clamp(rect.right, 0, window.innerWidth);
  const bottom = clamp(rect.bottom, 0, window.innerHeight);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function getElementLabel(element) {
  const selector = getCssSelector(element);
  const text = (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80);
  return text ? `${selector} - ${text}` : selector;
}

function getElementLabelPosition(rect, label) {
  const margin = 8;
  const width = Math.min(label.offsetWidth || 280, window.innerWidth - margin * 2);
  const height = label.offsetHeight || 24;
  return {
    x: clamp(rect.x, margin, window.innerWidth - width - margin),
    y: clamp(rect.y - height - 6, margin, window.innerHeight - height - margin)
  };
}

function describeSelectedElement(element, rect) {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    className: typeof element.className === "string" ? element.className : "",
    selector: getCssSelector(element),
    text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 1200),
    outerHTML: getSanitizedOuterHTML(element),
    attributes: getElementAttributes(element),
    rect,
    computedStyle: getElementComputedStyle(element)
  };
}

function getElementAttributes(element) {
  const sensitive = new Set(["value", "srcdoc"]);
  const attributes = {};
  for (const attribute of Array.from(element.attributes || [])) {
    if (sensitive.has(attribute.name.toLowerCase())) {
      continue;
    }
    attributes[attribute.name] = attribute.value.slice(0, 300);
  }
  return attributes;
}

function getSanitizedOuterHTML(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll?.("script, style, noscript, iframe").forEach((node) => node.remove());
  clone.querySelectorAll?.("input, textarea, select").forEach((node) => {
    node.removeAttribute("value");
    node.removeAttribute("checked");
    node.removeAttribute("selected");
    if (node.tagName === "TEXTAREA") {
      node.textContent = "";
    }
  });

  return clone.outerHTML.slice(0, 6000);
}

function getElementComputedStyle(element) {
  const style = window.getComputedStyle(element);
  const keys = [
    "display",
    "position",
    "boxSizing",
    "width",
    "height",
    "margin",
    "padding",
    "color",
    "backgroundColor",
    "border",
    "borderRadius",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "textAlign",
    "opacity",
    "overflow",
    "zIndex"
  ];
  return Object.fromEntries(keys.map((key) => [key, style[key]]));
}

function getCssSelector(element) {
  if (!(element instanceof Element)) {
    return "";
  }

  if (element.id && isUniqueSelector(`#${cssEscape(element.id)}`)) {
    return `#${cssEscape(element.id)}`;
  }

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    const classList = Array.from(current.classList || []).filter(Boolean).slice(0, 3);
    if (classList.length) {
      part += classList.map((className) => `.${cssEscape(className)}`).join("");
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(part);
    const selector = parts.join(" > ");
    if (isUniqueSelector(selector)) {
      return selector;
    }
    current = parent;
  }

  return parts.join(" > ");
}

function isUniqueSelector(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function describeElement(element) {
  if (!element || element === document.body) {
    return null;
  }

  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    className: typeof element.className === "string" ? element.className : "",
    text: (element.textContent || "").trim().slice(0, 160)
  };
}
