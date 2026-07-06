export function createAlbumCharacterBinding({
  $,
  toastr,
  t,
  getContext,
  ensureAlbumSettings,
  forceSaveSettingsImmediate,
  setAlbumFolderLibraryOpen,
  imageSaveBindingExtensionKey,
} = {}) {

function canBindAlbumFolderId(folderId, settings = null) {
  const s = settings || ensureAlbumSettings();
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) return false;
  if (normalizedFolderId === "all" || normalizedFolderId === "lobby") return false;
  return s.albumFolders.some((folder) => folder.id === normalizedFolderId);
}

function isAlbumFolderBoundToActiveCharacter(folderId, settings = null) {
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) return false;
  const activeCharacter = getActiveCharacterState();
  if (!activeCharacter) return false;

  const binding = readCharacterImageSaveBinding(activeCharacter.character);
  if (!binding?.enabled) return false;
  return String(binding.folder_id || "") === normalizedFolderId;
}

function getAlbumBindingTargetFolderId(settings = null) {
  const s = settings || ensureAlbumSettings();
  const folderId = String(s.albumActiveFolderId || "").trim();
  return canBindAlbumFolderId(folderId, s) ? folderId : "";
}

function renderAlbumFolderLockState(settings = null) {
  const s = settings || ensureAlbumSettings();
  const lockBtn = $("#sm-album-folder-lock");
  if (!lockBtn.length) return;

  const activeCharacter = getActiveCharacterState();
  const targetFolderId = getAlbumBindingTargetFolderId(s);
  const isLocked = targetFolderId
    ? isAlbumFolderBoundToActiveCharacter(targetFolderId, s)
    : false;

  const icon = lockBtn.find("i").first();
  if (icon.length) {
    icon.attr("class", isLocked ? "fa-solid fa-lock" : "fa-solid fa-lock-open");
  }

  lockBtn.toggleClass("is-locked", isLocked);
  lockBtn.attr("aria-pressed", isLocked ? "true" : "false");

  if (!activeCharacter) {
    lockBtn.prop("disabled", true);
    const title = t("album_bind_no_character");
    lockBtn.attr("title", title);
    lockBtn.attr("data-i18n-title", "");
    return;
  }

  if (!targetFolderId) {
    lockBtn.prop("disabled", true);
    const title = t("album_bind_select_folder_first");
    lockBtn.attr("title", title);
    lockBtn.attr("data-i18n-title", "");
    return;
  }

  lockBtn.prop("disabled", false);
  lockBtn.attr("data-i18n-title", isLocked ? "album_bind_unlock" : "album_bind_lock");
  lockBtn.attr("title", t(isLocked ? "album_bind_unlock" : "album_bind_lock"));
}

async function toggleAlbumFolderBindingForActiveCharacter() {
  const s = ensureAlbumSettings();
  const targetFolderId = getAlbumBindingTargetFolderId(s);
  const activeCharacter = getActiveCharacterState();

  if (!activeCharacter) {
    toastr.info(t("album_bind_no_character"));
    renderAlbumFolderLockState(s);
    return;
  }

  if (!targetFolderId) {
    toastr.info(t("album_bind_select_folder_first"));
    renderAlbumFolderLockState(s);
    return;
  }

  const isLocked = isAlbumFolderBoundToActiveCharacter(targetFolderId, s);
  if (isLocked) {
    const persisted = await persistActiveCharacterImageSaveBinding("", s);
    if (!persisted) {
      toastr.error(t("storage_copy_failed"));
      renderAlbumFolderLockState(s);
      return;
    }
    applyCharacterAlbumSaveBinding(s);
    forceSaveSettingsImmediate();
    renderAlbumFolderLockState(s);
    toastr.success(t("album_bind_unlocked"));
    return;
  }

  const persisted = await persistActiveCharacterImageSaveBinding(targetFolderId, s);
  if (!persisted) {
    toastr.error(t("storage_copy_failed"));
    renderAlbumFolderLockState(s);
    return;
  }
  applyCharacterAlbumSaveBinding(s);
  forceSaveSettingsImmediate();
  renderAlbumFolderLockState(s);
  toastr.success(t("album_bind_locked"));
}


