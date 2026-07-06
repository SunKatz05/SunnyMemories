export function createMessagePopoverButtons({ $, document, window, MutationObserver } = {}) {
  function addSunnyButton(messageElement, messageId) {
    if (!messageElement) return;
    if (messageElement.querySelector(".sunny-message-btn")) return;

    let extraMesButtons = messageElement.querySelector(
      ".extraMesButtons, .mes-buttons, .mes__actions, .mes-right",
    );

    if (!extraMesButtons) {
      extraMesButtons = document.createElement("div");
      extraMesButtons.className = "extraMesButtons sm-extra-mes-buttons";
      extraMesButtons.style.display = "inline-flex";
      extraMesButtons.style.alignItems = "center";
      const header = messageElement.querySelector(
        ".mes_header, .mes-head, .mes-headline",
      );
      if (header) header.appendChild(extraMesButtons);
      else messageElement.appendChild(extraMesButtons);
    }

    const btn = document.createElement("div");
    btn.className = "mes_button sunny-message-btn fa-solid fa-sun interactable";
    btn.title = "Sunny Memories";
    btn.style.marginLeft = "6px";

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        const popover = $("#sm-message-popover");
        popover.data("mesid", messageId);

        popover.css({
          display: "flex",
          visibility: "hidden",
          top: "-9999px",
          left: "-9999px",
        });

        const rect = btn.getBoundingClientRect();
        const popWidth = Math.ceil(popover.outerWidth() || 220);
        const popHeight = Math.ceil(popover.outerHeight() || 180);
        const scrollY = window.scrollY || document.documentElement.scrollTop;
        const scrollX = window.scrollX || document.documentElement.scrollLeft;

        let topPos = rect.top + scrollY - popHeight - 10;
        let leftPos = rect.left + scrollX + rect.width / 2 - popWidth / 2;

        const minLeft = scrollX + 10;
        const maxLeft = scrollX + window.innerWidth - popWidth - 10;
        leftPos = Math.min(Math.max(minLeft, leftPos), Math.max(minLeft, maxLeft));

        const minTop = scrollY + 10;
        if (topPos < minTop) {
          topPos = rect.bottom + scrollY + 10;
        }
        const maxTop = scrollY + window.innerHeight - popHeight - 10;
        topPos = Math.min(Math.max(minTop, topPos), Math.max(minTop, maxTop));

        popover.css({
          top: topPos + "px",
          left: leftPos + "px",
          display: "flex",
          visibility: "visible",
        });
      } catch (err) {
        console.error("SunnyMemories: popover show error", err);
      }
    });

    btn.style.display = "inline-flex";
    btn.style.visibility = "visible";
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";

    extraMesButtons.appendChild(btn);
  }

  function addButtonsToExistingMessages() {
    document.querySelectorAll("#chat .mes").forEach((el) => {
      const mesId = el.getAttribute("mesid");
      if (mesId) addSunnyButton(el, parseInt(mesId, 10));
    });
  }

  function initSunnyButtons() {
    addButtonsToExistingMessages();

    const chatEl = document.querySelector("#chat");
    if (chatEl) {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "childList") {
            document.querySelectorAll("#chat .mes").forEach((el) => {
              if (!el.querySelector(".sunny-message-btn")) {
                const mid = el.getAttribute("mesid");
                if (mid) addSunnyButton(el, parseInt(mid, 10));
              }
            });
          }
        }
      });
      mo.observe(chatEl, { childList: true, subtree: true });
    }
  }

  return {
    addSunnyButton,
    addButtonsToExistingMessages,
    initSunnyButtons,
  };
}
