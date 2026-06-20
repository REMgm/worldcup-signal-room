# World Cup Signal Room

Interactive FIFA World Cup 2026 intelligence dashboard with match rooms, team rooms, fixture filtering, momentum reference plots, news, squad signals, and prediction modeling.

## Data Sources

- `rezarahiminia/worldcup2026` fixture, team, group, and stadium data
- FIFA official squad list parsed into `data/squads-2026.json`
- ESPN public soccer endpoints for live schedule, summaries, odds, broadcasts, news, standings, and team stats
- OpenFootball World Cup JSON cross-checks for schedule validation
- StatsBomb open data for historical match-lab exploration
- Google News RSS for team and match preview wires
- BALLDONTLIE FIFA API is wired through `BALLDONTLIE_API_KEY`, but requires a valid credential

## Local Run

```bash
npm start
```

Then open `http://localhost:4173`.

## Deployment

The app is Vercel-ready through `vercel.json`. It exports the Node request handler from `server.js` for serverless deployment while still running locally as a normal Node server.

Optional production environment variable:

```bash
BALLDONTLIE_API_KEY=your_key_here
```

Do not commit API keys or local `.env` files.
