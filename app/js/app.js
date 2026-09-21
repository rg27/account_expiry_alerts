const SELECTORS = {
    popup: "popup",
    popupTitle: "popupTitle",
    popupMessage: "popupMessage"
};

// TODO: replace with the REST API name of your standalone function as
// registered under Settings > Developer Space > Functions in Zoho CRM.
// This is NOT necessarily the same as the Deluge function's display name
// (get_all_account_important_info) — check the function's API Name field.
const GET_ALL_NOTES_FUNCTION_NAME = "get_all_account_important_info";

// Same note as above: use the function's API Name from Developer Space > Functions.
// Returns { rv_count: <number> } = Residence Visas that are still "Issued"
// but whose Expiry Date has already passed.
const GET_EXPIRED_RV_FUNCTION_NAME = "get_expired_issued_rv";

// TODO: set to the API Name of your Outstanding Receivables function.
// It receives { account_id } and should return the balance, either as a plain
// number (e.g. 1234.5) or as a Map like { "outstanding_receivables": 1234.5 }.
const GET_OUTSTANDING_RECEIVABLES_FUNCTION_NAME = "get_outstanding_receivables";

// TODO: if your function returns a Map, this is the key that holds the amount.
// (If the Map has only one numeric value, it is picked up even if the key differs.)
const RECEIVABLES_KEY = "outstanding_receivables";

const ALERT_META = {
    trade_license: {
        label: "Trade License",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6M9 16h6M9 8h1"></path><rect x="3" y="4" width="18" height="16" rx="2"></rect></svg>'
    },
    establishment_card: {
        label: "Immigration Card",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><circle cx="8" cy="12" r="2"></circle><path d="M14 10h5M14 14h3"></path></svg>'
    },
    address_package: {
        label: "Address Package",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"></path></svg>'
    },
    echannel: {
        label: "E-Channel",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"></path></svg>'
    },
    corporate_tax: {
        label: "Corporate Tax",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z"></path><path d="M16 2v20"></path><path d="M9 8h4"></path><path d="M9 12h4"></path><path d="M9 16h4"></path></svg>'
    },
    vat_return: {
        label: "VAT Return",
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
    }
};

// Items that are "due" rather than "expire". Anything not listed says "Expires".
const DATE_LABELS = {
    corporate_tax: "Due",
    vat_return: "Due"
};

const DEFAULT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A1.5 1.5 0 0 0 3.4 20.4h17.2a1.5 1.5 0 0 0 1.29-2.36L13.71 3.86a1.5 1.5 0 0 0-2.42 0z"></path></svg>';

// Passport-style icon for the Residence Visa row.
const RV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"></path><circle cx="11" cy="10" r="2.5"></circle><path d="M8 16h6"></path></svg>';

// Banknote icon for the Outstanding Receivables footer.
const RECEIVABLES_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2.5"></circle><path d="M6 10v.01M18 14v.01"></path></svg>';

// Track the current account so the "View all notes" button knows who to fetch for.
let currentAccountId = null;

// Cache the fetched notes per account so re-opening the log view doesn't refetch.
let notesCache = null;
let notesCacheAccountId = null;

// Guards the Residence Visa check: if the widget receives a newer account
// while an older request is still running, the older result is ignored.
let rvRequestId = 0;

// Same guard for the Outstanding Receivables check.
let receivablesRequestId = 0;

// ---- Loading state --------------------------------------------------------
let alertsRendered = false;       // true once the date list has been drawn
let pendingChecks = 0;            // Residence Visa / Receivables checks still running
let earlyChecksAccountId = null;  // checks already started from the initial "loading" payload

/** Small inline "Checking..." line, shown only while a background check is still running. */
function updateChecksLoading() {
    const el = document.getElementById("checks-loading");
    if (el) el.classList.toggle("hidden", !(alertsRendered && pendingChecks > 0));
}

/**
 * "No expiry alerts" is only shown once the date list is drawn, both
 * background checks have finished, and there is nothing at all to display.
 */
