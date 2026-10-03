/*
 * FEG — Football Evolution God
 * LEARNING CONTROLLER v0.3.0
 *
 * Назначение:
 *   Связать Prediction Journal → FACT → Learning Memory → Rating
 *   → контрольные точки 88 / 264 / 999 → Challenger.
 *
 * PRINCIPLES
 *   1. Prediction != Fact
 *   2. Future data is forbidden
 *   3. Missing != 0
 *   4. One fact is processed only once
 *   5. Rating update is performed only once per fact
 *   6. Champion is never replaced automatically
 *   7. 88 / 264 / 999 are evidence checkpoints
 *   8. Weak evidence produces no formula change
 *   9. Learning never modifies historical predictions
 *  10. Challenger is isolated from Champion
 */

(function () {
    "use strict";

    const VERSION = "0.3.0";

    const JOURNAL_KEY = "FEG_PREDICTION_JOURNAL_V0_1";
    const LEARNING_KEY = "FEG_LEARNING_MEMORY_V0_2";
    const STATE_KEY = "FEG_LEARNING_CONTROLLER_V0_3";
    const CHALLENGER_KEY = "FEG_CHALLENGER_V0_3";

    const CHECKPOINTS = {
        short: 88,
        deep: 264,
        laboratory: 999
    };

    /*
     * Corrections are intentionally small.
     *
     * They are NOT a new prediction formula.
     * They are bounded context adjustments learned from
     * accumulated historical error.
     */
    const LIMITS = {
        globalLambdaMax: 0.08,
        teamLambdaMax: 0.12,

        minGlobalSamples: 30,
        minTeamSamples: 12,

        minCorrectionMagnitude: 0.01,

        maxLearningRecordsPerRun: 5000
    };

    function nowISO() {
        return new Date().toISOString();
    }

    function safeParse(value, fallback) {
        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);

            if (!raw) {
                return fallback;
            }

            return safeParse(raw, fallback);
        } catch (error) {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error("[FEG Learning] save error:", error);
            return false;
        }
    }

    function isObject(value) {
        return value !== null &&
            typeof value === "object" &&
            !Array.isArray(value);
    }

    function finiteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeTeam(value) {
        if (typeof value !== "string") {
            return "";
        }

        return value.trim();
    }

    function normalizeCompetition(value) {
        if (typeof value !== "string") {
            return "";
        }

        return value.trim().toUpperCase();
    }

    function getJournal() {
        const data = loadJSON(JOURNAL_KEY, []);

        if (!Array.isArray(data)) {
            return [];
        }

        return data;
    }

    function getLearningMemory() {
        const data = loadJSON(LEARNING_KEY, {
            version: "FEG-MEMORY-0.2",
            records: []
        });

        if (!isObject(data)) {
            return {
                version: "FEG-MEMORY-0.2",
                records: []
            };
        }

        if (!Array.isArray(data.records)) {
            data.records = [];
        }

        return data;
    }

    function getState() {
        const state = loadJSON(STATE_KEY, null);

        if (!isObject(state)) {
            return createInitialState();
        }

        return state;
    }

    function createInitialState() {
        return {
            version: VERSION,

            processedFacts: 0,

            lastRunAt: null,

            checkpoints: {
                short88: {
                    reached: false,
                    processedAt: null,
                    applied: false
                },

                deep264: {
                    reached: false,
                    processedAt: null,
                    applied: false
                },

                laboratory999: {
                    reached: false,
                    processedAt: null,
                    created: false
                }
            },

            adjustments: {
                global: {},
                teams: {}
            },

            statistics: {
                totalRecords: 0,
                evaluatedRecords: 0,
                pendingRecords: 0,
                invalidRecords: 0
            }
        };
    }

    function saveState(state) {
        state.version = VERSION;
        state.lastRunAt = nowISO();

        saveJSON(STATE_KEY, state);
    }

    /*
     * A journal entry is considered finished only if it contains
     * an actual factual result.
     *
     * We intentionally do NOT trust prediction status alone.
     */
    function extractFact(entry) {
        if (!isObject(entry)) {
            return null;
        }

        const homeGoals =
            finiteNumber(entry.actualHomeGoals)
                ? entry.actualHomeGoals
                : finiteNumber(entry.factHomeGoals)
                    ? entry.factHomeGoals
                    : finiteNumber(entry.home_goals)
                        ? entry.home_goals
                        : null;

        const awayGoals =
            finiteNumber(entry.actualAwayGoals)
                ? entry.actualAwayGoals
                : finiteNumber(entry.factAwayGoals)
                    ? entry.factAwayGoals
                    : finiteNumber(entry.away_goals)
                        ? entry.away_goals
                        : null;

        if (!finiteNumber(homeGoals) || !finiteNumber(awayGoals)) {
            return null;
        }

        if (homeGoals < 0 || awayGoals < 0) {
            return null;
        }

        return {
            homeGoals,
            awayGoals
        };
    }

    function getPredictionId(entry, index) {
        if (entry.id !== undefined && entry.id !== null) {
            return String(entry.id);
        }

        if (entry.predictionId !== undefined && entry.predictionId !== null) {
            return String(entry.predictionId);
        }

        if (entry.fingerprint) {
            return String(entry.fingerprint);
        }

        /*
         * Last-resort stable identifier for old journal entries.
         */
        return [
            normalizeTeam(entry.home),
            normalizeTeam(entry.away),
            entry.predictionTime || entry.createdAt || "",
            index
        ].join("|");
    }

    function getPredictionDate(entry) {
        const value =
            entry.predictionTime ||
            entry.createdAt ||
            entry.timestamp ||
            entry.date ||
            null;

        if (!value) {
            return null;
        }

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            return null;
        }

        return parsed.toISOString();
    }

    function getPredictedLambda(entry, side) {
        const prediction =
            isObject(entry.prediction)
                ? entry.prediction
                : entry;

        const lambda =
            isObject(prediction.lambda)
                ? prediction.lambda
                : null;

        if (lambda) {
            const value =
                side === "home"
                    ? lambda.home
                    : lambda.away;

            if (finiteNumber(value)) {
                return value;
            }
        }

        const direct =
            side === "home"
                ? [
                    prediction.lambdaHome,
                    prediction.homeLambda,
                    prediction.xgHome,
                    prediction.expectedHomeGoals
                ]
                : [
                    prediction.lambdaAway,
                    prediction.awayLambda,
                    prediction.xgAway,
                    prediction.expectedAwayGoals
                ];

        for (const value of direct) {
            if (finiteNumber(value)) {
                return value;
            }
        }

        return null;
    }

    function getPredictedOutcome(entry) {
        const prediction =
            isObject(entry.prediction)
                ? entry.prediction
                : entry;

        if (prediction.outcome) {
            return String(prediction.outcome).toUpperCase();
        }

        if (prediction.predictedOutcome) {
            return String(prediction.predictedOutcome).toUpperCase();
        }

        if (prediction.result) {
            const value = String(prediction.result).toUpperCase();

            if (
                value === "HOME" ||
                value === "DRAW" ||
                value === "AWAY" ||
                value === "1" ||
                value === "X" ||
                value === "2"
            ) {
                return value;
            }
        }

        /*
         * Try probability object.
         */
        const probabilities =
            isObject(prediction.probabilities)
                ? prediction.probabilities
                : null;

        if (probabilities) {
            const candidates = [
                {
                    name: "HOME",
                    value: probabilities.home ?? probabilities.HOME ?? probabilities["1"]
                },
                {
                    name: "DRAW",
                    value: probabilities.draw ?? probabilities.DRAW ?? probabilities["X"]
                },
                {
                    name: "AWAY",
                    value: probabilities.away ?? probabilities.AWAY ?? probabilities["2"]
                }
            ].filter(item => finiteNumber(item.value));

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.value - a.value);
                return candidates[0].name;
            }
        }

        return null;
    }

    function factualOutcome(homeGoals, awayGoals) {
        if (homeGoals > awayGoals) {
            return "HOME";
        }

        if (homeGoals < awayGoals) {
            return "AWAY";
        }

        return "DRAW";
    }

    function isBTTS(homeGoals, awayGoals) {
        return homeGoals > 0 && awayGoals > 0;
    }

    function isOver25(homeGoals, awayGoals) {
        return homeGoals + awayGoals > 2.5;
    }

    function calculateLambdaError(predicted, actual) {
        if (!finiteNumber(predicted) || !finiteNumber(actual)) {
            return null;
        }

        return actual - predicted;
    }

    function createLearningRecord(entry, fact, predictionId) {
        const home = normalizeTeam(
            entry.home ||
            entry.homeTeam ||
            entry.home_team
        );

        const away = normalizeTeam(
            entry.away ||
            entry.awayTeam ||
            entry.away_team
        );

        if (!home || !away) {
            return null;
        }

        const predictionDate = getPredictionDate(entry);

        /*
         * Critical anti-leakage rule:
         *
         * The record represents:
         *   prediction made at predictionDate
         *   + fact received later.
         *
         * We never modify the original prediction.
         */
        const predictedLambdaHome = getPredictedLambda(entry, "home");
        const predictedLambdaAway = getPredictedLambda(entry, "away");

        const predictedOutcome = getPredictedOutcome(entry);
        const actualOutcome = factualOutcome(
            fact.homeGoals,
            fact.awayGoals
        );

        const competition = normalizeCompetition(
            entry.competition ||
            entry.league ||
            entry.competitionCode ||
            ""
        );

        return {
            id: `learn:${predictionId}`,

            version: VERSION,

            predictionId: predictionId,

            predictionDate: predictionDate,

            factDate: nowISO(),

            home: home,
            away: away,

            competition: competition || null,

            predicted: {
                outcome: predictedOutcome,
                lambdaHome: predictedLambdaHome,
                lambdaAway: predictedLambdaAway
            },

            fact: {
                homeGoals: fact.homeGoals,
                awayGoals: fact.awayGoals,
                outcome: actualOutcome,
                btts: isBTTS(fact.homeGoals, fact.awayGoals),
                over25: isOver25(fact.homeGoals, fact.awayGoals)
            },

            error: {
                outcome:
                    predictedOutcome !== null
                        ? predictedOutcome !== actualOutcome
                        : null,

                lambdaHome: calculateLambdaError(
                    predictedLambdaHome,
                    fact.homeGoals
                ),

                lambdaAway: calculateLambdaError(
                    predictedLambdaAway,
                    fact.awayGoals
                )
            },

            ratingUpdated: false,

            createdAt: nowISO()
        };
    }

    function recordExists(records, recordId) {
        return records.some(
            record => record && record.id === recordId
        );
    }

    function updateRatingForRecord(record) {
        if (!window.FEGRATING) {
            return {
                success: false,
                reason: "FEGRATING_NOT_CONNECTED"
            };
        }

        if (typeof window.FEGRATING.updateAfterFact !== "function") {
            return {
                success: false,
                reason: "RATING_UPDATE_METHOD_NOT_FOUND"
            };
        }

        try {
            /*
             * Use the existing Rating API.
             *
             * We deliberately pass only factual information and
             * the prediction snapshot required by the rating module.
             */
            const result = window.FEGRATING.updateAfterFact({
                home: record.home,
                away: record.away,

                homeGoals: record.fact.homeGoals,
                awayGoals: record.fact.awayGoals,

                competition: record.competition,

                predictedHomeGoals: record.predicted.lambdaHome,
                predictedAwayGoals: record.predicted.lambdaAway,

                prediction: {
                    lambdaHome: record.predicted.lambdaHome,
                    lambdaAway: record.predicted.lambdaAway
                },

                fact: {
                    homeGoals: record.fact.homeGoals,
                    awayGoals: record.fact.awayGoals
                }
            });

            return {
                success: true,
                result: result
            };

        } catch (error) {
            console.error(
                "[FEG Learning] Rating update failed:",
                error
            );

            return {
                success: false,
                reason: "RATING_UPDATE_ERROR",
                error: String(error)
            };
        }
    }

    function aggregate(records) {
        const valid = records.filter(Boolean);

        const lambdaRecords = valid.filter(record =>
            finiteNumber(record.error?.lambdaHome) &&
            finiteNumber(record.error?.lambdaAway)
        );

        let homeError = 0;
        let awayError = 0;

        for (const record of lambdaRecords) {
            homeError += record.error.lambdaHome;
            awayError += record.error.lambdaAway;
        }

        const averageHomeError =
            lambdaRecords.length
                ? homeError / lambdaRecords.length
                : null;

        const averageAwayError =
            lambdaRecords.length
                ? awayError / lambdaRecords.length
                : null;

        const outcomeRecords = valid.filter(
            record => record.error?.outcome !== null
        );

        const outcomeMisses = outcomeRecords.filter(
            record => record.error.outcome === true
        ).length;

        return {
            count: valid.length,

            lambdaCount: lambdaRecords.length,

            averageHomeError,
            averageAwayError,

            outcomeCount: outcomeRecords.length,

            outcomeMisses,

            outcomeAccuracy:
                outcomeRecords.length
                    ? 1 - outcomeMisses / outcomeRecords.length
                    : null
        };
    }

    function getGlobalAdjustments(records) {
        const result = {};

        /*
         * Global correction is allowed only after 88 facts.
         *
         * We use at least 30 valid lambda observations so that
         * one or two matches cannot move the system.
         */
        if (records.length < LIMITS.minGlobalSamples) {
            return result;
        }

        const stats = aggregate(records);

        if (stats.lambdaCount < LIMITS.minGlobalSamples) {
            return result;
        }

        if (
            finiteNumber(stats.averageHomeError) &&
            Math.abs(stats.averageHomeError) >= LIMITS.minCorrectionMagnitude
        ) {
            result.lambdaHomeCorrection = clamp(
                stats.averageHomeError * 0.25,
                -LIMITS.globalLambdaMax,
                LIMITS.globalLambdaMax
            );
        }

        if (
            finiteNumber(stats.averageAwayError) &&
            Math.abs(stats.averageAwayError) >= LIMITS.minCorrectionMagnitude
        ) {
            result.lambdaAwayCorrection = clamp(
                stats.averageAwayError * 0.25,
                -LIMITS.globalLambdaMax,
                LIMITS.globalLambdaMax
            );
        }

        result.samples = stats.lambdaCount;
        result.generatedAt = nowISO();

        return result;
    }

    function getTeamAdjustments(records) {
        const grouped = {};

        for (const record of records) {
            if (!record) {
                continue;
            }

            const teams = [
                {
                    team: record.home,
                    error:
                        finiteNumber(record.error?.lambdaHome)
                            ? record.error.lambdaHome
                            : null
                },
                {
                    team: record.away,
                    error:
                        finiteNumber(record.error?.lambdaAway)
                            ? record.error.lambdaAway
                            : null
                }
            ];

            for (const item of teams) {
                if (!item.team || !finiteNumber(item.error)) {
                    continue;
                }

                if (!grouped[item.team]) {
                    grouped[item.team] = [];
                }

                grouped[item.team].push(item.error);
            }
        }

        const result = {};

        for (const [team, errors] of Object.entries(grouped)) {
            if (errors.length < LIMITS.minTeamSamples) {
                continue;
            }

            const average =
                errors.reduce((sum, value) => sum + value, 0) /
                errors.length;

            if (Math.abs(average) < LIMITS.minCorrectionMagnitude) {
                continue;
            }

            result[team] = {
                lambdaCorrection: clamp(
                    average * 0.20,
                    -LIMITS.teamLambdaMax,
                    LIMITS.teamLambdaMax
                ),

                samples: errors.length,

                generatedAt: nowISO()
            };
        }

        return result;
    }

    function createChallenger(records, state) {
        const existing = loadJSON(CHALLENGER_KEY, null);

        /*
         * Do not recreate a Challenger on every page refresh.
         */
        if (
            isObject(existing) &&
            existing.status === "READY_FOR_WALK_FORWARD"
        ) {
            return existing;
        }

        const global =
            getGlobalAdjustments(records);

        const teams =
            getTeamAdjustments(records);

        const challenger = {
            version: "FEG-CHALLENGER-0.1.0",

            status: "READY_FOR_WALK_FORWARD",

            createdAt: nowISO(),

            basedOnLearningRecords: records.length,

            parentBrain:
                window.FEG_BRAIN_VERSION ||
                "unknown",

            parentEXG:
                window.FEG_EXG_VERSION ||
                "unknown",

            changes: {
                global: global,
                teams: teams
            },

            validation: {
                walkForward: "NOT_RUN",
                statisticalCheck: "NOT_RUN",
                promotion: "DISABLED"
            },

            rule:
                "Challenger must pass walk-forward and statistical validation before any promotion."
        };

        saveJSON(CHALLENGER_KEY, challenger);

        return challenger;
    }

    function processCheckpoint88(records, state) {
        if (records.length < CHECKPOINTS.short) {
            return;
        }

        state.checkpoints.short88.reached = true;

        if (state.checkpoints.short88.applied) {
            return;
        }

        const global = getGlobalAdjustments(records);

        /*
         * Weak evidence = no adjustment.
         */
        if (
            Object.keys(global).length === 0 ||
            global.lambdaHomeCorrection === undefined &&
            global.lambdaAwayCorrection === undefined
        ) {
            state.checkpoints.short88.applied = true;
            state.adjustments.global = {
                status: "NO_CHANGE",
                reason: "INSUFFICIENT_STABLE_SIGNAL",
                samples: records.length,
                generatedAt: nowISO()
            };

            state.checkpoints.short88.processedAt = nowISO();
            return;
        }

        state.adjustments.global = {
            status: "ACTIVE",
            ...global
        };

        state.checkpoints.short88.applied = true;
        state.checkpoints.short88.processedAt = nowISO();
    }

    function processCheckpoint264(records, state) {
        if (records.length < CHECKPOINTS.deep) {
            return;
        }

        state.checkpoints.deep264.reached = true;

        if (state.checkpoints.deep264.applied) {
            return;
        }

        const teams = getTeamAdjustments(records);

        state.adjustments.teams = teams;

        state.checkpoints.deep264.applied = true;
        state.checkpoints.deep264.processedAt = nowISO();
    }

    function processCheckpoint999(records, state) {
        if (records.length < CHECKPOINTS.laboratory) {
            return;
        }

        state.checkpoints.laboratory999.reached = true;

        if (state.checkpoints.laboratory999.created) {
            return;
        }

        const challenger = createChallenger(
            records,
            state
        );

        if (challenger) {
            state.checkpoints.laboratory999.created = true;
        }

        state.checkpoints.laboratory999.processedAt = nowISO();
    }

    function updateStatistics(state, records, journal) {
        state.statistics.totalRecords = records.length;

        state.statistics.evaluatedRecords =
            journal.filter(entry => extractFact(entry)).length;

        state.statistics.pendingRecords =
            journal.filter(entry => !extractFact(entry)).length;

        state.statistics.invalidRecords =
            Math.max(
                0,
                journal.length -
                state.statistics.evaluatedRecords -
                state.statistics.pendingRecords
            );
    }

    function getAdjustmentForTeam(state, team) {
        if (!team) {
            return 0;
        }

        const adjustment =
            state.adjustments?.teams?.[team];

        if (!adjustment) {
            return 0;
        }

        if (!finiteNumber(adjustment.lambdaCorrection)) {
            return 0;
        }

        return adjustment.lambdaCorrection;
    }

    /*
     * Public function.
     *
     * Call this after journal evaluation, and also on page load.
     *
     * It is idempotent.
     */
    function processFinishedPredictions() {
        const journal = getJournal();

        const memory = getLearningMemory();

        const state = getState();

        const existingRecords = Array.isArray(memory.records)
            ? memory.records
            : [];

        const newRecords = [];

        let ratingUpdates = 0;

        for (
            let index = 0;
            index < journal.length;
            index++
        ) {
            if (
                newRecords.length >=
                LIMITS.maxLearningRecordsPerRun
            ) {
                break;
            }

            const entry = journal[index];

            const fact = extractFact(entry);

            if (!fact) {
                continue;
            }

            const predictionId =
                getPredictionId(entry, index);

            const recordId =
                `learn:${predictionId}`;

            if (
                recordExists(
                    existingRecords,
                    recordId
                )
            ) {
                continue;
            }

            const record =
                createLearningRecord(
                    entry,
                    fact,
                    predictionId
                );

            if (!record) {
                continue;
            }

            /*
             * Rating update occurs before the record is committed
             * as processed.
             */
            const ratingResult =
                updateRatingForRecord(record);

            if (ratingResult.success) {
                record.ratingUpdated = true;
                ratingUpdates++;
            }

            newRecords.push(record);
        }

        /*
         * Append only. Existing learning history is immutable.
         */
        if (newRecords.length > 0) {
            memory.version = "FEG-MEMORY-0.2";

            memory.records =
                existingRecords.concat(newRecords);

            memory.updatedAt = nowISO();

            saveJSON(
                LEARNING_KEY,
                memory
            );
        }

        const records = memory.records;

        /*
         * The number of learning records, NOT raw results.json rows,
         * is what controls the learning checkpoints.
         */
        state.processedFacts = records.length;

        processCheckpoint88(
            records,
            state
        );

        processCheckpoint264(
            records,
            state
        );

        processCheckpoint999(
            records,
            state
        );

        updateStatistics(
            state,
            records,
            journal
        );

        saveState(state);

        return {
            version: VERSION,

            processedFacts: records.length,

            newFacts: newRecords.length,

            ratingUpdates: ratingUpdates,

            checkpoint88:
                state.checkpoints.short88,

            checkpoint264:
                state.checkpoints.deep264,

            checkpoint999:
                state.checkpoints.laboratory999,

            adjustments:
                state.adjustments,

            statistics:
                state.statistics
        };
    }

    function getAdjustments() {
        const state = getState();

        return {
            global:
                state.adjustments?.global || {},

            teams:
                state.adjustments?.teams || {}
        };
    }

    function getGlobalLambdaHomeAdjustment() {
        const state = getState();

        const value =
            state.adjustments?.global?.lambdaHomeCorrection;

        return finiteNumber(value)
            ? value
            : 0;
    }

    function getGlobalLambdaAwayAdjustment() {
        const state = getState();

        const value =
            state.adjustments?.global?.lambdaAwayCorrection;

        return finiteNumber(value)
            ? value
            : 0;
    }

    function getTeamLambdaAdjustment(team) {
        const state = getState();

        return getAdjustmentForTeam(
            state,
            team
        );
    }

    function getStatus() {
        const state = getState();

        const facts =
            Number.isFinite(state.processedFacts)
                ? state.processedFacts
                : 0;

        let stage = "FOUNDATION";

        if (facts >= CHECKPOINTS.laboratory) {
            stage = "LABORATORY";
        } else if (facts >= CHECKPOINTS.deep) {
            stage = "DEEP_ADAPTATION";
        } else if (facts >= CHECKPOINTS.short) {
            stage = "SHORT_CORRECTION";
        }

        return {
            version: VERSION,

            stage: stage,

            processedFacts: facts,

            to88:
                Math.max(
                    0,
                    CHECKPOINTS.short - facts
                ),

            to264:
                Math.max(
                    0,
                    CHECKPOINTS.deep - facts
                ),

            to999:
                Math.max(
                    0,
                    CHECKPOINTS.laboratory - facts
                ),

            checkpoints:
                state.checkpoints,

            adjustments:
                state.adjustments,

            statistics:
                state.statistics,

            challenger:
                loadJSON(
                    CHALLENGER_KEY,
                    null
                )
        };
    }

    function loadState() {
        return getState();
    }

    function resetController() {
        /*
         * Administrative/debug function.
         *
         * It does NOT delete Learning Memory or Rating.
         */
        localStorage.removeItem(
            STATE_KEY
        );
    }

    /*
     * Expose public API.
     */
    window.FEGLearning = {
        version: VERSION,

        processFinishedPredictions,

        getAdjustments,

        getGlobalLambdaHomeAdjustment,

        getGlobalLambdaAwayAdjustment,

        getTeamLambdaAdjustment,

        getStatus,

        loadState,

        resetController
    };

    window.FEG_LEARNING_CONTROLLER_VERSION =
        VERSION;

    /*
     * Automatic safe startup.
     *
     * If journal/evaluator/rating are already ready,
     * this processes any finished predictions.
     *
     * If something is not ready yet, we simply wait.
     * We NEVER create fake facts.
     */
    function startup() {
        try {
            processFinishedPredictions();
        } catch (error) {
            console.error(
                "[FEG Learning] startup error:",
                error
            );
        }
    }

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            startup,
            { once: true }
        );
    } else {
        startup();
    }

})();
