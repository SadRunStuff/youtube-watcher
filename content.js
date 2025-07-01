// Content script for YouTube History Recommender
class YouTubeRecommender {
  constructor() {
    this.model = null;
    this.processedVideos = new Set();
    this.observerActive = false;
    this.autoProcrastinating = false;
    this.collectedVideos = [];
    this.procrastinationUI = null;
    this.totalProcessedCount = 0;
    this.backgroundRanking = true; // Default enabled
    this.backgroundInterval = null;
    this.processedVideosCleanupInterval = null;
    this.init();
  }

  async init() {
    // Load model from storage
    await this.loadModel();
    
    // Load background ranking preference
    await this.loadBackgroundRankingPreference();
    
    // Load existing background results to accumulate with new ones
    await this.loadBackgroundResults();
    
    // Start processing videos
    this.processCurrentVideos();
    
    // Set up observer for dynamic content
    this.setupObserver();
    
    // Start background ranking if enabled
    if (this.backgroundRanking) {
      this.startBackgroundRanking();
    }
  }

  async loadModel() {
    try {
      const result = await chrome.storage.local.get(['youtubeModel']);
      this.model = result.youtubeModel;
      
      if (!this.model) {
        console.log('No YouTube recommendation model found. Train the model first.');
        return;
      }
      
      console.log(`Loaded model with ${this.model.totalVideos} videos`);
    } catch (error) {
      console.error('Failed to load model:', error);
    }
  }

