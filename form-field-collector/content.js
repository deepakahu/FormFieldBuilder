// =========================================================================
//            XERO FORM COLLECTOR - content.js (DEBUG VERSION)
// =========================================================================

// --- GLOBALS ---
let DEBUG_MODE = false; // Force debug mode for this session
const log = (...args) => {
  if (DEBUG_MODE) console.log("XFC DEBUG [Content]:", ...args);
};
let sidebarInjected = false;
let sidebarElement = null;
let collectedFieldsCache = [];
let masterQuestionList = {};
let dynamicStorageKey = null;
let activeConfig = null;

/**
 * Main initialization function.
 */
async function initialize() {
  log("---- INITIALIZATION START ----");
  
  // Load sync settings first
  const settings = await chrome.storage.sync.get({
    masterQuestionList: {},
    debugMode: false,
    activeProfileIndex: 0,
  });
  DEBUG_MODE = settings.debugMode || false; // Keep it on for this test
  log("1. Settings loaded from sync storage:", settings);

  document.body.classList.add("ffc-active-page");

  // Fetch site configurations
  let siteConfigs;
  try {
    const response = await fetch(chrome.runtime.getURL("sites.json"));
    siteConfigs = await response.json();
    activeConfig = siteConfigs[settings.activeProfileIndex];
    log("2. Loaded sites.json and selected active profile:", activeConfig.name);
  } catch (e) {
    console.error("XFC CRITICAL: Could not load sites.json.", e);
    return;
  }

  const currentURL = window.location.href;
  if (
    !activeConfig ||
    !activeConfig.matchPatterns.some((p) =>
      new RegExp(p.replace(/\*/g, ".*")).test(currentURL)
    )
  ) {
    log(
      `Current page does not match active profile "${
        activeConfig?.name || "none"
      }". Halting execution.`
    );
    document.body.classList.remove("ffc-active-page");
    return;
  }
  log("3. Active profile is valid for this page.");

  // Merge question lists
  const defaultQuestions = activeConfig.defaultQuestions || {};
  const customQuestions = settings.masterQuestionList || {};
  log(
    "4a. Default questions found:",
    JSON.parse(JSON.stringify(defaultQuestions))
  );
  log(
    "4b. Custom questions found:",
    JSON.parse(JSON.stringify(customQuestions))
  );
  masterQuestionList = { ...defaultQuestions, ...customQuestions };
  log(
    `4c. MERGED master list now contains ${
      Object.keys(masterQuestionList).length
    } rules.`,
    JSON.parse(JSON.stringify(masterQuestionList))
  );

  // Get client name and set storage key
  const clientNameElement = await waitForElement(
    activeConfig.selectors.clientName
  );
  if (clientNameElement) {
    log("5a. Found client name element:", clientNameElement.textContent.trim());
    dynamicStorageKey = `collectedFields_${clientNameElement.textContent
      .trim()
      .replace(/&/g, "and")
      .replace(/\s+/g, "_")}`;
  } else {
    log("5a. WARNING: Could not find client name element. Using default key.");
    dynamicStorageKey = "collectedFields_default";
  }
  log("5b. Dynamic storage key set to:", dynamicStorageKey);

  const data = await chrome.storage.local.get([dynamicStorageKey]);
  collectedFieldsCache = data[dynamicStorageKey] || [];
  log(
    "6. Loaded collected fields from local storage for this key:",
    collectedFieldsCache
  );

  log("7. Injecting sidebar...");
  await injectSidebar();
  log("Sidebar injection complete.");
  
  log("8. Setting up listeners...");
  setupListeners();
  log("Listeners setup complete.");

  log("9. Initial scan for fields to add buttons...");
  processPageForMissingButtons();
  log("---- INITIALIZATION COMPLETE ----");

  // Check if extension is not more than 30 days old
  await checkForUpdateNotification();

}

