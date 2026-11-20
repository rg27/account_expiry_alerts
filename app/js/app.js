/* =========================================================================
   Account Expiry Alerts — Widget Logic
   The client script only passes account_id. This widget calls the Deluge
   function itself and renders its return value.
   Also runs `Accounts_Unblocked_Email` on open and flags a permanently blocked PC email.
   ========================================================================= */

(function () {
  "use strict";

  var CONFIG = {
    WARN_THRESHOLD_DAYS: 30,
    CURRENCY: "AED",
    LOAD_TIMEOUT_MS: 10000,
    DEBUG: false,
    FUNCTION_NAME: "account_expiry_alerts",
    EMAIL_UNBLOCK_FUNCTION: "Accounts_Unblocked_Email",
    EMAIL_BLOCK_TITLE: "PC email is blocked",
    EMAIL_BLOCK_TEXT: "The PC email for this account is currently blocked by Zoho CRM. If you can confirm with the client that it is still active and working, please coordinate with the CRM team.",
    // Fallback only. The real flyout size is read when the widget loads.
    SIZE_FULL_FALLBACK: { width: "400px", height: "500px" },
    MIN_HEIGHT: "65px",
    DATE_FIELDS: [
      { key: "trade_license_end_date", label: "Trade License" },
      { key: "establishment_card_expiry_date", label: "Establishment Card" },
      { key: "e_channel_expiry_date", label: "E-Channel Registration" },
      { key: "address_package_end_date", label: "Address Package" }
    ]
  };

  var TAG = "[Account_Expiry_Alerts]";
  var state = { accountId: null, hasNotes: false, minimized: false, fullSize: null, emailBlocked: false };
  var ebAnchor = null;     // badge the blocked-email card is attached to
  var ebPinned = false;    // true after a click, so the card stays open

  /* ---------------- Logging ---------------- */

  function log() {
    if (!CONFIG.DEBUG) return;
    var args = [TAG].concat([].slice.call(arguments));
    try { console.log.apply(console, args); } catch (e) {}
  }

  function logErr() {
    var args = [TAG].concat([].slice.call(arguments));
    try { console.error.apply(console, args); } catch (e) {}
  }

  function safe(value, max) {
    var s;
    try { s = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
    catch (e) { s = String(value); }
    if (s === undefined) s = String(value);
    if (max && s.length > max) s = s.slice(0, max) + "\n… (truncated, " + s.length + " chars total)";
    return s;
  }

  /* ---------------- Icons ---------------- */

  function svg(inner, sw) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2.2) +
      '" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  var ICONS = {
    excl: svg('<path d="M12 6v8"></path><path d="M12 18h.01"></path>', 3.2),
    tick: svg('<path d="m5 12.5 4.5 4.5L19 7.5"></path>', 3.2),
    dash: svg('<path d="M7 12h10"></path>', 3.2),
    info: svg('<path d="M12 11v6"></path><path d="M12 7h.01"></path>', 3.2),
    user: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>', 2.4),
    users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', 2.4),
    wallet: svg('<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path>', 2.4)
  };

  /* ---------------- Elements ---------------- */

  function $(id) { return document.getElementById(id); }

  var el = {
    card: $("card"),
    screenMain: $("screen-main"), screenNotes: $("screen-notes"),
    closeBtns: document.querySelectorAll(".js-close"),
    minBtns: document.querySelectorAll(".js-min"),
    backBtn: $("backBtn"),

    hero: $("hero"), meta: $("meta"),
    typeText: $("typeText"), jurisText: $("jurisText"), jurisWrap: $("jurisWrap"),
    clientBadge: $("clientBadge"), recvBadge: $("recvBadge"),
    emailBlock: $("emailBlock"), ebPop: $("ebPop"),

    noteStrip: $("note-strip"), noteText: $("noteText"),
    notesBtn: $("notesBtn"), notesCount: $("notesCount"),
    notesSub: $("notesSub"), notesList: $("notes-list"),

    loader: $("loader"), main: $("main-view"), error: $("error-view"),
    rows: $("rows"),

    errorTitle: $("error-title"), errorMessage: $("error-message"),
    debug: $("debug"), copyBtn: $("copyBtn")
  };

  /* ---------------- Boot ---------------- */

  // Remember the real flyout size so "restore" returns to exactly that size.
  function captureFullSize() {
    if (state.fullSize || state.minimized) return;
    var w = window.innerWidth, h = window.innerHeight;
    if (w > 100 && h > 150) {
      state.fullSize = { width: w + "px", height: h + "px" };
    }
    log("full size captured:", safe(state.fullSize));
  }

  var noDataTimer = setTimeout(function () {
    logErr("PageLoad never fired within " + CONFIG.LOAD_TIMEOUT_MS + "ms");
    showError("No data received",
      "The widget didn't receive the account ID. Please reopen it from the record page.",
      { reason: "PageLoad event did not fire within " + CONFIG.LOAD_TIMEOUT_MS + "ms" });
  }, CONFIG.LOAD_TIMEOUT_MS);

  ZOHO.embeddedApp.on("PageLoad", function (entity) {
    clearTimeout(noDataTimer);
    captureFullSize();
    log("PageLoad entity (raw):", safe(entity));

    state.accountId = findKey(entity, "account_id") || findKey(entity, "EntityId");
    log("account_id received by widget:", state.accountId);

    load();
    checkEmailBlock();   // runs in parallel, never delays the alerts
  });

  ZOHO.embeddedApp.init();

  Array.prototype.forEach.call(el.closeBtns, function (b) { b.addEventListener("click", closeWidget); });
  Array.prototype.forEach.call(el.minBtns, function (b) {
    b.addEventListener("click", function () { setMinimized(!state.minimized); });
  });
  el.backBtn.addEventListener("click", function () { setMode("main"); });
  el.notesBtn.addEventListener("click", function () { setMode("notes"); });
  el.copyBtn.addEventListener("click", copyDebug);

  /* ---------------- Blocked email check ---------------- */

  // Only a "blocked permanently" answer (email_blocked = true) shows anything;
  // every other result or error stays silent.
  function checkEmailBlock() {
    if (!state.accountId) return;
    var request = { arguments: JSON.stringify({ account_id: state.accountId }) };
    ZOHO.CRM.FUNCTIONS.execute(CONFIG.EMAIL_UNBLOCK_FUNCTION, request)
      .then(function (res) {
        log("email unblock result:", safe(res));
        setEmailBlocked(findFlag(res, "email_blocked") === true);
      })
      .catch(function (err) {
        logErr("email unblock call failed (nothing is shown)", err);
      });
  }

  // Breadth-first search for a boolean key inside the (possibly string-wrapped) response.
  function findFlag(root, key) {
    var queue = [root], seen = [], steps = 0;
    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (v === null || v === undefined) continue;
      if (typeof v === "string") {
        var parsed = tryParse(v);
        if (parsed !== null) queue.push(parsed);
        continue;
      }
      if (typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);
      if (typeof v[key] === "boolean") return v[key];
      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  function setEmailBlocked(on) {
    state.emailBlocked = !!on;
    toggle(el.emailBlock, state.emailBlocked);
    if (!state.emailBlocked) hideEbPop();
  }

  /* ---- Explanation card: hover, click to pin, click elsewhere or Esc to close ---- */

  function ebTarget(e) {
    return e.target && e.target.closest ? e.target.closest(".eb") : null;
  }

  function showEbPop(anchor) {
    if (!state.emailBlocked || !anchor) return;
    el.ebPop.innerHTML = "";
    el.ebPop.appendChild(h("div", "eb-pop__t", CONFIG.EMAIL_BLOCK_TITLE));
    el.ebPop.appendChild(h("div", "eb-pop__p", CONFIG.EMAIL_BLOCK_TEXT));
    ebAnchor = anchor;
    el.ebPop.classList.remove("eb-pop--up");
    toggle(el.ebPop, true);

    var r = anchor.getBoundingClientRect();
    var w = el.ebPop.offsetWidth, ph = el.ebPop.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    var top = r.bottom + 9;
    if (top + ph > window.innerHeight - 8) {          // no room below: open upwards
      top = Math.max(8, r.top - ph - 9);
      el.ebPop.classList.add("eb-pop--up");
    }
    el.ebPop.style.left = left + "px";
    el.ebPop.style.top = top + "px";
    el.ebPop.style.setProperty("--ax", Math.round(r.left + r.width / 2 - left) + "px");
  }

  function hideEbPop() {
    ebAnchor = null;
    ebPinned = false;
    toggle(el.ebPop, false);
  }

  document.addEventListener("mouseover", function (e) {
    var b = ebTarget(e);
    if (b && !ebPinned) showEbPop(b);
  });
  document.addEventListener("mouseout", function (e) {
    var b = ebTarget(e);
    if (b && !ebPinned && !(e.relatedTarget && b.contains(e.relatedTarget))) hideEbPop();
  });
  document.addEventListener("click", function (e) {
    var b = ebTarget(e);
    if (b) {
      if (ebPinned && ebAnchor === b) { hideEbPop(); return; }
      showEbPop(b);
      ebPinned = true;
    } else if (ebPinned) {
      hideEbPop();
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ebAnchor) hideEbPop(); });
  document.addEventListener("scroll", function () { if (ebAnchor) hideEbPop(); }, true);

  /* ---------------- Minimize / restore (via ZOHO.CRM.UI.Resize) ---------------- */

  function setMinimized(min) {
    captureFullSize();
    state.minimized = min;
    if (min) hideEbPop();
    el.card.classList.toggle("is-min", min);

    Array.prototype.forEach.call(el.minBtns, function (b) {
      var label = min ? "Expand" : "Minimize";
      b.setAttribute("aria-label", label);
      b.setAttribute("title", label);
    });

    var full = state.fullSize || CONFIG.SIZE_FULL_FALLBACK;
    resizeFlyout(min
      ? { width: full.width, height: CONFIG.MIN_HEIGHT }
      : { width: full.width, height: full.height });
  }

  function resizeFlyout(size) {
    log("resize →", safe(size));
    if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && typeof ZOHO.CRM.UI.Resize === "function") {
      ZOHO.CRM.UI.Resize(size)
        .then(function (res) { log("[Resize] response:", safe(res)); })
        .catch(function (err) { logErr("[Resize] error:", err); });
    }
  }

  /* ---------------- Load (calls the Deluge function) ---------------- */

  function load() {
    if (!state.accountId) {
      showError("Missing account ID",
        "The client script didn't pass account_id to the widget.",
        { accountIdInWidget: state.accountId });
      return;
    }

    var args = { account_id: state.accountId };
    var request = { arguments: JSON.stringify(args) };

    log("ZOHO.CRM.FUNCTIONS.execute →", CONFIG.FUNCTION_NAME);
    log("function params:", safe(request));
    setMode("loading");

    ZOHO.CRM.FUNCTIONS.execute(CONFIG.FUNCTION_NAME, request)
      .then(function (res) {
        log("function result (type):", typeof res);
        log("function result (value):", safe(res));
        handleRaw(res, { function: CONFIG.FUNCTION_NAME, params: request });
      })
      .catch(function (err) {
        logErr("function call failed", err);
        showError("Couldn't call the function",
          (err && err.message) || "ZOHO.CRM.FUNCTIONS.execute failed.",
          { function: CONFIG.FUNCTION_NAME, params: request, error: err });
      });
  }

  /* ---------------- Payload handling ---------------- */

  function handleRaw(raw, ctx) {
    var payload;
    try {
      payload = extractPayload(raw);
    } catch (e) {
      logErr("extractPayload threw", e);
      showError("Couldn't read the response", "Error while reading the response: " + e.message,
        { call: ctx, received: raw, stack: e.stack });
      return;
    }

    if (!payload) {
      logErr("No payload found in response");
      showError("Couldn't read the response",
        "The function responded, but the account payload wasn't found in it.",
        { call: ctx, received: raw });
      return;
    }

    log("payload extracted:", safe(payload));

    if (payload.error) {
      showError("Couldn't load alerts", payload.message || "Failed to load account expiry data.",
        { call: ctx, received: raw });
      return;
    }

    try {
      render(payload);
    } catch (err) {
      logErr("render failed", err);
      showError("Couldn't display alerts", "Render error: " + err.message,
        { call: ctx, received: raw, payload: payload, stack: err.stack });
    }
  }

  // Searches the response (breadth-first) for the object that has `accounts`.
  function extractPayload(root) {
    var queue = [root];
    var seen = [];
    var steps = 0;

    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (v === null || v === undefined) continue;

      if (typeof v === "string") {
        var parsed = tryParse(v);
        if (parsed !== null) queue.push(parsed);
        continue;
      }
      if (typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);

      if (v.accounts && typeof v.accounts === "object") return v;
      if (v.error === true) return v;

      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  function tryParse(str) {
    var s = String(str).trim();
    if (!s || (s.charAt(0) !== "{" && s.charAt(0) !== "[")) return null;
    try {
      return JSON.parse(s);
    } catch (e1) {
      var a = s.indexOf("{");
      var b = s.lastIndexOf("}");
      if (a !== -1 && b > a) {
        try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) { /* fall through */ }
      }
      logErr("String looked like JSON but could not be parsed:", s.slice(0, 500));
      return null;
    }
  }

  function findKey(root, key) {
    var queue = [root];
    var seen = [];
    var steps = 0;
    while (queue.length && steps++ < 300) {
      var v = queue.shift();
      if (!v || typeof v !== "object" || seen.indexOf(v) !== -1) continue;
      seen.push(v);
      if (v[key] !== undefined && v[key] !== null && typeof v[key] !== "object") return String(v[key]);
      Object.keys(v).forEach(function (k) { queue.push(v[k]); });
    }
    return null;
  }

  /* ---------------- Modes ---------------- */

  function setMode(mode) {
    toggle(el.screenMain, mode !== "notes");
    toggle(el.screenNotes, mode === "notes");

    toggle(el.loader, mode === "loading");
    toggle(el.main, mode === "main");
    toggle(el.error, mode === "error");
    toggle(el.meta, mode === "main");
    toggle(el.hero, mode === "main");
    toggle(el.noteStrip, mode === "main" && state.hasNotes);
  }

  function showError(title, message, debug) {
    el.errorTitle.textContent = title;
    el.errorMessage.textContent = message;
    el.debug.textContent = safe(debug || {}, 8000);
    setMode("error");
  }

  /* ---------------- Render ---------------- */

  function render(payload) {
    var acc = payload.accounts || {};
    var notes = normalizeNotes(payload.all_notes).slice().sort(byNewest);
    var rvCount = Number((payload.residence_visa || {}).rv_count) || 0;
    var outstanding = Number((payload.zoho_books || {}).outstanding_receivables) || 0;

    renderHeader(acc, outstanding);
    renderNotes(notes);
    renderDates(buildItems(acc, rvCount));

    setMode("main");
  }

  /* ---------------- Header ---------------- */

  function renderHeader(acc, outstanding) {
    el.typeText.textContent = acc.account_type || "";
    el.jurisText.textContent = acc.jurisdiction || "";
    toggle(el.jurisWrap, !!acc.jurisdiction);

    var partner = isTrue(acc.contact_partner_only);
    var kind = partner ? "partner" : "direct";

    el.clientBadge.className = "badge badge--" + kind;
    el.clientBadge.innerHTML = partner ? ICONS.users : ICONS.user;
    el.clientBadge.appendChild(h("span", "", partner ? "Business Partner" : "Direct Client"));

    var tip = h("div", "tip tip--" + kind);
    var tipIco = h("div", "tip__ico");
    tipIco.innerHTML = partner ? ICONS.users : ICONS.user;
    var tipBody = h("div", "tip__body");
    tipBody.appendChild(h("strong", "", partner ? "Business Partner account" : "Direct Client account"));
    tipBody.appendChild(h("span", "", partner
      ? "Send all communication for this company to the Business Partner, not to the company directly."
      : "Send all communication for this company directly to the client."));
    tip.appendChild(tipIco);
    tip.appendChild(tipBody);
    el.clientBadge.appendChild(tip);

    // Outstanding Receivables: dark label + amber amount
    var hasBalance = outstanding > 1;
    toggle(el.recvBadge, hasBalance);
    el.recvBadge.innerHTML = "";
    if (hasBalance) {
      var label = h("span", "recv__label");
      label.innerHTML = ICONS.wallet;
      label.appendChild(h("span", "", "Outstanding Receivables"));
      el.recvBadge.appendChild(label);
      el.recvBadge.appendChild(h("span", "recv__amt", formatCurrency(outstanding)));
    }
  }

  /* ---------------- Important Info ---------------- */

  // Accepts a list, a single note object, or a JSON string, and always returns a list.
  function normalizeNotes(raw) {
    var v = raw;

    if (typeof v === "string") {
      var parsed = tryParse(v);
      v = parsed !== null ? parsed : null;
    }
    if (!v) return [];

    if (Array.isArray(v)) {
      return v.filter(function (n) { return n && typeof n === "object"; });
    }

    if (typeof v === "object") {
      if (Array.isArray(v.data)) return normalizeNotes(v.data);

      // A single note object
      if (v.Note_Content !== undefined || v.Note_Title !== undefined || v.id !== undefined) {
        return [v];
      }

      // An object keyed by index or id
      return Object.keys(v)
        .map(function (k) { return v[k]; })
        .filter(function (n) { return n && typeof n === "object"; });
    }

    return [];
  }

  function renderNotes(notes) {
    el.notesList.innerHTML = "";
    state.hasNotes = notes.length > 0;
    if (!notes.length) return;

    // Strip: latest note only
    el.noteText.textContent = notes[0].Note_Content || "(No content)";
    el.noteStrip.classList.toggle("is-multi", notes.length > 1);

    toggle(el.notesBtn, notes.length > 1);
    el.notesCount.textContent = notes.length + " notes";

    // Separate notes screen (newest at the top)
    el.notesSub.textContent = plural(notes.length, "note") + " · newest first";
    notes.forEach(function (note, i) {
      var created = parseDate(note.Created_Time);
      el.notesList.appendChild(buildItem({
        sev: "info",
        icon: "info",
        title: noteAuthor(note) || "Note",
        pill: i === 0 ? "Latest" : "",
        detail: note.Note_Content || "",
        sub: created ? formatDateTime(created) : ""
      }));
    });
  }

  function noteAuthor(note) {
    var parts = String(note.Note_Title || "").split(":");
    return parts.length > 1 ? parts.slice(1).join(":").trim() : "";
  }

  /* ---------------- Expiry dates ---------------- */

  function renderDates(items) {
    el.rows.innerHTML = "";
    items.forEach(function (item) { el.rows.appendChild(buildItem(item)); });
  }

  function buildItems(acc, rvCount) {
    var items = [];
    var today = startOfDay(new Date());

    CONFIG.DATE_FIELDS.forEach(function (field, index) {
      var date = parseDate(acc[field.key]);
      var skip = skipReason(field.key, acc, date);
      var order = 1e9 + index;

      // Not applicable to this account: still shown, greyed out.
      if (skip) {
        items.push({
          sev: "muted", title: field.label, detail: skip,
          pill: "N/A", sub: date ? formatDate(date) : "", sort: order
        });
        return;
      }

      // Applicable but empty.
      if (!date) {
        items.push({
          sev: "muted", title: field.label, detail: "No date on record.",
          pill: "Not set", sub: "", sort: order
        });
        return;
      }

      var days = Math.round((startOfDay(date) - today) / 86400000);
      var item = { title: field.label, sub: formatDate(date), sort: days };

      if (days < 0) {
        item.sev = "urgent";
        item.detail = "Expired " + plural(Math.abs(days), "day") + " ago";
        item.pill = "Expired";
      } else if (days === 0) {
        item.sev = "urgent";
        item.detail = "Expires today";
        item.pill = "Today";
      } else if (days <= CONFIG.WARN_THRESHOLD_DAYS) {
        item.sev = "warn";
        item.detail = "Expires in " + plural(days, "day");
        item.pill = plural(days, "day") + " left";
      } else {
        item.sev = "ok";
        item.detail = "Expires in " + plural(days, "day");
        item.pill = "Valid";
      }
      items.push(item);
    });

    if (rvCount > 0) {
      items.push({
        sev: "urgent", title: "Residence Visas",
        detail: plural(rvCount, "visa") + " marked Issued but past expiry date",
        pill: rvCount + " expired", sub: "Status still Issued", sort: -1
      });
    }

    var rank = { urgent: 0, warn: 1, ok: 2, muted: 3 };
    items.sort(function (a, b) {
      return rank[a.sev] - rank[b.sev] || a.sort - b.sort;
    });
    return items;
  }

  // Returns a reason string when the field doesn't apply to this account.
  function skipReason(key, acc, date) {
    if (key === "establishment_card_expiry_date" && acc.trade_license_package === "Zero Visa License") {
      return "Not required for Zero Visa License";
    }
    if (key === "e_channel_expiry_date" && acc.jurisdiction === "International Free Zone Authority") {
      return "Not required for International Free Zone Authority";
    }
    if (key === "address_package_end_date") {
      if (isTrue(acc.client_decided_not_to_renew)) return "Client is not renewing";
      if (!date && !acc.ap_status) return "No Address Package on this account";
    }
    return "";
  }

  /* ---------------- Item builder ---------------- */

  function buildItem(o) {
    var node = h("div", "item item--" + o.sev);

    var icon = h("div", "item__ico");
    var iconKey = o.icon || (o.sev === "ok" ? "tick" : o.sev === "muted" ? "dash" : "excl");
    icon.innerHTML = ICONS[iconKey];

    var body = h("div", "item__body");
    var top = h("div", "item__top");
    top.appendChild(h("span", "item__title", o.title));
    if (o.pill) top.appendChild(h("span", "pill", o.pill));
    body.appendChild(top);
    if (o.detail) body.appendChild(h("div", "item__detail", o.detail));
    if (o.sub) body.appendChild(h("div", "item__sub", o.sub));

    node.appendChild(icon);
    node.appendChild(body);
    return node;
  }

  /* ---------------- Helpers ---------------- */

  function copyDebug() {
    var text = el.debug.textContent || "";
    function done() {
      el.copyBtn.textContent = "Copied";
      setTimeout(function () { el.copyBtn.textContent = "Copy"; }, 1500);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      done();
    }
    try {
      navigator.clipboard.writeText(text).then(done, fallback);
    } catch (e) {
      fallback();
    }
  }

  function closeWidget() {
  console.log("Closing widget.");

  if (typeof $Client !== "undefined" && typeof $Client.close === "function") {
    $Client.close();
  } else {
    console.warn("[Close] $Client.close is not available in this widget.");
  }
}

  function h(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function toggle(node, show) {
    if (node) node.classList.toggle("hidden", !show);
  }

  function isTrue(v) { return v === true || v === "true"; }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function parseDate(value) {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var p = value.split("-").map(Number);
      return new Date(p[0], p[1] - 1, p[2]);
    }
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function formatDate(d) {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function formatDateTime(d) {
    return formatDate(d) + ", " +
      d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
  }

  function formatCurrency(amount) {
    return CONFIG.CURRENCY + " " + Number(amount).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function byNewest(a, b) {
    var da = parseDate(a.Created_Time);
    var db = parseDate(b.Created_Time);
    if (!da || !db) return 0;
    return db - da;
  }
})();