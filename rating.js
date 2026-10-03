/*
 * FEG — Football Evolution God
 * CLUB RATING ENGINE v0.1.0
 *
 * Назначение:
 *   Живая память силы клубов.
 *
 * Принципы:
 *   1. Rating != Prediction.
 *   2. Rating != Fact.
 *   3. Rating обновляется только после факта.
 *   4. Будущие матчи не используются.
 *   5. Один матч не может резко изменить рейтинг.
 *   6. Prediction snapshot не изменяется после обновления Rating.
 *   7. Formula v0.1 не меняет сама себя.
 *
 * Storage:
 *   localStorage
 *
 * Key:
 *   FEG_RATINGS_V0_1
 *
 * Scale:
 *   0 — 100
 *
 * ============================================================
 */

"use strict";


/* ============================================================
 * VERSION / CONFIG
 * ============================================================
 */

const FEG_RATING_VERSION = "0.1.0";

const FEG_RATING_STORAGE_KEY =
    "FEG_RATINGS_V0_1";


const FEG_RATING_CONFIG = Object.freeze({

    /*
     * Начальный рейтинг нового клуба.
     */
    baseRating: 50,

    /*
     * Максимальное изменение
     * за один завершённый матч.
     */
    maxMatchChange: 2.5,

    /*
     * Базовая скорость обучения.
     */
    learningRate: 0.18,

    /*
     * Насколько учитываем разницу голов.
     *
     * Пока специально небольшая.
     * Формулу позже проверим на реальных данных.
     */
    goalDifferenceWeight: 0.10,

    /*
     * Домашний контекст.
     *
     * Это НЕ постоянная прибавка
     * к базовому рейтингу.
     */
    homeContext: 1.5,

    /*
     * Максимальная сила влияния
     * неожиданного результата.
     */
    surpriseLimit: 1.5,

    /*
     * После какого количества матчей
     * рейтинг считается более устойчивым.
     */
    confidenceMatches: 20

});


/* ============================================================
 * BASIC HELPERS
 * ============================================================
 */

function ratingFiniteNumber(value) {

    return (
        typeof value === "number" &&
        Number.isFinite(value)
    );

}


function ratingClamp(value, min, max) {

    return Math.max(
        min,
        Math.min(max, value)
    );

}


function ratingRound(value, digits = 4) {

    if (!ratingFiniteNumber(value)) {
        return null;
    }

    const factor =
        Math.pow(10, digits);

    return (
        Math.round(
            value * factor
        ) / factor
    );

}


function ratingTeamKey(team) {

    return String(
        team ?? ""
    )
        .trim()
        .toLowerCase();

}


/* ============================================================
 * STORAGE
 * ============================================================
 */

function loadFEGRatings() {

    try {

        const raw =
            localStorage.getItem(
                FEG_RATING_STORAGE_KEY
            );

        if (!raw) {
            return {};
        }

        const parsed =
            JSON.parse(raw);

        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {

            return {};

        }

        return parsed;

    } catch (error) {

        console.error(
            "FEG Rating load error:",
            error
        );

        return {};

    }

}


function saveFEGRatings(ratings) {

    try {

        localStorage.setItem(
            FEG_RATING_STORAGE_KEY,
            JSON.stringify(ratings)
        );

        return true;

    } catch (error) {

        console.error(
            "FEG Rating save error:",
            error
        );

        return false;

    }

}


/* ============================================================
 * NEW CLUB
 * ============================================================
 */

function createFEGClubRating(team) {

    const now =
        new Date().toISOString();

    return {

        ratingVersion:
            FEG_RATING_VERSION,

        team,

        baseRating:
            FEG_RATING_CONFIG.baseRating,

        currentRating:
            FEG_RATING_CONFIG.baseRating,

        homeRating:
            FEG_RATING_CONFIG.baseRating,

        awayRating:
            FEG_RATING_CONFIG.baseRating,

        matchCount: 0,

        homeMatchCount: 0,

        awayMatchCount: 0,

        opponentStrength: null,

        stability: 0,

        confidence: 0,

        recentTrend: 0,

        ratingHistory: [

            {

                date: now,

                rating:
                    FEG_RATING_CONFIG.baseRating,

                reason:
                    "INITIAL"

            }

        ],

        lastUpdated: now

    };

}


