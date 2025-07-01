# YouTube History Recommender

Chrome extension that analyzes your YouTube history to highlight and rank videos based on your preferences.


## Features

- **Smart Highlighting**: Visual indicators on similar videos (green/orange/blue borders, star badges)
- **Background Collection**: Automatically collects recommendations while browsing (default enabled)
- **Auto-Procrastination**: Homepage auto-scroll mode for focused discovery
- **Persistent Storage**: Recommendations accumulate until manually cleared

## Usage

1. Load extension in Chrome developer mode
2. Click "Train Model" to analyze your history (~1500 videos, 12 months)
3. Browse YouTube - see highlighted recommendations automatically
4. Use "Auto-procrastination" on homepage for more discovery
5. View collected recommendations in popup

## Technical

- **Data**: YouTube oEmbed API for title/channel extraction
- **Algorithm**: 70% title similarity + 30% channel preference
- **Architecture**: Vanilla JS, Manifest V3, Chrome Storage API
- **Performance**: Client-side only, rate limited, CSP compliant

<img width="265" alt="image" src="https://github.com/user-attachments/assets/8873902c-2b3e-4768-b8de-33e660aaa486" />

<img width="269" alt="image" src="https://github.com/user-attachments/assets/45dceaa5-5d45-4885-bea3-0703cb9d5a7d" />
