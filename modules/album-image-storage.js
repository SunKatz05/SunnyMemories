import { ALBUM_REMOTE_SAVE_CATEGORY } from "./constants.js";
import {
  getImageNameFromUrl,
  sanitizeAlbumFileNamePart,
} from "./utils/album-core-utils.js";
import {
  buildAlbumDownloadFileName,
  buildAlbumRemoteFileName,
  getImageExtensionForBlob,
  isSupportedRemoteImageUrl,
  normalizeAlbumStoredPath,
  resolveImageFetchUrl,
} from "./utils/album-media-utils.js";

function fallbackTranslate(key) {
  return String(key || "");
}

function getFallbackRequestHeaders() {
  const globalHeadersFn = globalThis?.getRequestHeaders;
  if (typeof globalHeadersFn === "function") {
    return globalHeadersFn();
  }

  return { "Content-Type": "application/json" };
}

export function createAlbumImageStorage({
  getRequestHeaders,
  getActiveCharacterName,
  translate,
  notify,
} = {}) {
  const t = typeof translate === "function" ? translate : fallbackTranslate;
  const notifier = notify || {};

  function getAlbumApiJsonHeaders() {
    try {
      if (typeof getRequestHeaders === "function") {
        return getRequestHeaders();
      }
    } catch (_error) {}

    return getFallbackRequestHeaders();
  }

  async function fetchImageBlobDirect(url) {
    const fetchUrl = resolveImageFetchUrl(url);
    if (!fetchUrl) return null;

    try {
      const response = await fetch(fetchUrl, { cache: "no-store" });
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob && blob.size > 0 ? blob : null;
    } catch (_error) {
      return null;
    }
  }

  async function deleteTempAssetFile(filename) {
    const normalizedFileName = String(filename || "").trim();
    if (!normalizedFileName) return;

    try {
      await fetch("/api/assets/delete", {
        method: "POST",
        headers: getAlbumApiJsonHeaders(),
        body: JSON.stringify({
          category: ALBUM_REMOTE_SAVE_CATEGORY,
          filename: normalizedFileName,
        }),
      });
    } catch (_error) {}
  }

  async function downloadImageBlobViaServer(url) {
    const normalizedRemoteUrl = resolveImageFetchUrl(url);
    if (!normalizedRemoteUrl || !isSupportedRemoteImageUrl(normalizedRemoteUrl)) {
      return { blob: null, errorCode: "unsupported_url" };
    }

    const fileName = buildAlbumRemoteFileName(normalizedRemoteUrl);
    try {
      const saveResponse = await fetch("/api/assets/download", {
        method: "POST",
        headers: getAlbumApiJsonHeaders(),
        body: JSON.stringify({
          url: normalizedRemoteUrl,
          category: ALBUM_REMOTE_SAVE_CATEGORY,
          filename: fileName,
        }),
      });

      if (!saveResponse.ok) {
        return {
          blob: null,
          errorCode: saveResponse.status === 404 ? "host_not_allowed" : "download_failed",
        };
      }

      const tempUrl = `/assets/${ALBUM_REMOTE_SAVE_CATEGORY}/${fileName}`;
      const tempResponse = await fetch(tempUrl, { cache: "no-store" });
      if (!tempResponse.ok) {
        return { blob: null, errorCode: "download_failed" };
      }

      const blob = await tempResponse.blob();
      if (!blob || blob.size <= 0) {
        return { blob: null, errorCode: "download_failed" };
      }

      return { blob, errorCode: "" };
    } catch (_error) {
      return { blob: null, errorCode: "download_failed" };
    } finally {
      await deleteTempAssetFile(fileName);
    }
  }

  async function blobToBase64Data(blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error("base64_read_failed"));
      reader.readAsDataURL(blob);
    });
  }

  async function computeBlobSha256Hex(blob) {
    try {
      if (!blob || typeof blob.arrayBuffer !== "function") return "";
      if (!globalThis?.crypto?.subtle) return "";
      const buffer = await blob.arrayBuffer();
      const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch (_error) {
      return "";
    }
  }

  async function uploadBlobToAlbumStorage(blob, sourceUrl, imageNameHint = "", fileNameOverride = "") {
    if (!blob || blob.size <= 0) {
      throw new Error(t("album_save_image_failed"));
    }

    const base64Data = await blobToBase64Data(blob);
    const extension = getImageExtensionForBlob(blob, sourceUrl);
    const preferredName = String(imageNameHint || getImageNameFromUrl(sourceUrl, "image")).trim();
    const sanitizedBaseName = sanitizeAlbumFileNamePart(
      preferredName.replace(/\.[a-zA-Z0-9]{2,6}$/g, ""),
      "image",
    ).slice(0, 64);
    let fileName = "";
    if (String(fileNameOverride || "").trim()) {
      fileName = sanitizeAlbumFileNamePart(
        String(fileNameOverride).replace(/\.[a-zA-Z0-9]{2,6}$/g, ""),
        "image",
      );
    } else {
      fileName = `${sanitizedBaseName}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    }

    const payload = {
      image: base64Data,
      format: extension,
      filename: fileName,
    };

    const activeCharacterName = String(
      typeof getActiveCharacterName === "function" ? getActiveCharacterName() : "",
    ).trim();
    if (activeCharacterName) {
      payload.ch_name = activeCharacterName;
    }

    const response = await fetch("/api/images/upload", {
      method: "POST",
      headers: getAlbumApiJsonHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = t("album_save_image_failed");
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = String(errorData.error);
        }
      } catch (_error) {}
      throw new Error(errorMessage);
    }

    let responseData = null;
    try {
      responseData = await response.json();
    } catch (_error) {
      responseData = null;
    }

    const savedPath = normalizeAlbumStoredPath(responseData?.path);
    if (!savedPath) {
      throw new Error(t("album_save_image_failed"));
    }

    return savedPath;
  }

  async function downloadAlbumImageToDevice(imageUrl, imageNameHint = "") {
    const normalizedUrl = String(imageUrl || "").trim();
    if (!normalizedUrl) {
      notifier.error?.(t("album_download_image_failed"));
      return false;
    }

    let imageBlob = await fetchImageBlobDirect(normalizedUrl);
    if (!imageBlob && isSupportedRemoteImageUrl(normalizedUrl)) {
      const serverFallback = await downloadImageBlobViaServer(normalizedUrl);
      imageBlob = serverFallback?.blob || null;
    }

    if (!imageBlob) {
      notifier.error?.(t("album_download_image_failed"));
      return false;
    }

    const downloadName = buildAlbumDownloadFileName(
      imageNameHint,
      normalizedUrl,
      String(imageBlob?.type || ""),
    );

    const objectUrl = URL.createObjectURL(imageBlob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notifier.success?.(t("album_download_image_success"));
      return true;
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  }

  return {
    getAlbumApiJsonHeaders,
    fetchImageBlobDirect,
    deleteTempAssetFile,
    downloadImageBlobViaServer,
    blobToBase64Data,
    computeBlobSha256Hex,
    uploadBlobToAlbumStorage,
    downloadAlbumImageToDevice,
  };
}

export function getAlbumStoredImagePath(imageUrl) {
  const normalizedUrl = String(imageUrl || "").trim();
  if (!normalizedUrl) return "";

  try {
    const parsed = new URL(normalizedUrl, window.location.origin);
    if (parsed.origin !== window.location.origin) return "";
    const pathName = String(parsed.pathname || "").trim();
    if (!pathName.startsWith("/user/images/")) return "";
    return pathName;
  } catch (_error) {
    return "";
  }
}

export async function deleteAlbumStoredImageFile(imageUrl) {
  // Deleting an album entry intentionally never deletes the underlying server file.
  void imageUrl;
  return { attempted: false, deleted: false };
}
