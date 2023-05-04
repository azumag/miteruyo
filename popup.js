const channelInput = document.getElementById("channelInput");
const addChannelBtn = document.getElementById("addChannelBtn");
const channelListItems = document.getElementById("channelListItems");
const enableSwitch = document.getElementById("enableSwitch");

// Load the saved values from storage and display them in the UI
chrome.storage.sync.get(
  {
    channels: [],
    isEnabled: false,
  },
  (data) => {
    console.log(data.channels);
    data.channels.forEach((channel) => addChannelToList(channel));
    enableSwitch.checked = data.isEnabled;
  }
);

function addChannelToList(channel) {
  const li = document.createElement('li');
  li.classList.add('channel-item');
  
  const channelNameTag = document.createElement('span');
  channelNameTag.textContent = channel.name;
  li.appendChild(channelNameTag);
  
  const categoriesInput = document.createElement('input');
  categoriesInput.id = channel.name + '|category';
  categoriesInput.type = 'text';
  categoriesInput.placeholder = 'category';
  categoriesInput.value = channel.categoriesFilter;
  li.appendChild(categoriesInput);
  
  const tagsInput = document.createElement('input');
  tagsInput.id = channel.name + '|tag';
  tagsInput.type = 'text';
  tagsInput.placeholder = 'tag';
  tagsInput.value = channel.tagsFilter;
  li.appendChild(tagsInput);

  const saveButton = document.createElement('button');
  saveButton.setAttribute('data-id', channel.name);
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', (event) => {
    const targetButton = event.target;
    const targetChannelName = targetButton.getAttribute('data-id');
    const targetChannel = {
      name: targetChannelName,
    };

    const categoriesInput = document.getElementById(targetChannelName+'|category');
    const tagsInput = document.getElementById(targetChannelName+'|tag');

    targetChannel.categoriesFilter = categoriesInput.value;
    targetChannel.tagsFilter = tagsInput.value;

    saveChannelToList(targetChannel);
  });
  li.appendChild(saveButton);

  const removeButton = document.createElement('button');
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => {
    li.remove();

    chrome.storage.sync.get('channels', (data) => {
      const newChannels = data.channels.filter((c) => c.name !== channel.name);
      chrome.storage.sync.set({ channels: newChannels });
    });
  });
  li.appendChild(removeButton);

  channelListItems.appendChild(li);
}

addChannelBtn.addEventListener("click", async () => {
  const channel = {
    name: channelInput.value.trim(),
    categoriesFilter: '',
    tagsFilter: ''
  }

  if (!channel.name) return;
  if (await duplicatedChannel(channel)) return;

  // Add the new channel to the list
  addChannelToList(channel);

  // Save the new channel to storage
  saveChannelToList(channel);
  
  // Clear the input field
  channelInput.value = "";
});

async function duplicatedChannel(channel) {
  const data = await chrome.storage.sync.get("channels");
  return (data.channels.findIndex((c) => c.name === channel.name) !== -1);
}

function saveChannelToList(channel) {
  chrome.storage.sync.get("channels", (data) => {
    if (Object.keys(data).length === 0) {
      const newChannels = [channel];
      chrome.storage.sync.set({ channels: newChannels });
    } else {
      const index = data.channels.findIndex((c) => c.name === channel.name);

      if (index !== -1) {
        data.channels.splice(index, 1);
      }

      const newChannels = [...data.channels, channel];
      chrome.storage.sync.set({ channels: newChannels });
    }
  });
}

enableSwitch.addEventListener("change", () => {
  // Save the current state of the switch to storage
  chrome.storage.sync.set({ isEnabled: enableSwitch.checked });
});