function setupListeners() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Message received: type = ${request.type}`);
    if (request.type === "TOGGLE_SIDEBAR") {
      if (sidebarElement) {
        // This now uses our new function which also saves the state
        const shouldBeVisible = !sidebarElement.classList.contains("ffc-visible");
        initializeSidebarLogic().then(() => { // Ensure logic is initialized
            const closeBtn = document.getElementById("ffc-close-btn");
            if (closeBtn) {
                 const toggleFn = (visible) => {
                    if (visible) sidebarElement.classList.add("ffc-visible");
                    else sidebarElement.classList.remove("ffc-visible");
                    chrome.storage.local.set({ isSidebarVisible: visible });
                 };
                 toggleFn(shouldBeVisible);
            }
        });
      }
    } else if (request.type === "GET_ACTIVE_CLIENT_KEY") {
      log("Responding with active client key:", dynamicStorageKey);
      sendResponse({ activeKey: dynamicStorageKey });
    } else if (request.type === "GET_ALL_LABELS") {
      const labels = Array.from(
        document.querySelectorAll(activeConfig.selectors.fieldLabel)
      ).map((el) =>
        (el.querySelector(".questionText") || el).textContent.trim()
      );
      log(`Found ${labels.length} labels on page to send to options.`, labels);
      sendResponse({ labels: [...new Set(labels)] });
    }
    return true;
  });
}


function openQuestionPicker(clickedButton, labelElement, labelText) {
  log(`--- openQuestionPicker called for label: "${labelText}" ---`);
  
  let picker = document.getElementById("ffc-question-picker");
  if (picker) picker.remove();
  picker = document.createElement("div");
  picker.id = "ffc-question-picker";

  const questions = masterQuestionList[labelText] || masterQuestionList["default"];
  if (!questions || questions.length === 0) {
      log(`!!!!!! CRITICAL ERROR: NO QUESTIONS FOUND for "${labelText}" and no "default" questions exist!`);
      return; 
  }
  
  log(`Found these questions to display:`, questions);
  picker.innerHTML = `<div id="ffc-question-picker-header"><span>Select a Query</span><button id="ffc-picker-close-btn">×</button></div><ul id="ffc-question-list">${questions
    .map((q) => `<li class="ffc-question-item">${q}</li>`)
    .join("")}</ul>`;

  document.body.appendChild(picker);
  log("Question picker menu has been appended to the document body.");

  const rect = clickedButton.getBoundingClientRect();
  picker.style.display = "block";
  picker.style.top = `${window.scrollY + rect.bottom + 5}px`;
  picker.style.left = `${window.scrollX + rect.left}px`;

  const closePicker = () => {
      log("Closing question picker.");
      const pickerElement = document.getElementById("ffc-question-picker");
      if(pickerElement) pickerElement.remove();
  };
  document.getElementById("ffc-picker-close-btn").onclick = closePicker;

  document.querySelectorAll(".ffc-question-item").forEach((item) => {
    item.onclick = (event) => {
      event.stopPropagation();

      log(`Question item clicked: "${item.textContent}"`);
      const selectedQuestion = item.textContent;
      const pageTitle = findCurrentPageTitle(labelElement);
      const valueElement = findValueElementForLabel(labelElement);
      let value = "N/A";
      if (valueElement) {
        const tagName = valueElement.tagName.toLowerCase();
        if (["input", "textarea", "select"].includes(tagName)) {
          value = valueElement.value;
        } else {
          value = valueElement.textContent.trim();
        }
      }

      log(`Saving data: { page: "${pageTitle}", label: "${labelText}", value: "${value}", question: "${selectedQuestion}" }`);
      
      // ----------- THIS IS THE FINAL FIX -----------
      // Instead of relying on the onChanged listener, we update the UI directly.

      // 1. Create the new data entry
      const newEntry = {
        id: Date.now(),
        pageTitle,
        label: labelText,
        value,
        question: selectedQuestion,
      };

      // 2. Update our local cache IMMEDIATELY
      const existingIndex = collectedFieldsCache.findIndex(f => f.label === labelText);
      if (existingIndex > -1) {
        collectedFieldsCache[existingIndex] = newEntry;
      } else {
        collectedFieldsCache.push(newEntry);
      }
      
      // 3. Start saving to storage (asynchronously)
      chrome.storage.local.set({ [dynamicStorageKey]: collectedFieldsCache });

      // 4. Manually trigger the UI updates NOW
      log("Manually updating sidebar text and button states...");
      updateSidebarText();
      updateAllButtonStates();
      // ---------------------------------------------
      
      closePicker();
    };
  });
  
  setTimeout(() => {
    document.addEventListener(
      "click",
      (e) => {
        const pickerElement = document.getElementById("ffc-question-picker");
        if (pickerElement && !pickerElement.contains(e.target) && e.target !== clickedButton) {
          closePicker();
        }
      },
      { once: true }
    );
  }, 0);
}

function createCollectorButton(labelElement) {
  const labelText = labelElement.textContent.trim();
  // Prevent re-adding buttons
  if (
    !dynamicStorageKey ||
    labelElement.querySelector(".form-field-collector-btn")
  )
    return;

  const button = document.createElement("button");
  button.className = "form-field-collector-btn";
  button.title = "Add or Change Query";
  // Store the CLEAN label text before we modify the element
  button.dataset.ffcLabel = labelText; 
  labelElement.style.position = "relative";
  labelElement.appendChild(button);

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // ----- THIS IS THE FIX -----
    // Instead of passing the whole labelElement (which has contaminated textContent),
    // we now pass the clean labelText that we saved in the dataset.
    // The openQuestionPicker function will also need a small change to accept this.
    const cleanLabel = button.dataset.ffcLabel; // Get the original, clean label
    log(`>>>>>>>>>> BUTTON CLICKED! <<<<<<<<<< Clean Label: "${cleanLabel}"`);
    log("Calling openQuestionPicker...");
    openQuestionPicker(button, labelElement, cleanLabel); // Pass it as a third argument
  });
}

function updateAllButtonStates() {
  log("Updating all button states based on cache...");
  document.querySelectorAll(".form-field-collector-btn").forEach((button) => {
    const labelText = button.dataset.ffcLabel;
    if (!labelText) return;
    const isCollected = collectedFieldsCache.some(
      (field) => field.label === labelText
    );
    button.innerHTML = isCollected ? "✓" : "→";
    if (isCollected) {
      button.classList.add("collected");
    } else {
      button.classList.remove("collected");
    }
  });
}

function processPageForMissingButtons() {
  if (!activeConfig?.selectors?.fieldLabel) {
    log(
      "processPageForMissingButtons: No fieldLabel selector in config. Skipping."
    );
    return;
  }
  log("processPageForMissingButtons: Starting scan...");
  const targetNode = document.getElementById("form-view") || document.body;
  const potentialLabels = targetNode.querySelectorAll(
    activeConfig.selectors.fieldLabel
  );
  log(`Found ${potentialLabels.length} potential label elements on the page.`);
  potentialLabels.forEach((label) => {
    const textElement = label.querySelector(".questionText") || label;
    if (textElement) {
      createCollectorButton(textElement);
    }
  });
  updateAllButtonStates();
  log("processPageForMissingButtons: Scan complete.");
}

// --- Functions below this line are less likely to be the source of the bug but are included for completeness ---

function waitForElement(selector, timeout = 7000) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(element);
      }
    }, 200);
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(null);
    }, timeout);
  });
}


function findValueElementForLabel(labelElement) {
  // 1. Find the main container for the entire question row.
  const container = labelElement.closest(activeConfig.selectors.fieldContainer);
  if (!container) {
    log(`Could not find a container for label: "${labelElement.textContent.trim()}"`);
    return null;
  }

  // 2. Use the powerful, combined selector from sites.json to find all possible value elements within that row.
  const valueElements = Array.from(container.querySelectorAll(activeConfig.selectors.value));

  if (valueElements.length === 0) {
    log(`No value elements found for label: "${labelElement.textContent.trim()}"`);
    return null;
  }
  
  // 3. Intelligent Logic to pick the BEST value from the results.
  //    For rows with multiple values (like ITR "Salary or wages"), this finds the right one.
  let targetElement = null;
  if (valueElements.length > 1) {
    // If there are multiple values, we prefer one that is NOT a button or inside a button.
    // This handles the ITR "Salary or wages" case where a button and the value exist.
    // We also look for the last element, which is often the primary value in Xero's layout.
    targetElement = valueElements.filter(el => el.tagName !== 'BUTTON' && !el.closest('button')).pop() || valueElements.pop();
    log(`Multiple value elements found for "${labelElement.textContent.trim()}". Heuristics selected:`, targetElement);
  } else {
    // If there's only one, that's our target.
    targetElement = valueElements[0];
    log(`Single value element found for "${labelElement.textContent.trim()}":`, targetElement);
  }

  return targetElement;
}

function findCurrentPageTitle(element) {
  if (!activeConfig?.selectors?.pageTitle) return "Unknown Section";
  const titles = document.querySelectorAll(activeConfig.selectors.pageTitle);
  let last = "Unknown Section";
  for (const t of titles) {
    if (element.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING) {
      last = t.textContent.trim();
    } else {
      break;
    }
  }
  return last;
}
function injectSidebar() {
  return new Promise((resolve) => {
    if (sidebarInjected) {
      resolve();
      return;
    }
    sidebarInjected = true;
    fetch(chrome.runtime.getURL("sidebar.html"))
      .then((e) => e.text())
      .then((html) => {
        document.body.insertAdjacentHTML("beforeend", html);
        sidebarElement = document.getElementById("ffc-sidebar");
        initializeSidebarLogic();
        resolve();
      });
  });
}
function updateSidebarText() {
  // This function is unlikely to be the cause.
  const textarea = document.getElementById("ffc-live-textarea");
  if (!textarea) return;
  let formattedBody = "";
  let currentPage = null;
  collectedFieldsCache.forEach((field) => {
    if (field.pageTitle !== currentPage) {
      if (currentPage !== null) formattedBody += "\n";
      formattedBody += `${field.pageTitle}\n`;
      currentPage = field.pageTitle;
    }
    formattedBody += `- ${field.label}: ${field.value}\n`;
    if (field.question) {
      formattedBody += `  Query: ${field.question}\n`;
    }
  });
  textarea.value = formattedBody.trim();
}

// In content.js

async function initializeSidebarLogic() {
  const clearBtn = document.getElementById("ffc-clear-all-btn");
  const closeBtn = document.getElementById("ffc-close-btn");
  const copyAllBtn = document.getElementById("ffc-copy-all-btn");

  if (!closeBtn || !copyAllBtn) return;

  const toggleSidebarVisibility = (visible) => {
    if (visible) {
      sidebarElement.classList.add("ffc-visible");
      // When opening, re-scan for buttons just in case
      processPageForMissingButtons();
    } else {
      sidebarElement.classList.remove("ffc-visible");
    }
    // Save the state to chrome.storage
    chrome.storage.local.set({ isSidebarVisible: visible });
  };
  
  closeBtn.onclick = () => toggleSidebarVisibility(false);
  
  copyAllBtn.onclick = () => {
    const textarea = document.getElementById("ffc-live-textarea");
    navigator.clipboard.writeText(textarea.value).then(() => {
      copyAllBtn.textContent = "Copied!";
      setTimeout(() => {
        copyAllBtn.textContent = "Copy All Text";
      }, 2000);
    });
  };

  clearBtn.onclick = () => {
    if (confirm(`Are you sure you want to clear all collected fields for this client?`)) {
      chrome.storage.local.set({ [dynamicStorageKey]: [] });
    }
  };
  
  // Check storage to see if the sidebar should be open
  const { isSidebarVisible } = await chrome.storage.local.get({ isSidebarVisible: true }); // Default to true (visible)
  if (isSidebarVisible) {
      toggleSidebarVisibility(true);
  }

  updateSidebarText();
}


// --- SPA NAVIGATION FIX ---
// This code will detect when you navigate within the Xero site
// and will re-initialize the script to find new fields.

let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  // Check if the main part of the URL has changed (e.g., from one return to another)
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    log("URL has changed, re-initializing script for new page content...");

    // A small delay to ensure the new page content has had time to render
    setTimeout(() => {
        // Reset globals that need to be re-discovered
        masterQuestionList = {};
        dynamicStorageKey = null;
        activeConfig = null;
        collectedFieldsCache = [];

        // Run the main initialization function again
        initialize();
    }, 500); // 500ms delay is usually a safe bet
  }
}).observe(document, { subtree: true, childList: true });

async function checkForUpdateNotification() {
  // 1. Check if the profile has a "Free" license
  if (activeConfig.license !== "Free") {
    return;
  }

  // 2. Get the installation date from storage
  const data = await chrome.storage.local.get('installDate');
  if (data.installDate) {
    
    // 3. Calculate the difference in days
    const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
    const timeSinceInstall = Date.now() - data.installDate;

    if (timeSinceInstall < thirtyDaysInMillis) {
      // It has not been 30 days yet. Do nothing.
      return;
    }
  }
  
  const extensionId = chrome.runtime.id;
  // Let's call it "re-install" as requested, but "update" is clearer for users.
  // We'll use "update" in the user-facing text.
  const updateUrl = `https://chrome.google.com/webstore/detail/${extensionId}`;

  const message = `Please <a href="${updateUrl}" target="_blank">update the extension</a> for bug fixes and latest features.`;
  
  
  // Show notification in the sidebar
  const sidebarNotification = document.getElementById('ffc-sidebar-notification');
  if (sidebarNotification) {
    sidebarNotification.innerHTML = message;
    sidebarNotification.style.display = 'block';
  }


  // 4. If it's been over 30 days, show the banner
  if (document.querySelector('.xfc-update-banner')) {
    return; // Banner already exists
  } else {
    const banner = document.createElement('div');
    banner.className = 'xfc-update-banner';
    banner.innerHTML = `
      Thank you for using the Xero Form Collector! To ensure you have the latest features and bug fixes, please update the extension.
      <a href="${updateUrl}" target="_blank" rel="noopener noreferrer">Update Now</a>
    `;

    document.body.prepend(banner);
  }
}


// --- Start the entire process ---
//initialize();

// In content.js

// --- SCRIPT INITIATOR ---
// This waits for the main Xero form view to exist before starting the script.
// This solves the "doesn't run on first load" problem.
function a_better_waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      return resolve(document.querySelector(selector));
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    
    // Failsafe timeout
    setTimeout(() => {
        observer.disconnect();
        resolve(null);
    }, timeout);
  });
}

// Wait for a reliable element that exists on both ITR and CTR forms.
// The div with class "page-content" seems to be a good candidate.
a_better_waitForElement(".page-content", 15000).then(element => {
    if (element) {
        log("Main form container found. Starting initialization.");
        initialize();
    } else {
        log("Main form container not found after 15 seconds. Halting script.");
    }
});