# Chess League Tracker

> A comprehensive match tracking and analysis platform for Chess.com team leagues

🌐 **Live Sites:**
- [https://1dpmc.chessteamdata.com](https://1dpmc.chessteamdata.com) — 1 Day Per Move Club
- [https://teamusa.chessteamdata.com](https://teamusa.chessteamdata.com) — Team USA

⚠️ **Status:** BETA - Data may be incomplete or unreliable while under active development

---

## 📖 What Is This?

Chess League Tracker is a static website that automatically tracks and displays team match data for Chess.com clubs. It provides real-time insights into league standings, match results, and most importantly—registration status to help teams avoid forfeits.

### Key Features

**For Team Admins & Players:**
- 🎯 **Registration Alerts** - Get warned when your team hasn't met minimum player requirements
- 📊 **Rating Analysis** - See board-by-board rating matchups and identify weak spots
- ⚠️ **Smart Warnings** - Visual alerts for forfeit risks, player deficits, and rating disadvantages
- 🏆 **Leaderboards** - Track player performance across all leagues
- ⚖️ **Forfeit Detection** - Automatically identifies completed matches won/lost by forfeit
- ⏱️ **Timeout Risk Analysis** - Player reliability metrics and timeout risk flags for upcoming matches

**Match Intelligence:**
- 📈 **Cohort Analysis** - See how your team stacks up by rating ranges (e.g., 1400-1500, 1500-1600)
- 🎮 **All Matches View** - Filter by status (Open, In Progress, Finished) across all leagues
- 📉 **Board Differentials** - Identify which boards have rating advantages/disadvantages
- ✅ **Success Indicators** - Green banners when registration requirements are met

**Automated & Always Updated:**
- 🔄 Updates nightly via GitHub Actions

---

## 🔧 Technical Overview

### Architecture

This is a **JAMstack** application with three components:

1. **Data Layer** (Python)
   - `scripts/fetch_league_data.py` fetches data from Chess.com Public API
   - `scripts/enrich_timeouts.py` analyses player timeout history
   - Generates static JSON files into `public/data/<siteKey>/`

2. **Frontend** (React + Vite)
   - React App
   - Reads static JSON from `/data/`
   - No backend server required

3. **Deployment**
   - Each project runs its own build command against the same repo
   - Python scripts run via GitHub Actions and commit the updated data

### Multi-Site Architecture

A single repository powers **multiple independent sites**, each tracking a
different Chess.com club. Every site has its own:

| Concern | Location |
|---|---|
| League patterns & club ID | `config/<siteKey>/league_config.json` |
| Script parameters | `config/<siteKey>/script_params.json` |
| Generated JSON data | `public/data/<siteKey>/` |
| Build command | `npm run build:<siteKey>` |

The frontend source (`src/`) and Python scripts (`scripts/`) are **shared**
across all sites.

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
- GitHub Actions (data generation)
- Cloudflare Pages (hosting)

### Data Flow

```
┌─────────────────┐
│  GitHub Actions  │  ← Runs nightly / on demand
│   (Scheduler)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ python scripts/fetch_league_data.py --site-key 1dpmc    │
│ python scripts/enrich_timeouts.py  --site-key 1dpmc     │
│                                                         │
│ python scripts/fetch_league_data.py --site-key teamusa  │
│ python scripts/enrich_timeouts.py  --site-key teamusa   │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ public/data/     │  ← Static JSON committed to repo
│   1dpmc/         │     leagueData.json, timeoutData.json
│   teamusa/       │     leagueData.json, timeoutData.json
└────────┬────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│ Deploy (two projects)              │
│                                              │
│  Project A: npm run build:1dpmc  → dist/     │
│    Domain:  1dpmc.chessteamdata.com           │
│                                              │
│  Project B: npm run build:teamusa → dist/    │
│    Domain:  teamusa.chessteamdata.com         │
└──────────────────────────────────────────────┘
```

### Project Structure

```
chess-league-tracker/
├── .github/workflows/
│   └── update-data.yml              # Nightly automation
├── config/
│   ├── 1dpmc/
│   │   ├── league_config.json       # Club ID & league patterns
│   │   └── script_params.json       # Timeout thresholds, user agent, etc.
│   └── teamusa/
│       ├── league_config.json
│       └── script_params.json
├── scripts/
│   ├── fetch_league_data.py         # Data fetcher (--site-key required)
│   └── enrich_timeouts.py           # Timeout analysis (--site-key required)
├── config/shared/
│   └── variant_patterns.json        # Shared variant normalization rules
├── public/
│   └── data/
│       ├── 1dpmc/
│       │   ├── leagueData.json      # Generated
│       │   └── timeoutData.json     # Generated
│       └── teamusa/
│           ├── leagueData.json      # Generated
│           └── timeoutData.json     # Generated
├── src/
│   ├── components/
│   │   ├── Leaderboard.jsx
│   │   ├── MatchCard.jsx
│   │   ├── StatusBadge.jsx
│   │   └── TimeoutModal.jsx
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── AllMatches.jsx
│   │   ├── LeagueView.jsx
│   │   ├── SubLeagueView.jsx
│   │   ├── GlobalLeaderboard.jsx
│   │   └── NotFound.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── vite.config.js                   # Multi-site Vite config
├── tailwind.config.js
├── package.json                     # Per-site build scripts
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+** and **npm**
- **Python 3.11+**

### Install Dependencies

```bash
git clone https://github.com/mhelke/chess-league-tracker.git
cd chess-league-tracker
npm install
```

---

## 📦 Generating Data (Python Scripts)

Python scripts are run manually or via GitHub Actions. They are
never executed during the build.

### 1. Fetch League Data

Fetches match data from the Chess.com API for a given site:

```bash
python scripts/fetch_league_data.py --site-key 1dpmc
python scripts/fetch_league_data.py --site-key teamusa
```

- Reads club ID and league patterns from `config/<siteKey>/league_config.json`
- Reads variant normalization rules from `config/shared/variant_patterns.json`
- Writes output to `public/data/<siteKey>/leagueData.json`

### 2. Enrich Timeout Data

Analyses player timeout history and assigns risk levels:

```bash
python scripts/enrich_timeouts.py --site-key 1dpmc
python scripts/enrich_timeouts.py --site-key teamusa
```

 - Reads parameters from `config/<siteKey>/script_params.json`
- Reads input from `public/data/<siteKey>/leagueData.json`
- Writes output to `public/data/<siteKey>/timeoutData.json`

### 3. Commit the Generated JSON

After running the scripts, commit the updated JSON files:

```bash
git add public/data/
git commit -m "Update data for 1dpmc and teamusa"
git push
```

### Environment Variable Overrides

| Variable | Purpose | Default |
|---|---|---|
| `USER_AGENT` | HTTP User-Agent header for Chess.com API requests | `ChessLeagueTracker/1.0` |

---

## 🔧 Per-Site Configuration

### league_config.json

Located at `config/<siteKey>/league_config.json`. Defines which
Chess.com club to track and which league title patterns to match.

```json
{
  "clubId": "1-day-per-move-club",
  "leagues": [
    {"root_pattern": "\\b1WL\\b", "name": "1WL"},
    {"root_pattern": "\\bTCMAC\\b", "name": "TCMAC"},
    {"root_pattern": "\\bTMCL\\b", "name": "TMCL"}
  ]
}
```

| Field | Description |
|---|---|
| `clubId` | Chess.com club identifier (from the club URL) |
| `leagues[].root_pattern` | Regex pattern matched against match titles (case-insensitive) |
| `leagues[].name` | Canonical league name written to the output JSON |

### script_params.json

Located at `config/<siteKey>/script_params.json`. Controls timeout
enrichment thresholds and behaviour.

```json
{
  "riskThresholdPercent": 25.0,
  "leagueTimeoutWindowDays": 90,
  "archiveMaxMonthsBack": 2,
  "userAgent": "ChessLeagueTracker/1.0"
}
```

| Field | Description | Default |
|---|---|---|
| `riskThresholdPercent` | Timeout % above which a player is flagged for archive analysis | `25.0` |
| `leagueTimeoutWindowDays` | Rolling window (days) for league-wide timeout count | `90` |
| `archiveMaxMonthsBack` | Calendar months to look back in the game archive | `2` |
| `userAgent` | User-Agent header sent to Chess.com API | `ChessLeagueTracker/1.0` |

### Shared: variant_patterns.json

Located at `scripts/shared/variant_patterns.json`. Defines regex rules for
normalising inconsistent variant spellings in match titles (e.g. "Chess 960"
→ "Chess960"). Shared across all sites.

```json
[
  ["\\bChess\\s*960\\b", "Chess960"],
  ["\\b960\\b", "Chess960"]
]
```

---

## 🏗️ Building & Running Locally

### Development Server

```bash
npm run dev            # Defaults to 1dpmc
npm run dev:1dpmc      # Explicit
npm run dev:teamusa    # Team USA site
```

Opens at [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
npm run build:1dpmc    # Build 1dpmc site → dist/
npm run build:teamusa  # Build teamusa site → dist/
```

### Preview Production Build

```bash
npm run build:1dpmc
npm run preview        # Serve from dist/ at http://localhost:4173
```

---

## Deployment

Two separate domains pointing to the same repository.

### Project A — 1dpmc

| Setting | Value |
|---|---|
| **Build command** | `npm run build:1dpmc` |
| **Build output directory** | `dist` |
| **Custom domain** | `1dpmc.chessteamdata.com` |

### Project B — teamusa

| Setting | Value |
|---|---|
| **Build command** | `npm run build:teamusa` |
| **Build output directory** | `dist` |
| **Custom domain** | `teamusa.chessteamdata.com` |

Both projects trigger on pushes to the main branch. Because the JSON data is
committed to the repo, no Python or API calls are needed during the build.

---

## ➕ Adding a New Site

Adding support for a new Chess.com club is straightforward:

1. **Create config directory:**
   ```bash
   mkdir -p config/<newSiteKey>
   ```

2. **Add `league_config.json`:**
   ```json
   {
     "clubId": "your-club-id",
     "leagues": [
       {"root_pattern": "\\bYOUR_LEAGUE\\b", "name": "YourLeague"}
     ]
   }
   ```

3. **Add `script_params.json`:**
   ```json
   {
     "riskThresholdPercent": 25.0,
     "leagueTimeoutWindowDays": 90,
     "archiveMaxMonthsBack": 2,
     "userAgent": "ChessLeagueTracker/1.0"
   }
   ```

4. **Create data directory:**
   ```bash
   mkdir -p public/data/<newSiteKey>
   ```

5. **Add build script** to `package.json`:
   ```json
   "build:<newSiteKey>": "vite build --mode <newSiteKey>"
   ```

6. **Generate initial data:**
   ```bash
   python scripts/fetch_league_data.py --site-key <newSiteKey>
   python scripts/enrich_timeouts.py --site-key <newSiteKey>
   ```

7. **Build and Deploy**
   - Build command: `npm run build:<newSiteKey>`
   - Output directory: `dist`

---

## 💬 Get Help or Request a Feature

Don't want to set it up yourself? I can help!

**Contact me on Chess.com:**
👤 **[@MasterMatthew52](https://www.chess.com/member/mastermatthew52)**

I'm happy to:
- Answer technical questions
- Help troubleshoot your setup
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

**Please note:** this repository is configured for my teams and reflects the needs of those teams. Contributions that broadly benefit the project are welcome; however, I may decline or redirect requests that are specific to other clubs.

### Development Guidelines

- Follow existing code style (React hooks, Tailwind utilities)
- Test locally before submitting PRs
- Update README if adding features
- Keep API calls efficient

## 🙏 Credits

- **Chess.com** Public API

---

♟️ Made for the Chess.com community