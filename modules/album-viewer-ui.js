export function createAlbumViewerUi({
  $,
  document,
  window,
  getContext,
  getMessageId,
  getImageNameFromUrl,
  saveRemoteImageToAlbumFromUrl,
  toastr,
  t,
} = {}) {
  let albumQuickSaveState = {
    imageUrl: "",
    sourceKey: "",
    messageId: null,
    messageIndex: null,
    generationMetaRaw: "",
    imageNameHint: "",
    anchorElement: null,
  };

  let albumMetaViewerState = {
    promptText: "",
    styleText: "",
    activeMode: "prompt",
  };

  let albumQuickSaveViewportEventsBound = false;
  let albumQuickSaveHandlersBound = false;
  let lightboxPollerId = null;
  let albumImageZoomHandlersBound = false;
  let albumImageCleanModeHandlersBound = false;
  let albumImageViewerCloseGuardTimer = null;
  let albumImageViewerCloseGuardCleanup = null;
  let albumImageZoomState = {
    scale: 1,
    x: 0,
    y: 0,
    pointers: new Map(),
    panStart: null,
    pinchStart: null,
  };

  function ensureAlbumViewerInBody(viewer) {
    const element = viewer?.get?.(0);
    if (!element || !document?.body || element.parentElement === document.body) return;
    try {
      document.body.appendChild(element);
    } catch (error) {
      console.warn("SunnyMemories: failed to move album viewer to body", error);
    }
  }

  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.min(Math.max(num, min), max);
  }

  function getAlbumImageZoomNodes() {
    const viewer = $("#sm-album-image-viewer");
    const content = viewer.find("#sm-album-image-viewer-content");
    const img = viewer.find(".sm-album-image-viewer-img");
    return { viewer, content, img };
  }

  function isAlbumImageZoomControlTarget(target) {
    return Boolean(
      target?.closest?.(
        ".sm-album-image-zoom-controls, .sm-album-image-viewer-close, .sm-album-image-viewer-actions, .sm-album-image-viewer-caption, button, a, input, textarea, select",
      ),
    );
  }

  function getAlbumImageZoomBounds(scale = albumImageZoomState.scale) {
    const { content, img } = getAlbumImageZoomNodes();
    const contentElement = content.get(0);
    const imageElement = img.get(0);
    if (!contentElement || !imageElement || scale <= 1.01) {
      return { maxX: 0, maxY: 0 };
    }

    const contentRect = contentElement.getBoundingClientRect();
    const imageRect = imageElement.getBoundingClientRect();
    const renderedWidth = imageRect.width ? imageRect.width / Math.max(scale, 0.001) : 0;
    const renderedHeight = imageRect.height ? imageRect.height / Math.max(scale, 0.001) : 0;
    const baseWidth = renderedWidth || imageElement.offsetWidth || imageElement.clientWidth || contentRect.width || 0;
    const baseHeight = renderedHeight || imageElement.offsetHeight || imageElement.clientHeight || contentRect.height || 0;
    const zoomedWidth = baseWidth * scale;
    const zoomedHeight = baseHeight * scale;
    const overflowX = Math.max(0, (zoomedWidth - contentRect.width) / 2);
    const overflowY = Math.max(0, (zoomedHeight - contentRect.height) / 2);
    const freeX = Math.min(contentRect.width * 0.48, Math.max(120, zoomedWidth * 0.32));
    const freeY = Math.min(contentRect.height * 0.48, Math.max(120, zoomedHeight * 0.32));
    const maxX = overflowX + freeX + 24;
    const maxY = overflowY + freeY + 24;
    return { maxX, maxY };
  }

  function clampAlbumImageZoomPosition(x = albumImageZoomState.x, y = albumImageZoomState.y, scale = albumImageZoomState.scale) {
    const { maxX, maxY } = getAlbumImageZoomBounds(scale);
    return {
      x: clampNumber(x, -maxX, maxX),
      y: clampNumber(y, -maxY, maxY),
    };
  }

  function applyAlbumImageZoomState(options = {}) {
    const { viewer, img } = getAlbumImageZoomNodes();
    if (!viewer.length || !img.length) return;

    const scale = clampNumber(albumImageZoomState.scale, 1, 5);
    const clamped = clampAlbumImageZoomPosition(albumImageZoomState.x, albumImageZoomState.y, scale);
    albumImageZoomState.scale = scale;
    albumImageZoomState.x = clamped.x;
    albumImageZoomState.y = clamped.y;

    const shouldAnimate = options.animate !== false;
    img.toggleClass("sm-zoom-animating", shouldAnimate);
    img.css("transform", `translate3d(${clamped.x}px, ${clamped.y}px, 0) scale(${scale})`);
    viewer.toggleClass("sm-zoomed", scale > 1.01);
    updateAlbumImageZoomControls();
    if (shouldAnimate) {
      window.setTimeout(() => img.removeClass("sm-zoom-animating"), 160);
    }
  }

  function updateAlbumImageZoomControls() {
    const { viewer } = getAlbumImageZoomNodes();
    if (!viewer.length) return;

    const scale = clampNumber(albumImageZoomState.scale, 1, 5);
    const percent = Math.round(scale * 100);
    viewer.find(".sm-album-image-zoom-value").text(`${percent}%`);
    viewer.find("#sm-album-image-zoom-out").prop("disabled", scale <= 1.01);
    viewer.find("#sm-album-image-zoom-reset").prop("disabled", scale <= 1.01);
    viewer.find("#sm-album-image-zoom-in").prop("disabled", scale >= 4.99);
  }

  function setAlbumImageViewerCleanMode(enabled = false) {
    const viewer = $("#sm-album-image-viewer");
    if (!viewer.length) return;

    const isCleanMode = enabled === true;
    viewer.toggleClass("sm-clean-view", isCleanMode);

    const toggle = viewer.find("#sm-album-image-viewer-clean-toggle");
    if (!toggle.length) return;

    const label = isCleanMode
      ? t("album_image_viewer_show_controls")
      : t("album_image_viewer_hide_controls");
    toggle
      .attr("title", label)
      .attr("aria-label", label)
      .attr("aria-pressed", isCleanMode ? "true" : "false");
    toggle.find("i").attr("class", isCleanMode ? "fa-solid fa-eye" : "fa-solid fa-eye-slash");
  }

  function bindAlbumImageCleanModeHandlers() {
    if (albumImageCleanModeHandlersBound) return;
    albumImageCleanModeHandlersBound = true;

    $(document)
      .off("click.smAlbumImageCleanMode", "#sm-album-image-viewer-clean-toggle")
      .on("click.smAlbumImageCleanMode", "#sm-album-image-viewer-clean-toggle", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }

        const viewer = $("#sm-album-image-viewer");
        setAlbumImageViewerCleanMode(!viewer.hasClass("sm-clean-view"));
        return false;
      });
  }

  function getAlbumImageViewerCenterPoint() {
    const { content } = getAlbumImageZoomNodes();
    const rect = content.get(0)?.getBoundingClientRect?.();
    if (!rect) return { x: null, y: null };
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function resetAlbumImageZoom(options = {}) {
    albumImageZoomState.scale = 1;
    albumImageZoomState.x = 0;
    albumImageZoomState.y = 0;
    albumImageZoomState.pointers = new Map();
    albumImageZoomState.panStart = null;
    albumImageZoomState.pinchStart = null;
    applyAlbumImageZoomState({ animate: options.animate !== false });
  }

  function zoomAlbumImageAt(nextScale, clientX = null, clientY = null, options = {}) {
    const { content } = getAlbumImageZoomNodes();
    const contentElement = content.get(0);
    const oldScale = clampNumber(albumImageZoomState.scale, 1, 5);
    const scale = clampNumber(nextScale, 1, 5);

    let nextX = albumImageZoomState.x;
    let nextY = albumImageZoomState.y;

    if (contentElement && Number.isFinite(Number(clientX)) && Number.isFinite(Number(clientY))) {
      const rect = contentElement.getBoundingClientRect();
      const focalX = Number(clientX) - (rect.left + rect.width / 2);
      const focalY = Number(clientY) - (rect.top + rect.height / 2);
      const ratio = scale / Math.max(oldScale, 0.001);
      nextX = focalX - (focalX - albumImageZoomState.x) * ratio;
      nextY = focalY - (focalY - albumImageZoomState.y) * ratio;
    } else if (scale <= 1.01) {
      nextX = 0;
      nextY = 0;
    }

    const clamped = scale <= 1.01 ? { x: 0, y: 0 } : clampAlbumImageZoomPosition(nextX, nextY, scale);
    albumImageZoomState.scale = scale;
    albumImageZoomState.x = clamped.x;
    albumImageZoomState.y = clamped.y;
    applyAlbumImageZoomState({ animate: options.animate !== false });
  }

  function getPointerPairMetrics() {
    const points = Array.from(albumImageZoomState.pointers.values());
    if (points.length < 2) return null;
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      distance: Math.max(1, Math.hypot(dx, dy)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  function getAlbumImagePointerClientPoint(event) {
    const originalEvent = event?.originalEvent || event || {};
    const touch = originalEvent.touches?.[0] || originalEvent.changedTouches?.[0];
    if (touch) {
      return { x: Number(touch.clientX || 0), y: Number(touch.clientY || 0) };
    }
    return { x: Number(originalEvent.clientX || 0), y: Number(originalEvent.clientY || 0) };
  }

  function beginAlbumImagePanFromEvent(event, pointerId = "mouse") {
    if (!$("#sm-album-image-viewer").hasClass("sm-open")) return false;
    if (isAlbumImageZoomControlTarget(event?.target)) return false;
    if (albumImageZoomState.scale <= 1.01) return false;

    const point = getAlbumImagePointerClientPoint(event);
    albumImageZoomState.panStart = {
      pointerId,
      x: point.x,
      y: point.y,
      startX: albumImageZoomState.x,
      startY: albumImageZoomState.y,
      moved: false,
    };
    $("#sm-album-image-viewer").addClass("sm-panning");
    return true;
  }

  function moveAlbumImagePanFromEvent(event, pointerId = null) {
    const pan = albumImageZoomState.panStart;
    if (!pan || albumImageZoomState.scale <= 1.01) return false;
    if (pointerId !== null && pan.pointerId !== pointerId) return false;

    const point = getAlbumImagePointerClientPoint(event);
    const dx = point.x - pan.x;
    const dy = point.y - pan.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      pan.moved = true;
    }
    const clamped = clampAlbumImageZoomPosition(pan.startX + dx, pan.startY + dy, albumImageZoomState.scale);
    albumImageZoomState.x = clamped.x;
    albumImageZoomState.y = clamped.y;
    applyAlbumImageZoomState({ animate: false });
    return true;
  }

  function endAlbumImagePan(pointerId = null) {
    const pan = albumImageZoomState.panStart;
    if (pan && (pointerId === null || pan.pointerId === pointerId)) {
      albumImageZoomState.panStart = null;
      $("#sm-album-image-viewer").removeClass("sm-panning");
      return true;
    }
    return false;
  }

  function bindAlbumImageZoomHandlers() {
    if (albumImageZoomHandlersBound) return;
    albumImageZoomHandlersBound = true;

    const pointerSelector = "#sm-album-image-viewer .sm-album-image-viewer-img";
    const dragSurfaceSelector = "#sm-album-image-viewer .sm-album-image-viewer-img";

    $(document)
      .off("wheel.smAlbumImageZoom", pointerSelector)
      .on("wheel.smAlbumImageZoom", pointerSelector, function (e) {
        const originalEvent = e.originalEvent || e;
        if (isAlbumImageZoomControlTarget(e.target)) return;
        if (!originalEvent.ctrlKey && !originalEvent.metaKey && !originalEvent.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        const direction = Number(originalEvent.deltaY || 0) > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.14 : 0.88;
        zoomAlbumImageAt(albumImageZoomState.scale * factor, originalEvent.clientX, originalEvent.clientY, { animate: false });
      });

    $(document)
      .off("click.smAlbumImageZoomControls", "#sm-album-image-viewer .sm-album-image-zoom-btn")
      .on("click.smAlbumImageZoomControls", "#sm-album-image-viewer .sm-album-image-zoom-btn", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }
        const btn = $(this);
        if (btn.prop("disabled")) return false;

        const action = String(btn.attr("data-zoom-action") || "").trim();
        const center = getAlbumImageViewerCenterPoint();
        const currentScale = clampNumber(albumImageZoomState.scale, 1, 5);
        if (action === "in") {
          const nextScale = currentScale < 1.01 ? 1.35 : currentScale + (currentScale < 3 ? 0.35 : 0.5);
          zoomAlbumImageAt(nextScale, center.x, center.y, { animate: true });
        } else if (action === "out") {
          const nextScale = currentScale <= 1.35 ? 1 : currentScale - (currentScale <= 3 ? 0.35 : 0.5);
          zoomAlbumImageAt(nextScale, center.x, center.y, { animate: true });
        } else if (action === "reset") {
          zoomAlbumImageAt(1, center.x, center.y, { animate: true });
        }
        return false;
      });

    $(document)
      .off(
        "pointerdown.smAlbumImageZoomControls mousedown.smAlbumImageZoomControls touchstart.smAlbumImageZoomControls dblclick.smAlbumImageZoomControls",
        "#sm-album-image-viewer .sm-album-image-zoom-controls, #sm-album-image-viewer .sm-album-image-zoom-btn, #sm-album-image-viewer .sm-album-image-viewer-close",
      )
      .on(
        "pointerdown.smAlbumImageZoomControls mousedown.smAlbumImageZoomControls touchstart.smAlbumImageZoomControls dblclick.smAlbumImageZoomControls",
        "#sm-album-image-viewer .sm-album-image-zoom-controls, #sm-album-image-viewer .sm-album-image-zoom-btn, #sm-album-image-viewer .sm-album-image-viewer-close",
        function (e) {
          e.stopPropagation();
          if (e.type === "dblclick") {
            e.preventDefault();
            if (typeof e.stopImmediatePropagation === "function") {
              e.stopImmediatePropagation();
            }
            return false;
          }
          return undefined;
        },
      );

    $(document)
      .off("dblclick.smAlbumImageZoom", "#sm-album-image-viewer")
      .on("dblclick.smAlbumImageZoom", "#sm-album-image-viewer", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }
        return false;
      });

    $(dragSurfaceSelector)
      .off("pointerdown.smAlbumImageZoom")
      .on("pointerdown.smAlbumImageZoom", function (e) {
        if (!$("#sm-album-image-viewer").hasClass("sm-open")) return;
        if (isAlbumImageZoomControlTarget(e.target)) return;

        const originalEvent = e.originalEvent || e;
        const pointerId = originalEvent.pointerId;
        if (pointerId === undefined || pointerId === null) return;

        albumImageZoomState.pointers.set(pointerId, {
          x: Number(originalEvent.clientX || 0),
          y: Number(originalEvent.clientY || 0),
        });

        try {
          this.setPointerCapture?.(pointerId);
        } catch (_error) {}

        if (albumImageZoomState.pointers.size >= 2) {
          const metrics = getPointerPairMetrics();
          if (metrics) {
            const { content } = getAlbumImageZoomNodes();
            const rect = content.get(0)?.getBoundingClientRect?.();
            albumImageZoomState.pinchStart = {
              distance: metrics.distance,
              scale: albumImageZoomState.scale,
              x: albumImageZoomState.x,
              y: albumImageZoomState.y,
              midX: metrics.midX,
              midY: metrics.midY,
              focalX: rect ? metrics.midX - (rect.left + rect.width / 2) : 0,
              focalY: rect ? metrics.midY - (rect.top + rect.height / 2) : 0,
            };
          }
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (beginAlbumImagePanFromEvent(e, pointerId)) {
          e.preventDefault();
          e.stopPropagation();
        }
      });

    $(document)
      .off("pointermove.smAlbumImageZoom")
      .on("pointermove.smAlbumImageZoom", function (e) {
        const originalEvent = e.originalEvent || e;
        const pointerId = originalEvent.pointerId;
        if (pointerId === undefined || pointerId === null) return;
        if (!albumImageZoomState.pointers.has(pointerId) && (!albumImageZoomState.panStart || albumImageZoomState.panStart.pointerId !== pointerId)) return;

        const x = Number(originalEvent.clientX || 0);
        const y = Number(originalEvent.clientY || 0);
        if (albumImageZoomState.pointers.has(pointerId)) {
          albumImageZoomState.pointers.set(pointerId, { x, y });
        }

        if (albumImageZoomState.pointers.size >= 2 && albumImageZoomState.pinchStart) {
          const metrics = getPointerPairMetrics();
          const start = albumImageZoomState.pinchStart;
          if (!metrics) return;
          const nextScale = clampNumber(start.scale * (metrics.distance / Math.max(start.distance, 1)), 1, 5);
          const ratio = nextScale / Math.max(start.scale, 0.001);
          const midDx = metrics.midX - start.midX;
          const midDy = metrics.midY - start.midY;
          const nextX = start.focalX - (start.focalX - start.x) * ratio + midDx;
          const nextY = start.focalY - (start.focalY - start.y) * ratio + midDy;
          const clamped = nextScale <= 1.01 ? { x: 0, y: 0 } : clampAlbumImageZoomPosition(nextX, nextY, nextScale);
          albumImageZoomState.scale = nextScale;
          albumImageZoomState.x = clamped.x;
          albumImageZoomState.y = clamped.y;
          applyAlbumImageZoomState({ animate: false });
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (moveAlbumImagePanFromEvent(e, pointerId)) {
          e.preventDefault();
          e.stopPropagation();
        }
      });

    $(document)
      .off("pointerup.smAlbumImageZoom pointercancel.smAlbumImageZoom")
      .on("pointerup.smAlbumImageZoom pointercancel.smAlbumImageZoom", function (e) {
        const originalEvent = e.originalEvent || e;
        const pointerId = originalEvent.pointerId;
        if (pointerId === undefined || pointerId === null) return;

        albumImageZoomState.pointers.delete(pointerId);
        if (albumImageZoomState.pointers.size < 2) {
          albumImageZoomState.pinchStart = null;
        }
        endAlbumImagePan(pointerId);
      });

    $(dragSurfaceSelector)
      .off("mousedown.smAlbumImageZoomFallback")
      .on("mousedown.smAlbumImageZoomFallback", function (e) {
        if (e.which && e.which !== 1) return;
        if (!beginAlbumImagePanFromEvent(e, "mouse")) return;
        e.preventDefault();
        e.stopPropagation();
      });

    $(document)
      .off("mousemove.smAlbumImageZoomFallback")
      .on("mousemove.smAlbumImageZoomFallback", function (e) {
        if (!moveAlbumImagePanFromEvent(e, "mouse")) return;
        e.preventDefault();
        e.stopPropagation();
      });

    $(document)
      .off("mouseup.smAlbumImageZoomFallback mouseleave.smAlbumImageZoomFallback")
      .on("mouseup.smAlbumImageZoomFallback mouseleave.smAlbumImageZoomFallback", function () {
        endAlbumImagePan("mouse");
      });

    $(dragSurfaceSelector)
      .off("touchstart.smAlbumImageZoomFallback")
      .on("touchstart.smAlbumImageZoomFallback", function (e) {
        const originalEvent = e.originalEvent || e;
        if (!originalEvent.touches || originalEvent.touches.length !== 1) return;
        if (!beginAlbumImagePanFromEvent(e, "touch")) return;
        e.preventDefault();
        e.stopPropagation();
      });

    $(document)
      .off("touchmove.smAlbumImageZoomFallback")
      .on("touchmove.smAlbumImageZoomFallback", function (e) {
        if (!moveAlbumImagePanFromEvent(e, "touch")) return;
        e.preventDefault();
        e.stopPropagation();
      });

    $(document)
      .off("touchend.smAlbumImageZoomFallback touchcancel.smAlbumImageZoomFallback")
      .on("touchend.smAlbumImageZoomFallback touchcancel.smAlbumImageZoomFallback", function () {
        endAlbumImagePan("touch");
      });

    $(window)
      .off("resize.smAlbumImageZoom orientationchange.smAlbumImageZoom")
      .on("resize.smAlbumImageZoom orientationchange.smAlbumImageZoom", function () {
        if (!$("#sm-album-image-viewer").hasClass("sm-open")) return;
        applyAlbumImageZoomState({ animate: false });
      });
  }

  function hideAlbumQuickSaveButton() {
    const quickBtn = $("#sm-image-save-quick");
    if (quickBtn.length) {
      quickBtn.hide().prop("disabled", false);
    }

    albumQuickSaveState = {
      imageUrl: "",
      sourceKey: "",
      messageId: null,
      messageIndex: null,
      generationMetaRaw: "",
      imageNameHint: "",
      anchorElement: null,
    };
  }

  function disableAlbumQuickSaveHandlers() {
    if (!albumQuickSaveHandlersBound) return;
    albumQuickSaveHandlersBound = false;
    try {
      $(document).off("pointerdown", "#chat .mes img");
      $(document).off("pointerup", "#chat .mes img");
      $(document).off("click", "#chat .mes");
    } catch (err) {
      console.warn("SunnyMemories: failed to unbind quick-save handlers", err);
    }
    try {
      hideAlbumQuickSaveButton();
    } catch (_e) {}
  }

  function openAlbumImageViewer(imageUrl, imageName = "", itemId = "") {
    const viewer = $("#sm-album-image-viewer");
    if (!viewer.length) return;
    ensureAlbumViewerInBody(viewer);
    bindAlbumImageZoomHandlers();
    bindAlbumImageCleanModeHandlers();

    const src = String(imageUrl || "").trim();
    if (!src) return;

    const name = String(imageName || "").trim();
    const fallbackImageName = t("album_image_fallback_name");
    const normalizedItemId = String(itemId || "").trim();
    viewer
      .find(".sm-album-image-viewer-img")
      .attr("src", src)
      .attr("alt", name || fallbackImageName);
    viewer.find(".sm-album-image-viewer-caption").text(name);
    viewer.attr("data-item-id", normalizedItemId);
    const downloadLabel = t("album_download_image");
    const deleteLabel = t("album_delete_image");
    viewer
      .find("#sm-album-image-viewer-download")
      .attr("data-image-url", src)
      .attr("data-image-name", name || fallbackImageName)
      .attr("title", downloadLabel)
      .find("span")
      .text(downloadLabel);
    viewer
      .find("#sm-album-image-viewer-delete")
      .attr("data-item-id", normalizedItemId)
      .attr("title", deleteLabel)
      .prop("disabled", !normalizedItemId)
      .find("span")
      .text(deleteLabel);

    resetAlbumImageZoom({ animate: false });
    setAlbumImageViewerCleanMode(false);
    viewer.find("#sm-album-image-viewer-content").scrollTop(0);
    viewer.addClass("sm-open").attr("aria-hidden", "false");
    $("body").addClass("sm-album-viewer-open");
  }

  function armAlbumImageViewerCloseClickGuard(durationMs = 360) {
    if (!document?.addEventListener || !window?.setTimeout) return;

    if (albumImageViewerCloseGuardCleanup) {
      albumImageViewerCloseGuardCleanup();
    }

    const guardedEvents = [
      "click",
      "dblclick",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
    ];
    const until = Date.now() + durationMs;
    const swallow = (event) => {
      if (Date.now() > until) {
        if (albumImageViewerCloseGuardCleanup) albumImageViewerCloseGuardCleanup();
        return;
      }
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      return false;
    };

    albumImageViewerCloseGuardCleanup = () => {
      for (const eventName of guardedEvents) {
        document.removeEventListener(eventName, swallow, true);
      }
      if (albumImageViewerCloseGuardTimer) {
        window.clearTimeout(albumImageViewerCloseGuardTimer);
        albumImageViewerCloseGuardTimer = null;
      }
      albumImageViewerCloseGuardCleanup = null;
    };

    for (const eventName of guardedEvents) {
      document.addEventListener(eventName, swallow, true);
    }
    albumImageViewerCloseGuardTimer = window.setTimeout(() => {
      if (albumImageViewerCloseGuardCleanup) albumImageViewerCloseGuardCleanup();
    }, durationMs);
  }

  function closeAlbumImageViewer() {
    const viewer = $("#sm-album-image-viewer");
    if (!viewer.length || !viewer.hasClass("sm-open")) return;

    armAlbumImageViewerCloseClickGuard();
    endAlbumImagePan();

    viewer.removeAttr("data-item-id");
    viewer
      .find("#sm-album-image-viewer-download")
      .removeAttr("data-image-url")
      .removeAttr("data-image-name");
    viewer
      .find("#sm-album-image-viewer-delete")
      .removeAttr("data-item-id")
      .prop("disabled", true);

    resetAlbumImageZoom({ animate: false });
    viewer.find(".sm-album-image-viewer-img").attr("src", "").removeClass("sm-zoom-animating");
    viewer.removeClass("sm-open sm-zoomed sm-panning sm-clean-view").attr("aria-hidden", "true");
    $("body").removeClass("sm-album-viewer-open");
  }

  function getAlbumMetaViewerResolvedMode(mode = "prompt") {
    const preferred = String(mode || "prompt").toLowerCase();
    if (preferred === "style" && albumMetaViewerState.styleText) return "style";
    if (preferred === "prompt" && albumMetaViewerState.promptText) return "prompt";
    if (albumMetaViewerState.promptText) return "prompt";
    if (albumMetaViewerState.styleText) return "style";
    return "prompt";
  }

  function getAlbumMetaViewerActiveText() {
    const mode = getAlbumMetaViewerResolvedMode(albumMetaViewerState.activeMode);
    return mode === "style" ? albumMetaViewerState.styleText : albumMetaViewerState.promptText;
  }

  function setAlbumMetaViewerMode(mode = "prompt") {
    const viewer = $("#sm-album-meta-viewer");
    if (!viewer.length) return;

    const resolvedMode = getAlbumMetaViewerResolvedMode(mode);
    albumMetaViewerState.activeMode = resolvedMode;

    viewer.find(".sm-album-prompt-mode-btn").removeClass("is-active");
    viewer.find(`.sm-album-prompt-mode-btn[data-mode="${resolvedMode}"]`).addClass("is-active");

    const activeText = getAlbumMetaViewerActiveText();
    viewer.find("#sm-album-meta-viewer-text").val(activeText || t("album_prompt_not_found"));
    viewer.find("#sm-album-meta-viewer-copy").prop("disabled", !activeText);
  }

  function openAlbumMetaViewer(promptText = "", styleText = "", imageName = "") {
    const viewer = $("#sm-album-meta-viewer");
    if (!viewer.length) return;
    ensureAlbumViewerInBody(viewer);

    albumMetaViewerState = {
      promptText: String(promptText || "").trim(),
      styleText: String(styleText || "").trim(),
      activeMode: "prompt",
    };

    viewer.find(".sm-album-meta-viewer-caption").text(String(imageName || "").trim());
    setAlbumMetaViewerMode("prompt");
    viewer.find("#sm-album-meta-viewer-content").scrollTop(0);
    viewer.find("#sm-album-meta-viewer-text").scrollTop(0);

    viewer.addClass("sm-open").attr("aria-hidden", "false");
    $("body").addClass("sm-album-viewer-open");
  }

  function closeAlbumMetaViewer() {
    const viewer = $("#sm-album-meta-viewer");
    if (!viewer.length || !viewer.hasClass("sm-open")) return;

    viewer.removeClass("sm-open").attr("aria-hidden", "true");
    $("body").removeClass("sm-album-viewer-open");
  }

  function getAlbumQuickSaveViewportRect() {
    const docEl = document.documentElement;
    return {
      left: 0,
      top: 0,
      width: Math.max(Number(window.innerWidth) || 0, Number(docEl?.clientWidth) || 0),
      height: Math.max(Number(window.innerHeight) || 0, Number(docEl?.clientHeight) || 0),
    };
  }

  function getAlbumQuickSaveButtonSize(quickBtn) {
    const buttonElement = quickBtn?.get?.(0);
    if (!buttonElement) {
      return { width: 180, height: 36 };
    }

    const wasVisible = quickBtn.is(":visible");
    const previousStyle = {
      display: buttonElement.style.display,
      visibility: buttonElement.style.visibility,
      left: buttonElement.style.left,
      top: buttonElement.style.top,
    };

    if (!wasVisible) {
      quickBtn.css({
        display: "inline-flex",
        visibility: "hidden",
        left: "-10000px",
        top: "-10000px",
      });
    }

    const rect = buttonElement.getBoundingClientRect();
    const width = Math.ceil(rect.width || quickBtn.outerWidth() || 180);
    const height = Math.ceil(rect.height || quickBtn.outerHeight() || 36);

    if (!wasVisible) {
      quickBtn.css(previousStyle);
    }

    return {
      width: Math.max(120, width),
      height: Math.max(30, height),
    };
  }

  function positionAlbumQuickSaveButton(quickBtn, anchorElement = null) {
    const viewport = getAlbumQuickSaveViewportRect();
    const { width: buttonWidth, height: buttonHeight } = getAlbumQuickSaveButtonSize(quickBtn);
    const minGap = 10;

    let left = viewport.left + (viewport.width - buttonWidth) / 2;
    let top = viewport.top + viewport.height - buttonHeight - minGap;

    if (anchorElement && typeof anchorElement.getBoundingClientRect === "function") {
      const rect = anchorElement.getBoundingClientRect();
      const hasValidRect =
        Number.isFinite(rect?.left) &&
        Number.isFinite(rect?.top) &&
        Number.isFinite(rect?.bottom) &&
        Number.isFinite(rect?.width);

      if (hasValidRect) {
        left = rect.left + rect.width / 2 - buttonWidth / 2;

        const aboveTop = rect.top - buttonHeight - minGap;
        const belowTop = rect.bottom + minGap;
        top = aboveTop;
        if (top < viewport.top + minGap) {
          top = belowTop;
        }
      }
    }

    const minLeft = viewport.left + minGap;
    const maxLeft = viewport.left + viewport.width - buttonWidth - minGap;
    const minTop = viewport.top + minGap;
    const maxTop = viewport.top + viewport.height - buttonHeight - minGap;

    left = maxLeft >= minLeft ? Math.min(Math.max(left, minLeft), maxLeft) : viewport.left;
    top = maxTop >= minTop ? Math.min(Math.max(top, minTop), maxTop) : viewport.top;

    quickBtn.css({
      display: "inline-flex",
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
    });
  }

  function showAlbumQuickSaveButton(anchorElement, imageUrl, sourceMeta = {}) {
    const quickBtn = $("#sm-image-save-quick");
    if (!quickBtn.length) return;

    const normalizedMeta =
      typeof sourceMeta === "string" ? { sourceKey: sourceMeta } : sourceMeta || {};
    const safeAnchorElement =
      anchorElement && document.body.contains(anchorElement) ? anchorElement : null;

    albumQuickSaveState = {
      imageUrl,
      sourceKey: String(normalizedMeta.sourceKey || "").trim(),
      messageId: normalizedMeta.messageId ?? null,
      messageIndex: Number.isFinite(Number(normalizedMeta.messageIndex))
        ? Number(normalizedMeta.messageIndex)
        : null,
      generationMetaRaw: String(normalizedMeta.generationMetaRaw || "").trim(),
      imageNameHint: String(normalizedMeta.imageNameHint || "").trim(),
      anchorElement: safeAnchorElement,
    };

    positionAlbumQuickSaveButton(quickBtn, safeAnchorElement);
  }

  function resolveAlbumQuickSaveMetaFromImageElement(imageElement, imageUrl) {
    const messageElement = imageElement?.closest?.(".mes") || null;
    let messageIndex = null;
    let messageId = null;

    if (messageElement) {
      const parsedMesId = Number.parseInt(String(messageElement.getAttribute("mesid") || ""), 10);
      if (Number.isInteger(parsedMesId) && parsedMesId >= 0) {
        messageIndex = parsedMesId;
      }
    }

    const ctx = getContext();
    if (
      messageIndex !== null &&
      Array.isArray(ctx?.chat) &&
      messageIndex >= 0 &&
      messageIndex < ctx.chat.length
    ) {
      messageId = getMessageId(ctx.chat[messageIndex]);
    }

    let imageSlot = 0;
    if (messageElement) {
      const imageNodes = Array.from(messageElement.querySelectorAll("img"));
      const imageNodeIndex = imageNodes.indexOf(imageElement);
      imageSlot = imageNodeIndex >= 0 ? imageNodeIndex : 0;
    }

    const generationMetaRaw = String(
      imageElement?.getAttribute?.("data-iig-instruction") || "",
    ).trim();
    const imageNameHint =
      String(imageElement?.getAttribute?.("alt") || "").trim() ||
      getImageNameFromUrl(imageUrl, "image");

    return {
      sourceKey: `chat_image:${messageId ?? messageIndex ?? "na"}:${imageSlot}:${imageUrl}`,
      messageId: messageId ?? null,
      messageIndex,
      generationMetaRaw,
      imageNameHint,
    };
  }

  function initAlbumImageQuickSave() {
    let pointerDownAt = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastTapHandledAt = 0;

    function handleAlbumQuickSaveTap(imageElement, eventObject = null) {
      const img = /** @type {HTMLImageElement | null} */ (imageElement || null);
      if (!img) return;

      const url = String(img.currentSrc || img.src || "").trim();
      if (!url) return;

      void eventObject;

      let sourceMeta = {
        sourceKey: `chat_image:${url}`,
        messageId: null,
        messageIndex: null,
        generationMetaRaw: "",
        imageNameHint: getImageNameFromUrl(url, "image"),
      };

      try {
        sourceMeta = resolveAlbumQuickSaveMetaFromImageElement(img, url);
      } catch (error) {
        console.warn("SunnyMemories: image quick-save meta extraction failed", error);
      }

      showAlbumQuickSaveButton(img, url, sourceMeta);
      lastTapHandledAt = Date.now();
    }

    function bindAlbumQuickSaveHandlers() {
      if (albumQuickSaveHandlersBound) return;
      albumQuickSaveHandlersBound = true;

      $(document).on("pointerdown", "#chat .mes img", function (e) {
        pointerDownAt = Date.now();
        pointerDownX = Number(e.clientX || 0);
        pointerDownY = Number(e.clientY || 0);
      });

      $(document).on("pointerup", "#chat .mes img", function (e) {
        const elapsed = Date.now() - pointerDownAt;
        const dx = Math.abs(Number(e.clientX || 0) - pointerDownX);
        const dy = Math.abs(Number(e.clientY || 0) - pointerDownY);
        const isShortTap = elapsed <= 400 && dx <= 12 && dy <= 12;
        if (!isShortTap) return;

        handleAlbumQuickSaveTap(this, e);
      });

      $(document).on("click", "#chat .mes", function (e) {
        if (Date.now() - lastTapHandledAt < 350) return;

        const targetElement =
          e?.target && typeof e.target.closest === "function" ? e.target : null;
        const targetImage = targetElement ? targetElement.closest("img") : null;
        if (!targetImage || !this.contains(targetImage)) return;

        handleAlbumQuickSaveTap(targetImage, e);
      });
    }

    bindAlbumQuickSaveHandlers();

    $(document).off("click", "#sm-image-save-quick").on("click", "#sm-image-save-quick", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const btn = $(this);
      const imageUrl = String(albumQuickSaveState.imageUrl || "").trim();
      if (!imageUrl) {
        hideAlbumQuickSaveButton();
        return;
      }

      btn.prop("disabled", true);
      try {
        await saveRemoteImageToAlbumFromUrl(imageUrl, {
          sourceKey: albumQuickSaveState.sourceKey,
          messageId: albumQuickSaveState.messageId,
          messageIndex: albumQuickSaveState.messageIndex,
          generationMetaRaw: albumQuickSaveState.generationMetaRaw,
          imageNameHint: albumQuickSaveState.imageNameHint,
        });
        hideAlbumQuickSaveButton();
      } catch (error) {
        console.error("SunnyMemories: failed to save image", error);
        toastr.error(error?.message || t("album_save_image_failed"));
        btn.prop("disabled", false);
      }
    });

    const syncAlbumQuickSaveButtonPosition = () => {
      const quickBtn = $("#sm-image-save-quick");
      if (!quickBtn.length || !quickBtn.is(":visible")) return;

      const currentImageUrl = String(albumQuickSaveState.imageUrl || "").trim();
      if (!currentImageUrl) {
        hideAlbumQuickSaveButton();
        return;
      }

      const safeAnchorElement =
        albumQuickSaveState.anchorElement && document.body.contains(albumQuickSaveState.anchorElement)
          ? albumQuickSaveState.anchorElement
          : null;
      albumQuickSaveState.anchorElement = safeAnchorElement;

      positionAlbumQuickSaveButton(quickBtn, safeAnchorElement);
    };

    if (!albumQuickSaveViewportEventsBound) {
      albumQuickSaveViewportEventsBound = true;
      $(window).on("resize orientationchange scroll", syncAlbumQuickSaveButtonPosition);

      const vv = window.visualViewport;
      if (vv && typeof vv.addEventListener === "function") {
        vv.addEventListener("resize", syncAlbumQuickSaveButtonPosition);
        vv.addEventListener("scroll", syncAlbumQuickSaveButtonPosition);
      }
    }

    if (!lightboxPollerId) {
      let attempts = 0;
      lightboxPollerId = setInterval(() => {
        attempts += 1;
        try {
          const lb = document.querySelector(".iig-lightbox");
          if (lb) {
            disableAlbumQuickSaveHandlers();
            clearInterval(lightboxPollerId);
            lightboxPollerId = null;
          } else if (attempts > 40) {
            clearInterval(lightboxPollerId);
            lightboxPollerId = null;
          }
        } catch (err) {
          console.warn("SunnyMemories: lightbox poller error", err);
        }
      }, 300);
    }
  }

  function isInsideAlbumImageViewer(target) {
    return Boolean(
      target &&
        typeof target.closest === "function" &&
        target.closest("#sm-album-image-viewer, #sm-album-meta-viewer"),
    );
  }

  return {
    hideAlbumQuickSaveButton,
    disableAlbumQuickSaveHandlers,
    openAlbumImageViewer,
    closeAlbumImageViewer,
    getAlbumMetaViewerActiveText,
    setAlbumMetaViewerMode,
    openAlbumMetaViewer,
    closeAlbumMetaViewer,
    positionAlbumQuickSaveButton,
    showAlbumQuickSaveButton,
    resolveAlbumQuickSaveMetaFromImageElement,
    initAlbumImageQuickSave,
    isInsideAlbumImageViewer,
  };
}