function refreshEmptyState() {
    const emptyState = document.getElementById("empty-state");
    if (!emptyState) return;

    const hasRows = document.getElementById("alert-rows").children.length > 0;
    const hasRv = !!document.querySelector("#rv-section .alert-row");
    const hasReceivables = !!document.querySelector("#receivables-section .alert-row");

    const showEmpty = alertsRendered && pendingChecks === 0 && !hasRows && !hasRv && !hasReceivables;
    emptyState.classList.toggle("hidden", !showEmpty);
}

/** Called when one of the two background checks completes (success or failure). */
function finishCheck() {
    pendingChecks = Math.max(0, pendingChecks - 1);
    updateChecksLoading();
    refreshEmptyState();
}

/** Starts the Residence Visa and Outstanding Receivables checks in parallel. */
function startAccountChecks(accountId) {
    if (!accountId) {
        pendingChecks = 0;
        updateChecksLoading();
        return;
    }
    pendingChecks = 2;
    updateChecksLoading();
    loadExpiredResidenceVisas(accountId);
    loadOutstandingReceivables(accountId);
}

/**
 * Processes the payload (from either PageLoad or Notify) and
 * updates all the widget's UI sections: badges, important info panel,
 * and the sorted date list.
 */
function processPayload(payloadData) {
    const alerts = Array.isArray(payloadData?.alerts) ? payloadData.alerts : (Array.isArray(payloadData) ? payloadData : []);
    const leadSource = payloadData?.lead_source || "";
    const importantInfo = payloadData?.important_info || "";
    const contactPartnerOnly = payloadData?.contact_partner_only;

    currentAccountId = payloadData?.account_id || null;

    const badgeEl = document.getElementById("clientTypeBadge");
    const standardBadgeEl = document.getElementById("standardClientBadge");

    const isBusinessPartner = (leadSource === "Business Partner Referrals" && (contactPartnerOnly === true || contactPartnerOnly === "true"));

    if (isBusinessPartner) {
        badgeEl.classList.remove("hidden");
        standardBadgeEl.classList.add("hidden");
    } else {
        badgeEl.classList.add("hidden");
        standardBadgeEl.classList.remove("hidden");
    }

    const infoWrapper = document.getElementById("importantInfoWrapper");
    const infoContentBox = document.getElementById("importantInfoContentBox");
    const infoText = document.getElementById("importantInfoText");
    const infoToggleBtn = document.getElementById("importantInfoToggle");

    if (importantInfo && importantInfo.trim() !== "") {
        infoText.textContent = importantInfo;
        infoWrapper.classList.remove("hidden");
    } else {
        infoWrapper.classList.add("hidden");
    }

    if (infoToggleBtn) {
        infoToggleBtn.onclick = () => {
            infoContentBox.classList.toggle("hidden");
            infoToggleBtn.classList.toggle("is-expanded");
        };
    }

    // Most overdue first (most negative days_left), then soonest upcoming.
    alerts.sort((a, b) => Number(a.days_left) - Number(b.days_left));

    // The Residence Visa and receivables checks run in the background so the date
    // list appears immediately. If they were already started from the initial
    // "loading" payload (see PageLoad below), don't start them a second time.
    const alreadyStarted = earlyChecksAccountId !== null && earlyChecksAccountId === currentAccountId;
    earlyChecksAccountId = null;
    if (!alreadyStarted) startAccountChecks(currentAccountId);

    renderAlerts(alerts);
}

/**
 * Fires once when the widget/flyout first loads. With the updated
 * Client Script, the flyout is opened immediately with { loading: true }
 * and no alert data yet, so we just show the loader and wait for the
 * "Notify" event below to deliver the real data.
 *
 * The `loading === false` branch is kept as a fallback in case the
 * Client Script ever sends full data directly via open() instead of
 * via notify().
 */
