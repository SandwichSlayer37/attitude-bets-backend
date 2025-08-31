app.post('/api/ai-analysis', async (req, res) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not set.");
        }
        const { game, prediction } = req.body;
        const { home_team, away_team } = game;
        const { winner, factors } = prediction;
        const homeRecord = factors['Record']?.homeStat || 'N/A';
        const awayRecord = factors['Record']?.awayStat || 'N/A';
        const homeL10 = factors['Recent Form (L10)']?.homeStat || 'N/A';
        const awayL10 = factors['Recent Form (L10)']?.awayStat || 'N/A';
        const homeSentiment = factors['Social Sentiment']?.homeStat || 'N/A';
        const awaySentiment = factors['Social Sentiment']?.awayStat || 'N/A';
        
        const prompt = `
            Act as a professional sports betting analyst. Create a sophisticated HTML analysis for the following game.
            Use Tailwind CSS classes for styling. Use only the following tags: <div>, <h4>, <p>, <ul>, <li>, and <strong>.

            Game: ${away_team} (${awayRecord}, ${awayL10} L10) @ ${home_team} (${homeRecord}, ${homeL10} L10)
            Our Algorithm's Prediction: ${winner}

            Generate the following HTML structure:
            1. A <h4> with class "text-xl font-bold text-cyan-400 mb-2" titled "Key Narrative". Follow it with a <p> with class "text-gray-300 mb-4" summarizing the matchup.
            2. An <hr> with class "border-gray-700 my-4".
            3. A <h4> with class "text-xl font-bold text-indigo-400 mb-2" titled "Social Sentiment Analysis". Follow it with a <p> with class "text-gray-300 mb-4". In this paragraph, explain that this score (Home: ${homeSentiment}, Away: ${awaySentiment}) is derived from recent discussions on sports betting forums like Reddit's r/sportsbook. Briefly interpret the scores - for example, does the higher score suggest the public is heavily favoring that team, or are the scores close, indicating a divided opinion?
            4. An <hr> with class "border-gray-700 my-4".
            5. A <h4> with class "text-xl font-bold text-teal-400 mb-2" titled "Bull Case for ${winner}". Follow it with a <ul class="list-disc list-inside space-y-2 mb-4 text-gray-300"> with two or three <li> bullet points explaining why our prediction is solid. Make key stats bold with <strong>.
            6. An <hr> with class "border-gray-700 my-4".
            7. A <h4> with class "text-xl font-bold text-red-400 mb-2" titled "Bear Case for ${winner}". Follow it with a <ul class="list-disc list-inside space-y-2 mb-4 text-gray-300"> with two or three <li> bullet points explaining the risks. Make key stats bold with <strong>.
            8. An <hr> with class "border-gray-700 my-4".
            9. A <h4> with class "text-xl font-bold text-yellow-400 mb-2" titled "Final Verdict". Follow it with a single, confident <p> with class "text-gray-200" summarizing your recommendation.
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        let analysisHtml = response.text();
        
        analysisHtml = analysisHtml.replace(/```html/g, '').replace(/```/g, '');

        res.json({ analysisHtml });

    } catch (error) {
        console.error("AI Analysis Error:", error);
        res.status(500).json({ error: "Failed to generate AI analysis." });
    }
});
