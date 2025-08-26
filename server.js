// server.js

// ... (keep all the top-level requires the same)
const ODDS_API_KEY = process.env.ODDS_API_KEY;

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ADD THIS TEAM NAME MAP NEAR THE TOP OF YOUR FILE
const teamNameMap = {
    // Odds API Name : Baseball-Reference Name
    "Arizona D'Backs": "Arizona Diamondbacks",
    "Los Angeles Angels of Anaheim": "Los Angeles Angels",
    // Add any other mismatches you find here.
    // If names match, you don't need an entry. E.g., "Boston Red Sox": "Boston Red Sox" is not needed.
};

// ... (all your scraping functions like scrapeMLBStandings, getMLBOdds, etc., remain exactly the same) ...


// --- API Endpoints ---
// ... (your app.get('/') endpoint remains the same) ...

app.get('/predictions', async (req, res) => {
    // ... (the top part of this function is the same)
    
    try {
        const [standingsData, games, probablePitchers] = await Promise.all([
            // ... (this Promise.all remains the same)
        ]);

        // ... (the 'if (!games)' check is the same)

        const predictions = await Promise.all(games.map(async (game) => {
            const homeTeam = game.home_team;
            const awayTeam = game.away_team;
            
            // --- THIS IS THE MODIFIED LOGIC ---
            // Use the map to get the correct name for lookup. If not in map, use original name.
            const mappedHomeTeam = teamNameMap[homeTeam] || homeTeam;
            const mappedAwayTeam = teamNameMap[awayTeam] || awayTeam;

            const homeStats = standingsData[mappedHomeTeam];
            const awayStats = standingsData[mappedAwayTeam];
            // --- END OF MODIFIED LOGIC ---

            if (!homeStats || !awayStats) {
                // This message will now appear less often
                return { game: `${awayTeam} @ ${homeTeam}`, error: "Could not find team stats for this matchup." };
            }

            // ... (the rest of the function continues exactly as before)
            const homePitcherName = probablePitchers[mappedHomeTeam] || 'N/A';
            const awayPitcherName = probablePitchers[mappedAwayTeam] || 'N/A';
            
            // ...

        }));

        res.json(predictions);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ... (app.listen remains the same)