  // Parse title into words (same logic as background script)
  parseTitle(title) {
    if (!title) return [];
    
    const cleanTitle = title
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'how', 'what', 'when', 'where', 'why', 'this', 'that']);
    
    return cleanTitle
      .split(' ')
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  // Calculate similarity score for a video
  calculateSimilarity(videoData) {
    if (!this.model) return 0;

    let titleScore = 0;
    let channelScore = 0;

    // Title similarity based on word frequency
    if (videoData.title) {
      const words = this.parseTitle(videoData.title);
      const totalWords = words.length;
      
      if (totalWords > 0) {
        let matchingWords = 0;
        let totalFrequency = 0;
        
        words.forEach(word => {
          if (this.model.titleWords[word]) {
            matchingWords++;
            totalFrequency += this.model.titleWords[word];
          }
        });
        
        // Score based on percentage of matching words and their frequency
        const matchRatio = matchingWords / totalWords;
        const avgFrequency = totalFrequency / Math.max(matchingWords, 1);
        titleScore = matchRatio * Math.min(avgFrequency / 5, 1); // Cap frequency influence
      }
    }

    // Channel preference
    if (videoData.channel && this.model.channels[videoData.channel]) {
      const channelFreq = this.model.channels[videoData.channel];
      channelScore = Math.min(channelFreq / 10, 1); // Normalize to 0-1
    }

    // Weighted total score
    const totalScore = (titleScore * 0.7) + (channelScore * 0.3);
    return Math.min(totalScore, 1); // Cap at 1
  }

  // Extract video data from DOM element
  extractVideoData(element) {
    const data = {};

    // Extract title
    const titleElement = element.querySelector('#video-title, .ytd-video-meta-block #video-title, h3 a, .video-title');
    data.title = titleElement ? titleElement.textContent.trim() : '';

    // Extract channel
    const channelElement = element.querySelector('.ytd-video-meta-block #text a, .ytd-channel-name a, .yt-simple-endpoint.style-scope.yt-formatted-string');
    data.channel = channelElement ? channelElement.textContent.trim() : '';

    // Extract video ID from link
    const linkElement = element.querySelector('a[href*="/watch?v="]');
    if (linkElement) {
      const match = linkElement.href.match(/[?&]v=([^&]+)/);
      data.videoId = match ? match[1] : '';
    }

    return data;
  }

  // Apply visual highlight to video element
  applyHighlight(element, score) {
    // Remove existing highlights
    element.classList.remove('yhr-match-high', 'yhr-match-medium', 'yhr-match-low');
    const existingBadge = element.querySelector('.yhr-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    let className = '';
    let badgeText = '';
    
    if (score >= 0.6) {
      className = 'yhr-match-high';
      badgeText = '★★★';
    } else if (score >= 0.3) {
      className = 'yhr-match-medium';
      badgeText = '★★';
    } else if (score >= 0.1) {
      className = 'yhr-match-low';
      badgeText = '★';
    }

    if (className) {
      element.classList.add(className);
      
      // Add badge
      const badge = document.createElement('div');
      badge.className = 'yhr-badge';
      badge.textContent = badgeText;
      badge.title = `Similarity: ${Math.round(score * 100)}%`;
      
      // Position badge relative to thumbnail
      const thumbnail = element.querySelector('img, ytd-thumbnail');
      if (thumbnail) {
        const container = thumbnail.closest('div') || thumbnail.parentElement;
        if (container) {
          container.style.position = 'relative';
          container.appendChild(badge);
        }
      }
    }
  }

  // Process all videos on current page
  processCurrentVideos() {
    if (!this.model) return;

    // Common selectors for YouTube video elements
    const videoSelectors = [
      'ytd-video-renderer',
      'ytd-grid-video-renderer', 
      'ytd-rich-item-renderer',
      'ytd-compact-video-renderer'
    ];

    let totalVideos = 0;
    let recommendedVideos = 0;

    videoSelectors.forEach(selector => {
      const videos = document.querySelectorAll(selector);
      totalVideos += videos.length;
      videos.forEach(video => {
        const wasRecommended = this.processVideo(video);
        if (wasRecommended) recommendedVideos++;
      });
    });

    if (totalVideos > 0) {
      console.log(`YouTube Recommender: Found ${recommendedVideos} recommendations out of ${totalVideos} videos on page`);
    }
  }

  // Process individual video element
  processVideo(element) {
    if (!element || this.processedVideos.has(element)) return false;

    const videoData = this.extractVideoData(element);
    if (!videoData.title && !videoData.channel) return false;

    const score = this.calculateSimilarity(videoData);
    if (score > 0.15) { // Only highlight if there's meaningful similarity
      this.applyHighlight(element, score);
      console.log(`Recommended: "${videoData.title}" by ${videoData.channel} (${Math.round(score * 100)}% match)`);
      this.processedVideos.add(element);
      return true;
    }

    this.processedVideos.add(element);
    return false;
  }

  // Set up mutation observer for dynamic content
  setupObserver() {
    if (this.observerActive) return;

    const observer = new MutationObserver((mutations) => {
      let hasNewVideos = false;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is a video or contains videos
            const videoSelectors = 'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer';
            
            if (node.matches && node.matches(videoSelectors)) {
              hasNewVideos = true;
            } else if (node.querySelector) {
              const videos = node.querySelectorAll(videoSelectors);
              if (videos.length > 0) {
                hasNewVideos = true;
              }
            }
          }
        });
      });

      if (hasNewVideos) {
        // Debounce processing
        clearTimeout(this.processingTimeout);
        this.processingTimeout = setTimeout(() => {
          this.processCurrentVideos();
        }, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    this.observerActive = true;
    console.log('YouTube Recommender: Observer active');
  }

  // Check if we're on YouTube homepage
  isHomePage() {
    return window.location.hostname === 'www.youtube.com' && 
           (window.location.pathname === '/' || window.location.pathname === '');
  }

  // Start auto-procrastination mode
  async startAutoProcrastination() {
    if (!this.model || this.autoProcrastinating) return;
    
    this.autoProcrastinating = true;
    this.collectedVideos = [];
    
    // Create overlay UI
    this.createProcrastinationUI();
    
    // Start auto-scrolling and collection
    this.autoProcrastinationLoop();
    
    // Listen for ESC key
    document.addEventListener('keydown', this.handleEscapeKey.bind(this));
    
    console.log('Auto-procrastination mode started');
  }

  // Create the overlay UI elements
  createProcrastinationUI() {
    // Remove existing UI if any
    if (this.procrastinationUI) {
      this.procrastinationUI.remove();
    }

    // Create container
    this.procrastinationUI = document.createElement('div');
    this.procrastinationUI.innerHTML = `
      <div id="yhr-escape-notice" style="
        position: fixed;
        top: 20px;
        left: 20px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
      ">
        Press ESC to stop
      </div>
      
      <div id="yhr-results-panel" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        max-height: 60vh;
        background: white;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        overflow: hidden;
      ">
        <div style="
          background: #f5f5f5;
          padding: 12px 15px;
          border-bottom: 1px solid #ddd;
          font-weight: bold;
          font-size: 14px;
        ">
          <span id="yhr-processed-count">0 videos processed</span><br>
          <span style="font-size: 12px; font-weight: normal; color: #666;">
            Ranked Recommendations: <span id="yhr-count">0</span>
          </span>
        </div>
        <div id="yhr-video-list" style="
          max-height: calc(60vh - 70px);
          overflow-y: auto;
          padding: 8px;
        ">
          <div style="color: #666; text-align: center; padding: 20px;">
            Scanning videos...
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.procrastinationUI);
  }

  // Auto-scroll and collect videos
  async autoProcrastinationLoop() {
    let lastScrollHeight = 0;
    let noNewContentCount = 0;
    this.totalProcessedCount = 0;
    
    while (this.autoProcrastinating) {
      // Process current videos
      this.collectVideosForProcrastination();
      
      // Scroll down
      window.scrollBy(0, window.innerHeight * 0.8);
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if we've reached the bottom or no new content
      const currentScrollHeight = document.documentElement.scrollHeight;
      if (currentScrollHeight === lastScrollHeight) {
        noNewContentCount++;
        if (noNewContentCount >= 3) {
          console.log('Reached end of homepage recommendations');
          break;
        }
      } else {
        noNewContentCount = 0;
        lastScrollHeight = currentScrollHeight;
      }
    }
    
    if (this.autoProcrastinating) {
      this.stopAutoProcrastination();
    }
  }

  // Collect and rank videos for procrastination mode
  collectVideosForProcrastination() {
    const videoSelectors = [
      'ytd-video-renderer',
      'ytd-grid-video-renderer', 
      'ytd-rich-item-renderer'
    ];

    videoSelectors.forEach(selector => {
      const videos = document.querySelectorAll(selector);
      videos.forEach(video => {
        if (this.processedVideos.has(video)) return;
        
        this.totalProcessedCount++;
        const videoData = this.extractVideoData(video);
        if (!videoData.title || !videoData.videoId) {
          this.processedVideos.add(video);
          return;
        }
        
        const score = this.calculateSimilarity(videoData);
        if (score > 0.05) { // Lower threshold for collection mode
          this.collectedVideos.push({
            ...videoData,
            score,
            url: `https://www.youtube.com/watch?v=${videoData.videoId}`
          });
          
          // Sort by score (highest first)
          this.collectedVideos.sort((a, b) => b.score - a.score);
          
          // Keep only top 50 to avoid memory issues
          if (this.collectedVideos.length > 50) {
            this.collectedVideos = this.collectedVideos.slice(0, 50);
          }
        }
        
        this.processedVideos.add(video);
        this.updateProcrastinationUI();
      });
    });
  }

  // Update the procrastination UI with current results
  updateProcrastinationUI() {
    if (!this.procrastinationUI) return;
    
    const processedCountElement = this.procrastinationUI.querySelector('#yhr-processed-count');
    const countElement = this.procrastinationUI.querySelector('#yhr-count');
    const listElement = this.procrastinationUI.querySelector('#yhr-video-list');
    
    processedCountElement.textContent = `${this.totalProcessedCount} videos processed`;
    countElement.textContent = `${this.collectedVideos.length}`;
    
         listElement.innerHTML = this.collectedVideos.map((video, index) => {
       const videoHTML = `
         <div style="
           padding: 8px;
           border-bottom: 1px solid #eee;
           cursor: pointer;
           font-size: 12px;
           line-height: 1.3;
         " data-video-url="${video.url}">
           <div style="font-weight: bold; margin-bottom: 2px;">
             ${index + 1}. ${video.title}
           </div>
           <div style="color: #666; font-size: 11px;">
             ${video.channel} • ${Math.round(video.score * 100)}% match
           </div>
         </div>
       `;
       return videoHTML;
     }).join('');
     
     // Add click event listeners to video items
     const videoItems = listElement.querySelectorAll('[data-video-url]');
     videoItems.forEach(item => {
       item.addEventListener('click', () => {
         window.open(item.dataset.videoUrl, '_blank');
       });
     });
  }

  // Handle ESC key press
  handleEscapeKey(event) {
    if (event.key === 'Escape' && this.autoProcrastinating) {
      this.stopAutoProcrastination();
    }
  }

  // Stop auto-procrastination mode
  stopAutoProcrastination() {
    this.autoProcrastinating = false;
    
    // Remove UI
    if (this.procrastinationUI) {
      this.procrastinationUI.remove();
      this.procrastinationUI = null;
    }
    
    // Remove event listener
    document.removeEventListener('keydown', this.handleEscapeKey.bind(this));
    
    // Store results
    chrome.storage.local.set({ 
      procrastinationResults: this.collectedVideos,
      lastProcrastinationTime: Date.now()
    });
    
    console.log(`Auto-procrastination stopped. Collected ${this.collectedVideos.length} ranked videos.`);
  }

  // Load background ranking preference from storage
  async loadBackgroundRankingPreference() {
    try {
      const result = await chrome.storage.local.get(['backgroundRanking']);
      this.backgroundRanking = result.backgroundRanking !== false; // Default true
    } catch (error) {
      console.error('Failed to load background ranking preference:', error);
    }
  }

  // Start continuous background ranking
  startBackgroundRanking() {
    if (this.backgroundInterval) return;
    
    console.log('Background ranking started');
    this.backgroundInterval = setInterval(() => {
      this.collectBackgroundVideos();
    }, 3000); // Check every 3 seconds
    
    // Clear processedVideos periodically to allow re-processing
    this.processedVideosCleanupInterval = setInterval(() => {
      const oldSize = this.processedVideos.size;
      this.processedVideos.clear();
      if (oldSize > 0) {
        console.log(`Cleared ${oldSize} processed videos to allow re-processing`);
      }
    }, 30000); // Clear every 30 seconds
  }

  // Stop background ranking
  stopBackgroundRanking() {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
      console.log('Background ranking stopped');
    }
    
    if (this.processedVideosCleanupInterval) {
      clearInterval(this.processedVideosCleanupInterval);
      this.processedVideosCleanupInterval = null;
    }
  }

  // Collect videos in background mode
  collectBackgroundVideos() {
    if (!this.model || this.autoProcrastinating) return;

    let videoSelectors;
    
    // Different selectors based on page type
    if (this.isHomePage()) {
      // Homepage selectors
      videoSelectors = [
        'ytd-video-renderer',
        'ytd-grid-video-renderer', 
        'ytd-rich-item-renderer'
      ];
    } else if (this.isVideoPage()) {
      // Video page - collect related/recommended videos
      videoSelectors = [
        'ytd-compact-video-renderer', // Sidebar related videos
        '#related ytd-rich-item-renderer', // Related videos section
        'ytd-video-renderer', // Up next section
        'ytd-rich-item-renderer' // General recommendations
      ];
    } else {
      // Other pages (search, trending, etc.)
      videoSelectors = [
        'ytd-video-renderer',
        'ytd-grid-video-renderer',
        'ytd-rich-item-renderer',
        'ytd-compact-video-renderer'
      ];
    }

    let newVideosFound = 0;

    videoSelectors.forEach(selector => {
      const videos = document.querySelectorAll(selector);
      videos.forEach(video => {
        if (this.processedVideos.has(video)) return;
        
        const videoData = this.extractVideoData(video);
        if (!videoData.title || !videoData.videoId) {
          this.processedVideos.add(video);
          return;
        }
        
        const score = this.calculateSimilarity(videoData);
        if (score > 0.05) {
          // Check if we already have this video in our collection
          const existingVideo = this.collectedVideos.find(v => v.videoId === videoData.videoId);
          if (!existingVideo) {
            this.collectedVideos.push({
              ...videoData,
              score,
              url: `https://www.youtube.com/watch?v=${videoData.videoId}`
            });
            newVideosFound++;
          }
        }
        
        this.processedVideos.add(video);
      });
    });

    if (newVideosFound > 0) {
      // Sort and limit
      this.collectedVideos.sort((a, b) => b.score - a.score);
      if (this.collectedVideos.length > 100) {
        this.collectedVideos = this.collectedVideos.slice(0, 100);
      }

      // Update storage
      this.saveBackgroundResults();
      
      console.log(`Background ranking: Found ${newVideosFound} new videos (total: ${this.collectedVideos.length})`);
    }
  }

  // Check if current page is a video page
  isVideoPage() {
    return window.location.pathname === '/watch' && window.location.search.includes('v=');
  }

  // Save background results to storage
  async saveBackgroundResults() {
    try {
      await chrome.storage.local.set({ 
        procrastinationResults: this.collectedVideos,
        lastProcrastinationTime: Date.now()
      });
    } catch (error) {
      console.error('Failed to save background results:', error);
    }
  }

  // Load existing background results
  async loadBackgroundResults() {
    try {
      const result = await chrome.storage.local.get(['procrastinationResults']);
      if (result.procrastinationResults) {
        this.collectedVideos = result.procrastinationResults;
        console.log(`Loaded ${this.collectedVideos.length} existing recommendations`);
      }
    } catch (error) {
      console.error('Failed to load background results:', error);
    }
  }

  // Toggle background ranking
  async toggleBackgroundRanking(enabled) {
    this.backgroundRanking = enabled;
    
    // Save preference
    try {
      await chrome.storage.local.set({ backgroundRanking: enabled });
    } catch (error) {
      console.error('Failed to save background ranking preference:', error);
    }

    if (enabled) {
      await this.loadBackgroundResults();
      this.startBackgroundRanking();
    } else {
      this.stopBackgroundRanking();
    }
  }
}