function getActiveCharacterState() {
  const ctx = getContext();
  const rawCharacterId = Number(ctx?.characterId);
  if (!Number.isInteger(rawCharacterId) || rawCharacterId < 0) return null;
  const character = Array.isArray(ctx?.characters) ? ctx.characters[rawCharacterId] : null;
  if (!character) return null;
  return { characterId: rawCharacterId, character };
}

function readCharacterImageSaveBinding(character) {
  const raw = character?.data?.extensions?.[imageSaveBindingExtensionKey];
  if (!raw || typeof raw !== "object") return null;

  const folderId = String(raw.folder_id || "").trim();
  const folderName = String(raw.folder_name || "").trim();
  const enabled = raw.enabled === true && !!folderId;
  const parsedUpdatedAt = Number(raw.last_updated);

  return {
    folder_id: folderId,
    folder_name: folderName,
    enabled,
    last_updated: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : null,
  };
}

function getDefaultAlbumSaveFolderId(settings = null) {
  const s = settings || ensureAlbumSettings();
  const defaultFolderId = String(s.albumDefaultSaveFolderId || "").trim();
  if (!defaultFolderId) return "";
  return s.albumFolders.some((folder) => folder.id === defaultFolderId)
    ? defaultFolderId
    : "";
}

function resolveAlbumSaveFolderIdForCurrentCharacter(settings = null) {
  const s = settings || ensureAlbumSettings();
  const activeCharacter = getActiveCharacterState();
  const activeFolderId = String(s.albumActiveFolderId || "").trim();
  const fallbackFolderId =
    getDefaultAlbumSaveFolderId(s) ||
    (canBindAlbumFolderId(activeFolderId, s) ? activeFolderId : "");

  if (!activeCharacter) return fallbackFolderId;

  const binding = readCharacterImageSaveBinding(activeCharacter.character);
  if (!binding?.enabled || !binding.folder_id) return fallbackFolderId;

  return s.albumFolders.some((folder) => folder.id === binding.folder_id)
    ? binding.folder_id
    : fallbackFolderId;
}

function resolveCharacterBoundAlbumFolderId(settings = null) {
  const s = settings || ensureAlbumSettings();
  const activeCharacter = getActiveCharacterState();
  if (!activeCharacter) return "";

  const binding = readCharacterImageSaveBinding(activeCharacter.character);
  if (!binding?.enabled || !binding.folder_id) return "";

  return s.albumFolders.some((folder) => folder.id === binding.folder_id)
    ? String(binding.folder_id)
    : "";
}

function syncAlbumViewToCharacterBoundFolder(settings = null, options = {}) {
  const s = settings || ensureAlbumSettings();
  const boundFolderId = resolveCharacterBoundAlbumFolderId(s);
  if (!boundFolderId) return false;

  s.albumActiveFolderId = boundFolderId;

  if (options?.openFolderPanel === true) {
    setAlbumFolderLibraryOpen(true, {
      animate: options?.animate !== false,
      render: options?.render !== false,
    });
  }

  return true;
}

function getWriteExtensionFieldFn() {
  const globalFn = globalThis?.writeExtensionField;
  if (typeof globalFn === "function") return globalFn;

  const ctxFn = getContext()?.writeExtensionField;
  return typeof ctxFn === "function" ? ctxFn : null;
}

function buildCharacterImageSaveBinding(folderId, settings = null) {
  const s = settings || ensureAlbumSettings();
  const normalizedFolderId = String(folderId || "").trim();
  const now = Date.now();
  if (!normalizedFolderId) {
    return {
      folder_id: "",
      folder_name: "",
      enabled: false,
      last_updated: now,
    };
  }

  const folder = s.albumFolders.find((entry) => entry.id === normalizedFolderId);
  if (!folder) {
    return {
      folder_id: "",
      folder_name: "",
      enabled: false,
      last_updated: now,
    };
  }

  return {
    folder_id: folder.id,
    folder_name: String(folder.name || "").trim(),
    enabled: true,
    last_updated: now,
  };
}

