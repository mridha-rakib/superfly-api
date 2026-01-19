const baseUrlForm = document.getElementById("base-url-form");
const baseUrlInput = document.getElementById("base-url");
const baseUrlActive = document.getElementById("base-url-active");

const quoteForm = document.getElementById("quote-form");
const checkoutUrlEl = document.getElementById("checkout-url");
const paymentFlowEl = document.getElementById("payment-flow");
const sessionIdEl = document.getElementById("session-id");
const paymentIntentIdEl = document.getElementById("payment-intent-id");
const clientSecretEl = document.getElementById("client-secret");
const amountEl = document.getElementById("amount");
const currencyEl = document.getElementById("currency");
const openCheckoutBtn = document.getElementById("open-checkout");
const loadServicesBtn = document.getElementById("load-services");
const serviceListEl = document.getElementById("service-list");
const servicesPreviewEl = document.getElementById("services-preview");

const statusForm = document.getElementById("status-form");
const statusSessionInput = document.getElementById("status-session-id");
const statusPaymentIntentInput = document.getElementById(
  "status-payment-intent-id"
);
const paymentMethodInput = document.getElementById("payment-method-id");
const statusPill = document.getElementById("status-pill");
const stripeStatusEl = document.getElementById("stripe-status");
const quoteIdEl = document.getElementById("quote-id");
const autoRefresh = document.getElementById("auto-refresh");
const confirmQuoteBtn = document.getElementById("confirm-quote");

const manualForm = document.getElementById("manual-quote-form");
const manualQuoteIdEl = document.getElementById("manual-quote-id");
const manualQuoteStatusEl = document.getElementById("manual-quote-status");
const manualQuoteTypeEl = document.getElementById("manual-quote-type");
const toast = document.getElementById("toast");

let pollTimer = null;

