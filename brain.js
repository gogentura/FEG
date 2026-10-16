/*
 * FEG — Football Evolution God
 * SUPER BRAIN v0.1.0
 *
 * FIX: история команды содержит только матчи
 * с подтверждённым числовым счётом.
 *
 * FIX: minMatches поднят с 3 до 5,
 * чтобы Brain не считал прогнозы
 * на командах с короткой историей.
 *
 * Формула и параметры Brain 0.1.0 сохранены.
 * Missing != 0.
 */

"use strict";

const FEG_BRAIN_VERSION = "0.1.0";
const FEG_EXG_VERSION = "0.1.0";

const EPS = 1e-12;

const CONFIG = Object.freeze({
    minMatches: 5,
    formMatches: 5,
    exgMatches: 6,
    exgWeights: Object.freeze([1, 2, 3, 1, 3, 4]),
    regularization: 2,
    minLambda: 0.15,
    maxLambda: 5.0,
    maxGoals: 9,
    homeAdvantage: 1.08,
    eloStart: 1500,
    eloK: 20,
    eloHomeAdvantage: 60,
    maxExgStabilityBonus: 0.25
});

/* ============================================================
 * BASIC HELPERS
 * ============================================================ */

function finiteNumber(value) {
    return typeof value === "number" &&
        Number.isFinite(value);
}

function numberOrNull(value) {
    return finiteNumber(value) ? value : null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function safeDivide(a, b, fallback = null) {
    if (!finiteNumber(a) || !finiteNumber(b) || Math.abs(b) < EPS) {
        return fallback;
    }
    return a / b;
}

function mean(values) {
    const valid = values.filter(finiteNumber);
    if (!valid.length) return null;

    return valid.reduce((sum, x) => sum + x, 0) / valid.length;
}

function weightedMean(values, weights) {
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        const weight = weights[i];

        if (!finiteNumber(value) || !finiteNumber(weight)) {
            continue;
        }

        numerator += value * weight;
        denominator += weight;
    }

    return denominator > EPS ? numerator / denominator : null;
}

function standardDeviation(values) {
    const valid = values.filter(finiteNumber);
    if (valid.length < 2) return null;

    const avg = mean(valid);
    if (!finiteNumber(avg)) return null;

    const variance = valid.reduce(
        (sum, x) => sum + Math.pow(x - avg, 2),
        0
    ) / valid.length;

    return Math.sqrt(variance);
}

function normalizeProbabilities(values) {
    const safe = values.map(x =>
        finiteNumber(x) && x >= 0 ? x : 0
    );

    const total = safe.reduce((sum, x) => sum + x, 0);
    if (total <= EPS) return safe.map(() => 0);

    return safe.map(x => x / total);
}

