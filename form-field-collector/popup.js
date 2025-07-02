// popup.js (FINAL, STABLE VERSION)
document.addEventListener('DOMContentLoaded', () => {

    // --- Tab Switching Logic ---
    const tabLinks = document.querySelectorAll('.tab-link');
    const tabContents = document.querySelectorAll('.tab-content');
    tabLinks.forEach(link => {
        link.addEventListener('click', () => {
            tabLinks.forEach(l => l.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            const tabId = link.dataset.tab;
            link.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // --- "Status" Tab Logic ---
    const statusDisplay = document.getElementById('status-display');
    const toggleBtn = document.getElementById('toggle-sidebar-btn');

    async function updateStatus() {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url && activeTab.url.includes('.xero.com')) {
            statusDisplay.innerHTML = `<p>Active on this Xero page.</p>`;
            toggleBtn.disabled = false;
        } else {
            statusDisplay.innerHTML = '<p>Inactive on this page.</p>';
            toggleBtn.disabled = true;
        }
    }

    toggleBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_SIDEBAR" }, (response) => {
                    // This handles a potential error if the content script isn't injected.
                    if (chrome.runtime.lastError) {
                        console.log("Could not send message to content script.");
                    }
                });
                window.close(); // Close the popup immediately
            }
        });
    });

    // --- "Stored Notes" Tab Logic ---
    const clientSelect = document.getElementById('client-select');
    const notesTextarea = document.getElementById('stored-notes-textarea');
    const copyNotesBtn = document.getElementById('copy-notes-btn');

    async function populateStoredNotes() {
        const allItems = await chrome.storage.local.get(null);
        const clientKeys = Object.keys(allItems).filter(key => key.startsWith('collectedFields_'));
        
        clientSelect.innerHTML = '';
        if (clientKeys.length === 0) {
            clientSelect.innerHTML = '<option value="">-- No clients found --</option>';
            return;
        }

        clientKeys.forEach(key => {
            const clientName = key.replace('collectedFields_', '').replace(/_/g, ' ');
            const option = document.createElement('option');
            option.value = key;
            option.textContent = clientName === 'default' ? 'Default (No Client)' : clientName;
            clientSelect.appendChild(option);
        });

        clientSelect.addEventListener('change', () => displayNotesForKey(clientSelect.value, allItems));
        copyNotesBtn.addEventListener('click', () => {
             navigator.clipboard.writeText(notesTextarea.value).then(() => {
                copyNotesBtn.textContent = 'Copied!';
                setTimeout(() => { copyNotesBtn.textContent = 'Copy Notes'; }, 2000);
            });
        });

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_ACTIVE_CLIENT_KEY" }, (response) => {
                if (response && response.activeKey) {
                    clientSelect.value = response.activeKey;
                    displayNotesForKey(response.activeKey, allItems);
                } else if (clientKeys.length > 0) {
                    // Fallback to first client if no response
                    clientSelect.value = clientKeys[0];
                    displayNotesForKey(clientKeys[0], allItems);
                }
            });
        }
    }

    function displayNotesForKey(selectedKey, allItems) {
        if (selectedKey) {
            const clientData = allItems[selectedKey] || [];
            let formattedBody = '';
            let currentPage = null;
            clientData.forEach(field => {
                if (field.pageTitle !== currentPage) {
                    if (currentPage !== null) formattedBody += '\n';
                    formattedBody += `${field.pageTitle}\n`;
                    currentPage = field.pageTitle;
                }
                formattedBody += `- ${field.label}: ${field.value}\n`;
            });
            notesTextarea.value = formattedBody.trim();
            copyNotesBtn.disabled = false;
        } else {
            notesTextarea.value = 'Select a client to view their notes.';
            copyNotesBtn.disabled = true;
        }
    }
    
    // --- Initialize both tabs when the popup opens ---
    updateStatus();
    populateStoredNotes();
});