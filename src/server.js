The code change produced by Gemini cannot be fully applied. Blocks that failed (highlighted below) can be applied manually.
        });
    }

    function uiSafeText(v){ return (v && v !== 'undefined' && v !== 'null') ? String(v) : 'N/A'; }

    function renderGameCard(cardElement, data, sportKey) {
        const { game, prediction } = data;
        const { home_team, away_team, espnData } = game;
        const { winner, strengthText, factors, weather } = prediction;

    }
    
    function generateExplanationHtml(prediction, sportKey) {
    const { factors, historicalDataSeason } = prediction;
    let html = '<div class="space-y-2"><h4 class="font-bold text-center text-white mb-2">Key Factor Breakdown</h4>';

    const renderCategory = (title, factorList) => {
        let categoryHtml = '';
        factorList.forEach(factorName => {
            const data = factors[factorName];
            if (data) {
                let awayStatHtml, homeStatHtml, labelHtml, explanationHtml = '';
                const tooltipText = explanationTooltips[factorName] || '';

                // --- THIS IS THE FIX: Special UI logic for the Goalie Factor ---
                if (factorName === 'Historical Goalie Edge (GSAx)' && (data.awayGoalie || data.homeGoalie)) {
                    const awayGoalie = data.awayGoalie;
                    const homeGoalie = data.homeGoalie;

                    // Build Away Goalie UI
                    awayStatHtml = awayGoalie 
                        ? `<div class="factor-container stat-text text-xs">
                               <span>${awayGoalie.name.split(' ')[1]}</span>
                               <div class="factor-tooltip"><strong>${awayGoalie.name}</strong><br>Historical GSAx: ${awayGoalie.gsax.toFixed(2)}<br>Games Played: ${awayGoalie.games_played}</div>
                           </div>` 
                        : `<div class="stat-text text-xs">${uiSafeText(data.awayStat)}</div>`;
                    
                    // Build Home Goalie UI
                    homeStatHtml = homeGoalie 
                        ? `<div class="factor-container stat-text text-xs">
                               <span>${homeGoalie.name.split(' ')[1]}</span>
                               <div class="factor-tooltip"><strong>${homeGoalie.name}</strong><br>Historical GSAx: ${homeGoalie.gsax.toFixed(2)}<br>Games Played: ${homeGoalie.games_played}</div>
                           </div>` 
                        : `<div class="stat-text text-xs">${uiSafeText(data.homeStat)}</div>`;
                    
                    // FALLBACK: If the special UI data is missing, use the plain text "Swayman vs Kochetkov" from data.explain
                    if (!awayGoalie && !homeGoalie && data.explain) {
                        explanationHtml = `<div class="factor-explanation">${data.explain}</div>`;
                    }

                } else {
                    // --- Default UI for all other factors ---
                    awayStatHtml = `<div class="stat-text text-xs">${uiSafeText(data.awayStat)}</div>`;
                    homeStatHtml = `<div class="stat-text text-xs">${uiSafeText(data.homeStat)}</div>`;
                    
                    // Add the explanation text for other factors
                    if (data.explain && data.explain !== 'No goalie data available.' && data.explain !== 'No goalie form data available.') {
                        explanationHtml = `<div class="factor-explanation">${data.explain}</div>`;
                    }
                }
                
                labelHtml = tooltipText 
                    ? `<div class="factor-container"><span class="factor-label">${factorName}</span><div class="factor-tooltip">${tooltipText}</div></div>`
                    : `<span class="factor-label">${factorName}</span>`;

                categoryHtml += `<div class="explanation-item">${awayStatHtml}${labelHtml}${homeStatHtml}</div>${explanationHtml}`;
            }
        });

        if (categoryHtml) {
            html += `<div class="factor-category-header">${title}</div><div class="space-y-1">${categoryHtml}</div>`;
        }
    };

    if (sportKey === 'icehockey_nhl') {
        const historicalTitle = `Historical Data (<span class="neon-year">${historicalDataSeason || 'Last Season'}</span>)`;
        const hybridTitle = `Hybrid Data (Live + <span class="neon-year">${historicalDataSeason || 'Historical'}</span> Player Ratings)`;
        renderCategory(hybridTitle, [ 'Injury Impact', 'Current Goalie Form', 'Historical Goalie Edge (GSAx)' ]);
        renderCategory(historicalTitle, [ '5-on-5 xG%', 'High-Danger Battle', 'Special Teams Duel', 'Historical Faceoff %', 'PDO (Luck Factor)' ]);
        renderCategory('Live Data (Current Season)', [ 'Record', 'Hot Streak', 'Offensive Form (G/GP)', 'Defensive Form (GA/GP)', 'Faceoff Advantage', 'H2H (Season)', 'Fatigue' ]);
    } else {
        // ... (rest of the function is identical to your file) ...
    }
    
    const bettingValueData = factors['Betting Value'];
    if(bettingValueData) {
        html += `<div class="factor-category-header">Meta Analysis</div>`;
        html += `<div class="explanation-item">
        const { factors, historicalDataSeason } = prediction;
        let html = '<div class="space-y-2"><h4 class="font-bold text-center text-white mb-2">Key Factor Breakdown</h4>';

        const renderCategory = (title, factorList) => {
            let categoryHtml = '';
            factorList.forEach(factorName => {
                const data = factors[factorName];
                if (data) {
                    let awayStatHtml, homeStatHtml, labelHtml, explanationHtml = '';
                    const tooltipText = explanationTooltips[factorName] || '';

                    // --- THIS IS THE FIX: Special UI logic for the Goalie Factor ---
                    if (factorName === 'Historical Goalie Edge (GSAx)' && (data.awayGoalie || data.homeGoalie)) {
                        const awayGoalie = data.awayGoalie;
                        const homeGoalie = data.homeGoalie;

                        // Build Away Goalie UI
                        awayStatHtml = awayGoalie 
                            ? `<div class="factor-container stat-text text-xs">
                                   <span>${awayGoalie.name.split(' ')[1]}</span>
                                   <div class="factor-tooltip"><strong>${awayGoalie.name}</strong><br>Historical GSAx: ${awayGoalie.gsax.toFixed(2)}<br>Games Played: ${awayGoalie.games_played}</div>
                               </div>` 
                            : `<div class="stat-text text-xs">${uiSafeText(data.awayStat)}</div>`;
                        
                        // Build Home Goalie UI
                        homeStatHtml = homeGoalie 
                            ? `<div class="factor-container stat-text text-xs">
                                   <span>${homeGoalie.name.split(' ')[1]}</span>
                                   <div class="factor-tooltip"><strong>${homeGoalie.name}</strong><br>Historical GSAx: ${homeGoalie.gsax.toFixed(2)}<br>Games Played: ${homeGoalie.games_played}</div>
                               </div>` 
                            : `<div class="stat-text text-xs">${uiSafeText(data.homeStat)}</div>`;
                        
                        // FALLBACK: If the special UI data is missing, use the plain text "Swayman vs Kochetkov" from data.explain
                        if (!awayGoalie && !homeGoalie && data.explain) {
                            explanationHtml = `<div class="factor-explanation">${data.explain}</div>`;
                        }

                    } else {
                        // --- Default UI for all other factors ---
                        awayStatHtml = `<div class="stat-text text-xs">${uiSafeText(data.awayStat)}</div>`;
                        homeStatHtml = `<div class="stat-text text-xs">${uiSafeText(data.homeStat)}</div>`;
                        
                        // Add the explanation text for other factors
                        if (data.explain && data.explain !== 'No goalie data available.' && data.explain !== 'No goalie form data available.') {
                            explanationHtml = `<div class="factor-explanation">${data.explain}</div>`;
                        }
                    }
                    
                    labelHtml = tooltipText 
                        ? `<div class="factor-container"><span class="factor-label">${factorName}</span><div class="factor-tooltip">${tooltipText}</div></div>`
                        : `<span class="factor-label">${factorName}</span>`;

                    categoryHtml += `<div class="explanation-item">${awayStatHtml}${labelHtml}${homeStatHtml}</div>${explanationHtml}`;
                }
            });

            if (categoryHtml) {
                html += `<div class="factor-category-header">${title}</div><div class="space-y-1">${categoryHtml}</div>`;
            }
        };

        if (sportKey === 'icehockey_nhl') {
            const historicalTitle = `Historical Data (<span class="neon-year">${historicalDataSeason || 'Last Season'}</span>)`;
            const hybridTitle = `Hybrid Data (Live + <span class="neon-year">${historicalDataSeason || 'Historical'}</span> Player Ratings)`;
            renderCategory(hybridTitle, [ 'Injury Impact', 'Current Goalie Form', 'Historical Goalie Edge (GSAx)' ]);
            renderCategory(historicalTitle, [ '5-on-5 xG%', 'High-Danger Battle', 'Special Teams Duel', 'Historical Faceoff %', 'PDO (Luck Factor)' ]);
            renderCategory('Live Data (Current Season)', [ 'Record', 'Hot Streak', 'Offensive Form (G/GP)', 'Defensive Form (GA/GP)', 'Faceoff Advantage', 'H2H (Season)', 'Fatigue' ]);
        } else {
            const factorOrder = {
                'baseball_mlb': ['Record', 'Recent Form (L10)', 'H2H (Season)', 'Offensive Form', 'Defensive Form', 'Starting Pitcher Duel', 'Injury Impact'],
                'americanfootball_nfl': ['Record', 'H2H (Season)', 'Offensive Form', 'Defensive Form', 'Injury Impact']
            }[sportKey] || Object.keys(factors).filter(f => f !== 'Betting Value');
            renderCategory('Key Factors', factorOrder);
        }
        
        const bettingValueData = factors['Betting Value'];
        if(bettingValueData) {
            html += `<div class="factor-category-header">Meta Analysis</div>`;
            html += `<div class="explanation-item">
                    <div class="stat-text text-xs">${bettingValueData.awayStat || 'N/A'}</div>
                    <div class="factor-container">
                       <span class="factor-label">Betting Value</span>
                    </div>
                    <div class="stat-text text-xs">${bettingValueData.homeStat || 'N/A'}</div>
                 </div>`;
    }

    const hasInjuries = (factors['Injury Impact']?.injuries?.home?.length > 0 || factors['Injury Impact']?.injuries?.away?.length > 0);
    if (hasInjuries) {
         html += `<div class="text-center mt-2"><button class="view-injuries-btn">View Injury Details</button></div>`;
    }

    return html + '</div>';
        }

        const hasInjuries = (factors['Injury Impact']?.injuries?.home?.length > 0 || factors['Injury Impact']?.injuries?.away?.length > 0);
        if (hasInjuries) {
             html += `<div class="text-center mt-2"><button class="view-injuries-btn">View Injury Details</button></div>`;
        }

        return html + '</div>';
    }
    
    function generateWeatherIconHtml(weatherData, sportKey) {
