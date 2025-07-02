// =========================================================================
//            XERO FORM COLLECTOR - content.js (FINAL CONFIGURABLE & STABLE)
// =========================================================================

// --- GLOBALS ---
let DEBUG_MODE = false;
const log = (...args) => { if (DEBUG_MODE) console.log("XFC DEBUG:", ...args); };
let sidebarInjected = false;
let sidebarElement = null;
let collectedFieldsCache = [];
let masterQuestionList = {}; // This will hold the final MERGED list
let debounceTimer;
let isSelfTrigger = false;
let siteConfigs = [];
let activeConfig = null;
let dynamicStorageKey = null;

/**
 * Main initialization function. All logic flows from here.
 */
async function initialize() {
    // Load sync settings first to get the debug flag
    const settings = await chrome.storage.sync.get({ masterQuestionList: {}, debugMode: false, activeProfileIndex: 0 });
    DEBUG_MODE = settings.debugMode;
    log("Initializing Xero Form Collector...");
    
    // 1. Fetch site configurations from the extension package
    try {
        const response = await fetch(chrome.runtime.getURL('sites.json'));
        siteConfigs = await response.json();
    } catch (e) {
        console.error("XFC CRITICAL: Could not load sites.json. The extension cannot function.", e);
        return;
    }
    
    // 2. Find the active profile for the current URL
    const currentURL = window.location.href;
    // We use the index from sync storage to let the user choose the profile
    activeConfig = siteConfigs[settings.activeProfileIndex];
    
    // 3. THE CRITICAL FIX: Check if the current page URL matches the selected profile. If not, do nothing.
    const urlMatchesProfile = activeConfig.matchPatterns.some(pattern => new RegExp(pattern.replace(/\*/g, '.*')).test(currentURL));
    if (!activeConfig || !urlMatchesProfile) {
        log(`Current page "${currentURL}" does not match active profile "${activeConfig.name}". Extension will remain idle on this page.`);
        return;
    }
    
    log("Auto-selected profile is active on this page:", activeConfig.name);
    
    // 4. Merge default and custom questions
    const customQuestions = settings.masterQuestionList;
    masterQuestionList = { ...(activeConfig.defaultQuestions || {}), ...customQuestions };
    log(`Loaded ${Object.keys(masterQuestionList).length} master questions after merging.`);

    // 5. Determine the client-specific storage key
    if (activeConfig.selectors.clientName) {
        const clientNameElement = await waitForElement(activeConfig.selectors.clientName);
        if (clientNameElement) {
            const clientName = clientNameElement.textContent.trim().replace(/&/g, 'and').replace(/\s+/g, '_');
            dynamicStorageKey = `collectedFields_${clientName}`;
        } else { dynamicStorageKey = 'collectedFields_default'; }
    } else { dynamicStorageKey = 'collectedFields_default'; }
    log(`Using storage key: "${dynamicStorageKey}"`);
    
    // 6. Load data and start the extension
    const data = await chrome.storage.local.get([dynamicStorageKey]);
    collectedFieldsCache = data[dynamicStorageKey] || [];
    await injectSidebar();
    if (sidebarElement) {
        sidebarElement.classList.add('ffc-visible');
    }
    
    setupListeners();
    processPageForMissingButtons();
    
    const observerTarget = document.getElementById('form-view') || document.body;
    const observer = new MutationObserver(() => {
        if (isSelfTrigger) { return; }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            log("MutationObserver: Checking for new labels.");
            processPageForMissingButtons();
        }, 300);
    });
    observer.observe(observerTarget, { childList: true, subtree: true });
}

function setupListeners() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        // If ANY sync setting changes (master list, debug mode, or profile), re-initialize the script
        if (namespace === 'sync') {
            log("Sync settings changed. Re-initializing script to apply changes.");
            // We need to reload the page to ensure a clean state, as the selectors might change.
            window.location.reload();
        }
        if (namespace === 'local' && dynamicStorageKey && changes[dynamicStorageKey]) {
            isSelfTrigger = true;
            collectedFieldsCache = changes[dynamicStorageKey].newValue || [];
            updateAllButtonStates();
            updateSidebarText();
            setTimeout(() => { isSelfTrigger = false; }, 100);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "TOGGLE_SIDEBAR") {
            injectSidebar().then(() => { if (sidebarElement) { sidebarElement.classList.toggle('ffc-visible'); } });
        }
        if (request.type === "GET_ACTIVE_CLIENT_KEY") {
            sendResponse({ activeKey: dynamicStorageKey });
        }
        return true;
    });
}

