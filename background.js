let isEnabled = false;
let filterCategory = "";
let filterTags = "";

chrome.storage.sync.get(["isEnabled", "filterCategory", "filterTags"], function(data) {
  isEnabled = data.isEnabled;
  filterCategory = data.filterCategory;
  filterTags = data.filterTags;
});

chrome.storage.onChanged.addListener(function(changes) {
  if (changes.isEnabled) {
    isEnabled = changes.isEnabled.newValue;
  }
  if (changes.filterCategory) {
    filterCategory = changes.filterCategory.newValue;
  }
  if (changes.filterTags) {
    filterTags = changes.filterTags.newValue;
  }
});

chrome.storage.sync.get(
  {
    isEnabled: false,
    filterCategory: "",
    filterTags: "",
  },
  function (data) {
    isEnabled = data.isEnabled;
		filterCategory = data.filterCategory;
    filterTags = data.filterTags;
  }
);

function checkStreams() {
  if (!isEnabled) return;

  // 1. Fetch registered channels.
  // 2. Use Twitch API to check their streaming status.
  // 3. Filter channels based on category and tags.
  // 4. Open a new tab or window for each channel that started streaming.
}

// Check streams every minute.
setInterval(checkStreams, 60 * 1000);
