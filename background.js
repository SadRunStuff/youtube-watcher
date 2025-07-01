// Background script for YouTube History Recommender
class YouTubeHistoryAnalyzer {
  constructor() {
    this.isTraining = false;
  }

  // Extract video ID from YouTube URL
  extractVideoId(url) {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  // Parse title to extract meaningful words
  parseTitle(title) {
    if (!title) return [];
    
    // Remove common YouTube suffixes and clean title
    const cleanTitle = title
      .replace(/ - YouTube$/, '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Split into words and filter out common words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'how', 'what', 'when', 'where', 'why', 'this', 'that']);
    
    return cleanTitle
      .split(' ')
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  // Fetch YouTube history and build model using oEmbed API
  async trainModel() {
    if (this.isTraining) {
      console.log('Training already in progress');
      return;
    }

    this.isTraining = true;
    const startTime = Date.now();
    
    // Set training state in storage
    await chrome.storage.local.set({ 
      trainingState: { 
        isTraining: true, 
        startTime, 
        processed: 0, 
        total: 0,
        currentVideo: ''
      } 
    });

    console.log('Starting YouTube history analysis...');

    try {
      // Get YouTube history from last 12 months
      const twelveMonthsAgo = Date.now() - (12 * 30 * 24 * 60 * 60 * 1000);
      const historyItems = await chrome.history.search({
        text: 'youtube.com/watch',
        startTime: twelveMonthsAgo,
        maxResults: 5000
      });

      console.log(`Found ${historyItems.length} YouTube history items`);

      const model = {
        titleWords: {},
        channels: {},
        totalVideos: 0,
        lastTrained: Date.now()
      };

      // Update total count
      await chrome.storage.local.set({ 
        trainingState: { 
          isTraining: true, 
          startTime, 
          processed: 0, 
          total: historyItems.length,
          currentVideo: ''
        } 
      });

      // Process each history item using oEmbed API
      for (let i = 0; i < historyItems.length; i++) {
        const item = historyItems[i];
        const videoId = this.extractVideoId(item.url);
        if (!videoId) continue;

        try {
          // Update progress
          await chrome.storage.local.set({ 
            trainingState: { 
              isTraining: true, 
              startTime, 
              processed: i + 1, 
              total: historyItems.length,
              currentVideo: videoId
            } 
          });

          // Use YouTube oEmbed API (no API key required)
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
          const response = await fetch(oembedUrl);
          
          if (!response.ok) {
            console.warn(`oEmbed failed for ${videoId}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const title = data.title || '';
          const channel = data.author_name || '';

          if (title) {
            // Process title words
            const words = this.parseTitle(title);
            words.forEach(word => {
              model.titleWords[word] = (model.titleWords[word] || 0) + 1;
            });

            // Process channel
            if (channel) {
              model.channels[channel] = (model.channels[channel] || 0) + 1;
            }

            model.totalVideos++;
          }

        } catch (error) {
          console.warn(`Failed to process video ${videoId}:`, error);
        }

        // Add small delay to be respectful to YouTube's servers
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Save model and clear training state
      await chrome.storage.local.set({ 
        youtubeModel: model,
        trainingState: { isTraining: false }
      });
      
      console.log(`Training complete! Processed ${model.totalVideos} videos in ${Math.round((Date.now() - startTime) / 1000)}s`);

    } catch (error) {
      console.error('Training failed:', error);
      await chrome.storage.local.set({ trainingState: { isTraining: false } });
    } finally {
      this.isTraining = false;
    }
  }

  // Get current model status including training progress
  async getModelStatus() {
    const result = await chrome.storage.local.get(['youtubeModel', 'trainingState']);
    const model = result.youtubeModel;
    const trainingState = result.trainingState || { isTraining: false };
    
    if (trainingState.isTraining) {
      const elapsed = Math.round((Date.now() - trainingState.startTime) / 1000);
      const avgTimePerVideo = elapsed / Math.max(trainingState.processed, 1);
      const remainingVideos = trainingState.total - trainingState.processed;
      const estimatedTimeLeft = Math.round(avgTimePerVideo * remainingVideos);
      
      return {
        trained: false,
        isTraining: true,
        progress: {
          processed: trainingState.processed,
          total: trainingState.total,
          currentVideo: trainingState.currentVideo,
          elapsed,
          estimatedTimeLeft
        },
        message: `Training in progress... ${trainingState.processed}/${trainingState.total} videos`
      };
    }
    
    if (!model) {
      return { trained: false, message: 'No model found. Click "Train Model" to start.' };
    }

    const lastTrained = new Date(model.lastTrained).toLocaleString();
    return {
      trained: true,
      totalVideos: model.totalVideos,
      lastTrained,
      message: `Model trained with ${model.totalVideos} videos`
    };
  }
}

// Initialize analyzer
const analyzer = new YouTubeHistoryAnalyzer();

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'trainModel') {
    analyzer.trainModel().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'getStatus') {
    analyzer.getModelStatus().then(status => {
      sendResponse(status);
    });
    return true;
  }
});

console.log('YouTube History Recommender background script loaded'); 