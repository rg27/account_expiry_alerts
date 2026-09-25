/* =========================================================================
   Account Expiry Alerts — Widget Logic
   ========================================================================= */

(function () {
  "use strict";

  var CONFIG = {
    WARN_THRESHOLD_DAYS: 30,
    DATE_FIELDS: [
      { key: "trade_license_end_date", label: "Trade License End Date" },
      { key: "establishment_card_expiry_date", label: "Establishment Card Expiry Date" },
      { key: "e_channel_expiry_date", label: "E-Channel Expiry Date" },
      { key: "address_package_end_date", label: "Address Package End Date" }
    ],
    CURRENCY: "AED"
  };

  var el = {
    loaderOverlay: document.getElementById("loader-overlay"),
    loaderText: document.getElementById("loader-text"),

    mainView: document.getElementById("main-view"),
    alertCount: document.getElementById("alert-count"),
    clientTypeBadge: document.getElementById("clientTypeBadge"),
    standardClientBadge: document.getElementById("standardClientBadge"),
    headerReceivablesBadge: document.getElementById("headerReceivablesBadge"),
    headerReceivablesAmount: document.getElementById("headerReceivablesAmount"),

    importantInfoWrapper: document.getElementById("importantInfoWrapper"),
    importantInfoToggle: document.getElementById("importantInfoToggle"),
    importantInfoContentBox: document.getElementById("importantInfoContentBox"),
    importantInfoText: document.getElementById("importantInfoText"),
    viewAllNotesBtn: document.getElementById("viewAllNotesBtn"),

    alertList: document.getElementById("alert-list"),
    alertRows: document.getElementById("alert-rows"),
    rvSection: document.getElementById("rv-section"),
    receivablesSection: document.getElementById("receivables-section"),
    checksLoading: document.getElementById("checks-loading"),

    emptyState: document.getElementById("empty-state"),

    notesView: document.getElementById("notes-view"),
    notesBackBtn: document.getElementById("notesBackBtn"),
    notesLoader: document.getElementById("notes-loader"),
    notesList: document.getElementById("notes-list"),
    notesEmptyState: document.getElementById("notes-empty-state"),

    popup: document.getElementById("popup"),
    statusIcon: document.getElementById("statusIcon"),
    popupTitle: document.getElementById("popupTitle"),
    popupMessage: document.getElementById("popupMessage")
  };

  var noDataTimeout = setTimeout(function () {
    showPopup("error", "No data received", "This widget didn't receive any account data. Please reopen it from the record page.");
    hideLoader();
  }, 10000);

  ZOHO.embeddedApp.on("PageLoad", function (entity) {
    clearTimeout(noDataTimeout);

    try {
      var raw = extractRawPayload(entity);
      var payload = normalizePayload(raw);
      if (!payload) {
        throw new Error("Empty or unparsable payload");
      }
      render(payload);
    } catch (err) {
      console.error("Failed to render Account Expiry Alerts widget:", err);
      showPopup("error", "Couldn't load alerts", "Something went wrong while loading this account's data.");
    } finally {
      hideLoader();
    }
  });

  ZOHO.embeddedApp.init();

  function extractRawPayload(entity) {
    if (!entity) return null;
    var candidate = entity.accountExpiryAlerts || (entity.data && entity.data.accountExpiryAlerts);
    if (!candidate) {
      return entity;
    }
    if (candidate._details && "output" in candidate._details) {
      return candidate._details.output;
    }
    if (typeof candidate === "object" && "output" in candidate) {
      return candidate.output;
    }
    return candidate;
  }

  function normalizePayload(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error("Payload was a string but not valid JSON:", raw);
        return null;
      }
    }
    return null;
  }

  function render(payload) {
    var accounts = payload.accounts || {};
    var notes = Array.isArray(payload.all_notes) ? payload.all_notes.slice() : [];
    var residenceVisa = payload.residence_visa || {};
    var zohoBooks = payload.zoho_books || {};

    notes.sort(byCreatedTimeDesc);

    var dateAlerts = buildDateAlerts(accounts);
    var rvCount = Number(residenceVisa.rv_count) || 0;
    var outstanding = Number(zohoBooks.outstanding_receivables) || 0;

    renderClientBadge(accounts);
    renderImportantInfo(notes);
    renderAlertRows(dateAlerts);
    renderRvSection(rvCount);
    renderReceivablesSection(outstanding);
    renderHeaderReceivables(outstanding);
    renderNotesView(notes);

    // Counter assignment removed from here

    var hasAnyContent = dateAlerts.length > 0 || rvCount > 0 || outstanding > 0;
    toggle(el.alertList, hasAnyContent);
    toggle(el.emptyState, !hasAnyContent);
    toggle(el.checksLoading, false);
  }

  function buildDateAlerts(accounts) {
    var now = new Date();
    var alerts = [];

    CONFIG.DATE_FIELDS.forEach(function (field) {
      if (shouldSkipDateAlert(field.key, accounts)) {
        return;
      }

      var rawDate = accounts[field.key];
      var expiry = rawDate ? parseDate(rawDate) : null;

      if (!rawDate || !expiry) {
        alerts.push({
          title: field.label,
          message: field.label + " is empty.",
          badgeText: "Missing",
          dateLabel: "Not provided",
          severity: "warn",
          daysRemaining: Number.MAX_SAFE_INTEGER
        });
        return;
      }

      var differenceMs = expiry.getTime() - now.getTime();
      var daysRemaining = differenceMs / 86400000;
      var severity = differenceMs < 0 ? "urgent" : daysRemaining <= CONFIG.WARN_THRESHOLD_DAYS ? "warn" : "ok";

      var message, badgeText;
      if (differenceMs < 0) {
        message = "Expired " + formatDays(Math.abs(daysRemaining)) + " days ago";
        badgeText = "Expired";
      } else {
        message = "Expires in " + formatDays(daysRemaining) + " days";
        badgeText = formatDays(daysRemaining) + (daysRemaining === 1 ? " day left" : " days left");
      }

      alerts.push({
        title: field.label,
        message: message,
        badgeText: badgeText,
        dateLabel: formatDate(expiry),
        severity: severity,
        daysRemaining: daysRemaining
      });
    });

    if (accounts.client_decided_not_to_renew === true) {
      alerts.unshift({
        title: "Renewal Status",
        message: "Client has decided not to renew this account.",
        badgeText: "Not renewing",
        dateLabel: "Action required",
        severity: "urgent",
        daysRemaining: -Infinity
      });
    }

    alerts.sort(function (a, b) {
      return a.daysRemaining - b.daysRemaining;
    });

    return alerts;
  }

  function shouldSkipDateAlert(fieldKey, accounts) {
    if (fieldKey === "establishment_card_expiry_date" && accounts.trade_license_package === "Zero Visa License") {
      return true;
    }
    if (fieldKey === "e_channel_expiry_date" && accounts.jurisdiction === "International Free Zone Authority") {
      return true;
    }
    if (fieldKey === "address_package_end_date" && accounts.client_decided_not_to_renew === true) {
      return true;
    }
    return false;
  }

  function renderAlertRows(alerts) {
    el.alertRows.innerHTML = "";
    alerts.forEach(function (alert) {
      el.alertRows.appendChild(buildAlertRow(alert));
    });
  }

  function buildAlertRow(alert) {
    var row = document.createElement("div");
    row.className = "alert-row sev-" + alert.severity;

    var iconSvg = alert.severity === "urgent" ? ICONS.urgent : alert.severity === "warn" ? ICONS.warn : ICONS.ok;

    row.innerHTML =
      '<div class="alert-icon">' + iconSvg + "</div>" +
      '<div class="alert-body">' +
        '<div class="alert-row-top">' +
          '<span class="alert-title"></span>' +
        "</div>" +
        '<p class="alert-message"></p>' +
        '<div class="alert-row-bottom">' +
          '<span class="alert-date"></span>' +
          '<span class="alert-badge"></span>' +
        "</div>" +
      "</div>";

    row.querySelector(".alert-title").textContent = alert.title;
    row.querySelector(".alert-message").textContent = alert.message;
    row.querySelector(".alert-date").textContent = alert.dateLabel;
    row.querySelector(".alert-badge").textContent = alert.badgeText;

    return row;
  }

  function renderClientBadge(accounts) {
    var isPartner = accounts.contact_partner_only === true;
    toggle(el.clientTypeBadge, isPartner);
    toggle(el.standardClientBadge, !isPartner);
  }

  function renderImportantInfo(notes) {
    if (!notes.length) {
      toggle(el.importantInfoWrapper, false);
      return;
    }
    toggle(el.importantInfoWrapper, true);
    el.importantInfoText.textContent = notes[0].Note_Content || "";
  }

  if (el.importantInfoToggle) {
    el.importantInfoToggle.addEventListener("click", function () {
      var isExpanded = el.importantInfoToggle.classList.toggle("is-expanded");
      toggle(el.importantInfoContentBox, isExpanded);
    });
  }

  if (el.viewAllNotesBtn) {
    el.viewAllNotesBtn.addEventListener("click", showNotesView);
  }
  if (el.notesBackBtn) {
    el.notesBackBtn.addEventListener("click", showMainView);
  }

  function showNotesView() {
    toggle(el.mainView, false);
    toggle(el.notesView, true);
  }

  function showMainView() {
    toggle(el.notesView, false);
    toggle(el.mainView, true);
  }

  function renderNotesView(notes) {
    el.notesList.innerHTML = "";

    if (!notes.length) {
      toggle(el.notesEmptyState, true);
      toggle(el.notesList, false);
      return;
    }
    toggle(el.notesEmptyState, false);
    toggle(el.notesList, true);

    notes.forEach(function (note, index) {
      el.notesList.appendChild(buildNoteCard(note, index === 0));
    });
  }

  function buildNoteCard(note, isCurrent) {
    var card = document.createElement("div");
    card.className = "note-card" + (isCurrent ? " is-current" : "");

    var titleParts = (note.Note_Title || "").split(":");
    var subjectLabel = titleParts.length > 1 ? titleParts.slice(1).join(":").trim() : "";
    var initials = subjectLabel ? getInitials(subjectLabel) : "?";

    card.innerHTML =
      '<div class="note-card-top">' +
        '<span class="note-date">' + ICONS.clock + '<span class="note-date-text"></span></span>' +
        (isCurrent ? '<span class="note-current-badge">Current</span>' : "") +
      "</div>" +
      (subjectLabel
        ? '<div class="note-author-row">' +
            '<span class="note-avatar"></span>' +
            '<span class="note-author"></span>' +
          "</div>"
        : "") +
      '<p class="note-content"></p>';

    var dateEl = card.querySelector(".note-date-text");
    var createdAt = parseDate(note.Created_Time);
    dateEl.textContent = createdAt ? formatDateTime(createdAt) : "";

    if (subjectLabel) {
      card.querySelector(".note-avatar").textContent = initials;
      card.querySelector(".note-author").textContent = subjectLabel;
    }

    card.querySelector(".note-content").textContent = note.Note_Content || "";

    return card;
  }

  function renderRvSection(rvCount) {
    if (rvCount <= 0) {
      toggle(el.rvSection, false);
      el.rvSection.innerHTML = "";
      return;
    }
    toggle(el.rvSection, true);
    el.rvSection.innerHTML =
      '<div class="alert-row sev-urgent">' +
        '<div class="alert-icon">' + ICONS.urgent + "</div>" +
        '<div class="alert-body">' +
          '<div class="alert-row-top"><span class="alert-title">Residence Visas</span></div>' +
          '<p class="alert-message"></p>' +
          '<div class="alert-row-bottom">' +
            '<span class="alert-date"></span>' +
            '<span class="alert-badge">Expired</span>' +
          "</div>" +
        "</div>" +
      "</div>";
    el.rvSection.querySelector(".alert-message").textContent =
      rvCount + " residence visa" + (rvCount === 1 ? "" : "s") + " marked Issued but past its expiry date";
  }

  function renderReceivablesSection(amount) {
    if (amount <= 0) {
      toggle(el.receivablesSection, false);
      el.receivablesSection.innerHTML = "";
      return;
    }
    toggle(el.receivablesSection, true);
    el.receivablesSection.innerHTML =
      '<div class="alert-row sev-warn">' +
        '<div class="alert-icon">' + ICONS.warn + "</div>" +
        '<div class="alert-body">' +
          '<div class="alert-row-top">' +
            '<span class="alert-title">Outstanding Receivables</span>' +
          "</div>" +
          '<p class="alert-message">This account has an unpaid balance in Zoho Books.</p>' +
          '<div class="alert-row-bottom">' +
            '<span class="alert-date">Zoho Books Balance</span>' +
            '<span class="alert-badge"></span>' +
          "</div>" +
        "</div>" +
      "</div>";
    el.receivablesSection.querySelector(".alert-badge").textContent = formatCurrency(amount);
  }

  function renderHeaderReceivables(amount) {
    var hasBalance = amount > 0;
    toggle(el.headerReceivablesBadge, hasBalance);
    if (hasBalance && el.headerReceivablesAmount) {
      el.headerReceivablesAmount.textContent = formatCurrency(amount);
    }
  }

  function showPopup(status, title, message) {
    if (!el.popup) return;
    el.popup.dataset.status = status;
    el.statusIcon.className = "status-icon status-icon--" + status;
    el.popupTitle.textContent = title;
    el.popupMessage.textContent = message;
    el.popup.classList.remove("hidden");
  }

  window.closePopup = function () {
    if (el.popup) el.popup.classList.add("hidden");
  };

  function hideLoader() {
    if (el.loaderOverlay) el.loaderOverlay.classList.add("hidden");
  }

  window.closeWidget = function () {
    try {
      if (typeof $Client !== "undefined" && $Client.close) {
        $Client.close();
      } else {
        window.close();
      }
    } catch (e) {
      console.error("Unable to close widget:", e);
    }
  };

  function toggle(node, show) {
    if (!node) return;
    node.classList.toggle("hidden", !show);
  }

  function parseDate(value) {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      var parts = value.split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDays(days) {
    return String(Math.round(Number(days)));
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function formatDate(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(d) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function formatCurrency(amount) {
    return CONFIG.CURRENCY + " " + Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function byCreatedTimeDesc(a, b) {
    var da = parseDate(a.Created_Time);
    var db = parseDate(b.Created_Time);
    if (!da || !db) return 0;
    return db - da;
  }

  function getInitials(name) {
    var parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  var ICONS = {
    urgent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.8 19a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L12 3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.8 19a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L12 3Z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.2 4L19 6.5"></path><path d="M12 21a9 9 0 1 1 9-9"></path></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></svg>'
  };
})();