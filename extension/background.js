// Clicking the toolbar icon (or pressing Alt+Shift+B) injects the engine into
// the current tab. Injecting again toggles it off.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (err) {
    // chrome:// pages, the Web Store and PDF viewers can't be scripted.
    console.warn('[Build Crew] cannot run on this page:', err.message);
  }
});