ZOHO.embeddedApp.on("PageLoad", async (entity) => {
    const loader = document.getElementById("loader-overlay");
    if (loader) loader.classList.remove("hidden");

    // New load: forget the previous account's state.
    alertsRendered = false;
    earlyChecksAccountId = null;

    try {
        const payloadData = entity && entity.data ? entity.data : entity;

        if (payloadData && payloadData.loading === false) {
            processPayload(payloadData);
            if (loader) loader.classList.add("hidden");
        } else if (payloadData && payloadData.account_id) {
            // The Client Script opened the flyout straight away and is still
            // fetching the account. Start the Residence Visa / receivables checks
            // now so they run in parallel with that fetch.
            currentAccountId = payloadData.account_id;
            earlyChecksAccountId = payloadData.account_id;
            startAccountChecks(payloadData.account_id);
        }
        // In the loading case, stay on the loader until the "Notify" event delivers the account data.
    } catch (err) {
        if (loader) loader.classList.add("hidden");
        showPopup("Data Fetch Error", err.message, "error");
    }
});

/**
 * Fires when Client Script calls:
 *   flyout.notify({ data: {...} }, { wait: false })
 * This is how the real data arrives after the flyout has
 * already been shown with the loading spinner.
 */
ZOHO.embeddedApp.on("Notify", (data) => {
    const loader = document.getElementById("loader-overlay");
    try {
        const payloadData = data && data.data ? data.data : data;
        processPayload(payloadData);
    } catch (err) {
        showPopup("Data Fetch Error", err.message, "error");
    } finally {
        if (loader) loader.classList.add("hidden");
    }
});

ZOHO.embeddedApp.init();

function closeWidget() {
    try {
        if (typeof $Client !== "undefined" && typeof $Client.close === "function") {
            $Client.close();
        } else {
            console.warn("$Client.close is not defined, attempting SDK alternative.");
            ZOHO.CRM.UI.Flyout.close();
        }
    } catch (e) {
        console.error("Error closing flyout widget:", e);
    }
}

function renderAlerts(alerts) {
    const list = document.getElementById("alert-rows");
    const countEl = document.getElementById("alert-count");

    countEl.textContent = alerts.length;
    list.innerHTML = alerts.length ? alerts.map(buildRowHtml).join("") : "";

    alertsRendered = true;
    updateChecksLoading();
    refreshEmptyState();
}

function buildRowHtml(alert) {
    const meta = ALERT_META[alert.key] || { label: alert.title || "Date", icon: DEFAULT_ICON };
    const title = alert.title || meta.label;
    const message = alert.message || "";          // only present when expired
    const sev = alert.severity || "ok";
    const dateLabel = formatDate(alert.expiry_date);
    const statusLabel = statusText(alert.days_left);

    const dateWord = alert.status === "expired"
        ? "Expired"
        : (DATE_LABELS[alert.key] || "Expires");

    return `
        <div class="alert-row sev-${sev}">
            <div class="alert-icon">${meta.icon}</div>
            <div class="alert-body">
                <div class="alert-row-top">
                    <span class="alert-title">${escapeHtml(title)}</span>
                </div>
                ${message ? `<p class="alert-message">${escapeHtml(message)}</p>` : ""}
                <div class="alert-row-bottom">
                    <span class="alert-date">${dateWord}: ${dateLabel}</span>
                    <span class="alert-badge">${statusLabel}</span>
                </div>
            </div>
        </div>
    `;
}

