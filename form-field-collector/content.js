// =========================================================================
//                  XERO FORM COLLECTOR - content.js (FINAL STABLE BUILD)
// =========================================================================

// --- GLOBALS ---
let DEBUG_MODE = false;
const log = (...args) => { if (DEBUG_MODE) console.log("XFC DEBUG:", ...args); };
let sidebarInjected = false;
let sidebarElement = null;
let collectedFieldsCache = [];
let dynamicStorageKey = null;
let isSelfTrigger = false;

// --- Hardcoded Selectors for maximum reliability on Xero Tax ---
const SELECTORS = {
    pageTitle: "span.dfPgT.xui-text-emphasis",
    fieldLabel: "span.questionText, [data-type='questionheading']",
    fieldContainer: ".question.LPitW",
    clientName: "a.xui-text-decoration-none.xui-margin-left-large"
};

/**
 * Main initialization function. All logic flows from here.
 */
async function initialize() {
    log("Initializing Xero Form Collector...");
    
    // 1. Wait for the client name element to exist
    const clientNameElement = await waitForElement(SELECTORS.clientName);
    if (clientNameElement) {
        const clientName = clientNameElement.textContent.trim().replace(/&/g, 'and').replace(/\s+/g, '_');
        dynamicStorageKey = `collectedFields_${clientName}`;
    } else {
        dynamicStorageKey = 'collectedFields_default';
    }
    log(`Using storage key: "${dynamicStorageKey}"`);
    
    // 2. Load data and setup listeners
    const data = await chrome.storage.local.get([dynamicStorageKey]);
    collectedFieldsCache = data[dynamicStorageKey] || [];
    
    setupListeners();
    
    // 3. Inject UI and run the first scan
    await injectSidebar();
    if (sidebarElement) {
        sidebarElement.classList.add('ffc-visible');
    }
    
    processPageForMissingButtons();
    
    // 4. Start observing for page changes
    const observerTarget = document.getElementById('form-view') || document.body;
    const observer = new MutationObserver(() => {
        if (isSelfTrigger) return;
        let debounceTimer;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            log("XFC: Page changed, re-scanning for buttons...");
            processPageForMissingButtons();
        }, 300);
    });
    observer.observe(observerTarget, { childList: true, subtree: true });
}

/**
 * Sets up the master event listeners for the script.
 */
function setupListeners() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && dynamicStorageKey && changes[dynamicStorageKey]) {
            log("XFC: Storage changed, updating UI.");
            isSelfTrigger = true;
            collectedFieldsCache = changes[dynamicStorageKey].newValue || [];
            updateAllButtonStates();
            updateSidebarText();
            setTimeout(() => { isSelfTrigger = false; }, 100);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "TOGGLE_SIDEBAR") {
            if (sidebarElement) {
                sidebarElement.classList.toggle('ffc-visible');
            }
        }
        // This is needed for the popup to get the current client's data
        if (request.type === "GET_ACTIVE_CLIENT_KEY") {
            sendResponse({ activeKey: dynamicStorageKey });
        }
        return true; // Acknowledge message was received
    });
}

// =========================================================================
// CORE FUNCTIONS
// =========================================================================

function waitForElement(selector, timeout = 7000) {
    return new Promise((resolve) => {
        const element = document.querySelector(selector);
        if (element) return resolve(element);
        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(el);
            }
        });
        const timer = setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

function findValueElementForLabel(labelElement) {
    const container = labelElement.closest(SELECTORS.fieldContainer);
    if (!container) return null;
    // Prioritize visible elements over hidden inputs
    const customDropdownButton = container.querySelector('.xui-select--control, .xui-picklist--button');
    if (customDropdownButton) return customDropdownButton.querySelector('span, div') || customDropdownButton;
    const standardInput = container.querySelector('input[type="text"], input:not([type]), textarea');
    if (standardInput) return standardInput;
    const checkedRadio = container.querySelector('input[type="radio"]:checked');
    if (checkedRadio) return checkedRadio.nextElementSibling;
    const selectElement = container.querySelector('select');
    if (selectElement) return selectElement;
    const readOnlyLabel = container.querySelector('label.mnIQk');
    if (readOnlyLabel) return readOnlyLabel;
    return null; // Return null if no specific value element is found
}

function findCurrentPageTitle(element) {
    const allTitles = document.querySelectorAll(SELECTORS.pageTitle);
    let lastSeenTitle = 'Unknown Section';
    for (const title of allTitles) {
        if (element.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_PRECEDING) {
            lastSeenTitle = title.textContent.trim();
        } else {
            break;
        }
    }
    return lastSeenTitle;
}

