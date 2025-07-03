document.addEventListener('DOMContentLoaded', () => {
    // Cache all DOM elements
    const csvUploadInput = document.getElementById('csv-upload');
    const questionEditor = document.getElementById('question-editor');
    const addRuleBtn = document.getElementById('add-question-rule-btn');
    const saveQuestionsBtn = document.getElementById('save-questions-btn');
    const uploadStatus = document.getElementById('upload-status');
    const saveStatus = document.getElementById('save-status');
    const modal = document.getElementById('add-rule-modal');
    const labelSelect = document.getElementById('field-label-select');
    const manualLabelInput = document.getElementById('manual-label-input');
    const newQuestionsContainer = document.getElementById('new-questions-container');
    const addAnotherQuestionBtn = document.getElementById('add-another-question-btn');
    const saveNewRuleBtn = document.getElementById('save-new-rule-btn');
    const cancelNewRuleBtn = document.getElementById('cancel-new-rule-btn');

    // Function to render the editor from a questions object
    function renderQuestionEditor(questions) {
        questionEditor.innerHTML = '';
        for (const label in questions) {
            questionEditor.appendChild(createRuleElement(label, questions[label]));
        }
    }
    
    // Function to create a single rule element
    function createRuleElement(label, questions) {
        const ruleDiv = document.createElement('div');
        ruleDiv.className = 'question-rule';
        let questionsHtml = questions.map(q => `<input type="text" class="question-input" value="${q.replace(/"/g, '"')}">`).join('');
        ruleDiv.innerHTML = `<button class="delete-rule-btn" title="Delete Rule">×</button><strong>${label}</strong><br>${questionsHtml}`;
        return ruleDiv;
    }

    // Load custom questions from storage on page load
    async function loadCustomQuestions() {
        const data = await chrome.storage.sync.get({ masterQuestionList: {} });
        renderQuestionEditor(data.masterQuestionList);
    }

    // Handle CSV file upload
    csvUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            const text = e.target.result;
            const newMasterList = {};
            // Use a regex to handle CSVs more robustly, splitting on newlines
            const rows = text.split(/\r\n|\n/).slice(1); // .slice(1) to skip header
            rows.forEach(row => {
                if (!row) return;
                const columns = row.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
                const label = (columns[0] || '').trim().replace(/^"|"$/g, '');
                const question = (columns[1] || '').trim().replace(/^"|"$/g, '');
                if (label && question) {
                    if (!newMasterList[label]) newMasterList[label] = [];
                    newMasterList[label].push(question);
                }
            });
            chrome.storage.sync.set({ masterQuestionList: newMasterList }, () => {
                uploadStatus.textContent = `Uploaded ${Object.keys(newMasterList).length} rules!`;
                loadCustomQuestions();
                setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
            });
        };
        reader.readAsText(file);
    });

    // Handle "Add New Rule" button click
    // In options.js

addRuleBtn.addEventListener('click', async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true, url: "*://*.xero.com/*"});  // Only look for Xero tabs

    // If no such tab is found, inform the user and stop.
    if (!activeTab) {
        alert('Could not find an active Xero page. Please navigate to a Xero Tax form and try again.');
        return;
    }

    // Now, we can safely send the message.
    chrome.tabs.sendMessage(activeTab.id, { type: "GET_ALL_LABELS" }, (response) => {
        if (chrome.runtime.lastError) {
            alert('Could not connect to the Xero page. Please reload the page and try again.');
            return;
        }
        if (response && response.labels && response.labels.length > 0) {
            labelSelect.innerHTML = '';
            response.labels.forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                labelSelect.appendChild(option);
            });
            newQuestionsContainer.innerHTML = '<input type="text" class="question-input" placeholder="Question 1">';
            modal.style.display = 'flex';
        } else {
            alert('No field labels were found on the active page.');
        }
    });
});
    
    // Logic for the "Add New Rule" modal
    addAnotherQuestionBtn.addEventListener('click', () => {
        const input = document.createElement('input'); input.type = 'text';
        input.className = 'question-input'; input.placeholder = `Question ${newQuestionsContainer.children.length + 1}`;
        newQuestionsContainer.appendChild(input);
    });
    cancelNewRuleBtn.addEventListener('click', () => modal.style.display = 'none');
    saveNewRuleBtn.addEventListener('click', () => {
        const newLabel = manualLabelInput.value.trim() || labelSelect.value;
        const questions = Array.from(newQuestionsContainer.querySelectorAll('.question-input')).map(input => input.value.trim()).filter(Boolean);
        if (newLabel && questions.length > 0) {
            const existingLabels = Array.from(questionEditor.querySelectorAll('strong')).map(el => el.textContent);
            if (existingLabels.includes(newLabel)) {
                alert(`A rule for "${newLabel}" already exists. Please edit the existing rule.`);
                return;
            }
            questionEditor.appendChild(createRuleElement(newLabel, questions));
            modal.style.display = 'none';
        } else {
            alert('Please provide a field label and at least one question.');
        }
    });

    // Handle saving all changes made in the editor
    saveQuestionsBtn.addEventListener('click', () => {
        const newMasterList = {};
        questionEditor.querySelectorAll('.question-rule').forEach(rule => {
            const label = rule.querySelector('strong').textContent;
            const questions = Array.from(rule.querySelectorAll('.question-input')).map(input => input.value.trim()).filter(Boolean);
            if (questions.length > 0) newMasterList[label] = questions;
        });
        chrome.storage.sync.set({ masterQuestionList: newMasterList }, () => {
            saveStatus.textContent = 'Saved! Reload the Xero page to see changes.';
            setTimeout(() => { saveStatus.textContent = ''; }, 3000);
        });
    });

    // Add a single event listener to the editor for deleting rules
    questionEditor.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-rule-btn')) {
            e.target.parentElement.remove();
        }
    });

    // Initial load of questions
    loadCustomQuestions();
});