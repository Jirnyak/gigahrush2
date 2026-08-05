# Reddit 100 Karma PR Execution

Prepared on 2026-06-12.

Following the owner's confirmation that the Reddit account has reached 100 karma, we proceeded with posting the "Gigahrushchevka / Liminal Space" angle across the main indie game subreddits.

## Actions Taken
- Executed `PRCampaign/reddit_post_wave.js` locally on the host machine.
- This script constructed safe, native Reddit submission URLs using `URL parameters` to bypass Shadow DOM issues.
- It successfully opened Google Chrome tabs with pre-filled title and body for the following subreddits:
  - `r/playmygame`
  - `r/indiegames`
  - `r/HorrorGaming`
  - `r/IndieGaming`
- The owner can now review the content, attach the appropriate atmospheric GIF/image, and manually click "Post" to avoid bot/spam filters.

## Notes & Blockers
- **Manual Post Requirement:** The owner must manually verify and submit the posts in the opened tabs.
- **Monitoring:** We need to monitor these 4 subreddits for engagement, AutoModerator removals, and player feedback.

## Next Steps
- Verify that the posts went live and weren't shadowbanned.
- Monitor Reddit analytics and comments.
- Update KPI reach once posts are visible.