function setToast(message, isError) {
  toast.textContent = message;
  toast.classList.add("show");
  toast.style.borderColor = isError ? "rgba(239, 68, 68, 0.4)" : "";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function getBaseUrl() {
  return localStorage.getItem("sf_base_url") || "";
}

function setBaseUrl(url) {
  localStorage.setItem("sf_base_url", url);
  baseUrlActive.textContent = url || "Not set";
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function setStatus(status, stripeStatus, quoteId) {
  const normalizedStatus = status || "pending";
  statusPill.textContent = normalizedStatus;
  statusPill.className = `pill ${normalizedStatus}`;
  stripeStatusEl.textContent = stripeStatus || "-";
  quoteIdEl.textContent = quoteId || "-";
}

function formatCurrency(amount) {
  if (typeof amount !== "number") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function readServicesJson(value) {
  try {
    const raw = typeof value === "string" ? value : "";
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Services must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Services must be valid JSON");
  }
}

function getServiceSelections() {
  const selections = {};
  if (!serviceListEl) {
    return selections;
  }
  const inputs = serviceListEl.querySelectorAll("input[data-service-code]");
  inputs.forEach((input) => {
    const code = input.dataset.serviceCode;
    const quantity = Number.parseInt(input.value, 10);
    if (code && Number.isFinite(quantity) && quantity > 0) {
      selections[code] = quantity;
    }
  });
  return selections;
}

function updateServicesPreview() {
  if (!servicesPreviewEl) {
    return;
  }
  const selections = getServiceSelections();
  servicesPreviewEl.textContent = JSON.stringify(selections || {});
}

function renderServiceCatalog(services) {
  if (!serviceListEl) {
    return;
  }
  serviceListEl.innerHTML = "";

  if (!services || services.length === 0) {
    serviceListEl.classList.add("empty");
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No active services returned from the backend.";
    serviceListEl.appendChild(empty);
    updateServicesPreview();
    return;
  }

  serviceListEl.classList.remove("empty");
  services.forEach((service) => {
    const row = document.createElement("div");
    row.className = "service-item";

    const meta = document.createElement("div");
    meta.className = "service-meta";
    const name = document.createElement("strong");
    name.textContent = service.name || "Service";
    const code = document.createElement("span");
    code.className = "service-code";
    code.textContent = service.code || "";
    meta.appendChild(name);
    meta.appendChild(code);

    const priceWrap = document.createElement("div");
    priceWrap.className = "service-data";
    const priceLabel = document.createElement("span");
    priceLabel.className = "service-label";
    priceLabel.textContent = "Price";
    const priceValue = document.createElement("span");
    priceValue.className = "service-value";
    priceValue.textContent = formatCurrency(service.price);
    priceWrap.appendChild(priceLabel);
    priceWrap.appendChild(priceValue);

    const qtyWrap = document.createElement("label");
    qtyWrap.className = "service-data";
    const qtyLabel = document.createElement("span");
    qtyLabel.className = "service-label";
    qtyLabel.textContent = "Qty";
    const qtyInput = document.createElement("input");
    qtyInput.className = "service-qty";
    qtyInput.type = "number";
    qtyInput.min = "0";
    qtyInput.step = "1";
    qtyInput.value = "0";
    qtyInput.dataset.serviceCode = service.code || "";
    qtyInput.addEventListener("input", updateServicesPreview);
    qtyWrap.appendChild(qtyLabel);
    qtyWrap.appendChild(qtyInput);

    row.appendChild(meta);
    row.appendChild(priceWrap);
    row.appendChild(qtyWrap);

    serviceListEl.appendChild(row);
  });

  updateServicesPreview();
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Request failed");
  }
  return payload.data;
}

function updateCheckoutResult(result) {
  paymentFlowEl.textContent = result.flow || "-";
  checkoutUrlEl.textContent = result.checkoutUrl || "-";
  checkoutUrlEl.href = result.checkoutUrl || "#";
  sessionIdEl.textContent = result.sessionId || "-";
  paymentIntentIdEl.textContent = result.paymentIntentId || "-";
  clientSecretEl.textContent = result.clientSecret || "-";
  amountEl.textContent = result.amount ? result.amount.toString() : "-";
  currencyEl.textContent = result.currency || "-";

  if (result.sessionId) {
    statusSessionInput.value = result.sessionId;
    localStorage.setItem("sf_last_session_id", result.sessionId);
  } else {
    statusSessionInput.value = "";
    localStorage.removeItem("sf_last_session_id");
  }
  if (result.paymentIntentId) {
    statusPaymentIntentInput.value = result.paymentIntentId;
  } else {
    statusPaymentIntentInput.value = "";
  }

  const hasCheckout = Boolean(result.checkoutUrl);
  openCheckoutBtn.disabled = !hasCheckout;
  openCheckoutBtn.classList.toggle("disabled", !hasCheckout);
}

async function loadServices() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setToast("Set the API base URL first", true);
    return;
  }
  const data = await requestJson(`${baseUrl}/services`, { method: "GET" });
  const services = Array.isArray(data) ? data : [];
  renderServiceCatalog(services);
}

function getStatusQuery() {
  const sessionId = statusSessionInput.value.trim();
  const paymentIntentId = statusPaymentIntentInput.value.trim();
  if (sessionId) {
    return { checkoutSessionId: sessionId };
  }
  if (paymentIntentId) {
    return { paymentIntentId };
  }
  return null;
}

async function refreshStatus() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setToast("Set the API base URL first", true);
    return;
  }
  const query = getStatusQuery();
  if (!query) {
    setToast("Enter a session ID or payment intent ID", true);
    return;
  }
  const params = new URLSearchParams(query).toString();
  const data = await requestJson(
    `${baseUrl}/quotes/payment-status?${params}`,
    { method: "GET" }
  );
  setStatus(data.status, data.stripeStatus, data.quoteId);
}

