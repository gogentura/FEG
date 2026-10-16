
/*
 * FEG — Football Evolution God
 * LEARNING CONTROLLER v0.3.1
 *
 * Compatible with:
 *   index.html — Prediction Journal
 *   rating.js   — FEGRATING
 *
 * PRINCIPLES
 * 1. Prediction != Fact
 * 2. Future data is forbidden
 * 3. Missing != 0
 * 4. One prediction produces at most one learning record
 * 5. Rating must not be updated twice for the same fact
 * 6. Champion is never replaced automatically
 * 7. 88 / 264 / 999 are evidence checkpoints
 * 8. Weak evidence produces no formula change
 * 9. Historical predictions are immutable
 * 10. Challenger is isolated from Champion
 * 11. Learning runs in SHADOW mode
 * 12. Candidate adjustments never change active Brain
 */

(function () {
    "use strict";

    const VERSION = "0.3.1";

    const JOURNAL_KEY =
        "FEG_PREDICTION_JOURNAL_V0_1";

    const LEARNING_KEY =
        "FEG_LEARNING_MEMORY_V0_2";

    const STATE_KEY =
        "FEG_LEARNING_CONTROLLER_V0_3";

    const CHALLENGER_KEY =
        "FEG_CHALLENGER_V0_3";

    const CHECKPOINTS = {
        short: 88,
        deep: 264,
        laboratory: 999
    };

    const LIMITS = {
        globalLambdaMax: 0.08,
        teamLambdaMax: 0.12,

        minGlobalSamples: 30,
        minTeamSamples: 12,

        minCorrectionMagnitude: 0.01,

        maxLearningRecordsPerRun: 5000
    };

    const MODE = "SHADOW";

    /* =====================================================
       STORAGE
       ===================================================== */

    function nowISO() {
        return new Date().toISOString();
    }

    function isObject(value) {
        return value !== null &&
            typeof value === "object" &&
            !Array.isArray(value);
    }

    function finiteNumber(value) {
        return typeof value === "number" &&
            Number.isFinite(value);
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

            if (raw === null) {
                return fallback;
            }

            return safeParse(raw, fallback);
        } catch (error) {
            console.error(
                "[FEG Learning] Read error:",
                key,
                error
            );

            return fallback;
        }
    }

    function saveJSON(key, value) {
        try {
            localStorage.setItem(
                key,
                JSON.stringify(value)
            );

            return true;
        } catch (error) {
            console.error(
                "[FEG Learning] Save error:",
                key,
                error
            );

            return false;
        }
    }

    function clamp(value, min, max) {
        return Math.max(
            min,
            Math.min(max, value)
        );
    }

    function normalizeTeam(value) {
        return typeof value === "string"
            ? value.trim()
            : "";
    }

    function normalizeCompetition(value) {
        return typeof value === "string"
            ? value.trim().toUpperCase()
            : "";
    }

    /* =====================================================
       EXISTING DATA
       ===================================================== */

    function getJournal() {
        const data = loadJSON(
            JOURNAL_KEY,
            []
        );

        return Array.isArray(data)
            ? data
            : [];
    }

    function getLearningMemory() {
        const data = loadJSON(
            LEARNING_KEY,
            {
                version: "FEG-MEMORY-0.2",
                records: []
            }
        );

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

    function createInitialState() {
        return {
            version: VERSION,
            mode: MODE,

            processedFacts: 0,
            lastRunAt: null,

            checkpoints: {
                short88: {
                    reached: false,
                    processedAt: null,
                    status: "WAITING"
                },

                deep264: {
                    reached: false,
                    processedAt: null,
                    status: "WAITING"
                },

                laboratory999: {
                    reached: false,
                    processedAt: null,
                    status: "WAITING"
                }
            },

            adjustments: {
                global: {
                    status: "NOT_PROPOSED"
                },

                teams: {}
            },

            statistics: {
                totalJournalEntries: 0,
                evaluatedRecords: 0,
                pendingRecords: 0,
                invalidRecords: 0,
                learningRecords: 0,
                recordsWithoutLambda: 0
            }
        };
    }

    function getState() {
        const state = loadJSON(
            STATE_KEY,
            null
        );

        if (!isObject(state)) {
            return createInitialState();
        }

        const initial = createInitialState();

        state.version = VERSION;
        state.mode = MODE;

        if (!isObject(state.checkpoints)) {
            state.checkpoints =
                initial.checkpoints;
        }

        if (!isObject(state.adjustments)) {
            state.adjustments =
                initial.adjustments;
        }

        if (!isObject(state.statistics)) {
            state.statistics =
                initial.statistics;
        }

        for (const key of Object.keys(
            initial.checkpoints
        )) {
            if (!isObject(state.checkpoints[key])) {
                state.checkpoints[key] =
                    initial.checkpoints[key];
            }
        }

        return state;
    }

    function saveState(state) {
        state.version = VERSION;
        state.mode = MODE;
        state.lastRunAt = nowISO();

        return saveJSON(
            STATE_KEY,
            state
        );
    }

    /* =====================================================
       PREDICTION AND FACT EXTRACTION
       ===================================================== */

    function getPrediction(entry) {
        return isObject(entry?.prediction)
            ? entry.prediction
            : entry;
    }

    /*
     * Current index.html stores the actual score at:
     *
     * entry.evaluation.fact.homeGoals
     * entry.evaluation.fact.awayGoals
     *
     * Legacy field names remain supported.
     *
     * Missing values are never interpreted as zero.
     */

    function extractFact(entry) {
        if (!isObject(entry)) {
            return null;
        }

        const evaluation =
            isObject(entry.evaluation)
                ? entry.evaluation
                : {};

        const evaluationFact =
            isObject(evaluation.fact)
                ? evaluation.fact
                : {};

        const candidatesHome = [
            evaluationFact.homeGoals,
            entry.actualHomeGoals,
            entry.factHomeGoals,
            entry.home_goals
        ];

        const candidatesAway = [
            evaluationFact.awayGoals,
            entry.actualAwayGoals,
            entry.factAwayGoals,
            entry.away_goals
        ];

        const homeGoals =
            candidatesHome.find(finiteNumber);

        const awayGoals =
            candidatesAway.find(finiteNumber);

        if (
            !finiteNumber(homeGoals) ||
            !finiteNumber(awayGoals)
        ) {
            return null;
        }

        if (
            homeGoals < 0 ||
            awayGoals < 0
        ) {
            return null;
        }

        if (
            !Number.isInteger(homeGoals) ||
            !Number.isInteger(awayGoals)
        ) {
            return null;
        }

        /*
         * Do not learn from deleted journal entries.
         */
        if (entry.status === "DELETED") {
            return null;
        }

        return {
            homeGoals,
            awayGoals,

            factDate:
                evaluation.factDate ||
                evaluation.evaluatedAt ||
                null
        };
    }

    function getPredictionId(entry, index) {
        if (
            entry.predictionId !== undefined &&
            entry.predictionId !== null &&
            String(entry.predictionId).trim()
        ) {
            return String(entry.predictionId);
        }

        if (
            entry.id !== undefined &&
            entry.id !== null
        ) {
            return String(entry.id);
        }

        if (entry.fingerprint) {
            return String(entry.fingerprint);
        }

        /*
         * Legacy fallback only.
         * Stable IDs from index.html are preferred.
         */
        const prediction = getPrediction(entry);

        return [
            normalizeTeam(prediction.home),
            normalizeTeam(prediction.away),
            entry.createdAt || "",
            index
        ].join("|");
    }

    function getPredictionDate(entry) {
        const prediction = getPrediction(entry);

        const value =
            entry.createdAt ||
            entry.predictionTime ||
            prediction.predictionTime ||
            prediction.asOf ||
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

    function getTeamNames(entry) {
        const prediction = getPrediction(entry);

        return {
            home: normalizeTeam(
                prediction.home ||
                entry.home ||
                entry.homeTeam ||
                entry.home_team
            ),

            away: normalizeTeam(
                prediction.away ||
                entry.away ||
                entry.awayTeam ||
                entry.away_team
            )
        };
    }

    function getCompetition(entry) {
        const prediction = getPrediction(entry);

        return normalizeCompetition(
            prediction.competition ||
            prediction.competitionCode ||
            prediction.league ||
            entry.competition ||
            entry.competitionCode ||
            entry.league ||
            ""
        );
    }

    /* =====================================================
       PREDICTION SNAPSHOT
       ===================================================== */

    function getPredictedLambda(entry, side) {
        const prediction = getPrediction(entry);

        const lambda = isObject(prediction.lambda)
            ? prediction.lambda
            : null;

        if (lambda) {
            const value = side === "home"
                ? lambda.home
                : lambda.away;

            if (finiteNumber(value)) {
                return value;
            }
        }

        const candidates = side === "home"
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

        for (const value of candidates) {
            if (finiteNumber(value)) {
                return value;
            }
        }

        /*
         * Never fabricate a lambda when missing.
         */
        return null;
    }

    function normalizeOutcome(value) {
        if (typeof value !== "string") {
            return null;
        }

        const outcome = value.trim().toUpperCase();

        if (
            outcome === "HOME" ||
            outcome === "1"
        ) {
            return "HOME";
        }

        if (
            outcome === "DRAW" ||
            outcome === "X"
        ) {
            return "DRAW";
        }

        if (
            outcome === "AWAY" ||
            outcome === "2"
        ) {
            return "AWAY";
        }

        return null;
    }

    function getPredictedOutcome(entry) {
        const prediction = getPrediction(entry);

        const direct =
            normalizeOutcome(prediction.outcome) ||
            normalizeOutcome(prediction.predictedOutcome) ||
            normalizeOutcome(prediction.result);

        if (direct) {
            return direct;
        }

        /*
         * Current index.html uses probabilities1X2.
         * Legacy probabilities are also supported.
         */
        const probabilities =
            isObject(prediction.probabilities1X2)
                ? prediction.probabilities1X2
                : isObject(prediction.probabilities)
                    ? prediction.probabilities
                    : null;

        if (!probabilities) {
            return null;
        }

        const candidates = [
            {
                name: "HOME",
                value:
                    probabilities.home ??
                    probabilities.HOME ??
                    probabilities["1"]
            },
            {
                name: "DRAW",
                value:
                    probabilities.draw ??
                    probabilities.DRAW ??
                    probabilities["X"]
            },
            {
                name: "AWAY",
                value:
                    probabilities.away ??
                    probabilities.AWAY ??
                    probabilities["2"]
            }
        ].filter(item => finiteNumber(item.value));

        if (!candidates.length) {
            return null;
        }

        candidates.sort(
            (a, b) => b.value - a.value
        );

        return candidates[0].name;
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

    function calculateLambdaError(predicted, actual) {
        if (
            !finiteNumber(predicted) ||
            !finiteNumber(actual)
        ) {
            return null;
        }

        return actual - predicted;
    }

    /* =====================================================
       LEARNING RECORD
       ===================================================== */

    function createLearningRecord(
        entry,
        fact,
        predictionId
    ) {
        const teams = getTeamNames(entry);

        if (!teams.home || !teams.away) {
            return null;
        }

        const predictionDate =
            getPredictionDate(entry);

        const predictedLambdaHome =
            getPredictedLambda(entry, "home");

        const predictedLambdaAway =
            getPredictedLambda(entry, "away");

        const predictedOutcome =
            getPredictedOutcome(entry);

        const actualOutcome =
            factualOutcome(
                fact.homeGoals,
                fact.awayGoals
            );

        const competition =
            getCompetition(entry);

        return {
            id: `learn:${predictionId}`,

            version: VERSION,

            predictionId,

            predictionDate,

            factDate:
                fact.factDate || nowISO(),

            home: teams.home,
            away: teams.away,

            competition:
                competition || null,

            predicted: {
                outcome: predictedOutcome,
                lambdaHome: predictedLambdaHome,
                lambdaAway: predictedLambdaAway
            },

            fact: {
                homeGoals: fact.homeGoals,
                awayGoals: fact.awayGoals,
                outcome: actualOutcome,

                btts:
                    fact.homeGoals > 0 &&
                    fact.awayGoals > 0,

                over25:
                    fact.homeGoals +
                    fact.awayGoals > 2.5
            },

            error: {
                outcome:
                    predictedOutcome !== null
                        ? predictedOutcome !== actualOutcome
                        : null,

                lambdaHome:
                    calculateLambdaError(
                        predictedLambdaHome,
                        fact.homeGoals
                    ),

                lambdaAway:
                    calculateLambdaError(
                        predictedLambdaAway,
                        fact.awayGoals
                    )
            },

            /*
             * Rating updates are intentionally not performed
             * by this shadow controller.
             *
             * A rating idempotency contract is required first.
             */
            ratingUpdated: false,
            ratingStatus: "NOT_UPDATED_SHADOW_MODE",

            createdAt: nowISO()
        };
    }

    function recordExists(records, recordId) {
        return records.some(
            record =>
                record &&
                record.id === recordId
        );
    }

    /* =====================================================
       STATISTICS
       ===================================================== */

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
            record =>
                typeof record.error?.outcome === "boolean"
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
                    ? 1 -
                      outcomeMisses /
                      outcomeRecords.length
                    : null
        };
    }

    function getGlobalAdjustments(records) {
        const stats = aggregate(records);

        const result = {
            status: "INSUFFICIENT_DATA",
            mode: MODE,
            samples: stats.lambdaCount,
            generatedAt: nowISO()
        };

        if (
            stats.lambdaCount <
            LIMITS.minGlobalSamples
        ) {
            return result;
        }

        let hasSignal = false;

        if (
            finiteNumber(stats.averageHomeError) &&
            Math.abs(stats.averageHomeError) >=
                LIMITS.minCorrectionMagnitude
        ) {
            result.lambdaHomeCorrection = clamp(
                stats.averageHomeError * 0.25,
                -LIMITS.globalLambdaMax,
                LIMITS.globalLambdaMax
            );

            hasSignal = true;
        }

        if (
            finiteNumber(stats.averageAwayError) &&
            Math.abs(stats.averageAwayError) >=
                LIMITS.minCorrectionMagnitude
        ) {
            result.lambdaAwayCorrection = clamp(
                stats.averageAwayError * 0.25,
                -LIMITS.globalLambdaMax,
                LIMITS.globalLambdaMax
            );

            hasSignal = true;
        }

        result.status = hasSignal
            ? "PROPOSED_SHADOW"
            : "NO_STABLE_SIGNAL";

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
                        record.error?.lambdaHome
                },
                {
                    team: record.away,
                    error:
                        record.error?.lambdaAway
                }
            ];

            for (const item of teams) {
                if (
                    !item.team ||
                    !finiteNumber(item.error)
                ) {
                    continue;
                }

                if (!grouped[item.team]) {
                    grouped[item.team] = [];
                }

                grouped[item.team].push(
                    item.error
                );
            }
        }

        const result = {};

        for (
            const [team, errors]
            of Object.entries(grouped)
        ) {
            if (
                errors.length <
                LIMITS.minTeamSamples
            ) {
                continue;
            }

            const average =
                errors.reduce(
                    (sum, value) => sum + value,
                    0
                ) / errors.length;

            if (
                Math.abs(average) <
                LIMITS.minCorrectionMagnitude
            ) {
                continue;
            }

            result[team] = {
                status: "PROPOSED_SHADOW",

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

    /* =====================================================
       CHALLENGER
       ===================================================== */

    function createChallenger(records) {
        const existing = loadJSON(
            CHALLENGER_KEY,
            null
        );

        /*
         * Do not overwrite an existing candidate.
         * Challenger must be validated separately.
         */
        if (isObject(existing)) {
            return existing;
        }

        const usableLambdaRecords =
            records.filter(record =>
                finiteNumber(record?.predicted?.lambdaHome) &&
                finiteNumber(record?.predicted?.lambdaAway) &&
                finiteNumber(record?.fact?.homeGoals) &&
                finiteNumber(record?.fact?.awayGoals) &&
                Boolean(record?.predictionDate)
            );

        const challenger = {
            version: "FEG-CHALLENGER-0.1.0",

            status: "READY_FOR_WALK_FORWARD",

            mode: MODE,

            createdAt: nowISO(),

            basedOnLearningRecords:
                records.length,

            usableForLambdaValidation:
                usableLambdaRecords.length,

            parentBrain:
                window.FEG_BRAIN_VERSION ||
                "unknown",

            parentEXG:
                window.FEG_EXG_VERSION ||
                "unknown",

            changes: {
                global:
                    getGlobalAdjustments(records),

                teams:
                    getTeamAdjustments(records)
            },

            validation: {
                walkForward: "NOT_RUN",
                statisticalCheck: "NOT_RUN",
                promotion: "DISABLED"
            },

            rule:
                "Candidate only. No automatic formula promotion."
        };

        if (!saveJSON(CHALLENGER_KEY, challenger)) {
            return null;
        }

        return challenger;
    }

    /* =====================================================
       CHECKPOINTS
       ===================================================== */

    function processCheckpoint88(records, state) {
        if (records.length < CHECKPOINTS.short) {
            state.checkpoints.short88.reached = false;
            state.checkpoints.short88.status = "WAITING";
            return;
        }

        state.checkpoints.short88.reached = true;

        /*
         * Recalculate the proposal as new evidence arrives.
         * This does NOT apply the proposal to Brain.
         */
        const proposal =
            getGlobalAdjustments(records);

        state.adjustments.global = proposal;

        state.checkpoints.short88.status =
            proposal.status;

        state.checkpoints.short88.processedAt =
            nowISO();
    }

    function processCheckpoint264(records, state) {
        if (records.length < CHECKPOINTS.deep) {
            state.checkpoints.deep264.reached = false;
            state.checkpoints.deep264.status = "WAITING";
            return;
        }

        state.checkpoints.deep264.reached = true;

        state.adjustments.teams =
            getTeamAdjustments(records);

        state.checkpoints.deep264.status =
            "PROPOSED_SHADOW";

        state.checkpoints.deep264.processedAt =
            nowISO();
    }

    function processCheckpoint999(records, state) {
        if (
            records.length <
            CHECKPOINTS.laboratory
        ) {
            state.checkpoints.laboratory999.reached = false;
            state.checkpoints.laboratory999.status = "WAITING";
            return;
        }

        state.checkpoints.laboratory999.reached = true;

        const challenger =
            createChallenger(records);

        state.checkpoints.laboratory999.status =
            challenger
                ? challenger.status
                : "SAVE_FAILED";

        state.checkpoints.laboratory999.processedAt =
            nowISO();
    }

    /* =====================================================
       JOURNAL STATISTICS
       ===================================================== */

    function updateStatistics(
        state,
        records,
        journal
    ) {
        let evaluated = 0;
        let pending = 0;
        let invalid = 0;

        for (const entry of journal) {
            if (!isObject(entry)) {
                invalid++;
                continue;
            }

            if (entry.status === "DELETED") {
                continue;
            }

            const fact = extractFact(entry);

            if (fact) {
                const teams = getTeamNames(entry);

                if (teams.home && teams.away) {
                    evaluated++;
                } else {
                    invalid++;
                }

                continue;
            }

            /*
             * A FINISHED entry without a valid fact is not
             * silently counted as an ordinary pending match.
             */
            if (entry.status === "FINISHED") {
                invalid++;
            } else {
                pending++;
            }
        }

        state.statistics = {
            totalJournalEntries: journal.length,

            evaluatedRecords: evaluated,

            pendingRecords: pending,

            invalidRecords: invalid,

            learningRecords: records.length,

            recordsWithoutLambda:
                records.filter(record =>
                    !finiteNumber(
                        record.predicted?.lambdaHome
                    ) ||
                    !finiteNumber(
                        record.predicted?.lambdaAway
                    )
                ).length
        };
    }

    /* =====================================================
       MAIN PROCESS
       ===================================================== */

    function processFinishedPredictions() {
        const journal = getJournal();

        const memory = getLearningMemory();

        const state = getState();

        const existingRecords =
            memory.records;

        const newRecords = [];

        let invalidFinishedEntries = 0;

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

            if (!isObject(entry)) {
                continue;
            }

            if (entry.status === "DELETED") {
                continue;
            }

            const fact = extractFact(entry);

            if (!fact) {
                if (entry.status === "FINISHED") {
                    invalidFinishedEntries++;
                }

                continue;
            }

            const teams = getTeamNames(entry);

            if (!teams.home || !teams.away) {
                invalidFinishedEntries++;
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
                ) ||
                recordExists(
                    newRecords,
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
                invalidFinishedEntries++;
                continue;
            }

            newRecords.push(record);
        }

        /*
         * Persist learning records before updating controller
         * state. Existing records are preserved.
         *
         * No rating mutation is performed in this shadow mode.
         */
        let committedRecords = existingRecords;

        if (newRecords.length > 0) {
            const nextMemory = {
                ...memory,

                version: "FEG-MEMORY-0.2",

                records:
                    existingRecords.concat(newRecords),

                updatedAt: nowISO()
            };

            if (
                saveJSON(
                    LEARNING_KEY,
                    nextMemory
                )
            ) {
                committedRecords =
                    nextMemory.records;
            } else {
                console.error(
                    "[FEG Learning] Learning memory was not saved; " +
                    "controller state will not count these new records."
                );
            }
        }

        /*
         * Reload committed memory so that a failed save does not
         * advance checkpoints using uncommitted records.
         */
        const verifiedMemory =
            getLearningMemory();

        const records =
            verifiedMemory.records;

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

        state.statistics.invalidRecords +=
            invalidFinishedEntries;

        const stateSaved =
            saveState(state);

        return {
            version: VERSION,

            mode: MODE,

            processedFacts: records.length,

            newFacts:
                Math.max(
                    0,
                    records.length -
                    existingRecords.length
                ),

            ratingUpdates: 0,

            ratingStatus:
                "DISABLED_PENDING_IDEMPOTENCY_CONTRACT",

            stateSaved,

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

    /* =====================================================
       PUBLIC API
       ===================================================== */

    function getAdjustments() {
        const state = getState();

        return {
            mode: MODE,

            global:
                state.adjustments?.global || {},

            teams:
                state.adjustments?.teams || {}
        };
    }

    /*
     * These getters expose candidate values for diagnostics only.
     * They do NOT apply them to brain.js.
     */

    function getGlobalLambdaHomeAdjustment() {
        const state = getState();

        const proposal =
            state.adjustments?.global || {};

        return proposal.status === "PROPOSED_SHADOW" &&
            finiteNumber(
                proposal.lambdaHomeCorrection
            )
                ? proposal.lambdaHomeCorrection
                : 0;
    }

    function getGlobalLambdaAwayAdjustment() {
        const state = getState();

        const proposal =
            state.adjustments?.global || {};

        return proposal.status === "PROPOSED_SHADOW" &&
            finiteNumber(
                proposal.lambdaAwayCorrection
            )
                ? proposal.lambdaAwayCorrection
                : 0;
    }

    function getTeamLambdaAdjustment(team) {
        const state = getState();

        const adjustment =
            state.adjustments?.teams?.[team];

        if (
            !adjustment ||
            adjustment.status !== "PROPOSED_SHADOW" ||
            !finiteNumber(adjustment.lambdaCorrection)
        ) {
            return 0;
        }

        return adjustment.lambdaCorrection;
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

            mode: MODE,

            championAutoPromotion: false,

            formulaAutoApplication: false,

            ratingAutoUpdate: false,

            stage,

            processedFacts: facts,

            to88: Math.max(
                0,
                CHECKPOINTS.short - facts
            ),

            to264: Math.max(
                0,
                CHECKPOINTS.deep - facts
            ),

            to999: Math.max(
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
         * Removes only controller state.
         * Does NOT delete journal, learning memory,
         * rating, or Challenger.
         */
        try {
            localStorage.removeItem(STATE_KEY);
            return true;
        } catch (error) {
            console.error(
                "[FEG Learning] Reset error:",
                error
            );

            return false;
        }
    }

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

    /* =====================================================
       SAFE STARTUP
       ===================================================== */

    function startup() {
        try {
            processFinishedPredictions();
        } catch (error) {
            console.error(
                "[FEG Learning] Startup error:",
                error
            );
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            startup,
            { once: true }
        );
    } else {
        startup();
    }

})();
