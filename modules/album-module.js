export function createAlbumModule({
  $,
  window,
  document,
  extension_settings,
  extensionName,
  DEFAULT_ALBUM_DIARY_PROMPT,
  makeAlbumId,
  normalizeAlbumSort,
  normalizeAlbumFolderSort,
  getImageNameFromUrl,
  getAlbumPromptTextFromGenerationMeta,
  getAlbumStyleTextFromGenerationMeta,
  escapeAttr,
  escapeHtml,
  getContext,
  getMessageId,
  t,
  toastr,
  getActiveSettingsRoot,
  forceSaveSettingsImmediate,
  saveUIFieldsToSettings,
  renderAlbumFolderLockState,
  persistActiveCharacterImageSaveBinding,
  applyCharacterAlbumSaveBinding,
  toggleAlbumFolderBindingForActiveCharacter,
  isInsideAlbumImageViewer,
  hideAlbumQuickSaveButton,
  openAlbumMetaViewer,
  closeAlbumMetaViewer,
  setAlbumMetaViewerMode,
  getAlbumMetaViewerActiveText,
  copyTextToClipboard,
  openAlbumImageViewer,
  closeAlbumImageViewer,
  downloadAlbumImageToDevice,
  showAlbumDeleteConfirmPopover,
  deleteAlbumItemPermanently,
} = {}) {
  escapeAttr = typeof escapeAttr === "function"
    ? escapeAttr
    : (typeof escapeHtml === "function" ? escapeHtml : (value) => String(value ?? ""));
function ensureAlbumSettings(settings = null) {
  const s = settings || extension_settings[extensionName] || (extension_settings[extensionName] = {});

  if (!Array.isArray(s.albumFolders)) s.albumFolders = [];
  if (!Array.isArray(s.albumItems)) s.albumItems = [];
  if (typeof s.albumSaveGenerationMeta !== "boolean") s.albumSaveGenerationMeta = false;
  if (typeof s.albumDiaryMode !== "boolean") s.albumDiaryMode = false;
  if (typeof s.albumDiaryPrompt !== "string") s.albumDiaryPrompt = DEFAULT_ALBUM_DIARY_PROMPT;
  s.albumDiaryPrompt = String(s.albumDiaryPrompt || "").trim() || DEFAULT_ALBUM_DIARY_PROMPT;

  const normalizedFolders = [];
  const folderIds = new Set();
  for (const folder of s.albumFolders) {
    const name = String(folder?.name || "").trim();
    if (!name) continue;

    const id = String(folder?.id || makeAlbumId("alb_folder")).trim();
    if (!id || folderIds.has(id)) continue;

    folderIds.add(id);
    normalizedFolders.push({
      id,
      name,
      createdAt: Number.isFinite(Number(folder?.createdAt))
        ? Number(folder.createdAt)
        : Date.now(),
    });
  }
  s.albumFolders = normalizedFolders;

  const normalizedItems = [];
  const itemIds = new Set();
  for (const item of s.albumItems) {
    const url = String(item?.url || "").trim();
    if (!url) continue;

    const id = String(item?.id || makeAlbumId("alb_item")).trim();
    if (!id || itemIds.has(id)) continue;

    const folderId = String(item?.folderId || "").trim();
    itemIds.add(id);
    normalizedItems.push({
      id,
      url,
      name: String(item?.name || getImageNameFromUrl(url, "image")).trim() || "image",
      folderId: folderIds.has(folderId) ? folderId : "",
      createdAt: Number.isFinite(Number(item?.createdAt))
        ? Number(item.createdAt)
        : Date.now(),
      sourceKey: String(item?.sourceKey || "").trim(),
      sourceUrl: String(item?.sourceUrl || "").trim(),
      contentHash: String(item?.contentHash || "").trim().toLowerCase(),
      messageIndex: Number.isFinite(Number(item?.messageIndex))
        ? Number(item.messageIndex)
        : null,
      messageId: item?.messageId ?? null,
      generationMeta: item?.generationMeta ?? null,
      diaryEntry: String(item?.diaryEntry || item?.diaryCaption || "").trim(),
    });
  }
  s.albumItems = normalizedItems;

  s.albumSort = normalizeAlbumSort(s.albumSort);
  s.albumFolderSort = normalizeAlbumFolderSort(s.albumFolderSort);
  if (typeof s.albumDefaultSaveFolderId !== "string") {
    s.albumDefaultSaveFolderId = "";
  }
  if (s.albumDefaultSaveFolderId && !s.albumFolders.some((folder) => folder.id === s.albumDefaultSaveFolderId)) {
    s.albumDefaultSaveFolderId = "";
  }

  if (typeof s.albumActiveSaveFolderId !== "string") {
    s.albumActiveSaveFolderId = s.albumDefaultSaveFolderId || "";
  }
  if (s.albumActiveSaveFolderId && !s.albumFolders.some((folder) => folder.id === s.albumActiveSaveFolderId)) {
    s.albumActiveSaveFolderId = s.albumDefaultSaveFolderId || "";
  }

  if (typeof s.albumActiveFolderId !== "string") s.albumActiveFolderId = "all";
  if (
    s.albumActiveFolderId !== "all" &&
    s.albumActiveFolderId !== "lobby" &&
    !s.albumFolders.some((folder) => folder.id === s.albumActiveFolderId)
  ) {
    s.albumActiveFolderId = "all";
  }

  return s;
}

function filterAlbumItemsByActiveFolder(items, activeFolderId) {
  const list = Array.isArray(items) ? items : [];
  if (activeFolderId === "all") return list.slice();
  if (activeFolderId === "lobby") {
    return list.filter((item) => !item || !item.folderId);
  }
  return list.filter((item) => item && item.folderId === activeFolderId);
}

function getAlbumFolderLabel(activeFolderId, settings = null) {
  const s = settings || ensureAlbumSettings();
  if (activeFolderId === "lobby") return t("album_lobby");
  if (activeFolderId === "all") return t("album_all_folders");
  const folder = s.albumFolders.find((f) => f.id === activeFolderId);
  return folder ? folder.name : t("album_all_folders");
}

function syncAlbumDiaryControls(root = null) {
  const activeRoot = root && root.length ? root : getActiveSettingsRoot();
  const scopedRoot = activeRoot.length ? activeRoot : $("#sunny_memories_settings").last();
  if (!scopedRoot.length) return;

  const diaryEnabled = scopedRoot.find("#sm-album-diary-mode").is(":checked");
  const editBtn = scopedRoot.find("#sm-album-diary-edit-prompt");
  const editorWrap = scopedRoot.find("#sm-album-diary-prompt-editor");
  editBtn.toggle(diaryEnabled);

  if (!diaryEnabled) {
    editorWrap.hide();
    editBtn.removeClass("is-active").attr("aria-expanded", "false");
  }
}

function collectChatImagesForAlbum() {
  const ctx = getContext();
  if (!Array.isArray(ctx?.chat) || ctx.chat.length === 0) return [];

  const entries = [];
  const seen = new Set();
  const now = Date.now();
  const total = ctx.chat.length;

  ctx.chat.forEach((message, messageIndex) => {
    const media = Array.isArray(message?.extra?.media) ? message.extra.media : [];
    media.forEach((attachment, mediaIndex) => {
      if (String(attachment?.type || "").toLowerCase() !== "image") return;

      const url = String(attachment?.url || "").trim();
      if (!url) return;

      const messageId = getMessageId(message);
      const sourceKey = `${messageId ?? messageIndex}:${mediaIndex}:${url}`;
      if (seen.has(sourceKey)) return;
      seen.add(sourceKey);

      let createdAt = Number(message?.send_date);
      if (!Number.isFinite(createdAt)) {
        const parsed = Date.parse(String(message?.send_date || ""));
        if (Number.isFinite(parsed)) createdAt = parsed;
      }
      if (!Number.isFinite(createdAt)) {
        createdAt = now - Math.max(0, total - messageIndex) * 1000 - mediaIndex;
      }

      entries.push({
        url,
        name: String(attachment?.title || getImageNameFromUrl(url, "image")).trim() || "image",
        createdAt,
        sourceKey,
        messageId,
        messageIndex,
      });
    });
  });

  return entries;
}

function renderAlbum() {
  const s = ensureAlbumSettings();
  const sortSelect = $("#sm-album-sort");
  const folderSortSelect = $("#sm-album-folder-sort");
  const grid = $("#sm-album-grid");
  const count = $("#sm-album-count");
  const label = $("#sm-album-current-folder-label");

  if (!sortSelect.length || !grid.length) return;

  const activeFolderId =
    s.albumActiveFolderId === "all" ||
    s.albumActiveFolderId === "lobby" ||
    s.albumFolders.some((f) => f.id === s.albumActiveFolderId)
      ? s.albumActiveFolderId
      : "all";
  s.albumActiveFolderId = activeFolderId;

  const sortMode = normalizeAlbumSort(s.albumSort);
  s.albumSort = sortMode;
  sortSelect.val(sortMode);

  const folderSortMode = normalizeAlbumFolderSort(s.albumFolderSort);
  s.albumFolderSort = folderSortMode;
  if (folderSortSelect.length) {
    folderSortSelect.val(folderSortMode);
  }

  if (label.length) {
    const activeFolderLabel = getAlbumFolderLabel(activeFolderId, s);
    label.text(activeFolderLabel);
    const folderBtn = $("#sm-album-folder-btn");
    if (folderBtn.length) {
      folderBtn.attr("title", activeFolderLabel);
    }
  }

  const items = filterAlbumItemsByActiveFolder(s.albumItems, activeFolderId);

  items.sort((a, b) => {
    if (sortMode === "date_asc") {
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  const folderNameById = new Map(s.albumFolders.map((folder) => [folder.id, folder.name]));

  grid.empty();
  if (!items.length) {
    grid.append(
      `<div style="opacity:0.6; text-align:center; grid-column: 1 / -1; padding: 14px;">${t("album_no_images")}</div>`,
    );
  } else {
    items.forEach((item) => {
      const folderName = item.folderId
        ? folderNameById.get(item.folderId) || ""
        : t("album_lobby");
      const dateLabel = new Date(Number(item.createdAt || Date.now())).toLocaleString();
      const meta = folderName
        ? `${escapeHtml(folderName)} вЂў ${escapeHtml(dateLabel)}`
        : escapeHtml(dateLabel);
      const promptText = getAlbumPromptTextFromGenerationMeta(item?.generationMeta);
      const styleText = getAlbumStyleTextFromGenerationMeta(item?.generationMeta);
      const diaryEntry = String(item?.diaryEntry || "").trim();
      const cardCaptionText = diaryEntry || String(item?.name || "").trim() || t("album_image_fallback_name");
      const hasPromptText = Boolean(promptText);
      const hasStyleText = Boolean(styleText);
      const hasPromptPanel = hasPromptText || hasStyleText;
      const encodedPromptText = encodeURIComponent(promptText);
      const encodedStyleText = encodeURIComponent(styleText);

      const promptControlsHtml = hasPromptPanel
        ? `
            <button
              type="button"
              class="sm-album-action-btn sm-album-meta-open"
              data-prompt-encoded="${escapeAttr(encodedPromptText)}"
              data-style-encoded="${escapeAttr(encodedStyleText)}"
              data-image-name="${escapeAttr(item.name || t("album_image_fallback_name"))}"
              title="${escapeAttr(t("album_view_meta"))}">
              <span>${escapeHtml(t("album_view_meta"))}</span>
            </button>
          `
        : `<span class="sm-album-meta-placeholder" aria-hidden="true"></span>`;

      const cardControlsHtml = `
        <div class="sm-album-prompt-controls">
          <button
            type="button"
            class="sm-album-action-btn sm-album-download"
            data-image-url="${escapeAttr(item.url)}"
            data-image-name="${escapeAttr(item.name || t("album_image_fallback_name"))}"
            title="${escapeAttr(t("album_download_image"))}">
            <span>${escapeHtml(t("album_download_image"))}</span>
          </button>
          <button
            type="button"
            class="sm-album-action-btn sm-album-delete is-danger"
            data-item-id="${escapeAttr(item.id)}"
            title="${escapeAttr(t("album_delete_image"))}">
            <span>${escapeHtml(t("album_delete_image"))}</span>
          </button>
          <div class="sm-album-meta-row">
            ${promptControlsHtml}
          </div>
        </div>
      `;

      grid.append(`
        <div class="sm-album-card" data-id="${escapeAttr(item.id)}">
          <a class="sm-album-thumb-wrap" href="${escapeAttr(item.url)}">
            <img class="sm-album-thumb" src="${escapeAttr(item.url)}" alt="${escapeAttr(cardCaptionText)}">
          </a>
          <div class="sm-album-caption" title="${escapeAttr(cardCaptionText)}">${escapeHtml(cardCaptionText)}</div>
          <div class="sm-album-meta">${meta}</div>
          ${cardControlsHtml}
        </div>
      `);
    });
  }

  if (count.length) {
    count.text(String(items.length));
  }

  updateAlbumCreateFolderButtonState();
  renderAlbumRecentFolderHints(s);
  if ($("#sm-album-folder-list").is(":visible")) {
    renderAlbumFolderList(s);
  }
  renderAlbumFolderGrid(s);
  syncAlbumFolderLibraryButtonState();
  syncAlbumFolderDropdownButtonState();
  renderAlbumFolderLockState(s);
}

function getAlbumSortedFolders(settings = null, sortMode = null) {
  const s = ensureAlbumSettings(settings);
  const mode = sortMode || normalizeAlbumFolderSort(s.albumFolderSort);

  return s.albumFolders.slice().sort((a, b) => {
    if (mode === "date_desc") {
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    }
    if (mode === "date_asc") {
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    }
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
      sensitivity: "base",
    });
  });
}

function getAlbumRecentFolders(settings = null, limit = 5) {
  const s = ensureAlbumSettings(settings);
  const latestItemTsByFolderId = new Map();

  for (const item of s.albumItems) {
    const folderId = String(item?.folderId || "").trim();
    if (!folderId) continue;
    const itemTs = Number(item?.createdAt || 0);
    const prevTs = Number(latestItemTsByFolderId.get(folderId) || 0);
    if (itemTs > prevTs) {
      latestItemTsByFolderId.set(folderId, itemTs);
    }
  }

  const normalizedLimit = Math.max(1, Number(limit) || 5);
  return s.albumFolders
    .slice()
    .sort((a, b) => {
      const aTs = Math.max(
        Number(a?.createdAt || 0),
        Number(latestItemTsByFolderId.get(String(a?.id || "")) || 0),
      );
      const bTs = Math.max(
        Number(b?.createdAt || 0),
        Number(latestItemTsByFolderId.get(String(b?.id || "")) || 0),
      );
      return bTs - aTs;
    })
    .slice(0, normalizedLimit);
}

function renderAlbumRecentFolderHints(settings = null) {
  const row = $("#sm-album-folder-recent");
  if (!row.length) return;

  const s = ensureAlbumSettings(settings);
  const query = String($("#sm-album-folder-search").val() || "")
    .trim()
    .toLowerCase();

  const recentFolders = getAlbumRecentFolders(s, 5).filter(
    (folder) => !query || String(folder?.name || "").toLowerCase().includes(query),
  );

  if (!recentFolders.length) {
    row.empty().hide();
    return;
  }

  const activeFolderId = String(s.albumActiveFolderId || "all");
  const chips = recentFolders.map((folder) => {
    const folderId = String(folder?.id || "").trim();
    const folderName = String(folder?.name || "").trim();
    return `
      <button
        type="button"
        class="sm-album-recent-folder-btn ${activeFolderId === folderId ? "active" : ""}"
        data-folder-id="${escapeAttr(folderId)}"
        title="${escapeAttr(folderName)}">${escapeHtml(folderName)}</button>
    `;
  });

  row.html(chips.join("")).show();
}

function renderAlbumFolderList(settings = null) {
  const list = $("#sm-album-folder-list");
  if (!list.length) return;

  const s = ensureAlbumSettings(settings);
  const query = String($("#sm-album-folder-search").val() || "")
    .trim()
    .toLowerCase();

  const rows = [];
  const activeId = s.albumActiveFolderId;

  const allMatches = !query || t("album_all_folders").toLowerCase().includes(query);
  if (allMatches) {
    rows.push(`
      <div class="sm-album-folder-item ${activeId === "all" ? "active" : ""}" data-folder-id="all">
        <span class="sm-album-folder-name">${escapeHtml(t("album_all_folders"))}</span>
      </div>
    `);
  }

  const lobbyMatches = !query || t("album_lobby").toLowerCase().includes(query);
  if (lobbyMatches) {
    rows.push(`
      <div class="sm-album-folder-item ${activeId === "lobby" ? "active" : ""}" data-folder-id="lobby">
        <span class="sm-album-folder-name">${escapeHtml(t("album_lobby"))}</span>
      </div>
    `);
  }

  const matchingFolders = getAlbumSortedFolders(s, "name_asc").filter(
    (folder) => !query || String(folder.name || "").toLowerCase().includes(query),
  );

  for (const folder of matchingFolders) {
    rows.push(`
      <div class="sm-album-folder-item ${activeId === folder.id ? "active" : ""}" data-folder-id="${escapeAttr(folder.id)}">
        <span class="sm-album-folder-name">${escapeHtml(folder.name)}</span>
      </div>
    `);
  }

  if (!rows.length) {
    list.html(`<div class="sm-album-folder-empty">${escapeHtml(t("album_no_folders_match"))}</div>`);
  } else {
    list.html(rows.join(""));
  }
}

function syncAlbumFolderDropdownButtonState() {
  const button = $("#sm-album-folder-btn");
  if (!button.length) return;
  const expanded = $("#sm-album-folder-list").is(":visible");
  button.attr("aria-expanded", expanded ? "true" : "false");
}

function openAlbumFolderList() {
  const list = $("#sm-album-folder-list");
  if (!list.length) {
    syncAlbumFolderDropdownButtonState();
    return;
  }
  renderAlbumFolderList();
  list.show();
  syncAlbumFolderDropdownButtonState();
}

function closeAlbumFolderList() {
  $("#sm-album-folder-list").hide();
  syncAlbumFolderDropdownButtonState();
}

function syncAlbumFolderLibraryButtonState() {
  const button = $("#sm-album-folder-library-btn");
  if (!button.length) return;
  const expanded = $("#sm-album-folders-panel").is(":visible");
  button.attr("aria-expanded", expanded ? "true" : "false");
}

function isAlbumFolderLibraryOpen() {
  return $("#sm-album-folders-panel").is(":visible");
}

function setAlbumFolderLibraryOpen(shouldOpen, options = {}) {
  const panel = $("#sm-album-folders-panel");
  if (!panel.length) {
    syncAlbumFolderLibraryButtonState();
    return;
  }

  const open = shouldOpen === true;
  const animate = options?.animate !== false;
  const shouldRender = options?.render !== false;

  if (open && shouldRender) {
    renderAlbumFolderGrid();
  }

  if (animate) {
    panel.stop(true, true);
    if (open) {
      panel.slideDown(140);
    } else {
      panel.slideUp(140);
    }
  } else {
    panel.toggle(open);
  }

  syncAlbumFolderLibraryButtonState();
}

function renderAlbumFolderGrid(settings = null) {
  const grid = $("#sm-album-folder-grid");
  if (!grid.length) return;

  const s = ensureAlbumSettings(settings);
  const query = String($("#sm-album-folder-search").val() || "")
    .trim()
    .toLowerCase();
  const folderSortMode = normalizeAlbumFolderSort(s.albumFolderSort);
  s.albumFolderSort = folderSortMode;

  const totalCount = s.albumItems.length;
  const lobbyCount = s.albumItems.filter((item) => !item.folderId).length;
  const folderCounts = new Map();
  const folderPreviewById = new Map();
  let allPreviewItem = null;
  let lobbyPreviewItem = null;

  for (const item of s.albumItems) {
    const itemCreatedAt = Number(item?.createdAt || 0);
    if (!allPreviewItem || itemCreatedAt > Number(allPreviewItem?.createdAt || 0)) {
      allPreviewItem = item;
    }

    if (!item.folderId) {
      if (!lobbyPreviewItem || itemCreatedAt > Number(lobbyPreviewItem?.createdAt || 0)) {
        lobbyPreviewItem = item;
      }
      continue;
    }

    folderCounts.set(item.folderId, (folderCounts.get(item.folderId) || 0) + 1);
    const currentPreview = folderPreviewById.get(item.folderId);
    if (!currentPreview || itemCreatedAt > Number(currentPreview?.createdAt || 0)) {
      folderPreviewById.set(item.folderId, item);
    }
  }

  const matchingFolders = getAlbumSortedFolders(s, folderSortMode)
    .filter((folder) => !query || String(folder.name || "").toLowerCase().includes(query));

  const renderFolderCardThumb = (item, emptyIconClass) => {
    const previewUrl = String(item?.url || "").trim();
    if (previewUrl) {
      return `<img class="sm-album-folder-card-thumb" src="${escapeAttr(previewUrl)}" alt="${escapeAttr(t("album_folder_preview_alt"))}">`;
    }
    return `<div class="sm-album-folder-card-thumb-empty"><i class="${escapeAttr(emptyIconClass)}"></i></div>`;
  };

  const cards = [];
  const allMatches = !query || t("album_all_folders").toLowerCase().includes(query);
  if (allMatches) {
    cards.push(`
      <div class="sm-album-folder-card ${s.albumActiveFolderId === "all" ? "active" : ""}" data-folder-id="all">
        <div class="sm-album-folder-card-thumb-wrap">
          ${renderFolderCardThumb(allPreviewItem, "fa-solid fa-images")}
        </div>
        <div class="sm-album-folder-card-body">
          <div class="sm-album-folder-card-title" title="${escapeAttr(t("album_all_folders"))}">${escapeHtml(t("album_all_folders"))}</div>
          <div class="sm-album-folder-card-meta">${escapeHtml(String(totalCount))}</div>
        </div>
      </div>
    `);
  }

  const lobbyMatches = !query || t("album_lobby").toLowerCase().includes(query);
  if (lobbyMatches) {
    cards.push(`
      <div class="sm-album-folder-card ${s.albumActiveFolderId === "lobby" ? "active" : ""}" data-folder-id="lobby">
        <div class="sm-album-folder-card-thumb-wrap">
          ${renderFolderCardThumb(lobbyPreviewItem, "fa-solid fa-inbox")}
        </div>
        <div class="sm-album-folder-card-body">
          <div class="sm-album-folder-card-title" title="${escapeAttr(t("album_lobby"))}">${escapeHtml(t("album_lobby"))}</div>
          <div class="sm-album-folder-card-meta">${escapeHtml(String(lobbyCount))}</div>
        </div>
      </div>
    `);
  }

  for (const folder of matchingFolders) {
    const count = folderCounts.get(folder.id) || 0;
    const previewItem = folderPreviewById.get(folder.id);
    cards.push(`
      <div class="sm-album-folder-card ${s.albumActiveFolderId === folder.id ? "active" : ""}" data-folder-id="${escapeAttr(folder.id)}">
        <div class="sm-album-folder-card-thumb-wrap">
          ${renderFolderCardThumb(previewItem, "fa-solid fa-folder")}
        </div>
        <div class="sm-album-folder-card-body">
          <div class="sm-album-folder-card-title" title="${escapeAttr(folder.name)}">${escapeHtml(folder.name)}</div>
          <div class="sm-album-folder-card-meta">${escapeHtml(String(count))}</div>
        </div>
      </div>
    `);
  }

  if (!cards.length) {
    grid.html(`<div class="sm-album-folder-empty">${escapeHtml(t("album_no_folders_match"))}</div>`);
  } else {
    grid.html(cards.join(""));
  }
}

function setAlbumCreateInputVisible(visible) {
  const input = $("#sm-album-new-folder-name");
  if (!input.length) return;
  if (visible) {
    input.show();
    input.trigger("focus");
  } else {
    input.val("");
    input.hide();
  }
  updateAlbumCreateFolderButtonState();
}

function updateAlbumCreateFolderButtonState() {
  const btn = $("#sm-album-create-folder");
  if (!btn.length) return;

  const input = $("#sm-album-new-folder-name");
  const isVisible = input.length ? input.is(":visible") : false;
  const hasValue = input.length ? String(input.val() || "").trim().length > 0 : false;

  let iconClass = "fa-plus";
  if (isVisible) {
    iconClass = hasValue ? "fa-check" : "fa-xmark";
  }

  btn.html(`<i class="fa-solid ${iconClass}"></i>`);
}

function createAlbumFolder() {
  const s = ensureAlbumSettings();
  const input = $("#sm-album-new-folder-name");
  const raw = input.length ? String(input.val() || "").trim() : "";

  if (!raw) {
    toastr.info(t("album_enter_folder_name"));
    if (input.length) input.trigger("focus");
    return;
  }

  const name = raw.slice(0, 80);
  const duplicate = s.albumFolders.some(
    (folder) => String(folder.name || "").toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    toastr.info(t("album_folder_exists"));
    return;
  }

  const folder = {
    id: makeAlbumId("alb_folder"),
    name,
    createdAt: Date.now(),
  };

  s.albumFolders.push(folder);
  s.albumActiveFolderId = folder.id;
  void persistActiveCharacterImageSaveBinding(folder.id, s);
  applyCharacterAlbumSaveBinding(s);
  if (input.length) input.val("");
  setAlbumCreateInputVisible(false);

  forceSaveSettingsImmediate();
  renderAlbum();
  toastr.success(t("album_folder_created"));
}

function createAlbumTouchSafeTapHandler(action) {
  let lastHandledAt = 0;
  return function albumTouchSafeTapHandler(e) {
    const eventType = String(e?.type || "");
    const now = Date.now();

    const isActivationEvent =
      eventType === "pointerup" ||
      eventType === "mouseup" ||
      eventType === "touchend" ||
      eventType === "click";

    if (isActivationEvent && now - lastHandledAt < 450) {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      return false;
    }

    if (eventType === "pointerdown" || eventType === "mousedown" || eventType === "touchstart") {
      e.stopPropagation?.();
      return undefined;
    }

    if (eventType === "dblclick") {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      return false;
    }

    if (isActivationEvent) {
      lastHandledAt = now;
      e.preventDefault?.();
      e.stopPropagation?.();
      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }
      if (typeof action === "function") {
        action.call(this, e);
      }
      return false;
    }

    e.stopPropagation?.();
    return undefined;
  };
}

    function bindAlbumImageViewerHandlers() {
      const viewer = $("#sm-album-image-viewer");
      const content = $("#sm-album-image-viewer-content");
      const closeBtn = $("#sm-album-image-viewer-close");

      if (!viewer.length || !content.length || !closeBtn.length) return;

      const closeImageViewerTap = createAlbumTouchSafeTapHandler(() => {
        closeAlbumImageViewer();
      });

      closeBtn
        .off(".smAlbumViewer")
        .on("pointerdown.smAlbumViewer mousedown.smAlbumViewer touchstart.smAlbumViewer dblclick.smAlbumViewer", closeImageViewerTap)
        .on("pointerup.smAlbumViewer mouseup.smAlbumViewer touchend.smAlbumViewer click.smAlbumViewer", closeImageViewerTap);

      viewer
        .off(".smAlbumViewer")
        .on("click.smAlbumViewer", function (e) {
          if (e.target !== this) return;
          e.preventDefault();
          e.stopPropagation();
          closeAlbumImageViewer();
        })
        .on("dblclick.smAlbumViewer", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }
          return false;
        });

      content
        .off(".smAlbumViewer")
        .on(
          "pointerdown.smAlbumViewer mousedown.smAlbumViewer touchstart.smAlbumViewer",
          function (e) {
            e.stopPropagation();
          },
        );
    }

    function bindAlbumMetaViewerHandlers() {
      const viewer = $("#sm-album-meta-viewer");
      const content = $("#sm-album-meta-viewer-content");
      const closeBtn = $("#sm-album-meta-viewer-close");

      if (!viewer.length || !content.length || !closeBtn.length) return;

      function stopMetaViewerEvent(e) {
        e.stopPropagation();
      }


      const closeMetaViewerTap = createAlbumTouchSafeTapHandler(() => {
        closeAlbumMetaViewer();
      });

      closeBtn
        .off(".smAlbumMetaViewer")
        .on("pointerdown.smAlbumMetaViewer mousedown.smAlbumMetaViewer touchstart.smAlbumMetaViewer dblclick.smAlbumMetaViewer", closeMetaViewerTap)
        .on("pointerup.smAlbumMetaViewer mouseup.smAlbumMetaViewer touchend.smAlbumMetaViewer click.smAlbumMetaViewer", closeMetaViewerTap);

      viewer
        .off(".smAlbumMetaViewer")
        .on("click.smAlbumMetaViewer", function (e) {
          if (e.target !== this) return;
          e.preventDefault();
          e.stopPropagation();
          closeAlbumMetaViewer();
        })
        .on("dblclick.smAlbumMetaViewer", function (e) {
          if (e.target !== this) return;
          e.preventDefault();
          e.stopPropagation();
        });

      content
        .off(".smAlbumMetaViewer")
        .on(
          "dblclick.smAlbumMetaViewer pointerdown.smAlbumMetaViewer mousedown.smAlbumMetaViewer touchstart.smAlbumMetaViewer",
          stopMetaViewerEvent,
        );
    }