async function persistActiveCharacterImageSaveBinding(folderId, settings = null) {
  const writeExtensionField = getWriteExtensionFieldFn();
  const activeCharacter = getActiveCharacterState();
  if (!writeExtensionField || !activeCharacter) return false;

  const payload = buildCharacterImageSaveBinding(folderId, settings);
  const characterData =
    activeCharacter.character.data || (activeCharacter.character.data = {});
  const extensions = characterData.extensions || (characterData.extensions = {});
  const hadPreviousValue = Object.prototype.hasOwnProperty.call(
    extensions,
    imageSaveBindingExtensionKey,
  );
  const previousValue = hadPreviousValue
    ? extensions[imageSaveBindingExtensionKey]
    : undefined;

  extensions[imageSaveBindingExtensionKey] = payload;

  try {
    await writeExtensionField(
      activeCharacter.characterId,
      imageSaveBindingExtensionKey,
      payload,
    );
    return true;
  } catch (error) {
    if (hadPreviousValue) extensions[imageSaveBindingExtensionKey] = previousValue;
    else delete extensions[imageSaveBindingExtensionKey];
    console.warn("SunnyMemories: failed to persist image save folder binding", error);
    return false;
  }
}

async function refreshActiveCharacterBindingFolderMetadata(settings = null) {
  const s = settings || ensureAlbumSettings();
  const writeExtensionField = getWriteExtensionFieldFn();
  const activeCharacter = getActiveCharacterState();
  if (!writeExtensionField || !activeCharacter) return;

  const binding = readCharacterImageSaveBinding(activeCharacter.character);
  if (!binding?.enabled || !binding.folder_id) return;

  const folder = s.albumFolders.find((entry) => entry.id === binding.folder_id);
  if (!folder) return;

  const currentFolderName = String(folder.name || "").trim();
  if (String(binding.folder_name || "").trim() === currentFolderName) return;

  const payload = {
    ...binding,
    folder_name: currentFolderName,
    enabled: true,
    last_updated: Date.now(),
  };
  const characterData =
    activeCharacter.character.data || (activeCharacter.character.data = {});
  const extensions = characterData.extensions || (characterData.extensions = {});
  const previousValue = extensions[imageSaveBindingExtensionKey];
  extensions[imageSaveBindingExtensionKey] = payload;

  try {
    await writeExtensionField(
      activeCharacter.characterId,
      imageSaveBindingExtensionKey,
      payload,
    );
  } catch (error) {
    extensions[imageSaveBindingExtensionKey] = previousValue;
    console.warn("SunnyMemories: failed to refresh image save binding metadata", error);
  }
}

function applyCharacterAlbumSaveBinding(settings = null) {
  const s = settings || ensureAlbumSettings();
  void refreshActiveCharacterBindingFolderMetadata(s);
  const targetFolderId = resolveAlbumSaveFolderIdForCurrentCharacter(s);
  s.albumActiveSaveFolderId = targetFolderId;
  renderAlbumFolderLockState(s);
  return targetFolderId;
}

function getAlbumTargetFolderIdForImageSave() {
  return applyCharacterAlbumSaveBinding();
}


  return {
    canBindAlbumFolderId,
    isAlbumFolderBoundToActiveCharacter,
    getAlbumBindingTargetFolderId,
    renderAlbumFolderLockState,
    toggleAlbumFolderBindingForActiveCharacter,
    getActiveCharacterState,
    readCharacterImageSaveBinding,
    getDefaultAlbumSaveFolderId,
    resolveAlbumSaveFolderIdForCurrentCharacter,
    resolveCharacterBoundAlbumFolderId,
    syncAlbumViewToCharacterBoundFolder,
    getWriteExtensionFieldFn,
    buildCharacterImageSaveBinding,
    persistActiveCharacterImageSaveBinding,
    refreshActiveCharacterBindingFolderMetadata,
    applyCharacterAlbumSaveBinding,
    getAlbumTargetFolderIdForImageSave,
  };
}
