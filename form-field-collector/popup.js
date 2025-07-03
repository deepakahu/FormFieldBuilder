// popup.js (DEBUG VERSION)
const log = (...args) => console.log("XFC DEBUG [Popup]:", ...args);

document.addEventListener("DOMContentLoaded", () => {
  log("---- POPUP OPENED ----");
  // --- Tab Switching Logic ---
  const tabLinks = document.querySelectorAll(".tab-link");
  const tabContents = document.querySelectorAll(".tab-content");
  tabLinks.forEach((link) => {
    link.addEventListener("click", () => {
      tabLinks.forEach((l) => l.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));
      link.classList.add("active");
      document.getElementById(link.dataset.tab).classList.add("active");
      log(`Switched to tab: ${link.dataset.tab}`);
    });
  });

  // --- Links to Options Page ---
  document.getElementById("options-link").onclick = () =>
    chrome.runtime.openOptionsPage();
  document.getElementById("options-link-2").onclick = () =>
    chrome.runtime.openOptionsPage();

  // --- Tab 1: Status ---
  const profileSelect = document.getElementById("profile-select");
  const toggleBtn = document.getElementById("toggle-sidebar-btn");

  async function initStatusTab() {
    log("Status Tab: Initializing...");
    try {

        // --- This new helper function will handle the notification logic ---
        async function handlePopupUpdateNotification() {
            const { activeProfileIndex = 0 } = await chrome.storage.sync.get('activeProfileIndex');
            const siteConfigs = await fetch(chrome.runtime.getURL('sites.json')).then(res => res.json());
            const activeConfig = siteConfigs[activeProfileIndex];

            const { installDate } = await chrome.storage.local.get('installDate');

            if (!activeConfig || activeConfig.license !== "Free" || !installDate) {
                return; // Exit if not a free license or no install date
            }

            const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
            if ((Date.now() - installDate) > thirtyDaysInMillis) {
                const extensionId = chrome.runtime.id;
                const updateUrl = `https://chrome.google.com/webstore/detail/${extensionId}`;
                const message = `Please <a href="${updateUrl}" target="_blank">update your extension</a> for bug fixes and latest update.`;

                const popupNotification = document.getElementById('ffc-popup-notification');
                if (popupNotification) {
                    popupNotification.innerHTML = message;
                    popupNotification.style.display = 'block'; // Make it visible
                }
            }
        }


      const configs = await fetch(chrome.runtime.getURL("sites.json")).then(
        (res) => res.json()
      );
      configs.forEach((config, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = config.name;
        profileSelect.appendChild(option);
      });
      const settings = await chrome.storage.sync.get({ activeProfileIndex: 0 });
      profileSelect.value = settings.activeProfileIndex;

      handlePopupUpdateNotification();

      log("Status Tab: Profiles loaded and selected.", settings);
    } catch (e) {
      console.error("XFC ERROR: Failed to init status tab", e);
    }
  }

  profileSelect.onchange = () => {
    log(
      `Status Tab: Profile changed to index ${profileSelect.value}. Saving...`
    );
    chrome.storage.sync.set({ activeProfileIndex: profileSelect.value });
  };

  toggleBtn.onclick = () => {
    log("Status Tab: Toggle Sidebar button clicked.");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_SIDEBAR" });
        window.close();
      }
    });
  };

  // --- Tab 2: Stored Notes ---
  const clientSelect = document.getElementById("client-select");
  const notesTextarea = document.getElementById("stored-notes-textarea");
  const copyNotesBtn = document.getElementById("copy-notes-btn");

  async function initNotesTab() {
    log("Notes Tab: Initializing...");
    const allItems = await chrome.storage.local.get(null);
    log("Notes Tab: All items from local storage:", allItems);
    const clientKeys = Object.keys(allItems).filter((key) =>
      key.startsWith("collectedFields_")
    );
    log(`Notes Tab: Found ${clientKeys.length} client data keys.`, clientKeys);

    clientSelect.innerHTML = clientKeys.length
      ? ""
      : '<option value="">-- No clients found --</option>';
    clientKeys.forEach((key) => {
      const clientName = key.replace("collectedFields_", "").replace(/_/g, " ");
      const option = document.createElement("option");
      option.value = key;
      option.textContent =
        clientName === "default" ? "Default (No Client)" : clientName;
      clientSelect.appendChild(option);
    });

    clientSelect.onchange = () =>
      displayNotesForKey(clientSelect.value, allItems);
    copyNotesBtn.onclick = () => {
      navigator.clipboard.writeText(notesTextarea.value);
    };

    log("Notes Tab: Asking content script for its active client key...");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "GET_ACTIVE_CLIENT_KEY" },
        (res) => {
          if (chrome.runtime.lastError) {
            log(
              "Notes Tab: Could not get active key. Content script might not be running on this page.",
              chrome.runtime.lastError.message
            );
            return;
          }
          log("Notes Tab: Received response from content script:", res);
          if (res?.activeKey && clientKeys.includes(res.activeKey)) {
            log(`Notes Tab: Pre-selecting client: ${res.activeKey}`);
            clientSelect.value = res.activeKey;
            displayNotesForKey(res.activeKey, allItems);
          }
        }
      );
    }
  }

  function displayNotesForKey(key, allItems) {
    log(`Notes Tab: Displaying notes for key: ${key}`);
    const data = allItems[key] || [];
    let body = "";
    data.forEach((field) => {
      body += `${field.pageTitle}\n- ${field.label}: ${field.value}\n  Query: ${field.question}\n\n`;
    });
    notesTextarea.value = body.trim();
    copyNotesBtn.disabled = !body;
  }

  // --- Tab 3: Custom Questions Viewer ---
  async function initQuestionsTab() {
    log("Questions Tab: Initializing...");
    const { masterQuestionList = {} } = await chrome.storage.sync.get(
      "masterQuestionList"
    );
    const questionViewer = document.getElementById("question-viewer");
    log(
      "Questions Tab: Loaded masterQuestionList from sync storage:",
      masterQuestionList
    );

    if (Object.keys(masterQuestionList).length > 0) {
      questionViewer.textContent = JSON.stringify(masterQuestionList, null, 2);
    } else {
      questionViewer.textContent =
        "No custom questions defined. Use the main Options Page to add some.";
    }
  }

  // --- Initialize All Tabs ---
  initStatusTab();
  initNotesTab();
  initQuestionsTab();
});