/* ============================================================
 * GET CLUB
 * ============================================================
 */

function getFEGClubRating(
    team,
    ratings = null
) {

    const allRatings =
        ratings || loadFEGRatings();

    const key =
        ratingTeamKey(team);

    if (!key) {
        return null;
    }

    if (!allRatings[key]) {

        allRatings[key] =
            createFEGClubRating(team);

    }

    return allRatings[key];

}


/* ============================================================
 * CONFIDENCE
 * ============================================================
 */

function calculateRatingConfidence(
    matchCount
) {

    if (
        !ratingFiniteNumber(
            matchCount
        ) ||
        matchCount <= 0
    ) {

        return 0;

    }

    return ratingRound(
        Math.min(
            1,
            matchCount /
            FEG_RATING_CONFIG.confidenceMatches
        ),
        4
    );

}


/* ============================================================
 * RESULT VALUE
 * ============================================================
 */

function ratingResultValue(
    goalsFor,
    goalsAgainst
) {

    if (
        !ratingFiniteNumber(goalsFor) ||
        !ratingFiniteNumber(goalsAgainst)
    ) {

        return null;

    }

    if (goalsFor > goalsAgainst) {
        return 1;
    }

    if (goalsFor < goalsAgainst) {
        return 0;
    }

    return 0.5;

}


/* ============================================================
 * EXPECTED RESULT
 *
 * Converts rating difference into
 * an expected result between 0 and 1.
 * ============================================================
 */

function expectedRatingResult(
    teamRating,
    opponentRating,
    home
) {

    let difference =
        teamRating -
        opponentRating;

    if (home) {

        difference +=
            FEG_RATING_CONFIG.homeContext;

    }

    return 1 /
        (
            1 +
            Math.pow(
                10,
                -difference / 15
            )
        );

}


/* ============================================================
 * GOAL DIFFERENCE BONUS
 * ============================================================
 */

function goalDifferenceAdjustment(
    goalsFor,
    goalsAgainst
) {

    if (
        !ratingFiniteNumber(goalsFor) ||
        !ratingFiniteNumber(goalsAgainst)
    ) {

        return 0;

    }

    const difference =
        goalsFor -
        goalsAgainst;

    return (
        difference *
        FEG_RATING_CONFIG.goalDifferenceWeight
    );

}


/* ============================================================
 * MATCH UPDATE
 * ============================================================
 */