function bindAlbumHandlers() {
    $(document).on("click", "#sm-album-create-folder", function (e) {
      e.preventDefault();
      const input = $("#sm-album-new-folder-name");
      if (!input.length) {
        createAlbumFolder();
        return;
      }

      if (!input.is(":visible")) {
        setAlbumCreateInputVisible(true);
        return;
      }

      const raw = String(input.val() || "").trim();
      if (!raw) {
        setAlbumCreateInputVisible(false);
        return;
      }

      createAlbumFolder();
    });

    $(document).on("input", "#sm-album-folder-search", function () {
      const hasQuery = String($(this).val() || "").trim().length > 0;
      if (hasQuery && !isAlbumFolderLibraryOpen()) {
        setAlbumFolderLibraryOpen(true, { animate: false, render: false });
      }
      renderAlbumRecentFolderHints();
      if ($("#sm-album-folder-list").is(":visible")) {
        renderAlbumFolderList();
      }
      renderAlbumFolderGrid();
    });

    $(document).on("input", "#sm-album-new-folder-name", function () {
      updateAlbumCreateFolderButtonState();
    });

    $(document).on("change", "#sm-album-folder-sort", function () {
      const s = ensureAlbumSettings();
      s.albumFolderSort = normalizeAlbumFolderSort($(this).val());
      saveUIFieldsToSettings(false);
      renderAlbum();
    });

    $(document).on("click", "#sm-album-folder-btn", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const list = $("#sm-album-folder-list");
      if (list.is(":visible")) {
        closeAlbumFolderList();
      } else {
        openAlbumFolderList();
      }
    });

    $(document).on("click", "#sm-album-folder-library-btn", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setAlbumFolderLibraryOpen(!isAlbumFolderLibraryOpen());
    });

    $(document).on("focus", "#sm-album-folder-search", function () {
      if (!isAlbumFolderLibraryOpen()) {
        setAlbumFolderLibraryOpen(true, { animate: false });
      }
    });

    $(document).on("keydown", "#sm-album-folder-search", function (e) {
      if (e.key === "Escape") {
        closeAlbumFolderList();
        setAlbumFolderLibraryOpen(false);
      }
    });

    $(document).on("keydown", "#sm-album-new-folder-name", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        const raw = String($(this).val() || "").trim();
        if (!raw) {
          setAlbumCreateInputVisible(false);
          return;
        }
        createAlbumFolder();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAlbumCreateInputVisible(false);
      }
    });

    $(document).on("click", "#sm-album-folder-grid .sm-album-folder-card", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const folderId = String($(this).data("folder-id") || "all");
      const s = ensureAlbumSettings();
      s.albumActiveFolderId = folderId;
      forceSaveSettingsImmediate();
      renderAlbum();
    });

    $(document).on("click", "#sm-album-folder-list .sm-album-folder-item", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const folderId = String($(this).data("folder-id") || "all");
      const s = ensureAlbumSettings();
      s.albumActiveFolderId = folderId;
      forceSaveSettingsImmediate();
      closeAlbumFolderList();
      renderAlbum();
    });

    $(document).on("click", "#sm-album-folder-recent .sm-album-recent-folder-btn", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const folderId = String($(this).data("folder-id") || "all");
      const s = ensureAlbumSettings();
      s.albumActiveFolderId = folderId;
      forceSaveSettingsImmediate();
      closeAlbumFolderList();
      renderAlbum();
    });

    $(document).on("click", "#sm-album-folder-lock", function (e) {
      e.preventDefault();
      e.stopPropagation();
      void toggleAlbumFolderBindingForActiveCharacter();
      renderAlbum();
    });

    $(document).on("click", function (e) {
      if (isInsideAlbumImageViewer(e.target)) return;

      if (
        !$(e.target).closest(
          "#sm-album-folders-panel, #sm-album-folder-library-btn, #sm-album-folder-search, #sm-album-create-folder",
        ).length
      ) {
        setAlbumFolderLibraryOpen(false);
      }

      if (!$(e.target).closest("#sm-album-folder-list, #sm-album-folder-btn").length) {
        closeAlbumFolderList();
      }

      if (
        !$(e.target).closest("#sm-album-new-folder-name, #sm-album-create-folder").length
      ) {
        setAlbumCreateInputVisible(false);
      }

      if (!$(e.target).closest("#sm-image-save-quick, #chat .mes img").length) {
        hideAlbumQuickSaveButton();
      }
    });

    $(document).on("change", "#sm-album-sort", function () {
      const s = ensureAlbumSettings();
      s.albumSort = normalizeAlbumSort($(this).val());
      saveUIFieldsToSettings(false);
      renderAlbum();
    });

    $(document).on("change", "#sm-album-diary-mode", function () {
      const root = getActiveSettingsRoot();
      syncAlbumDiaryControls(root);
      saveUIFieldsToSettings(false);
    });

    $(document).on("click", "#sm-album-diary-edit-prompt", function (e) {
      e.preventDefault();
      const root = getActiveSettingsRoot();
      const scopedRoot = root.length ? root : $("#sunny_memories_settings").last();
      const editorWrap = scopedRoot.find("#sm-album-diary-prompt-editor");
      const button = scopedRoot.find("#sm-album-diary-edit-prompt");
      const nextExpanded = !editorWrap.is(":visible");
      editorWrap.stop(true, true).slideToggle(120);
      button.toggleClass("is-active", nextExpanded).attr("aria-expanded", nextExpanded ? "true" : "false");
    });

    $(document).on("click", ".sm-album-meta-open", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const button = $(this);
      const promptEncoded = String(button.attr("data-prompt-encoded") || "");
      const styleEncoded = String(button.attr("data-style-encoded") || "");

      let promptText = "";
      let styleText = "";

      try {
        promptText = decodeURIComponent(promptEncoded);
      } catch (_error) {
        promptText = promptEncoded;
      }

      try {
        styleText = decodeURIComponent(styleEncoded);
      } catch (_error) {
        styleText = styleEncoded;
      }

      const imageName =
        String(button.attr("data-image-name") || t("album_image_fallback_name")).trim() ||
        t("album_image_fallback_name");

      if (!String(promptText || "").trim() && !String(styleText || "").trim()) {
        toastr.info(t("album_prompt_not_found"));
        return;
      }

      openAlbumMetaViewer(promptText, styleText, imageName);
    });

    bindAlbumMetaViewerHandlers();

    const handleAlbumMetaModeTap = createAlbumTouchSafeTapHandler(function () {
      const mode = String($(this).data("mode") || "prompt");
      setAlbumMetaViewerMode(mode);
    });

    $(document)
      .off("pointerdown.smAlbumMetaMode mousedown.smAlbumMetaMode touchstart.smAlbumMetaMode dblclick.smAlbumMetaMode pointerup.smAlbumMetaMode mouseup.smAlbumMetaMode touchend.smAlbumMetaMode click.smAlbumMetaMode", "#sm-album-meta-viewer .sm-album-prompt-mode-btn")
      .on("pointerdown.smAlbumMetaMode mousedown.smAlbumMetaMode touchstart.smAlbumMetaMode dblclick.smAlbumMetaMode", "#sm-album-meta-viewer .sm-album-prompt-mode-btn", handleAlbumMetaModeTap)
      .on("pointerup.smAlbumMetaMode mouseup.smAlbumMetaMode touchend.smAlbumMetaMode click.smAlbumMetaMode", "#sm-album-meta-viewer .sm-album-prompt-mode-btn", handleAlbumMetaModeTap);

    const handleAlbumMetaCopyTap = createAlbumTouchSafeTapHandler(async function () {
      const textToCopy = String(getAlbumMetaViewerActiveText() || "").trim();
      if (!textToCopy) {
        toastr.info(t("album_prompt_not_found"));
        return;
      }

      try {
        await copyTextToClipboard(textToCopy);
        toastr.success(t("copied_text"));
      } catch (error) {
        console.warn("SunnyMemories: failed to copy album metadata text", error);
        toastr.error(t("failed_copy_text"));
      }
    });

    $(document)
      .off("pointerdown.smAlbumMetaCopy mousedown.smAlbumMetaCopy touchstart.smAlbumMetaCopy dblclick.smAlbumMetaCopy pointerup.smAlbumMetaCopy mouseup.smAlbumMetaCopy touchend.smAlbumMetaCopy click.smAlbumMetaCopy", "#sm-album-meta-viewer-copy")
      .on("pointerdown.smAlbumMetaCopy mousedown.smAlbumMetaCopy touchstart.smAlbumMetaCopy dblclick.smAlbumMetaCopy", "#sm-album-meta-viewer-copy", handleAlbumMetaCopyTap)
      .on("pointerup.smAlbumMetaCopy mouseup.smAlbumMetaCopy touchend.smAlbumMetaCopy click.smAlbumMetaCopy", "#sm-album-meta-viewer-copy", handleAlbumMetaCopyTap);

    $(document).on("click", ".sm-album-thumb-wrap", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const wrap = $(this);
      const card = wrap.closest(".sm-album-card");
      const itemId = String(card.data("id") || "").trim();
      const imageElement = card.find(".sm-album-thumb").first();
      const imageUrl = String(
        wrap.attr("href") || imageElement.attr("src") || imageElement.prop("src") || "",
      ).trim();
      if (!imageUrl) return;

      const imageName =
        String(card.find(".sm-album-caption").text() || "").trim() ||
        String(imageElement.attr("alt") || "").trim() ||
        t("album_image_fallback_name");

      openAlbumImageViewer(imageUrl, imageName, itemId);
    });

    $(document).on("click", ".sm-album-download", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const button = $(this);
      if (button.prop("disabled")) return;
      const imageUrl = String(button.attr("data-image-url") || "").trim();
      const imageName =
        String(button.attr("data-image-name") || "").trim() || t("album_image_fallback_name");
      if (!imageUrl) {
        toastr.error(t("album_download_image_failed"));
        return;
      }

      button.prop("disabled", true);
      try {
        await downloadAlbumImageToDevice(imageUrl, imageName);
      } finally {
        button.prop("disabled", false);
      }
    });

    $(document).on("click", ".sm-album-delete", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const button = $(this);
      if (button.prop("disabled")) return;
      const itemId = String(button.attr("data-item-id") || "").trim();
      if (!itemId) return;
      const confirmed = await showAlbumDeleteConfirmPopover(this, itemId);
      if (!confirmed) return;

      button.prop("disabled", true);
      try {
        await deleteAlbumItemPermanently(itemId);
      } finally {
        button.prop("disabled", false);
      }
    });

    $(document).on("click", "#sm-album-image-viewer-download", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const button = $(this);
      if (button.prop("disabled")) return;
      const imageUrl = String(button.attr("data-image-url") || "").trim();
      const imageName =
        String(button.attr("data-image-name") || "").trim() || t("album_image_fallback_name");
      if (!imageUrl) {
        toastr.error(t("album_download_image_failed"));
        return;
      }

      button.prop("disabled", true);
      try {
        await downloadAlbumImageToDevice(imageUrl, imageName);
      } finally {
        button.prop("disabled", false);
      }
    });

    $(document).on("click", "#sm-album-image-viewer-delete", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const button = $(this);
      if (button.prop("disabled")) return;
      const itemId = String(button.attr("data-item-id") || "").trim();
      if (!itemId) return;
      const confirmed = await showAlbumDeleteConfirmPopover(this, itemId);
      if (!confirmed) return;

      button.prop("disabled", true);
      try {
        await deleteAlbumItemPermanently(itemId);
      } finally {
        button.prop("disabled", false);
      }
    });

    $(document).on("keydown", function (e) {
      if (e.key === "Escape") {
        closeAlbumMetaViewer();
        closeAlbumImageViewer();
      }
    });
}

return {
  ensureAlbumSettings,
  filterAlbumItemsByActiveFolder,
  getAlbumFolderLabel,
  syncAlbumDiaryControls,
  collectChatImagesForAlbum,
  renderAlbum,
  getAlbumSortedFolders,
  getAlbumRecentFolders,
  renderAlbumRecentFolderHints,
  renderAlbumFolderList,
  syncAlbumFolderDropdownButtonState,
  openAlbumFolderList,
  closeAlbumFolderList,
  syncAlbumFolderLibraryButtonState,
  isAlbumFolderLibraryOpen,
  setAlbumFolderLibraryOpen,
  renderAlbumFolderGrid,
  setAlbumCreateInputVisible,
  updateAlbumCreateFolderButtonState,
  createAlbumFolder,
  bindAlbumImageViewerHandlers,
  bindAlbumHandlers,
};
}