function round(value, digits = 4) {
    if (!finiteNumber(value)) return null;

    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

/* ============================================================
 * DATE / MATCH HELPERS
 * ============================================================ */

function matchDate(match) {
    const raw =
        match?.date ||
        match?.utcDate ||
        match?.kickoff ||
        match?.matchDate ||
        null;

    if (!raw) return null;

    const timestamp = Date.parse(raw);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isFinished(match) {
    if (!match || typeof match !== "object") {
        return false;
    }

    const homeGoals = match.home_goals;
    const awayGoals = match.away_goals;

    return (
        finiteNumber(homeGoals) &&
        finiteNumber(awayGoals) &&
        homeGoals >= 0 &&
        awayGoals >= 0
    );
}

function matchBefore(match, asOf) {
    if (!asOf) return true;

    const matchTs = matchDate(match);
    if (matchTs === null) return false;

    const asOfTs =
        asOf instanceof Date
            ? asOf.getTime()
            : Date.parse(asOf);

    if (!Number.isFinite(asOfTs)) return true;

    return matchTs < asOfTs;
}

/* ============================================================
 * HISTORY
 * ============================================================ */

function cleanResults(results) {
    if (!Array.isArray(results)) return [];

    return results
        .filter(isFinished)
        .map(match => ({
            ...match,
            _timestamp: matchDate(match)
        }))
        .filter(match => match._timestamp !== null)
        .sort((a, b) => a._timestamp - b._timestamp);
}

function getTeamMatches(results, team, asOf = null) {
    const name = String(team || "").trim();
    if (!name) return [];

    return results.filter(match => {
        if (!matchBefore(match, asOf)) return false;

        return match.home === name || match.away === name;
    });
}

function getLeagueMatches(results, competition, asOf = null) {
    return results.filter(match => {
        if (!matchBefore(match, asOf)) return false;
        if (!competition) return true;

        return match.competition === competition;
    });
}

/* ============================================================
 * TEAM FORM
 * ============================================================ */

function resultForTeam(match, team) {
    let gf;
    let ga;

    if (match.home === team) {
        gf = match.home_goals;
        ga = match.away_goals;
    } else if (match.away === team) {
        gf = match.away_goals;
        ga = match.home_goals;
    } else {
        return null;
    }

    if (!finiteNumber(gf) || !finiteNumber(ga)) {
        return null;
    }

    if (gf > ga) return "W";
    if (gf < ga) return "L";
    return "D";
}

function formValue(result) {
    if (result === "W") return 1;
    if (result === "D") return 0.5;
    if (result === "L") return 0;

    return null;
}

function getForm(matches, team, count = CONFIG.formMatches) {
    const recent = matches.slice(-count);

    const sequence = recent.map(match => ({
        date: match.date || match.utcDate || match.kickoff || null,
        result: resultForTeam(match, team)
    }));

    const values = sequence
        .map(item => formValue(item.result))
        .filter(finiteNumber);

    return {
        matches: values.length,
        value: mean(values),
        sequence
    };
}

/* ============================================================
 * GOALS / ATTACK / DEFENCE
 * ============================================================ */

function teamGoals(match, team) {
    if (match.home === team) {
        return {
            gf: match.home_goals,
            ga: match.away_goals
        };
    }

    if (match.away === team) {
        return {
            gf: match.away_goals,
            ga: match.home_goals
        };
    }

    return { gf: null, ga: null };
}

function getGoalStats(matches, team) {
    const values = [];

    for (const match of matches) {
        const goals = teamGoals(match, team);

        if (
            finiteNumber(goals.gf) &&
            finiteNumber(goals.ga)
        ) {
            values.push(goals);
        }
    }

    const gf = values.map(x => x.gf);
    const ga = values.map(x => x.ga);

    return {
        matches: values.length,
        goalsFor: mean(gf),
        goalsAgainst: mean(ga),
        totalGoalsFor: gf.reduce((a, b) => a + b, 0),
        totalGoalsAgainst: ga.reduce((a, b) => a + b, 0)
    };
}

/* ============================================================
 * HOME / AWAY MEMORY
 * ============================================================ */

function getVenueStats(matches, team, venue) {
    const filtered = matches.filter(match => {
        if (venue === "home") return match.home === team;
        if (venue === "away") return match.away === team;
        return true;
    });

    return getGoalStats(filtered, team);
}

/* ============================================================
 * LEAGUE AVERAGES
 * ============================================================ */

function getLeagueAverages(matches) {
    const homeGoals = [];
    const awayGoals = [];

    for (const match of matches) {
        if (
            finiteNumber(match.home_goals) &&
            finiteNumber(match.away_goals)
        ) {
            homeGoals.push(match.home_goals);
            awayGoals.push(match.away_goals);
        }
    }

    return {
        matches: homeGoals.length,
        homeGoals: mean(homeGoals),
        awayGoals: mean(awayGoals),
        totalGoals: mean(
            homeGoals.map((x, i) => x + awayGoals[i])
        )
    };
}

/* ============================================================
 * FEG ESTIMATED xG
 * ============================================================ */

function calculateEstimatedXG(matches, team) {
    const recent = matches.slice(-CONFIG.exgMatches);

    if (!recent.length) {
        return {
            available: false,
            version: FEG_EXG_VERSION,
            matchesUsed: 0,
            base: null,
            stability: null,
            estimatedXG: null
        };
    }

    const values = recent.map(match => {
        const goals = teamGoals(match, team);
        return finiteNumber(goals.gf) ? goals.gf : null;
    });

    const weights = CONFIG.exgWeights.slice(
        CONFIG.exgWeights.length - values.length
    );

    const base = weightedMean(values, weights);
    const valid = values.filter(finiteNumber);

    if (!finiteNumber(base) || !valid.length) {
        return {
            available: false,
            version: FEG_EXG_VERSION,
            matchesUsed: valid.length,
            base: null,
            stability: null,
            estimatedXG: null
        };
    }

    const sd = standardDeviation(valid);
    const stability = finiteNumber(sd) ? 1 / (1 + sd) : 1;
    const bonus = CONFIG.maxExgStabilityBonus * stability;
    const estimatedXG = base * (0.75 + bonus);

    return {
        available: true,
        version: FEG_EXG_VERSION,
        matchesUsed: valid.length,
        values,
        weights,
        base: round(base),
        standardDeviation: round(sd),
        stability: round(stability),
        estimatedXG: round(Math.max(0, estimatedXG)),
        experimental: true,
        note:
            "FEG Estimated xG v0.1. " +
            "Proxy based on historical goals; not provider xG."
    };
}

/* ============================================================
 * OPPONENT STRENGTH
 * ============================================================ */

function opponentOf(match, team) {
    if (match.home === team) return match.away;
    if (match.away === team) return match.home;
    return null;
}

function getOpponentStrength(results, matches, team, asOf = null) {
    const opponents = [];

    for (const match of matches) {
        const opponent = opponentOf(match, team);
        if (!opponent) continue;

        const opponentMatches = getTeamMatches(
            results,
            opponent,
            asOf
        );

        const stats = getGoalStats(opponentMatches, opponent);

        if (stats.matches > 0) {
            opponents.push({
                opponent,
                matches: stats.matches,
                goalsFor: stats.goalsFor,
                goalsAgainst: stats.goalsAgainst
            });
        }
    }

    if (!opponents.length) {
        return {
            available: false,
            count: 0,
            average: null,
            opponents: []
        };
    }

    const strengths = opponents
        .map(item => {
            if (
                !finiteNumber(item.goalsFor) ||
                !finiteNumber(item.goalsAgainst)
            ) {
                return null;
            }

            return item.goalsFor +
                (1 / Math.max(0.25, item.goalsAgainst));
        })
        .filter(finiteNumber);

    return {
        available: strengths.length > 0,
        count: strengths.length,
        average: mean(strengths),
        opponents
    };
}

/* ============================================================
 * ELO
 * ============================================================ */

function expectedElo(homeRating, awayRating) {
    const diff =
        homeRating -
        awayRating +
        CONFIG.eloHomeAdvantage;

    return 1 / (1 + Math.pow(10, -diff / 400));
}

function eloUpdate(homeRating, awayRating, homeGoals, awayGoals) {
    const expected = expectedElo(homeRating, awayRating);

    let actual = 0.5;
    if (homeGoals > awayGoals) actual = 1;
    else if (homeGoals < awayGoals) actual = 0;

    const goalDifference = Math.abs(homeGoals - awayGoals);
    let multiplier = 1;

    if (goalDifference === 2) multiplier = 1.5;
    else if (goalDifference >= 3) {
        multiplier = (11 + goalDifference) / 8;
    }

    const delta =
        CONFIG.eloK *
        multiplier *
        (actual - expected);

    return {
        home: homeRating + delta,
        away: awayRating - delta,
        delta
    };
}

function buildEloRatings(results, competition = null, asOf = null) {
    const ratings = {};

    const matches = getLeagueMatches(results, null, asOf);

    for (const match of matches) {
        const home = match.home;
        const away = match.away;

        if (!home || !away) continue;
        if (!isFinished(match)) continue;

        const homeRating = finiteNumber(ratings[home])
            ? ratings[home]
            : CONFIG.eloStart;

        const awayRating = finiteNumber(ratings[away])
            ? ratings[away]
            : CONFIG.eloStart;

        const updated = eloUpdate(
            homeRating,
            awayRating,
            match.home_goals,
            match.away_goals
        );

        ratings[home] = updated.home;
        ratings[away] = updated.away;
    }

    return ratings;
}

function buildTeamState(results, team, competition = null, asOf = null) {
    const matches = getTeamMatches(results, team, asOf);

    const stats = getGoalStats(matches, team);
    const home = getVenueStats(matches, team, "home");
    const away = getVenueStats(matches, team, "away");
    const form = getForm(matches, team, CONFIG.formMatches);
    const exg = calculateEstimatedXG(matches, team);

    const opponentStrength = getOpponentStrength(
        results,
        matches.slice(-6),
        team,
        asOf
    );

    const eloRatings = buildEloRatings(
        results,
        null,
        asOf
    );

    const elo = finiteNumber(eloRatings[team])
        ? eloRatings[team]
        : CONFIG.eloStart;

    return {
        team,
        competition: competition || null,

        matches: matches.length,

        goalsForPerMatch: round(stats.goalsFor),
        goalsAgainstPerMatch: round(stats.goalsAgainst),

        home: {
            matches: home.matches,
            goalsFor: round(home.goalsFor),
            goalsAgainst: round(home.goalsAgainst)
        },

        away: {
            matches: away.matches,
            goalsFor: round(away.goalsFor),
            goalsAgainst: round(away.goalsAgainst)
        },

        form,
        estimatedXG: exg,
        opponentStrength,
        elo: round(elo, 2),

        evidence: {
            minimumReached: matches.length >= CONFIG.minMatches,
            formAvailable: form.matches > 0,
            exgAvailable: exg.available,
            sevenMatchThreshold: matches.length >= 7
        }
    };
}

/* ============================================================
 * ATTACK / DEFENCE
 * ============================================================ */

function calculateAttackDefence(teamState, league) {
    if (
        !teamState ||
        !league ||
        !finiteNumber(league.homeGoals) ||
        !finiteNumber(league.awayGoals)
    ) {
        return { attack: null, defence: null };
    }

    const teamGoals = finiteNumber(teamState.goalsForPerMatch)
        ? teamState.goalsForPerMatch
        : null;

    const teamAgainst = finiteNumber(teamState.goalsAgainstPerMatch)
        ? teamState.goalsAgainstPerMatch
        : null;

    const attackBase = safeDivide(
        teamGoals,
        league.totalGoals / 2
    );

    const defenceBase = safeDivide(
        teamAgainst,
        league.totalGoals / 2
    );

    return {
        attack: finiteNumber(attackBase)
            ? clamp(attackBase, 0.25, 3.0)
            : null,

        defence: finiteNumber(defenceBase)
            ? clamp(defenceBase, 0.25, 3.0)
            : null
    };
}

/* ============================================================
 * LAMBDA
 * ============================================================ */

function calculateLambdas(homeState, awayState, league) {
    if (!homeState || !awayState || !league) return null;

    const leagueHome = league.homeGoals;
    const leagueAway = league.awayGoals;

    if (
        !finiteNumber(leagueHome) ||
        !finiteNumber(leagueAway)
    ) {
        return null;
    }

    const homeAD = calculateAttackDefence(homeState, league);
    const awayAD = calculateAttackDefence(awayState, league);

    if (
        !finiteNumber(homeAD.attack) ||
        !finiteNumber(homeAD.defence) ||
        !finiteNumber(awayAD.attack) ||
        !finiteNumber(awayAD.defence)
    ) {
        return null;
    }

    let lambdaHome =
        leagueHome *
        homeAD.attack *
        awayAD.defence;

    let lambdaAway =
        leagueAway *
        awayAD.attack *
        homeAD.defence;

    if (
        finiteNumber(homeState.form.value) &&
        finiteNumber(awayState.form.value)
    ) {
        const homeFormFactor = 0.92 + homeState.form.value * 0.16;
        const awayFormFactor = 0.92 + awayState.form.value * 0.16;

        lambdaHome *= homeFormFactor;
        lambdaAway *= awayFormFactor;
    }

    lambdaHome *= CONFIG.homeAdvantage;

    if (
        homeState.estimatedXG.available &&
        awayState.estimatedXG.available
    ) {
        const homeExg = homeState.estimatedXG.estimatedXG;
        const awayExg = awayState.estimatedXG.estimatedXG;

        if (finiteNumber(homeExg) && finiteNumber(awayExg)) {
            lambdaHome = 0.80 * lambdaHome + 0.20 * homeExg;
            lambdaAway = 0.80 * lambdaAway + 0.20 * awayExg;
        }
    }

    return {
        lambdaHome: clamp(
            lambdaHome,
            CONFIG.minLambda,
            CONFIG.maxLambda
        ),

        lambdaAway: clamp(
            lambdaAway,
            CONFIG.minLambda,
            CONFIG.maxLambda
        ),

        components: {
            homeAttack: homeAD.attack,
            homeDefence: homeAD.defence,
            awayAttack: awayAD.attack,
            awayDefence: awayAD.defence
        }
    };
}

/* ============================================================
 * POISSON
 * ============================================================ */

function factorial(n) {
    if (n < 0) return null;

    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;

    return result;
}

function poissonProbability(goals, lambda) {
    if (
        !finiteNumber(goals) ||
        !finiteNumber(lambda) ||
        lambda < 0
    ) {
        return 0;
    }

    return (
        Math.exp(-lambda) *
        Math.pow(lambda, goals) /
        factorial(goals)
    );
}

function buildScoreMatrix(lambdaHome, lambdaAway) {
    const matrix = [];

    for (let homeGoals = 0; homeGoals <= CONFIG.maxGoals; homeGoals++) {
        const row = [];
        const homeProbability = poissonProbability(homeGoals, lambdaHome);

        for (let awayGoals = 0; awayGoals <= CONFIG.maxGoals; awayGoals++) {
            const awayProbability = poissonProbability(awayGoals, lambdaAway);

            row.push({
                homeGoals,
                awayGoals,
                probability: homeProbability * awayProbability
            });
        }

        matrix.push(row);
    }

    return matrix;
}

/* ============================================================
 * OUTCOME PROBABILITIES
 * ============================================================ */

function probabilitiesFromMatrix(matrix) {
    let home = 0;
    let draw = 0;
    let away = 0;
    let bttsYes = 0;
    let over25 = 0;
    let over15 = 0;
    let over35 = 0;

    const scores = [];

    for (const row of matrix) {
        for (const item of row) {
            const p = item.probability;

            if (item.homeGoals > item.awayGoals) home += p;
            else if (item.homeGoals === item.awayGoals) draw += p;
            else away += p;

            if (item.homeGoals > 0 && item.awayGoals > 0) {
                bttsYes += p;
            }

            const total = item.homeGoals + item.awayGoals;
            if (total >= 2) over15 += p;
            if (total >= 3) over25 += p;
            if (total >= 4) over35 += p;

            scores.push(item);
        }
    }

    const normalized = normalizeProbabilities([home, draw, away]);

    scores.sort((a, b) => b.probability - a.probability);

    return {
        "1": normalized[0],
        "X": normalized[1],
        "2": normalized[2],

        btts: {
            yes: bttsYes,
            no: 1 - bttsYes
        },

        totals: {
            over15,
            under15: 1 - over15,
            over25,
            under25: 1 - over25,
            over35,
            under35: 1 - over35
        },

        topScores: scores.slice(0, 5).map(item => ({
            score: `${item.homeGoals}:${item.awayGoals}`,
            homeGoals: item.homeGoals,
            awayGoals: item.awayGoals,
            probability: item.probability
        }))
    };
}

/* ============================================================
 * DATA QUALITY
 * ============================================================ */

function dataQuality(homeState, awayState) {
    const checks = {
        homeMinimum: homeState.matches >= CONFIG.minMatches,
        awayMinimum: awayState.matches >= CONFIG.minMatches,
        homeForm: homeState.form.matches > 0,
        awayForm: awayState.form.matches > 0,
        homeExg: homeState.estimatedXG.available,
        awayExg: awayState.estimatedXG.available,
        homeSeven: homeState.matches >= 7,
        awaySeven: awayState.matches >= 7
    };

    const values = Object.values(checks).map(Boolean);

    const score = values.length
        ? values.filter(Boolean).length / values.length
        : 0;

    return {
        score: round(score, 3),
        checks
    };
}

/* ============================================================
 * BRAIN
 * ============================================================ */

class FEGBRAIN {
    constructor(results = [], memory = null) {
        this.version = FEG_BRAIN_VERSION;
        this.results = cleanResults(results);
        this.memory = memory || null;
    }

    getTeamState(team, competition = null, asOf = null) {
        return buildTeamState(
            this.results,
            team,
            competition,
            asOf
        );
    }

    predict({ home, away, competition = null, asOf = null }) {
        if (!home || !away) {
            return {
                status: "INVALID_INPUT",
                brainVersion: this.version
            };
        }

        if (home === away) {
            return {
                status: "INVALID_INPUT",
                reason: "Home and away teams must differ.",
                brainVersion: this.version
            };
        }

        const leagueMatches = getLeagueMatches(
            this.results,
            competition,
            asOf
        );

        const league = getLeagueAverages(leagueMatches);

        const homeState = this.getTeamState(
            home,
            competition,
            asOf
        );

        const awayState = this.getTeamState(
            away,
            competition,
            asOf
        );

        const quality = dataQuality(homeState, awayState);

        if (
            homeState.matches < CONFIG.minMatches ||
            awayState.matches < CONFIG.minMatches ||
            !finiteNumber(league.homeGoals) ||
            !finiteNumber(league.awayGoals)
        ) {
            return {
                status: "INSUFFICIENT_DATA",
                brainVersion: this.version,
                home,
                away,
                competition,
                asOf: asOf || null,

                evidence: {
                    homeMatches: homeState.matches,
                    awayMatches: awayState.matches,
                    leagueMatches: league.matches
                },

                dataQuality: quality,
                homeState,
                awayState
            };
        }

        const lambdas = calculateLambdas(
            homeState,
            awayState,
            league
        );

        if (!lambdas) {
            return {
                status: "INSUFFICIENT_DATA",
                brainVersion: this.version,
                home,
                away,
                competition,
                homeState,
                awayState
            };
        }

        const matrix = buildScoreMatrix(
            lambdas.lambdaHome,
            lambdas.lambdaAway
        );

        const probabilities = probabilitiesFromMatrix(matrix);

        return {
            status: "OK",
            brain: "FEG SUPER BRAIN",
            brainVersion: this.version,
            model: "FEG_BRAIN_BASELINE",
            modelVersion: this.version,

            experimental: {
                estimatedXG: {
                    enabled: true,
                    version: FEG_EXG_VERSION,
                    warning:
                        "FEG eXG is an experimental estimated signal, not provider xG."
                }
            },

            home,
            away,
            competition,
            asOf: asOf || null,
            trainingMatches: league.matches,

            lambdaHome: round(lambdas.lambdaHome),
            lambdaAway: round(lambdas.lambdaAway),

            probabilities1X2: {
                "1": round(probabilities["1"]),
                "X": round(probabilities["X"]),
                "2": round(probabilities["2"])
            },

            btts: {
                yes: round(probabilities.btts.yes),
                no: round(probabilities.btts.no)
            },

            totals: {
                over15: round(probabilities.totals.over15),
                under15: round(probabilities.totals.under15),
                over25: round(probabilities.totals.over25),
                under25: round(probabilities.totals.under25),
                over35: round(probabilities.totals.over35),
                under35: round(probabilities.totals.under35)
            },

            topScores: probabilities.topScores.map(item => ({
                ...item,
                probability: round(item.probability)
            })),

            state: {
                home: homeState,
                away: awayState
            },

            league: {
                matches: league.matches,
                homeGoals: round(league.homeGoals),
                awayGoals: round(league.awayGoals),
                totalGoals: round(league.totalGoals)
            },

            dataQuality: quality,

            brainSignals: {
                form: true,
                attack: true,
                defence: true,
                homeAway: true,
                opponentStrength: true,
                elo: true,
                estimatedXG: true
            },

            evolution: {
                liveMemory: "READY",
                modelSelfModification: false,
                challengerLaboratory: "NOT_CONNECTED",
                walkForward: "NOT_CONNECTED",
                promotion: "NOT_CONNECTED"
            },

            journal: {
                ready: true
            }
        };
    }
}

/* ============================================================
 * BROWSER EXPORT
 * ============================================================ */

if (typeof window !== "undefined") {
    window.FEGBRAIN = FEGBRAIN;
    window.FEG_BRAIN_VERSION = FEG_BRAIN_VERSION;
    window.FEG_EXG_VERSION = FEG_EXG_VERSION;
}

/* ============================================================
 * NODE EXPORT
 * ============================================================ */

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        FEGBRAIN,
        FEG_BRAIN_VERSION,
        FEG_EXG_VERSION
    };
}