// =========================================================================
// CORE & SIDEBAR FUNCTIONS (These are stable and unchanged)
// =========================================================================
function waitForElement(selector, timeout = 7000) { return new Promise((resolve) => { const element = document.querySelector(selector); if (element) return resolve(element); const observer = new MutationObserver(() => { const el = document.querySelector(selector); if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); } }); const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout); observer.observe(document.body, { childList: true, subtree: true }); }); }
function findValueElementForLabel(labelElement) { if (!activeConfig?.selectors) return null; const container = labelElement.closest(activeConfig.selectors.fieldContainer); if (!container) return null; const customDropdownButton = container.querySelector('.xui-select--control, .xui-picklist--button'); if (customDropdownButton) return customDropdownButton.querySelector('span, div') || customDropdownButton; const standardInput = container.querySelector('input[type="text"], input:not([type]), textarea'); if (standardInput) return standardInput; const checkedRadio = container.querySelector('input[type="radio"]:checked'); if (checkedRadio) return checkedRadio.nextElementSibling; const selectElement = container.querySelector('select'); if (selectElement) return selectElement; const readOnlyLabel = container.querySelector('label.mnIQk'); if (readOnlyLabel) return readOnlyLabel; return null; }
function findCurrentPageTitle(element) { if (!activeConfig?.selectors?.pageTitle) return 'Unknown Section'; const allTitles = document.querySelectorAll(activeConfig.selectors.pageTitle); let lastSeenTitle = 'Unknown Section'; for (const title of allTitles) { if (element.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_PRECEDING) { lastSeenTitle = title.textContent.trim(); } else { break; } } return lastSeenTitle; }
function openQuestionPicker(clickedButton, labelText) { let picker = document.getElementById('ffc-question-picker'); if (!picker) { picker = document.createElement('div'); picker.id = 'ffc-question-picker'; document.body.appendChild(picker); } const questions = masterQuestionList[labelText] || masterQuestionList['default'] || ["Please verify."]; picker.innerHTML = `<div id="ffc-question-picker-header"><span>Select a Query</span><button id="ffc-picker-close-btn">×</button></div><ul id="ffc-question-list">${questions.map(q => `<li class="ffc-question-item">${q}</li>`).join('')}</ul>`; const rect = clickedButton.getBoundingClientRect(); picker.style.display = 'block'; picker.style.top = `${window.scrollY + rect.bottom}px`; picker.style.left = `${window.scrollX + rect.left}px`; document.getElementById('ffc-picker-close-btn').onclick = () => picker.style.display = 'none'; document.querySelectorAll('.ffc-question-item').forEach(item => { item.onclick = () => { const selectedQuestion = item.textContent; const pageTitle = findCurrentPageTitle(clickedButton); const valueElement = findValueElementForLabel(clickedButton); let value = 'N/A'; if (valueElement) { const tagName = valueElement.tagName.toLowerCase(); if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') { value = valueElement.value; } else { value = valueElement.textContent.trim(); } } let currentFields = [...collectedFieldsCache]; currentFields = currentFields.filter(f => f.label !== labelText); currentFields.push({ id: Date.now(), pageTitle: pageTitle, label: labelText, value: value, question: selectedQuestion }); chrome.storage.local.set({ [dynamicStorageKey]: currentFields }); picker.style.display = 'none'; }; }); }
function createCollectorButton(labelElement) { if (!dynamicStorageKey) return; const labelText = labelElement.textContent.trim(); const button = document.createElement('button'); button.className = 'form-field-collector-btn'; button.title = 'Add/Remove this field'; button.dataset.ffcLabel = labelText; labelElement.style.position = 'relative'; labelElement.appendChild(button); button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); const isCollected = collectedFieldsCache.some(field => field.label === labelText); if (isCollected) { let currentFields = collectedFieldsCache.filter(f => f.label !== labelText); chrome.storage.local.set({ [dynamicStorageKey]: currentFields }); } else { openQuestionPicker(button, labelText); } }); }
function updateAllButtonStates() { const allButtons = document.querySelectorAll('.form-field-collector-btn'); allButtons.forEach(button => { const labelText = button.dataset.ffcLabel; if (!labelText) return; const isCollected = collectedFieldsCache.some(field => field.label === labelText); if (isCollected) { if (!button.classList.contains('collected')) { button.innerHTML = '✓'; button.classList.add('collected'); } } else { if (button.classList.contains('collected')) { button.innerHTML = '→'; button.classList.remove('collected'); } } }); }
function processPageForMissingButtons() { if (!activeConfig?.selectors?.fieldLabel) { return; } const targetNode = document.getElementById('form-view') || document.body; const potentialLabels = targetNode.querySelectorAll(activeConfig.selectors.fieldLabel); potentialLabels.forEach(label => { const textElement = label.querySelector('.questionText') || label; if (textElement && !textElement.querySelector('.form-field-collector-btn')) { createCollectorButton(textElement); } }); updateAllButtonStates(); }
function injectSidebar() { return new Promise((resolve) => { if (sidebarInjected) { resolve(); return; } sidebarInjected = true; fetch(chrome.runtime.getURL("sidebar.html")).then(e => e.text()).then(e => { document.body.insertAdjacentHTML("beforeend", e); sidebarElement = document.getElementById("ffc-sidebar"); initializeSidebarLogic(); resolve(); }).catch(e => { console.error("XFC ERROR:", e); resolve(); }); }); }
function updateSidebarText() { const textarea = document.getElementById('ffc-live-textarea'); if (!textarea) return; let formattedBody = ''; let currentPage = null; collectedFieldsCache.forEach(field => { if (field.pageTitle !== currentPage) { if (currentPage !== null) formattedBody += '\n'; formattedBody += `${field.pageTitle}\n`; currentPage = field.pageTitle; } formattedBody += `- ${field.label}: ${field.value}\n`; if (field.question) { formattedBody += `  Query: ${field.question}\n`; } }); textarea.value = formattedBody.trim(); }
function initializeSidebarLogic() { const clearBtn = document.getElementById('ffc-clear-all-btn'); const closeBtn = document.getElementById('ffc-close-btn'); const copyAllBtn = document.getElementById('ffc-copy-all-btn'); if (!closeBtn || !copyAllBtn) { return; } closeBtn.onclick = () => sidebarElement.classList.remove('ffc-visible'); copyAllBtn.onclick = () => { const textarea = document.getElementById('ffc-live-textarea'); navigator.clipboard.writeText(textarea.value).then(() => { copyAllBtn.textContent = 'Copied!'; setTimeout(() => { copyAllBtn.textContent = 'Copy All Text'; }, 2000); }); }; clearBtn.onclick = () => { if (confirm(`Are you sure you want to clear all collected fields for this client?`)) { chrome.storage.local.set({ [dynamicStorageKey]: [] }); } }; updateSidebarText(); }

// --- Start the entire process ---
initialize();