// Global instance for message handling
let youtubeRecommender;

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    youtubeRecommender = new YouTubeRecommender();
  });
} else {
  youtubeRecommender = new YouTubeRecommender();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAutoProcrastination') {
    if (youtubeRecommender) {
      youtubeRecommender.startAutoProcrastination();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Recommender not initialized' });
    }
  }
  
  if (request.action === 'isHomePage') {
    const isHome = youtubeRecommender ? youtubeRecommender.isHomePage() : false;
    sendResponse({ isHomePage: isHome });
  }

  if (request.action === 'toggleBackgroundRanking') {
    if (youtubeRecommender) {
      youtubeRecommender.toggleBackgroundRanking(request.enabled);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Recommender not initialized' });
    }
  }

  if (request.action === 'getBackgroundRankingStatus') {
    const status = youtubeRecommender ? {
      enabled: youtubeRecommender.backgroundRanking,
      collectedCount: youtubeRecommender.collectedVideos.length
    } : { enabled: false, collectedCount: 0 };
    sendResponse(status);
  }

  if (request.action === 'clearRecommendations') {
    if (youtubeRecommender) {
      youtubeRecommender.collectedVideos = [];
      youtubeRecommender.processedVideos.clear(); // Clear to allow re-processing
      console.log('Content script: Recommendations cleared');
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Recommender not initialized' });
    }
  }
});

console.log('YouTube History Recommender content script loaded'); 