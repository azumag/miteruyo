// This content script controls the volume of media elements on Twitch pages

let targetVolume = 100; // Default volume (1-100)

// Function to set volume for all video and audio elements
function setMediaVolume(volume) {
  const volumeValue = volume / 100; // Convert to 0-1 range
  const mediaElements = document.querySelectorAll('video, audio');
  
  mediaElements.forEach(element => {
    element.volume = volumeValue;
  });
}

// Listen for volume setting messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setVolume') {
    targetVolume = message.volume;
    setMediaVolume(targetVolume);
    sendResponse({ success: true });
  }
});

// Set volume on new media elements as they're added to the DOM
const observer = new MutationObserver(mutations => {
  mutations.forEach(mutation => {
    if (mutation.addedNodes) {
      mutation.addedNodes.forEach(node => {
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          node.volume = targetVolume / 100;
        }
      });
    }
  });
});

// Start observing
observer.observe(document, { 
  childList: true, 
  subtree: true 
});

// Set volume on page load
window.addEventListener('load', () => {
  setMediaVolume(targetVolume);
});

// Set volume periodically to override any auto-adjustments by the page
setInterval(() => {
  setMediaVolume(targetVolume);
}, 2000);