function formatDate(rawDate) {
    if (!rawDate) return "—";
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(rawDate) {
    if (!rawDate) return "—";
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return "—";
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
}

/**
 * days_left is signed: negative = overdue, 0 = today, positive = days remaining.
 */
function statusText(daysLeft) {
    const n = Number(daysLeft);
    if (isNaN(n)) return "—";
    if (n < 0) {
        const overdue = Math.abs(n);
        return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`;
    }
    if (n === 0) return "Due today";
    if (n === 1) return "1 day left";
    return `${n} days left`;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function showPopup(titleText, message, type = "error") {
    const popup = document.getElementById(SELECTORS.popup);
    const iconDiv = document.getElementById("statusIcon");
    const title = document.getElementById(SELECTORS.popupTitle);
    const msg = document.getElementById(SELECTORS.popupMessage);

    popup.classList.remove("hidden");
    title.textContent = titleText;
    msg.innerHTML = message;

    if (type === "success") {
        popup.setAttribute("data-status", "success");
        iconDiv.className = "status-icon status-icon--success";
        iconDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>';
    } else {
        popup.setAttribute("data-status", "error");
        iconDiv.className = "status-icon status-icon--error";
        iconDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
    }
}

/* ===========================================================
   EXPIRED RESIDENCE VISAS
   Residence Visas that are still "Issued" but whose Expiry Date
   has already passed. Shown below the date list; hidden when 0.
   =========================================================== */

/**
 * Calls the Deluge standalone function and renders the result.
 * Never throws: a failure only shows a small muted note, so it can't
 * break the rest of the widget.
 */
async function loadExpiredResidenceVisas(accountId) {
    const section = document.getElementById("rv-section");
    if (!section) return;

    const requestId = ++rvRequestId;

    // Reset first so a previous account's result never lingers.
    section.innerHTML = "";
    section.classList.add("hidden");

    if (!accountId) return;

    try {
        const reqData = {
            arguments: JSON.stringify({
                account_id: accountId
            })
        };

        const response = await ZOHO.CRM.FUNCTIONS.execute(GET_EXPIRED_RV_FUNCTION_NAME, reqData);

        // A newer account was loaded while we were waiting — drop this result.
        if (requestId !== rvRequestId) return;

        const count = parseRvCount(extractFunctionOutput(response));
        if (count === null) {
            throw new Error("Unexpected response: " + JSON.stringify(response));
        }

        renderRvSection(count);
    } catch (err) {
        if (requestId !== rvRequestId) return;
        console.error("Failed to load expired Residence Visas:", err);
        section.innerHTML = '<p class="rv-note">Couldn\u2019t check Residence Visa status right now.</p>';
        section.classList.remove("hidden");
    } finally {
        // Only the latest request counts as finished; older ones were superseded.
        if (requestId === rvRequestId) finishCheck();
    }
}

/**
 * Same wrapper logic as the notes function: the payload is usually in
 * response.details.output, but fall back to other common shapes.
 */
function extractFunctionOutput(response) {
    if (response && response.details && response.details.output !== undefined) {
        return response.details.output;
    }
    if (response && response.output !== undefined) {
        return response.output;
    }
    return response;
}

/**
 * The Deluge function is declared to return a string but returns a Map,
 * so the output usually arrives as text like {"rv_count":2}. Handles
 * that plus a plain object or number. Returns null if rv_count can't
 * be found, so the caller can show the error note instead of a wrong 0.
 */
function parseRvCount(rawOutput) {
    if (rawOutput === null || rawOutput === undefined) return null;

    if (typeof rawOutput === "number") return rawOutput;

    if (typeof rawOutput === "object") {
        const n = Number(rawOutput.rv_count);
        return isNaN(n) ? null : n;
    }

    if (typeof rawOutput === "string") {
        try {
            const parsed = JSON.parse(rawOutput);
            const n = Number(parsed && parsed.rv_count);
            if (!isNaN(n)) return n;
        } catch (e) {
            // not JSON — fall through to the pattern match below
        }
        const m = /rv_count["']?\s*[:=]\s*"?(\d+)/.exec(rawOutput);
        return m ? Number(m[1]) : null;
    }

    return null;
}

function renderRvSection(count) {
    const section = document.getElementById("rv-section");
    if (!section) return;

    if (!count || count < 1) {
        section.innerHTML = "";
        section.classList.add("hidden");
        return;
    }

    section.innerHTML = buildRvRowHtml(count);
    section.classList.remove("hidden");
}

function buildRvRowHtml(count) {
    const message = count === 1
        ? "1 Residence Visa has expired but is still marked as \u201CIssued\u201D."
        : `${count} Residence Visas have expired but are still marked as \u201CIssued\u201D.`;

    return `
        <div class="alert-row sev-urgent">
            <div class="alert-icon">${RV_ICON}</div>
            <div class="alert-body">
                <div class="alert-row-top">
                    <span class="alert-title">Residence Visa Status</span>
                </div>
                <p class="alert-message">${message}</p>
                <div class="alert-row-bottom">
                    <span class="alert-date">Expired but still \u201CIssued\u201D</span>
                    <span class="alert-badge">${count} to review</span>
                </div>
            </div>
        </div>
    `;
}

/* ===========================================================
   OUTSTANDING RECEIVABLES
   Last item in the list, after the Residence Visa row (if any).
   Shown in AED with 2 decimals; hidden completely when the balance is 0.
   =========================================================== */

/**
 * Calls the Deluge standalone function and renders the result.
 * Never throws: a failure only shows a small muted note.
 */
async function loadOutstandingReceivables(accountId) {
    const section = document.getElementById("receivables-section");
    if (!section) return;

    const requestId = ++receivablesRequestId;

    // Reset first so a previous account's balance never lingers.
    section.innerHTML = "";
    section.classList.add("hidden");

    if (!accountId) return;

    try {
        const reqData = {
            arguments: JSON.stringify({
                account_id: accountId
            })
        };

        const response = await ZOHO.CRM.FUNCTIONS.execute(GET_OUTSTANDING_RECEIVABLES_FUNCTION_NAME, reqData);

        // A newer account was loaded while we were waiting — drop this result.
        if (requestId !== receivablesRequestId) return;

        const amount = parseReceivablesAmount(extractFunctionOutput(response));
        if (amount === null) {
            throw new Error("Unexpected response: " + JSON.stringify(response));
        }

        renderReceivablesSection(amount);
    } catch (err) {
        if (requestId !== receivablesRequestId) return;
        console.error("Failed to load outstanding receivables:", err);
        section.innerHTML = '<p class="rv-note">Couldn\u2019t check outstanding receivables right now.</p>';
        section.classList.remove("hidden");
    } finally {
        // Only the latest request counts as finished; older ones were superseded.
        if (requestId === receivablesRequestId) finishCheck();
    }
}

/** Number, or numeric text like "1234.5" / "1,234.50". Anything else -> NaN. */
function toNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    if (typeof v === "string" && v.trim() !== "") return Number(v.replace(/,/g, ""));
    return NaN;
}

/**
 * Reads the amount from an object: uses RECEIVABLES_KEY if present,
 * otherwise accepts the object if it holds exactly one numeric value.
 */
function amountFromObject(obj) {
    if (!obj || typeof obj !== "object") return null;

    if (obj[RECEIVABLES_KEY] !== undefined) {
        const n = toNumber(obj[RECEIVABLES_KEY]);
        return isNaN(n) ? null : n;
    }

    const nums = Object.values(obj).map(toNumber).filter((n) => !isNaN(n));
    return nums.length === 1 ? nums[0] : null;
}

/**
 * Accepts a plain number, numeric text, a JSON/Map object, or text like
 * {"outstanding_receivables":1234.5} / {outstanding_receivables=1234.5}.
 * Returns null if no amount can be found, so the caller shows the error
 * note instead of a wrong 0.
 */
function parseReceivablesAmount(rawOutput) {
    if (rawOutput === null || rawOutput === undefined) return null;

    if (typeof rawOutput === "object") return amountFromObject(rawOutput);

    const direct = toNumber(rawOutput);
    if (!isNaN(direct)) return direct;

    if (typeof rawOutput === "string") {
        try {
            const parsed = JSON.parse(rawOutput);
            if (parsed && typeof parsed === "object") return amountFromObject(parsed);
        } catch (e) {
            // not JSON — fall through to the pattern match below
        }
        const m = new RegExp(RECEIVABLES_KEY + "[\"']?\\s*[:=]\\s*\"?(-?[\\d.,]+)").exec(rawOutput);
        if (m) {
            const n = toNumber(m[1]);
            return isNaN(n) ? null : n;
        }
    }

    return null;
}

/** 1234.5 -> "AED 1,234.50" */
function formatAed(amount) {
    return "AED " + amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function renderReceivablesSection(amount) {
    const section = document.getElementById("receivables-section");
    if (!section) return;

    // Round to 2 decimals first so something like 0.004 counts as 0 and stays hidden.
    const rounded = Math.round(amount * 100) / 100;

    if (rounded === 0) {
        section.innerHTML = "";
        section.classList.add("hidden");
        return;
    }

    section.innerHTML = buildReceivablesRowHtml(rounded);
    section.classList.remove("hidden");
}

function buildReceivablesRowHtml(amount) {
    // Negative balance = the client has overpaid / has a credit with us.
    const isCredit = amount < 0;
    const message = isCredit
        ? "This account has a credit balance."
        : "There is an unpaid balance on this account.";
    const label = isCredit ? "Credit balance" : "Amount due";

    return `
        <div class="alert-row sev-warn">
            <div class="alert-icon">${RECEIVABLES_ICON}</div>
            <div class="alert-body">
                <div class="alert-row-top">
                    <span class="alert-title">Outstanding Receivables</span>
                </div>
                <p class="alert-message">${message}</p>
                <div class="alert-row-bottom">
                    <span class="alert-date">${label}</span>
                    <span class="alert-badge alert-badge--amount">${formatAed(amount)}</span>
                </div>
            </div>
        </div>
    `;
}

/* ===========================================================
   ALL NOTES / IMPORTANT INFO LOG VIEW  (unchanged)
   =========================================================== */

function showNotesView() {
    document.getElementById("main-view").classList.add("hidden");
    document.getElementById("notes-view").classList.remove("hidden");
}

function showMainView() {
    document.getElementById("notes-view").classList.add("hidden");
    document.getElementById("main-view").classList.remove("hidden");
}

/**
 * Fetches all "Important Info" notes for the current account via the
 * Deluge standalone function, using the cache if we already fetched
 * for this account in this session.
 */
async function loadAllNotes() {
    const notesLoader = document.getElementById("notes-loader");
    const notesList = document.getElementById("notes-list");
    const notesEmptyState = document.getElementById("notes-empty-state");

    if (!currentAccountId) {
        notesList.innerHTML = "";
        notesEmptyState.classList.remove("hidden");
        return;
    }

    // Serve from cache if we already fetched notes for this account.
    if (notesCache && notesCacheAccountId === currentAccountId) {
        renderNotesTimeline(notesCache);
        return;
    }

    notesEmptyState.classList.add("hidden");
    notesList.innerHTML = "";
    if (notesLoader) notesLoader.classList.remove("hidden");

    try {
        const reqData = {
            arguments: JSON.stringify({
                account_id: currentAccountId
            })
        };

        const response = await ZOHO.CRM.FUNCTIONS.execute(GET_ALL_NOTES_FUNCTION_NAME, reqData);

        // The exact response shape can vary — this defensively checks the
        // common wrapper Zoho uses for custom function execution results.
        // Confirm the real shape with console.log(response) if this doesn't work.
        let notes = [];
        let rawOutput = null;

        if (response && response.details && response.details.output !== undefined) {
            rawOutput = response.details.output;
        } else if (response && response.output !== undefined) {
            rawOutput = response.output;
        } else {
            rawOutput = response;
        }

        if (typeof rawOutput === "string") {
            notes = parseNotesOutput(rawOutput);
        } else if (Array.isArray(rawOutput)) {
            notes = rawOutput;
        } else if (rawOutput && Array.isArray(rawOutput.data)) {
            notes = rawOutput.data;
        }

        if (!Array.isArray(notes)) notes = [];

        notesCache = notes;
        notesCacheAccountId = currentAccountId;

        renderNotesTimeline(notes);
    } catch (err) {
        console.error("Failed to load notes:", err);
        notesList.innerHTML = "";
        notesEmptyState.classList.remove("hidden");
        showPopup("Notes Fetch Error", err.message || "Unable to load notes for this account.", "error");
    } finally {
        if (notesLoader) notesLoader.classList.add("hidden");
    }
}

/**
 * Zoho's REST-function response sometimes drops the outer [ ] when a
 * standalone function returns a List — the "output" string ends up as
 * a bare comma-separated run of objects: {...},{...},{...} instead of
 * [{...},{...},{...}]. Detect that case and wrap it before parsing.
 */
function parseNotesOutput(str) {
    const trimmed = str.trim();

    if (trimmed.startsWith('[')) {
        return extractJsonArray(trimmed);
    }

    if (trimmed.startsWith('{')) {
        return extractJsonArray('[' + trimmed + ']');
    }

    // Unexpected shape — let JSON.parse throw its normal error so it's
    // still visible in the popup/console for debugging.
    return JSON.parse(trimmed);
}

/**
 * Finds the outermost [...] block in a string and parses just that,
 * ignoring any extra text before/after it (e.g. leftover debug/info
 * log output that got bundled into the function response). Falls back
 * to a plain JSON.parse of the whole string if no array is found.
 */
function extractJsonArray(str) {
    const start = str.indexOf('[');
    if (start === -1) {
        return JSON.parse(str);
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < str.length; i++) {
        const ch = str[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === '\\') {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === '[') depth++;
        if (ch === ']') {
            depth--;
            if (depth === 0) {
                const candidate = str.slice(start, i + 1);
                return JSON.parse(candidate);
            }
        }
    }

    // No properly matched closing bracket found — let JSON.parse throw
    // its normal error so it's still visible in the popup/console.
    return JSON.parse(str);
}

/**
 * Renders the notes as a newest-first vertical timeline. The most
 * recent note is treated as the "current" one and gets a highlighted
 * badge, matching what's shown in the Important Info banner.
 */
function renderNotesTimeline(notes) {
    const notesList = document.getElementById("notes-list");
    const notesEmptyState = document.getElementById("notes-empty-state");

    if (!notes || !notes.length) {
        notesList.innerHTML = "";
        notesEmptyState.classList.remove("hidden");
        return;
    }

    notesEmptyState.classList.add("hidden");

    const sorted = [...notes].sort((a, b) => {
        const dateA = new Date(a.Created_Time).getTime() || 0;
        const dateB = new Date(b.Created_Time).getTime() || 0;
        return dateB - dateA;
    });

    notesList.innerHTML = sorted.map((note, index) => buildNoteCardHtml(note, index === 0)).join("");
}

function buildNoteCardHtml(note, isCurrent) {
    const content = note.Note_Content || "";
    const dateLabel = formatDateTime(note.Created_Time);
    const author = extractAuthorLabel(note.Note_Title);

    return `
        <div class="note-card${isCurrent ? ' is-current' : ''}">
            <div class="note-card-top">
                <span class="note-date">${dateLabel}</span>
                ${isCurrent ? '<span class="note-current-badge">Current</span>' : ''}
            </div>
            ${author ? `<p class="note-author">${escapeHtml(author)}</p>` : ''}
            <p class="note-content">${escapeHtml(content)}</p>
        </div>
    `;
}

/**
 * Note_Title looks like "Important Info: Danah Angela Campana" — strip
 * the fixed prefix so we can show just the name/label part, if present.
 */
function extractAuthorLabel(rawTitle) {
    if (!rawTitle) return "";
    const stripped = rawTitle.replace(/^Important Info:\s*/i, "").trim();
    return stripped;
}

// Wire up navigation once the DOM is ready.
document.addEventListener("DOMContentLoaded", () => {
    const viewAllNotesBtn = document.getElementById("viewAllNotesBtn");
    const notesBackBtn = document.getElementById("notesBackBtn");

    if (viewAllNotesBtn) {
        viewAllNotesBtn.onclick = () => {
            showNotesView();
            loadAllNotes();
        };
    }

    if (notesBackBtn) {
        notesBackBtn.onclick = () => {
            showMainView();
        };
    }
});