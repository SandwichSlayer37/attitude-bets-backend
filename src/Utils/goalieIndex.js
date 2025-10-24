// Index of goalie metrics from Mongo (Moneypuck historical).
// Expect a collection 'goalies' with docs like: { name, teamAbbr, season, gsax, rollingForm (0..5) ... }

// FIX: Import the new normalizeGoalieName function
const { normalizeGoalieName } = require('./hockeyNormalize'); 

let goalieIndex = new Map();

async function buildGoalieIndex(db) {
    const goalies = await db.collection('nhl_goalie_stats_historical').find({}).toArray();
    goalieIndex.clear();
    
    goalies.forEach(goalie => {
        const normalizedName = normalizeGoalieName(goalie.name); // Use the function here
        const key = String(goalie.playerId);
        const entry = {
            playerId: goalie.playerId,
            name: normalizedName,
            team: goalie.team,
            season: goalie.season,
            gamesPlayed: goalie.games_played,
            gsax: (goalie.xGoals || 0) - (goalie.goals || 0),
        };
        goalieIndex.set(key, entry);
    });

    console.log(`[GOALIE INDEX] ✅ Hydrated ${goalieIndex.size} goalies from nhl_goalie_stats_historical`);
    const sample = Array.from(goalieIndex.values()).slice(0, 3).map(g => `${g.name} (${g.team}) - GSAx: ${g.gsax.toFixed(2)}`);
    console.log('[GOALIE INDEX] Sample data preview:', sample);
}

async function hydrateGoalieIndex(db) {
    console.log('[GOALIE INDEX] Starting hydration from nhl_goalie_stats_historical...');
    try {
        await buildGoalieIndex(db); // Pass the db object down
    } catch (error) {
        console.error('[GOALIE INDEX] 🚨 Failed to build goalie index:', error);
    }
}

module.exports = {
    hydrateGoalieIndex,
    getGoalieIndex: () => goalieIndex,
    findByPlayerId: (playerId) => {
        if (!playerId) return null;
        return goalieIndex.get(String(playerId)); // Ensure we look up by string
    }
};