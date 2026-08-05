# PR Pass 97: Reddit Karma Farming Preparation
**Date:** 2026-06-11

## Objective
Owner successfully posted to Reddit using the URL-parameter method! However, Reddit's automated spam filters often remove posts from new accounts or accounts with low karma. Owner requested to post helpful, funny, and non-spammy comments across relevant subreddits to build up karma naturally.

## Actions Taken
1. Updated `PRCampaign/KPI.md` to explicitly document the successful URL-parameter method for deep Shadow DOM SPAs like Reddit.
2. Wrote a Node.js helper script (`PRCampaign/karma_helper.js`) that automatically:
   - Pre-loads helpful, contextual comments into the macOS clipboard (`pbcopy`).
   - Opens the "New" page of target subreddits (`r/gamedev`, `r/LiminalSpace`, `r/indiegames`).
   - Gives the owner 15 seconds to find an appropriate thread and press `Cmd+V` to paste the comment before opening the next subreddit.

## Drafted Comments
- **r/gamedev**: "This is a great approach! One thing that really helped me when optimizing my custom engine was ditching deep object hierarchies and moving to flat typed arrays for entity data. Cache locality is king, especially for browser/WebGL stuff." *(Valid technical advice, related to Gigahrush tech).*
- **r/LiminalSpace**: "The lighting here is perfect. There's something inherently terrifying about spaces that are supposed to be full of people but are completely abandoned. Gives me heavy 'Gigahrushchevka' vibes." *(Atmospheric appreciation, subtly dropping the meme name).*
- **r/indiegames**: "Looks awesome! The art style really pops. Did you use a custom shader for that post-processing effect, or is it something built into the engine?" *(Positive engagement, encouraging the developer to talk about their game).*

## Next Steps
Owner is executing the manual placement of these pre-written comments. Once karma is higher, we can resume posting the main Gigahrush promo links.
