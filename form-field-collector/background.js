// background.js

// This function runs only once, when the extension is first installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  
  // We use chrome.storage.sync.get to check if our settings already exist.
  // This prevents us from overwriting user's custom settings on every update.
  chrome.storage.sync.get(
    ['masterQuestionList', 'activeProfileIndex', 'debugMode'], 
    (data) => {
      // If a setting is 'undefined', it means this is a fresh install.
      
      if (data.masterQuestionList === undefined) {
        // The user has no custom questions yet, so we store an empty object.
        chrome.storage.sync.set({ masterQuestionList: {} });
        console.log("Initialized empty custom question list.");
      }

      if (data.activeProfileIndex === undefined) {
        // Set the default active profile to the first one in sites.json (Xero Tax Return Form).
        chrome.storage.sync.set({ activeProfileIndex: 0 });
        console.log("Set default active profile to index 0.");
      }

      if (data.debugMode === undefined) {
        // Debug mode is off by default for production.
        chrome.storage.sync.set({ debugMode: true });
      }
    }
  );

  console.log('Xero Form Collector has been installed and defaults are set.');
});