function updateFEGRatingAfterFact(
    fact,
    ratings = null
) {

    if (
        !fact ||
        typeof fact !== "object"
    ) {

        return {

            updated: false,

            reason:
                "INVALID_FACT"

        };

    }


    const home =
        String(
            fact.home ?? ""
        ).trim();


    const away =
        String(
            fact.away ?? ""
        ).trim();


    const homeGoals =
        Number(
            fact.home_goals
        );


    const awayGoals =
        Number(
            fact.away_goals
        );


    if (
        !home ||
        !away ||
        !Number.isFinite(homeGoals) ||
        !Number.isFinite(awayGoals)
    ) {

        return {

            updated: false,

            reason:
                "INCOMPLETE_FACT"

        };

    }


    const allRatings =
        ratings || loadFEGRatings();


    const homeKey =
        ratingTeamKey(home);

    const awayKey =
        ratingTeamKey(away);


    if (!allRatings[homeKey]) {

        allRatings[homeKey] =
            createFEGClubRating(home);

    }


    if (!allRatings[awayKey]) {

        allRatings[awayKey] =
            createFEGClubRating(away);

    }


    const homeClub =
        allRatings[homeKey];

    const awayClub =
        allRatings[awayKey];


    /*
     * Предматчевый рейтинг.
     *
     * Именно он используется
     * для расчёта результата.
     */

    const homeBefore =
        Number(
            homeClub.currentRating
        );

    const awayBefore =
        Number(
            awayClub.currentRating
        );


    const homeExpected =
        expectedRatingResult(
            homeBefore,
            awayBefore,
            true
        );


    const awayExpected =
        1 -
        homeExpected;


    const actualHome =
        ratingResultValue(
            homeGoals,
            awayGoals
        );


    const actualAway =
        ratingResultValue(
            awayGoals,
            homeGoals
        );


    if (
        actualHome === null ||
        actualAway === null
    ) {

        return {

            updated: false,

            reason:
                "INVALID_RESULT"

        };

    }


    /*
     * Ошибка ожидания.
     */

    let homeError =
        actualHome -
        homeExpected;

    let awayError =
        actualAway -
        awayExpected;


    /*
     * Небольшой учёт разницы голов.
     */

    homeError +=
        goalDifferenceAdjustment(
            homeGoals,
            awayGoals
        ) * 0.05;


    awayError +=
        goalDifferenceAdjustment(
            awayGoals,
            homeGoals
        ) * 0.05;


    /*
     * Ограничиваем влияние одного матча.
     */

    homeError =
        ratingClamp(
            homeError,
            -FEG_RATING_CONFIG.surpriseLimit,
            FEG_RATING_CONFIG.surpriseLimit
        );


    awayError =
        ratingClamp(
            awayError,
            -FEG_RATING_CONFIG.surpriseLimit,
            FEG_RATING_CONFIG.surpriseLimit
        );


    let homeDelta =
        homeError *
        FEG_RATING_CONFIG.learningRate *
        15;


    let awayDelta =
        awayError *
        FEG_RATING_CONFIG.learningRate *
        15;


    homeDelta =
        ratingClamp(
            homeDelta,
            -FEG_RATING_CONFIG.maxMatchChange,
            FEG_RATING_CONFIG.maxMatchChange
        );


    awayDelta =
        ratingClamp(
            awayDelta,
            -FEG_RATING_CONFIG.maxMatchChange,
            FEG_RATING_CONFIG.maxMatchChange
        );


    /*
     * Новый рейтинг.
     */

    const homeAfter =
        ratingClamp(
            homeBefore +
            homeDelta,
            0,
            100
        );


    const awayAfter =
        ratingClamp(
            awayBefore +
            awayDelta,
            0,
            100
        );


    /*
     * Счётчики.
     */

    homeClub.matchCount += 1;
    homeClub.homeMatchCount += 1;

    awayClub.matchCount += 1;
    awayClub.awayMatchCount += 1;


    /*
     * Рейтинг.
     */

    homeClub.currentRating =
        ratingRound(homeAfter, 4);

    awayClub.currentRating =
        ratingRound(awayAfter, 4);


    /*
     * Home/Away компоненты.
     *
     * Пока мягко двигаем их к текущему рейтингу.
     * Это foundation, не финальная формула.
     */

    homeClub.homeRating =
        ratingRound(
            (
                Number(homeClub.homeRating) +
                homeAfter
            ) / 2,
            4
        );


    awayClub.awayRating =
        ratingRound(
            (
                Number(awayClub.awayRating) +
                awayAfter
            ) / 2,
            4
        );


    /*
     * Confidence.
     */

    homeClub.confidence =
        calculateRatingConfidence(
            homeClub.matchCount
        );


    awayClub.confidence =
        calculateRatingConfidence(
            awayClub.matchCount
        );


    /*
     * Stability.
     *
     * Пока используем ограниченную оценку
     * размера последних изменений.
     */

    const homeChange =
        Math.abs(
            homeAfter -
            homeBefore
        );

    const awayChange =
        Math.abs(
            awayAfter -
            awayBefore
        );


    homeClub.stability =
        ratingRound(
            1 -
            Math.min(
                1,
                homeChange /
                FEG_RATING_CONFIG.maxMatchChange
            ),
            4
        );


    awayClub.stability =
        ratingRound(
            1 -
            Math.min(
                1,
                awayChange /
                FEG_RATING_CONFIG.maxMatchChange
            ),
            4
        );


    /*
     * Recent trend.
     */

    homeClub.recentTrend =
        ratingRound(
            homeAfter -
            homeBefore,
            4
        );


    awayClub.recentTrend =
        ratingRound(
            awayAfter -
            awayBefore,
            4
        );


    /*
     * История.
     */

    const factDate =
        fact.date ||
        fact.utcDate ||
        new Date().toISOString();


    homeClub.ratingHistory.push({

        date: factDate,

        rating:
            homeClub.currentRating,

        delta:
            ratingRound(
                homeDelta,
                4
            ),

        opponent:
            away,

        opponentRatingBefore:
            ratingRound(
                awayBefore,
                4
            ),

        score:
            `${homeGoals}:${awayGoals}`,

        reason:
            "FACT"

    });


    awayClub.ratingHistory.push({

        date: factDate,

        rating:
            awayClub.currentRating,

        delta:
            ratingRound(
                awayDelta,
                4
            ),

        opponent:
            home,

        opponentRatingBefore:
            ratingRound(
                homeBefore,
                4
            ),

        score:
            `${awayGoals}:${homeGoals}`,

        reason:
            "FACT"

    });


    /*
     * Ограничиваем историю.
     * Последние 100 событий достаточно
     * для текущего foundation.
     */

    if (
        homeClub.ratingHistory.length >
        100
    ) {

        homeClub.ratingHistory =
            homeClub.ratingHistory.slice(-100);

    }


    if (
        awayClub.ratingHistory.length >
        100
    ) {

        awayClub.ratingHistory =
            awayClub.ratingHistory.slice(-100);

    }


    homeClub.lastUpdated =
        new Date().toISOString();

    awayClub.lastUpdated =
        new Date().toISOString();


    /*
     * Сохраняем.
     */

    saveFEGRatings(
        allRatings
    );


    return {

        updated: true,

        version:
            FEG_RATING_VERSION,

        home: {

            team: home,

            before:
                ratingRound(
                    homeBefore,
                    4
                ),

            after:
                homeClub.currentRating,

            delta:
                ratingRound(
                    homeDelta,
                    4
                ),

            confidence:
                homeClub.confidence

        },

        away: {

            team: away,

            before:
                ratingRound(
                    awayBefore,
                    4
                ),

            after:
                awayClub.currentRating,

            delta:
                ratingRound(
                    awayDelta,
                    4
                ),

            confidence:
                awayClub.confidence

        }

    };

}


