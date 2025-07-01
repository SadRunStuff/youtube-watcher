// Popup script for YouTube History Recommender

document.addEventListener('DOMContentLoaded', function() {
  const trainButton = document.getElementById('trainButton');
  const statusMessage = document.getElementById('statusMessage');
  const loading = document.getElementById('loading');
  const procrastinationButton = document.getElementById('procrastinationButton');
  const resultsButton = document.getElementById('resultsButton');
  const clearButton = document.getElementById('clearButton');
  const backgroundRankingCheckbox = document.getElementById('backgroundRankingCheckbox');
  const backgroundInfo = document.getElementById('backgroundInfo');
  
  let vidsOpenedCount = 0; // Track how many videos have been opened

  // Load initial status
  updateStatus();
  checkHomePage();
  checkProcrastinationResults();
  checkBackgroundRankingStatus();

  // Handle train button click
  trainButton.addEventListener('click', function() {
    trainModel();
  });

  // Handle procrastination button click
  procrastinationButton.addEventListener('click', function() {
    startAutoProcrastination();
  });

  // Handle results button click
  resultsButton.addEventListener('click', function() {
    showProcrastinationResults();
  });

  // Handle clear button click
  clearButton.addEventListener('click', function() {
    clearRecommendations();
  });

  // Handle background ranking checkbox
  backgroundRankingCheckbox.addEventListener('change', function() {
    toggleBackgroundRanking(this.checked);
  });

  async function updateStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
      
      if (response.isTraining) {
        const progress = response.progress;
        const progressPercent = Math.round((progress.processed / progress.total) * 100);
        const timeLeftMin = Math.round(progress.estimatedTimeLeft / 60);
        
        statusMessage.innerHTML = `
          <strong>🔄 Training in Progress</strong><br>
          ${progress.processed}/${progress.total} videos (${progressPercent}%)<br>
          <small>Est. ${timeLeftMin}m remaining</small>
        `;
        trainButton.disabled = true;
        trainButton.textContent = 'Training...';
        loading.classList.add('show');
      } else if (response.trained) {
        statusMessage.innerHTML = `
          <strong>✓ Model Ready</strong><br>
          ${response.message}<br>
          <small>Last trained: ${response.lastTrained}</small>
        `;
        trainButton.disabled = false;
        trainButton.textContent = 'Retrain Model';
        loading.classList.remove('show');
      } else {
        statusMessage.innerHTML = `
          <strong>⚠ Not Trained</strong><br>
          ${response.message}
        `;
        trainButton.disabled = false;
        trainButton.textContent = 'Train Model';
        loading.classList.remove('show');
      }
    } catch (error) {
      statusMessage.innerHTML = `
        <strong>❌ Error</strong><br>
        Failed to get status: ${error.message}
      `;
      trainButton.disabled = false;
      loading.classList.remove('show');
    }
  }

  async function trainModel() {
    // Show loading state
    trainButton.disabled = true;
    loading.classList.add('show');
    statusMessage.innerHTML = `
      <strong>🔄 Training...</strong><br>
      Analyzing your YouTube history. This may take a few minutes.
    `;

    try {
      const response = await chrome.runtime.sendMessage({ action: 'trainModel' });
      
      if (response.success) {
        statusMessage.innerHTML = `
          <strong>✅ Training Complete!</strong><br>
          Your model has been updated. Browse YouTube to see recommendations.
        `;
        
        // Update status after a short delay
        setTimeout(updateStatus, 1000);
      } else {
        statusMessage.innerHTML = `
          <strong>❌ Training Failed</strong><br>
          ${response.error || 'Unknown error occurred'}
        `;
      }
    } catch (error) {
      statusMessage.innerHTML = `
        <strong>❌ Training Failed</strong><br>
        ${error.message}
      `;
    } finally {
      // Hide loading state
      trainButton.disabled = false;
      loading.classList.remove('show');
    }
  }

  // Check if we're on homepage for procrastination feature
  async function checkHomePage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('youtube.com')) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'isHomePage' });
        if (response && response.isHomePage) {
          procrastinationButton.disabled = false;
          procrastinationButton.title = 'Auto-scroll and rank YouTube recommendations by your interests';
        }
      }
    } catch (error) {
      console.log('Could not check homepage status');
    }
  }

  // Start auto-procrastination
  async function startAutoProcrastination() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'startAutoProcrastination' });
      
      if (response && response.success) {
        procrastinationButton.textContent = 'Running...';
        procrastinationButton.disabled = true;
        window.close(); // Close popup so user can see the page
      } else {
        alert('Failed to start auto-procrastination');
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }

  // Check for previous procrastination results
  async function checkProcrastinationResults() {
    try {
      const result = await chrome.storage.local.get(['procrastinationResults', 'lastProcrastinationTime', 'vidsOpenedCount']);
      if (result.procrastinationResults && result.procrastinationResults.length > 0) {
        resultsButton.style.display = 'block';
        const time = new Date(result.lastProcrastinationTime).toLocaleTimeString();
        resultsButton.textContent = `Show ${result.procrastinationResults.length} Best Recommendations`;
        
        // Show vids button and clear button
        clearButton.style.display = 'block';
        vidsOpenedCount = result.vidsOpenedCount || 0;
      } else {
        clearButton.style.display = 'none';
      }
    } catch (error) {
      console.log('Could not check procrastination results');
    }
  }

  // Clear all procrastination recommendations
  async function clearRecommendations() {
    try {
      await chrome.storage.local.remove(['procrastinationResults', 'lastProcrastinationTime', 'vidsOpenedCount']);
      
      // Notify content script to clear its collected videos
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.url && tab.url.includes('youtube.com')) {
          await chrome.tabs.sendMessage(tab.id, { action: 'clearRecommendations' });
        }
      } catch (error) {
        console.log('Could not notify content script to clear recommendations');
      }
      
      // Hide buttons
      clearButton.style.display = 'none';
      resultsButton.style.display = 'none';
      resultsButton.textContent = `Show Recommendations`;
      // Reset background info
      updateBackgroundInfo(backgroundRankingCheckbox.checked, 0);
      
      console.log('Recommendations cleared');
    } catch (error) {
      alert('Error clearing recommendations: ' + error.message);
    }
  }

  // Check background ranking status
  async function checkBackgroundRankingStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('youtube.com')) {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getBackgroundRankingStatus' });
        if (response) {
          backgroundRankingCheckbox.checked = response.enabled;
          updateBackgroundInfo(response.enabled, response.collectedCount);
        }
      }
    } catch (error) {
      console.log('Could not check background ranking status');
    }
  }

  // Toggle background ranking
  async function toggleBackgroundRanking(enabled) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.url && tab.url.includes('youtube.com')) {
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'toggleBackgroundRanking', 
          enabled 
        });
        if (response && response.success) {
          updateBackgroundInfo(enabled, 0);
          // Refresh other statuses
          setTimeout(() => {
            checkProcrastinationResults();
            checkBackgroundRankingStatus();
          }, 500);
        }
      }
    } catch (error) {
      console.log('Could not toggle background ranking:', error);
    }
  }

  // Update background info text
  function updateBackgroundInfo(enabled, collectedCount) {
    if (enabled) {
      backgroundInfo.textContent = 'Automatically collecting recommendations...';
      if (collectedCount > 0) {
        resultsButton.style.display = 'block';
      } else {
        resultsButton.style.display = 'none';
      }
    } else {
      backgroundInfo.textContent = 'Background ranking disabled';
    }
  }

  // Show procrastination results in modal
  async function showProcrastinationResults() {
    try {
      const result = await chrome.storage.local.get(['procrastinationResults']);
      const videos = result.procrastinationResults || [];
      
      // Create modal
      const modal = document.createElement('div');
      modal.className = 'results-modal';
      modal.innerHTML = `
        <div class="results-content">
          <div class="results-header">
            <h3>Ranked Video Recommendations (${videos.length})</h3>
            <button class="close-button">×</button>
          </div>
          <div class="results-list" style="font-size: 8px;">
            ${videos.map((video, index) => `
              <a href="${video.url}" target="_blank" class="video-item">
                <div class="video-title">${index + 1}. ${video.title}</div>
                <div class="video-meta">${video.channel} • ${Math.round(video.score * 100)}% match</div>
              </a>
            `).join('')}
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Add close button event listener
      const closeButton = modal.querySelector('.close-button');
      closeButton.addEventListener('click', () => {
        modal.remove();
      });
      
      // Close on background click
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          modal.remove();
        }
      });
      
    } catch (error) {
      alert('Error loading results: ' + error.message);
    }
  }

  // Refresh status more frequently during training
  setInterval(updateStatus, 2000);
  
  // Refresh homepage status and results
  setInterval(() => {
    checkHomePage();
    checkProcrastinationResults();
    checkBackgroundRankingStatus();
  }, 5000);
});

console.log('YouTube History Recommender popup loaded'); 