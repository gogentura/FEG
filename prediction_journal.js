"use strict";

/*
 * FEG Prediction Journal v0.1
 *
 * Назначение:
 *   Сохранять каждый прогноз FEG ДО результата матча.
 *
 * ВАЖНО:
 *   - старые прогнозы не изменяются;
 *   - результат матча не используется при создании прогноза;
 *   - это временный browser journal;
 *   - позже будет подключено постоянное predictions.json
 *     через GitHub Actions.
 */

const FEG_PREDICTION_JOURNAL_VERSION = "0.1.0";

const FEG_PREDICTION_STORAGE_KEY =
    "FEG_PREDICTION_JOURNAL_V0_1";


function safeClone(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return null;
    }
}


function loadPredictionJournal() {
    try {
        const raw =
            localStorage.getItem(
                FEG_PREDICTION_STORAGE_KEY
            );

        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed;
    } catch (error) {
        console.error(
            "FEG Prediction Journal load error:",
            error
        );

        return [];
    }
}


function savePredictionJournal(entries) {
    localStorage.setItem(
        FEG_PREDICTION_STORAGE_KEY,
        JSON.stringify(entries)
    );
}


function predictionFingerprint(prediction) {

    const home =
        prediction?.home ||
        prediction?.teams?.home ||
        "";

    const away =
        prediction?.away ||
        prediction?.teams?.away ||
        "";

    const competition =
        prediction?.competition ||
        "";

    const asOf =
        prediction?.asOf ||
        "";

    return [
        competition,
        home,
        away,
        asOf
    ].join("|");
}


function saveFEGPrediction(prediction) {

    if (!prediction || typeof prediction !== "object") {
        throw new Error(
            "FEG Prediction Journal: invalid prediction"
        );
    }

    const journal =
        loadPredictionJournal();

    const fingerprint =
        predictionFingerprint(prediction);

    /*
     * Защита от случайного повторного сохранения
     * одного и того же прогноза.
     */
    const alreadyExists =
        journal.some(
            item =>
                item.fingerprint === fingerprint
        );

    if (alreadyExists) {

        return {
            saved: false,
            duplicate: true,
            count: journal.length
        };
    }


    const entry = {

        journalVersion:
            FEG_PREDICTION_JOURNAL_VERSION,

        predictionId:
            "FEG-" +
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .slice(2, 8),

        createdAt:
            new Date().toISOString(),

        fingerprint,

        status:
            "PREDICTED",

        /*
         * ВАЖНО:
         * Сохраняем копию результата Brain.
         * Сам исходный prediction объект
         * больше не используется как ссылка.
         */
        prediction:
            safeClone(prediction)

    };


    journal.push(entry);

    savePredictionJournal(journal);


    return {
        saved: true,
        duplicate: false,
        count: journal.length,
        entry
    };
}


function getFEGPredictionJournal() {
    return loadPredictionJournal();
}


function getFEGPredictionCount() {
    return loadPredictionJournal().length;
}


function clearFEGPredictionJournal() {

    localStorage.removeItem(
        FEG_PREDICTION_STORAGE_KEY
    );

    return true;
}


/*
 * Browser API
 */

if (typeof window !== "undefined") {

    window.FEGPredictionJournal = {

        version:
            FEG_PREDICTION_JOURNAL_VERSION,

        save:
            saveFEGPrediction,

        getAll:
            getFEGPredictionJournal,

        count:
            getFEGPredictionCount,

        clear:
            clearFEGPredictionJournal

    };
}
