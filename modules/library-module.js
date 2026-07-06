export function createLibraryModule({
  $,
  extension_settings,
  extensionName,
  normalizeLibraryView,
  highlightSearchMatch,
  escapeAttr,
  escapeHtml,
  getChatMemory,
  setChatMemory,
  getAbsoluteChatLength,
  setExtensionPrompt,
  scheduleContextUpdate,
  t,
} = {}) {
  escapeAttr = typeof escapeAttr === "function"
    ? escapeAttr
    : (typeof escapeHtml === "function" ? escapeHtml : (value) => String(value ?? ""));
  function setActiveLibraryView(view) {
    const normalizedView = normalizeLibraryView(view);
    $("#sm-library-view-summary").prop("checked", normalizedView === "summary");
    $("#sm-library-view-facts").prop("checked", normalizedView === "facts");

    $("#sm-library-pane-summary").toggleClass("active", normalizedView === "summary");
    $("#sm-library-pane-facts").toggleClass("active", normalizedView === "facts");
  }

  function renderLibrary() {
    let s = extension_settings[extensionName] || {};
    const chatMemory = getChatMemory();
    const library = chatMemory.library || [];
    const summaryQuery = String($("#sm-library-search-summary").val() || "")
      .trim()
      .toLowerCase();
    const factsQuery = String($("#sm-library-search-facts").val() || "")
      .trim()
      .toLowerCase();

    const listSummary = $("#sm-library-list-summary");
    const listFacts = $("#sm-library-list-facts");

    if (!listSummary.length || !listFacts.length) return;

    listSummary.toggleClass("grid-view", s.viewModeSummary === "grid");
    listFacts.toggleClass("grid-view", s.viewModeFacts === "grid");

    listSummary.empty();
    listFacts.empty();

    let hasSummary = false;
    let hasFacts = false;
    let totalSummary = 0;
    let totalFacts = 0;
    const factsPinnedHtml = [];
    const factsRegularHtml = [];
    let libraryChanged = false;

    const defaultSumExp =
      s.defaultExpirySummary !== undefined ? s.defaultExpirySummary : 0;
    const defaultFactExp =
      s.defaultExpiryFacts !== undefined ? s.defaultExpiryFacts : 0;

    library.forEach((item) => {
      if (item.position === undefined)
        item.position = item.type === "summary" ? 0 : 1;
      if (item.depth === undefined) item.depth = item.type === "summary" ? 0 : 4;
      if (item.role === undefined) item.role = 0;
      if (item.frequency === undefined) item.frequency = 1;

      if (item.type === "facts" && item.pinned === undefined) {
        item.pinned = false;
        libraryChanged = true;
      }

      if (item.expiry === undefined) {
        item.expiry = item.type === "facts" ? defaultFactExp : defaultSumExp;
        libraryChanged = true;
      }

      const depthStyle =
        item.position == 0 || item.position == 2 ? "display: none;" : "";
      const sunClass = item.enabled ? "active" : "";

      const activeQuery = item.type === "summary" ? summaryQuery : factsQuery;
      const titleDisplayHtml = highlightSearchMatch(item.title, activeQuery);
      const snippetDisplayHtml = highlightSearchMatch(item.content, activeQuery);
      const hitClass = activeQuery ? " sm-search-hit-item" : "";
      const pinClass = item.type === "facts" && item.pinned ? "active" : "";
      const pinButtonHtml =
        item.type === "facts"
          ? `<div class="sm-lib-action-btn sm-lib-pin ${pinClass}" title="${escapeAttr(t(item.pinned ? "unpin_fact" : "pin_fact"))}"><i class="fa-solid fa-thumbtack"></i></div>`
          : "";

      const html = `
              <div class="sm-lib-item${hitClass}" data-id="${escapeAttr(item.id)}">
                  <div class="sm-lib-header" title="">
                      <i class="fa-regular fa-moon sm-bulk-checkbox" title=""></i>
                      <i class="fa-solid fa-sun sm-sun-toggle ${sunClass}" title=""></i>

                      <div class="sm-lib-title-container">
                          <span class="sm-lib-title-display">${titleDisplayHtml}</span>
                          <input type="text" class="sm-lib-title-input" value="${escapeAttr(item.title)}" placeholder="${escapeAttr(t("name_this_memory"))}">

                          <div class="sm-lib-action-btn sm-lib-edit" title=""><i class="fa-solid fa-pencil"></i></div>
                          <div class="sm-lib-action-btn sm-lib-copy" title="${escapeAttr(t("copy_text"))}"><i class="fa-solid fa-copy"></i></div>
                          <div class="sm-lib-action-btn sm-lib-storage-copy" title="${escapeAttr(t("storage_copy_library_item_other"))}"><i class="fa-solid fa-right-left"></i></div>
                          ${pinButtonHtml}
                      </div>

                      <div class="sm-lib-action-btn sm-lib-expand-icon"><i class="fa-solid fa-chevron-down"></i></div>
                      <div class="sm-lib-action-btn sm-lib-delete" title=""><i class="fa-solid fa-trash"></i></div>
                  </div>

                  <div class="sm-lib-snippet">${snippetDisplayHtml}</div>

                  <div class="sm-lib-body" style="display: none; margin-top: 5px;">
                      <textarea class="text_pole sm-lib-textarea" rows="4" style="width:100%; resize: vertical;">${escapeHtml(item.content)}</textarea>

                      <div class="sm-lib-controls">
                          <select class="sm-lib-pos">
                              <option value="0" ${item.position == 0 ? "selected" : ""}>${t("pos_before")}</option>
                              <option value="2" ${item.position == 2 ? "selected" : ""}>${t("pos_after")}</option>
                              <option value="1" ${item.position == 1 ? "selected" : ""}>${t("pos_depth")}</option>
                          </select>

                          <span class="sm-depth-wrapper" style="${depthStyle}">
                              <input type="number" class="sm-lib-depth" value="${item.depth}" min="0">
                          </span>

                          <select class="sm-lib-role">
                              <option value="0" ${item.role == 0 ? "selected" : ""}>${t("role_sys")}</option>
                              <option value="1" ${item.role == 1 ? "selected" : ""}>${t("role_user")}</option>
                              <option value="2" ${item.role == 2 ? "selected" : ""}>${t("role_asst")}</option>
                          </select>

                          <label title="${escapeAttr(t("freq_title"))}">F:</label>
                          <input type="number" class="sm-lib-freq" value="${item.frequency}" min="0">

                          <label title="${escapeAttr(t("expire_title"))}">E:</label>
                          <input type="number" class="sm-lib-expiry" value="${item.expiry}" min="0">
                      </div>
                  </div>
              </div>
          `;

      const title = String(item.title || "").toLowerCase();
      const content = String(item.content || "").toLowerCase();

      if (item.type === "summary") {
        totalSummary++;
        const matchesSummary =
          !summaryQuery ||
          title.includes(summaryQuery) ||
          content.includes(summaryQuery);
        if (matchesSummary) {
          listSummary.append(html);
          hasSummary = true;
        }
      } else {
        totalFacts++;
        const matchesFacts =
          !factsQuery || title.includes(factsQuery) || content.includes(factsQuery);
        if (matchesFacts) {
          if (item.pinned) factsPinnedHtml.push(html);
          else factsRegularHtml.push(html);
        }
      }
    });

    if (factsPinnedHtml.length || factsRegularHtml.length) {
      listFacts.append(factsPinnedHtml.join(""));
      listFacts.append(factsRegularHtml.join(""));
      hasFacts = true;
    }

    if (!hasSummary)
      listSummary.append(
        `<div style="text-align:center; opacity:0.5; padding: 10px; font-size: 0.9em;">${totalSummary === 0 ? t("no_saved_summaries") : t("no_summary_matches")}</div>`,
      );
    if (!hasFacts)
      listFacts.append(
        `<div style="text-align:center; opacity:0.5; padding: 10px; font-size: 0.9em;">${totalFacts === 0 ? t("no_saved_facts") : t("no_facts_matches")}</div>`,
      );

    $(".sm-bulk-select-all")
      .removeClass("selected fa-solid")
      .addClass("fa-regular");

    if (libraryChanged) setChatMemory({ library });
  }

  function getExpiredLibraryItemIds() {
    const s = extension_settings[extensionName] || {};
    if (String(s.libraryStorageMode || "") === "character") return [];

    const mem = getChatMemory();
    const library = Array.isArray(mem?.library) ? mem.library : [];
    const chatLength = getAbsoluteChatLength();

    return library
      .filter((item) => {
        const expiry = Number(item?.expiry) || 0;
        if (expiry <= 0) return false;

        const createdAtMessage = Number(item?.createdAtMessage);
        if (!Number.isFinite(createdAtMessage)) return false;

        return chatLength - createdAtMessage >= expiry;
      })
      .map((item) => item.id);
  }

  function cleanupExpiredLibrary() {
    const mem = getChatMemory();
    const library = Array.isArray(mem?.library) ? mem.library : [];
    const expiredIds = new Set(getExpiredLibraryItemIds());

    if (!expiredIds.size) return 0;

    expiredIds.forEach((id) => {
      setExtensionPrompt(`${extensionName}-lib-${id}`, "", 0, 0, false, 0);
    });

    const nextLibrary = library.filter((item) => !expiredIds.has(item?.id));
    setChatMemory({ library: nextLibrary });
    renderLibrary();
    scheduleContextUpdate();

    return expiredIds.size;
  }

  function runExpiryCleanup() {
    const cleanedCount = cleanupExpiredLibrary();
    scheduleContextUpdate();
    return cleanedCount;
  }

  return {
    setActiveLibraryView,
    renderLibrary,
    cleanupExpiredLibrary,
    runExpiryCleanup,
  };
}
