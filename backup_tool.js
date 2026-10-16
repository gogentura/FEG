/*
 * FEG — BACKUP TOOL v0.1.0
 *
 * Назначение:
 *   Безопасная выгрузка всех данных FEG из localStorage
 *   в один JSON-файл для резервной копии и диагностики.
 *
 * Принципы:
 *   - только читает localStorage;
 *   - ничего не удаляет и не перезаписывает;
 *   - скачивает один файл feg_backup_ГГГГ-ММ-ДД.json;
 *   - не трогает brain.js, rating.js, контроллер и пульт.
 */

(function () {
    "use strict";

    const BACKUP_VERSION = "0.1.0";

    const KNOWN_KEYS = [
        "FEG_PREDICTION_JOURNAL_V0_1",
        "FEG_LEARNING_MEMORY_V0_2",
        "FEG_LEARNING_CONTROLLER_V0_3",
        "FEG_CHALLENGER_V0_3",
        "FEG_RATINGS_V0_1",
        "FEG_MODEL_LAB_APPROVALS_V0_1"
    ];

    function readKey(key) {
        try {
            const raw = localStorage.getItem(key);

            if (raw === null) {
                return { present: false, raw: null };
            }

            return { present: true, raw: raw };

        } catch (error) {
            return {
                present: false,
                raw: null,
                error: String(error)
            };
        }
    }

    function safeParse(raw) {
        try {
            return JSON.parse(raw);
        } catch (error) {
            return { __parse_error__: String(error) };
        }
    }

    function collectAllKeys() {
        const keys = [];

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);

                if (k && k.indexOf("FEG_") === 0) {
                    keys.push(k);
                }
            }
        } catch (error) {
            console.error("[FEG Backup] key scan error:", error);
        }

        return keys;
    }

    function buildBackup() {
        const allKeys = collectAllKeys();

        const known = {};
        const other = {};

        const union = [
            ...new Set([...KNOWN_KEYS, ...allKeys])
        ].sort();

        for (const key of union) {
            const read = readKey(key);

            if (!read.present) {
                known[key] = {
                    present: false,
                    rawLength: 0,
                    parsed: null
                };
                continue;
            }

            const parsed = safeParse(read.raw);

            const entry = {
                present: true,
                rawLength: read.raw.length,
                parsed: parsed
            };

            if (KNOWN_KEYS.includes(key)) {
                known[key] = entry;
            } else {
                other[key] = entry;
            }
        }

        let origin = "(unknown)";

        try {
            origin = window.location.origin || "(no origin)";
        } catch (error) {
            origin = "(error)";
        }

        let userAgent = "(unknown)";

        try {
            userAgent = navigator.userAgent || "(no ua)";
        } catch (error) {
            userAgent = "(error)";
        }

        return {
            backupVersion: BACKUP_VERSION,
            generatedAt: new Date().toISOString(),
            origin: origin,
            userAgent: userAgent,
            knownKeys: known,
            otherFEGKeys: other
        };
    }

    function timestampForFileName() {
        const d = new Date();

        const pad = (n) => String(n).padStart(2, "0");

        return (
            d.getFullYear() +
            "-" +
            pad(d.getMonth() + 1) +
            "-" +
            pad(d.getDate()) +
            "_" +
            pad(d.getHours()) +
            "-" +
            pad(d.getMinutes())
        );
    }

    function downloadBackup() {
        const backup = buildBackup();

        const json = JSON.stringify(backup, null, 2);

        const blob = new Blob(
            [json],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);

        const fileName =
            "feg_backup_" +
            timestampForFileName() +
            ".json";

        const a = document.createElement("a");

        a.href = url;
        a.download = fileName;

        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 2000);

        return {
            fileName: fileName,
            bytes: json.length
        };
    }

    function summarize() {
        const backup = buildBackup();

        const lines = [];

        lines.push("FEG Backup Tool v" + BACKUP_VERSION);
        lines.push("origin: " + backup.origin);
        lines.push("");

        for (const [key, value] of Object.entries(backup.knownKeys)) {
            if (!value.present) {
                lines.push(key + ": (нет данных)");
                continue;
            }

            const parsed = value.parsed;

            let size = "?";

            if (Array.isArray(parsed)) {
                size = parsed.length + " элементов";
            } else if (parsed && typeof parsed === "object") {
                if (Array.isArray(parsed.records)) {
                    size = parsed.records.length + " records";
                } else if (typeof parsed.version === "string") {
                    size = "version " + parsed.version;
                } else {
                    size = Object.keys(parsed).length + " полей";
                }
            }

            lines.push(
                key + ": " + size +
                " (" + value.rawLength + " символов)"
            );
        }

        if (Object.keys(backup.otherFEGKeys).length) {
            lines.push("");
            lines.push("Другие ключи FEG_*:");

            for (const [key, value] of Object.entries(backup.otherFEGKeys)) {
                lines.push(key + ": " + value.rawLength + " символов");
            }
        }

        return lines.join("\n");
    }

    function mountPanel() {
        if (document.getElementById("feg-backup-panel")) {
            return;
        }

        const panel = document.createElement("section");

        panel.id = "feg-backup-panel";
        panel.className = "card";
        panel.style.marginTop = "18px";

        panel.innerHTML = `
            <div class="card-title">
                💾 Резервная копия FEG
            </div>

            <div class="loading" id="feg-backup-summary"
                 style="white-space:pre-wrap;font-size:12px;line-height:1.5"></div>

            <button
                id="feg-backup-download"
                type="button"
                style="margin-top:12px"
            >
                💾 Скачать резервную копию FEG
            </button>

            <div
                class="journal-note"
                style="margin-top:10px"
            >
                Эта кнопка только читает данные из этого браузера
                и скачивает один файл. Ничего не удаляется и не
                перезаписывается. Brain и расчёты модели не затрагиваются.
            </div>
        `;

        document.body.appendChild(panel);

        const summaryEl =
            document.getElementById("feg-backup-summary");

        summaryEl.textContent = summarize();

        const btn =
            document.getElementById("feg-backup-download");

        btn.addEventListener("click", function () {
            try {
                const result = downloadBackup();

                btn.textContent =
                    "✅ Файл сохранён: " +
                    result.fileName;

                setTimeout(() => {
                    btn.textContent =
                        "💾 Скачать резервную копию FEG";
                }, 6000);

            } catch (error) {
                btn.textContent =
                    "❌ Ошибка выгрузки: " + String(error);

                console.error("[FEG Backup] download error:", error);
            }
        });
    }

    if (typeof window !== "undefined") {
        window.FEGBackup = {
            version: BACKUP_VERSION,
            build: buildBackup,
            download: downloadBackup,
            summarize: summarize
        };
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            mountPanel,
            { once: true }
        );
    } else {
        mountPanel();
    }

})();