/* ============================================================
 * SNAPSHOT
 *
 * Используется в момент прогноза.
 *
 * После создания прогноза этот объект
 * больше не должен изменяться.
 * ============================================================
 */

function getFEGRatingSnapshot(
    team,
    ratings = null
) {

    const allRatings =
        ratings || loadFEGRatings();

    const club =
        getFEGClubRating(
            team,
            allRatings
        );


    if (!club) {
        return null;
    }


    /*
     * Если клуб создан впервые,
     * сохраняем storage.
     */

    saveFEGRatings(
        allRatings
    );


    return {

        ratingVersion:
            FEG_RATING_VERSION,

        team:
            club.team,

        currentRating:
            club.currentRating,

        baseRating:
            club.baseRating,

        homeRating:
            club.homeRating,

        awayRating:
            club.awayRating,

        matchCount:
            club.matchCount,

        homeMatchCount:
            club.homeMatchCount,

        awayMatchCount:
            club.awayMatchCount,

        opponentStrength:
            club.opponentStrength,

        stability:
            club.stability,

        confidence:
            club.confidence,

        recentTrend:
            club.recentTrend,

        snapshotAt:
            new Date().toISOString()

    };

}


/* ============================================================
 * PUBLIC API
 * ============================================================
 */

window.FEGRATING = {

    version:
        FEG_RATING_VERSION,

    load:
        loadFEGRatings,

    save:
        saveFEGRatings,

    get:
        getFEGClubRating,

    snapshot:
        getFEGRatingSnapshot,

    updateAfterFact:
        updateFEGRatingAfterFact

};


window.FEG_RATING_VERSION =
    FEG_RATING_VERSION;