function createCollectorButton(labelElement) {
    if (!dynamicStorageKey) return;
    const labelText = labelElement.textContent.trim();
    const button = document.createElement('button');
    button.className = 'form-field-collector-btn';
    button.title = 'Add/Remove this field';
    button.dataset.ffcLabel = labelText;
    labelElement.style.position = 'relative';
    labelElement.appendChild(button);

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pageTitle = findCurrentPageTitle(labelElement);
        const valueElement = findValueElementForLabel(labelElement);
        let value = 'N/A';
        if (valueElement) {
            const tagName = valueElement.tagName.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                value = valueElement.value;
            } else {
                value = valueElement.textContent.trim();
            }
        }
        let currentFields = [...collectedFieldsCache];
        const existingIndex = currentFields.findIndex(f => f.label === labelText);
        if (existingIndex > -1) {
            currentFields.splice(existingIndex, 1);
        } else {
            currentFields.push({
                id: Date.now(),
                pageTitle: pageTitle,
                label: labelText,
                value: value
            });
        }
        chrome.storage.local.set({ [dynamicStorageKey]: currentFields });
    });
}

function updateAllButtonStates() {
    const allButtons = document.querySelectorAll('.form-field-collector-btn');
    allButtons.forEach(button => {
        const labelText = button.dataset.ffcLabel;
        if (!labelText) return;
        const isCollected = collectedFieldsCache.some(field => field.label === labelText);
        button.innerHTML = isCollected ? '✓' : '→';
        if (isCollected) {
            button.classList.add('collected');
        } else {
            button.classList.remove('collected');
        }
    });
}

function processPageForMissingButtons() {
    const targetNode = document.getElementById('form-view') || document.body;
    const potentialLabels = targetNode.querySelectorAll(SELECTORS.fieldLabel);
    potentialLabels.forEach(label => {
        const textElement = label.matches('span.questionText') ? label : label.querySelector('.questionText');
        if (textElement && !textElement.querySelector('.form-field-collector-btn')) {
            createCollectorButton(textElement);
        }
    });
    updateAllButtonStates();
}

// =========================================================================
// SIDEBAR LOGIC
// =========================================================================
function injectSidebar() {
    return new Promise((resolve) => {
        if (sidebarInjected) {
            resolve();
            return;
        }
        sidebarInjected = true;
        fetch(chrome.runtime.getURL("sidebar.html"))
            .then(e => e.text())
            .then(html => {
                document.body.insertAdjacentHTML("beforeend", html);
                sidebarElement = document.getElementById("ffc-sidebar");
                initializeSidebarLogic();
                resolve();
            })
            .catch(e => {
                console.error("XFC ERROR: Failed to inject sidebar.", e);
                resolve();
            });
    });
}

function updateSidebarText() {
    const textarea = document.getElementById('ffc-live-textarea');
    if (!textarea) return;
    let formattedBody = '';
    let currentPage = null;
    collectedFieldsCache.forEach(field => {
        if (field.pageTitle !== currentPage) {
            if (currentPage !== null) formattedBody += '\n';
            formattedBody += `${field.pageTitle}\n`;
            currentPage = field.pageTitle;
        }
        formattedBody += `- ${field.label}: ${field.value}\n`;
    });
    textarea.value = formattedBody.trim();
}

function initializeSidebarLogic() {
    const clearBtn = document.getElementById('ffc-clear-all-btn');
    const closeBtn = document.getElementById('ffc-close-btn');
    const copyAllBtn = document.getElementById('ffc-copy-all-btn');
    if (!closeBtn || !copyAllBtn) return;
    closeBtn.onclick = () => sidebarElement.classList.remove('ffc-visible');
    copyAllBtn.onclick = () => {
        const textarea = document.getElementById('ffc-live-textarea');
        navigator.clipboard.writeText(textarea.value).then(() => {
            copyAllBtn.textContent = 'Copied!';
            setTimeout(() => { copyAllBtn.textContent = 'Copy All Text'; }, 2000);
        });
    };
    clearBtn.onclick = () => {
        if (confirm(`Are you sure you want to clear all collected fields for this client?`)) {
            chrome.storage.local.set({ [dynamicStorageKey]: [] });
        }
    };
    updateSidebarText();
}

// --- Start the entire process ---
// Only run the script if we're on a Xero page to be safe and efficient.
if (window.location.hostname.includes('.xero.com')) {
    initialize();
}