async function confirmQuote() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setToast("Set the API base URL first", true);
    return;
  }
  const query = getStatusQuery();
  if (!query) {
    setToast("Enter a session ID or payment intent ID", true);
    return;
  }

  const payload = {
    paymentIntentId: query.paymentIntentId,
    checkoutSessionId: query.checkoutSessionId,
    paymentMethodId: paymentMethodInput.value.trim() || undefined,
  };

  const data = await requestJson(`${baseUrl}/quotes/confirm`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setToast("Quote created successfully");
  setStatus("paid", data.paymentStatus || "paid", data._id);
}

function updateManualResult(result) {
  manualQuoteIdEl.textContent = result._id || "-";
  manualQuoteStatusEl.textContent = result.status || "-";
  manualQuoteTypeEl.textContent = result.serviceType || "-";
}

baseUrlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = normalizeBaseUrl(baseUrlInput.value.trim());
  setBaseUrl(value);
  setToast("Base URL saved");
});

quoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setToast("Set the API base URL first", true);
    return;
  }

  const formData = new FormData(quoteForm);
  let services;
  try {
    const overrideValue = formData.get("servicesOverride");
    if (overrideValue && overrideValue.trim()) {
      services = readServicesJson(overrideValue);
    } else {
      services = getServiceSelections();
    }
  } catch (error) {
    setToast(error.message, true);
    return;
  }
  if (!services || Object.keys(services).length === 0) {
    setToast(
      "Select at least one service or provide a JSON override",
      true
    );
    return;
  }

  const payload = {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    serviceDate: formData.get("serviceDate"),
    notes: formData.get("notes") || undefined,
    paymentFlow: formData.get("paymentFlow"),
    services,
  };

  try {
    const data = await requestJson(`${baseUrl}/quotes/intent`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    updateCheckoutResult(data);
    setToast(
      data.flow === "intent"
        ? "Payment intent created"
        : "Checkout session created"
    );
  } catch (error) {
    setToast(error.message, true);
  }
});

loadServicesBtn.addEventListener("click", () => {
  loadServices()
    .then(() => setToast("Services loaded"))
    .catch((error) => setToast(error.message, true));
});

openCheckoutBtn.addEventListener("click", () => {
  const url = checkoutUrlEl.getAttribute("href");
  if (!url || url === "#") {
    setToast("Checkout URL not available", true);
    return;
  }
  window.open(url, "_blank", "noopener");
});

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await refreshStatus();
    setToast("Status updated");
  } catch (error) {
    setToast(error.message, true);
  }
});

autoRefresh.addEventListener("change", () => {
  if (autoRefresh.checked) {
    pollTimer = setInterval(() => {
      refreshStatus().catch((error) => setToast(error.message, true));
    }, 3000);
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

confirmQuoteBtn.addEventListener("click", () => {
  confirmQuote().catch((error) => setToast(error.message, true));
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    setToast("Set the API base URL first", true);
    return;
  }

  const formData = new FormData(manualForm);
  const serviceType = formData.get("serviceType");
  const endpoint =
    serviceType === "post_construction"
      ? "/quotes/post-construction"
      : "/quotes/commercial";

  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    companyName: formData.get("companyName"),
    businessAddress: formData.get("businessAddress"),
    preferredDate: formData.get("preferredDate"),
    preferredTime: formData.get("preferredTime"),
    specialRequest: formData.get("specialRequest"),
  };

  try {
    const data = await requestJson(`${baseUrl}${endpoint}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    updateManualResult(data);
    setToast("Quote request submitted");
  } catch (error) {
    setToast(error.message, true);
  }
});

const storedBaseUrl = getBaseUrl();
if (storedBaseUrl) {
  baseUrlInput.value = storedBaseUrl;
  setBaseUrl(storedBaseUrl);
}

const lastSessionId = localStorage.getItem("sf_last_session_id");
if (lastSessionId) {
  statusSessionInput.value = lastSessionId;
}

function setDefaultDate(input) {
  if (!input || input.value) {
    return;
  }
  input.value = new Date().toISOString().split("T")[0];
}

setDefaultDate(quoteForm.querySelector('input[name="serviceDate"]'));
if (manualForm) {
  setDefaultDate(manualForm.querySelector('input[name="preferredDate"]'));
}
