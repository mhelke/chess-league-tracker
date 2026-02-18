# Chess League Tracker

> A comprehensive match tracking and analysis platform for Chess.com team leagues

🌐 **Live Site:** [https://1dpmc.chessteamdata.com](https://1dpmc.chessteamdata.com)  
⚠️ **Status:** BETA - Data may be incomplete or unreliable while under active development

---

## 📖 What Is This?

Chess League Tracker is a static website that automatically tracks and displays team match data for Chess.com clubs. Built for the **1-day-per-move-club**, it provides real-time insights into league standings, match results, and most importantly—registration status to help teams avoid forfeits.

### Key Features

**For Team Admins & Players:**
- 🎯 **Registration Alerts** - Get warned when your team hasn't met minimum player requirements
- 📊 **Rating Analysis** - See board-by-board rating matchups and identify weak spots
- ⚠️ **Smart Warnings** - Visual alerts for forfeit risks, player deficits, and rating disadvantages
- 🏆 **Leaderboards** - Track player performance across all leagues
- ⚖️ **Forfeit Detection** - Automatically identifies completed matches won/lost by forfeit

**Match Intelligence:**
- 📈 **Cohort Analysis** - See how your team stacks up by rating ranges (e.g., 1400-1500, 1500-1600)
- 🎮 **All Matches View** - Filter by status (Open, In Progress, Finished) across all leagues
- 📉 **Board Differentials** - Identify which boards have rating advantages/disadvantages
- ✅ **Success Indicators** - Green banners when registration requirements are met

**Automated & Always Updated:**
- 🔄 Updates nightly via GitHub Actions

### Who Is This For?

- **Chess Team Admins** - Track registrations, avoid forfeits, and avoid rating deficits 
- **Team Players** - See your stats and upcoming matches
- **Other Chess Clubs** - Adapt this for your own club (see instructions below)

---

## 🔧 Technical Overview

### Architecture

This is a **JAMstack** application with three components:

1. **Data Layer** (Python)
   - `scripts/fetch_league_data.py` fetches data from Chess.com Public API
   - Processes matches, calculates ratings, detects registration status
   - Generates static JSON file (`public/data/leagueData.json`)

2. **Frontend** (React + Vite)
   - Single-page application with React Router
   - Reads static JSON from `/data/leagueData.json`
   - No backend server required

3. **Deployment** (GitHub Actions + Pages)
   - Nightly workflow fetches fresh data
   - Builds React app automatically
   - Deploys to GitHub Pages or custom domain

### Tech Stack

**Frontend:**
- React 18.2
- React Router 6.22
- Tailwind CSS 3.4
- Vite 5.1

**Backend/Data:**
- Python 3.11
- Chess.com Public API

**Infrastructure:**
- GitHub Actions
- GitHub Pages

### How It Works

```
┌─────────────────┐
│  GitHub Actions │  ← Runs nightly at 2 AM UTC
│   (Scheduler)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Python Script   │  ← Fetches from Chess.com API
│ fetch_league_   │     Processes 50+ matches
│ data.py         │     Generates JSON (~500KB)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ leagueData.json │  ← Static data file
│ (committed)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Vite Build     │  ← Bundles React app
│  (npm run build)│     Optimizes assets
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GitHub Pages    │  ← Serves static site
│ club.chess...   │     CDN delivery
└─────────────────┘
```

### Data Flow

1. **Fetch**: Script calls `/pub/club/{club_id}/matches` to get match IDs
2. **Process**: For each match, calls `/pub/match/{match_id}` for detailed data
3. **Detect Status**: Maps data arrays (registered/in_progress/finished) to status
4. **Extract Ratings**: Grabs player ratings directly from match endpoint
5. **Output**: Writes JSON with all processed data

### Project Structure

```
chess-league-tracker/
├── .github/workflows/
│   └── update-data.yml          # Nightly automation
├── public/
│   ├── CNAME                     # Custom domain config
│   └── data/
│       └── leagueData.json       # Generated data
├── scripts/
│   └── fetch_league_data.py      # Data fetcher script
├── src/
│   ├── components/
│   │   ├── Leaderboard.jsx       # Table component
│   │   ├── MatchCard.jsx         # Match card with warnings
│   │   └── StatusBadge.jsx       # Status indicators
│   ├── pages/
│   │   ├── Home.jsx              # League overview
│   │   ├── AllMatches.jsx        # Global match view
│   │   ├── LeagueView.jsx        # Single league
│   │   ├── SubLeagueView.jsx     # Sub-league details
│   │   └── GlobalLeaderboard.jsx # Player rankings
│   ├── App.jsx                   # Main app + routing
│   ├── main.jsx                  # React entry point
│   └── index.css                 # Tailwind styles
├── vite.config.js                # Build config
├── tailwind.config.js            # Style config
└── package.json                  # Dependencies
```

### API Usage

**Chess.com Public API:**
- **Club Matches**: `GET /pub/club/{club-id}/matches`
  - Returns: `registered[]`, `in_progress[]`, `finished[]` arrays
- **Match Details**: `GET /pub/match/{match-id}`
  - Returns: Board assignments, player ratings, scores, settings

**Optimizations:**
- ✅ Single API call per match (ratings extracted from match endpoint)
- ✅ 0.5s delay between requests (respects rate limits)
- ✅ Static JSON caching (no API calls from frontend)

### Development Commands

```bash
# Local development
npm run dev              # Start dev server (http://localhost:5173)
npm run build            # Build for production
npm run preview          # Preview production build

# Data fetching
python scripts/fetch_league_data.py  # Fetch latest data
```

---

## 🚀 Use This For Your Own Club

Want to track your own Chess.com club? Here's how to set it up!

### Prerequisites

- GitHub account
- Chess.com club with team matches
- Node.js 18+ and Python 3.11+ (for local development)

### Step 1: Fork & Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR-USERNAME/chess-league-tracker.git
cd chess-league-tracker

# Install dependencies
npm install
```

### Step 2: Configure Your Club

Edit `scripts/fetch_league_data.py` and change these settings:

```python
# Line 8-10: Change to your club's ID
CLUB_ID = "your-club-id-here"  # From chess.com/club/your-club-id

# Line 13-15: Define your league prefixes
LEAGUE_PREFIXES = ["YOUR", "LEAGUE", "PREFIXES"]
# Example: If matches are titled "ML Summer League R1", use ["ML"]
```

**Finding Your League Prefixes:**

This project parses match titles using a simple, consistent pattern so it can map a title to a `league`, `subLeagueName`, and `round`.

Example pattern and mapping:

```text
"ML Division A R1"
  ^  ^         ^
  |  |         +-- Round token (e.g. R1) — used as the `round` identifier
  |  +------------ Sub-league name (e.g. Division A) — used as `subLeagueName`
  +--------------- League prefix (e.g. ML) — used to map to the `league` key
```

What is used:
- **League prefix** (first token): mapped to a top-level league key (e.g. `ML` → `1WL` or similar)
- **Sub-league text** (middle tokens): everything between the prefix and the round token becomes `subLeagueName`
- **Round token** (tail token like `R1`, `Round-1`, etc.): parsed as the `round` label

Notes and examples:
- "ML Division A R1" → League: `ML`, Sub-league: `Division A`, Round: `R1`
- "1WL summer league R2" → League: `1WL`, Sub-league: `summer league`, Round: `R2`
- Titles that do not follow the prefix + sub-league + round pattern will be ignored by the league matcher (or require adding a new `LEAGUE_PREFIXES` entry).

If your club uses a different naming convention, update `LEAGUE_PREFIXES` in `scripts/fetch_league_data.py` and ensure match titles consistently place the prefix first.

### Step 3: Configure Deployment

Choose GitHub Pages or configure a custom domain

### Step 4: Initial Deploy

```bash
# Test locally first
python scripts/fetch_league_data.py      # Fetch your club's data
npm run dev                       # Verify it looks good

# Push to GitHub
git add .
git commit -m "Configure for my club"
git push origin main
```

GitHub Actions will automatically:
1. Fetch your club's data
2. Build the React site
3. Deploy to GitHub Pages

Visit your site at:
- GitHub Pages: `https://YOUR-USERNAME.github.io/chess-league-tracker/`

### Step 5: Customize (Optional)

**Change Colors:**

Edit `tailwind.config.js`:
```javascript
colors: {
  'chess-dark': '#312e2b',    // Dark brown
  'chess-light': '#eeeed2',   // Light beige
  'chess-green': '#769656',   // Green
}
```

**Change Update Schedule:**

Edit `.github/workflows/update-data.yml`:
```yaml
schedule:
  - cron: '0 2 * * *'  # 2 AM UTC daily
```

### Troubleshooting

**No data showing:**
- Check GitHub Actions tab for errors
- Verify CLUB_ID matches your chess.com club URL
- Ensure club has league matches with consistent titles

**Wrong matches showing:**
- Update LEAGUE_PREFIXES to match your match titles
- Prefixes are case-sensitive
- The data displayed depends on how the match titles are structured 

**Need more help?** See contact info below!

---

## 💬 Get Help or Request a Custom Instance

Don't want to set it up yourself? I can help!

**Contact me on Chess.com:**  
👤 **[@MasterMatthew52](https://www.chess.com/member/mastermatthew52)**

I'm happy to:
- Answer technical questions
- Help troubleshoot your setup
- Create a custom hosted instance for your club
- Add new features or customizations

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

This project is free and open source. Use it, modify it, share it!

## 🤝 Contributing

Contributions welcome! Feel free to:
- Submit bug reports or feature requests (GitHub Issues)
- Open pull requests with improvements
- Share how you're using this for your club

**Please note:** this repository is configured for the _1 Day Per Move Club_ and reflects that team's needs. Contributions that broadly benefit the project are welcome; however, I may decline or redirect requests that are specific to other clubs.

### Development Guidelines

- Follow existing code style (React hooks, Tailwind utilities)
- Test locally before submitting PRs
- Update README if adding features
- Keep API calls efficient

## 🙏 Credits

- **Chess.com** Public API

---

♟️ Made for the Chess.com community