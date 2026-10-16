/*
 * FEG — MODEL LAB & CONTROL PANEL v0.1.0
 * Add after learning_controller.js:
 * <script src="model_lab.js"></script>
 *
 * Read-only diagnostics + shadow proposals.
 * Does NOT rewrite historical predictions and does NOT
 * apply candidate corrections to the active Brain.
 */
(function () {
  "use strict";

  const JOURNAL_KEY = "FEG_PREDICTION_JOURNAL_V0_1";
  const LEARNING_KEY = "FEG_LEARNING_MEMORY_V0_2";
  const STATE_KEY = "FEG_LEARNING_CONTROLLER_V0_3";
  const CHALLENGER_KEY = "FEG_CHALLENGER_V0_3";
  const APPROVAL_KEY = "FEG_MODEL_LAB_APPROVALS_V0_1";

  const $ = (id) => document.getElementById(id);
  const finite = (v) => typeof v === "number" && Number.isFinite(v);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
  const num = (v, digits = 2) => finite(v) ? v.toFixed(digits) : "—";
  const pct = (v) => finite(v) ? `${(v * 100).toFixed(1)}%` : "—";

  const parse = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };

  const list = (value) => Array.isArray(value) ? value : [];

  const predOf = (entry) =>
    entry && entry.prediction && typeof entry.prediction === "object"
      ? entry.prediction
      : {};

  const factOf = (entry) => {
    const f = entry?.evaluation?.fact;

    if (
      !f ||
      !Number.isInteger(f.homeGoals) ||
      !Number.isInteger(f.awayGoals) ||
      f.homeGoals < 0 ||
      f.awayGoals < 0
    ) {
      return null;
    }

    if (entry.status !== "FINISHED") return null;

    return {
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals
    };
  };

  const outcome = (h, a) => h > a ? "1" : h < a ? "2" : "X";

  const predOutcome = (p) => {
    const probs = p.probabilities1X2 || p.probabilities || {};

    const vals = [
      ["1", probs["1"] ?? probs.home ?? probs.HOME],
      ["X", probs["X"] ?? probs.draw ?? probs.DRAW],
      ["2", probs["2"] ?? probs.away ?? probs.AWAY]
    ].filter(x => finite(x[1]));

    if (!vals.length) return null;

    vals.sort((a, b) => b[1] - a[1]);

    return vals[0][0];
  };

  const teamsOf = (entry) => {
    const p = predOf(entry);

    return {
      home: p.home || entry.home || entry.homeTeam || "—",
      away: p.away || entry.away || entry.awayTeam || "—"
    };
  };

  const compOf = (entry) => {
    const p = predOf(entry);

    return (
      p.competition ||
      p.competitionCode ||
      p.league ||
      entry.competition ||
      entry.league ||
      "Без турнира"
    );
  };

  const scoreOf = (p) => {
    const top = Array.isArray(p.topScores) ? p.topScores[0] : null;

    if (top && top.score != null) return String(top.score);

    if (
      finite(p.predictedHomeGoals) &&
      finite(p.predictedAwayGoals)
    ) {
      return `${p.predictedHomeGoals}:${p.predictedAwayGoals}`;
    }

    return "—";
  };

  const actualScore = f => `${f.homeGoals}:${f.awayGoals}`;

  const avg = arr =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  function addStyles() {
    if ($("feg-model-lab-styles")) return;

    const style = document.createElement("style");

    style.id = "feg-model-lab-styles";

    style.textContent = `
      #feg-model-lab {
        margin: 18px 0;
        color: inherit;
      }

      #feg-model-lab * {
        box-sizing: border-box;
      }

      #feg-model-lab .ml-head {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }

      #feg-model-lab .ml-title {
        font-size: 1.25rem;
        font-weight: 800;
        margin: 0;
      }

      #feg-model-lab .ml-sub {
        opacity: .75;
        font-size: .9rem;
        margin-top: 5px;
      }

      #feg-model-lab .ml-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
        gap: 10px;
        margin: 14px 0;
      }

      #feg-model-lab .ml-kpi {
        background: rgba(127,127,127,.10);
        border: 1px solid rgba(127,127,127,.22);
        border-radius: 12px;
        padding: 12px;
        min-width: 0;
      }

      #feg-model-lab .ml-label {
        opacity: .72;
        font-size: .78rem;
      }

      #feg-model-lab .ml-value {
        font-size: 1.35rem;
        font-weight: 800;
        margin-top: 5px;
        overflow-wrap: anywhere;
      }

      #feg-model-lab .ml-section {
        border-top: 1px solid rgba(127,127,127,.22);
        padding-top: 14px;
        margin-top: 14px;
      }

      #feg-model-lab .ml-section h3 {
        margin: 0 0 10px;
        font-size: 1.03rem;
      }

      #feg-model-lab .ml-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }

      #feg-model-lab select,
      #feg-model-lab button {
        border-radius: 9px;
        padding: 9px 11px;
        border: 1px solid rgba(127,127,127,.35);
        background: rgba(127,127,127,.10);
        color: inherit;
        font: inherit;
      }

      #feg-model-lab button {
        cursor: pointer;
        font-weight: 700;
      }

      #feg-model-lab button:hover {
        background: rgba(127,127,127,.20);
      }

      #feg-model-lab .ml-note {
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(127,127,127,.10);
        font-size: .9rem;
        line-height: 1.45;
      }

      #feg-model-lab .ml-warn {
        border-left: 3px solid #d97706;
      }

      #feg-model-lab .ml-good {
        border-left: 3px solid #16a34a;
      }

      #feg-model-lab .ml-table-wrap {
        overflow-x: auto;
      }

      #feg-model-lab table {
        width: 100%;
        border-collapse: collapse;
        font-size: .88rem;
      }

      #feg-model-lab th,
      #feg-model-lab td {
        text-align: left;
        padding: 9px 8px;
        border-bottom: 1px solid rgba(127,127,127,.20);
        vertical-align: top;
        white-space: nowrap;
      }

      #feg-model-lab th {
        opacity: .75;
        font-weight: 700;
      }

      #feg-model-lab .ml-barrow {
        display: grid;
        grid-template-columns: minmax(90px,1fr) minmax(90px,2fr) 55px;
        gap: 8px;
        align-items: center;
        margin: 8px 0;
        font-size: .88rem;
      }

      #feg-model-lab .ml-track {
        height: 9px;
        background: rgba(127,127,127,.17);
        border-radius: 99px;
        overflow: hidden;
      }

      #feg-model-lab .ml-fill {
        height: 100%;
        background: currentColor;
        border-radius: 99px;
      }

      #feg-model-lab .ml-small {
        font-size: .82rem;
        opacity: .78;
        line-height: 1.45;
      }

      #feg-model-lab .ml-tag {
        display: inline-block;
        border: 1px solid rgba(127,127,127,.35);
        border-radius: 99px;
        padding: 3px 8px;
        font-size: .76rem;
      }

      #feg-model-lab details {
        border: 1px solid rgba(127,127,127,.22);
        border-radius: 10px;
        padding: 10px 12px;
        margin: 8px 0;
      }

      #feg-model-lab summary {
        cursor: pointer;
        font-weight: 700;
      }

      @media(max-width:520px) {
        #feg-model-lab .ml-value {
          font-size: 1.15rem;
        }

        #feg-model-lab th,
        #feg-model-lab td {
          padding: 7px 6px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function mount() {
    if ($("feg-model-lab")) return;

    const host = document.createElement("section");

    host.id = "feg-model-lab";
    host.className = "card";

    host.innerHTML = `
      <div class="ml-head">
        <div>
          <h2 class="ml-title">🧪 FEG Model Lab & Пульт управления</h2>
          <div class="ml-sub">
            Диагностика Champion · теневые поправки · история ошибок · все турниры
          </div>
        </div>

        <div class="ml-row">
          <select id="ml-competition" aria-label="Фильтр турнира">
            <option value="*">Все турниры</option>
          </select>

          <button id="ml-refresh" type="button">↻ Обновить</button>
        </div>
      </div>

      <div id="ml-content">
        <div class="ml-note">Читаю журнал и память FEG…</div>
      </div>
    `;

    const learningCard = $("learning-status-card");
    const journalCard = $("journalInfo")?.closest("section.card");

    if (learningCard?.parentNode) {
      learningCard.parentNode.insertBefore(
        host,
        journalCard || learningCard.nextSibling
      );
    } else if (journalCard?.parentNode) {
      journalCard.parentNode.insertBefore(host, journalCard);
    } else {
      document.body.appendChild(host);
    }

    $("ml-refresh").addEventListener("click", render);
    $("ml-competition").addEventListener("change", render);

    render();

    window.addEventListener("storage", render);

    setInterval(render, 60000);
  }

  function getData() {
    const journal = list(parse(JOURNAL_KEY, []));

    const memoryRaw = parse(LEARNING_KEY, []);

    const memory = Array.isArray(memoryRaw)
      ? memoryRaw
      : list(memoryRaw?.records || memoryRaw?.facts || memoryRaw?.items);

    const controller = parse(STATE_KEY, {});
    const challenger = parse(CHALLENGER_KEY, null);
    const approvals = parse(APPROVAL_KEY, {});

    const entries = journal.map((entry, index) => {
      const p = predOf(entry);
      const f = factOf(entry);
      const teams = teamsOf(entry);
      const probs = p.probabilities1X2 || p.probabilities || {};
      const score = scoreOf(p);
      const predRes = predOutcome(p);
      const actualRes = f
        ? outcome(f.homeGoals, f.awayGoals)
        : null;

      const lambdaHome = finite(p.lambdaHome) ? p.lambdaHome : null;
      const lambdaAway = finite(p.lambdaAway) ? p.lambdaAway : null;

      return {
        entry,
        p,
        f,
        teams,
        probs,
        score,
        predRes,
        actualRes,
        lambdaHome,
        lambdaAway,
        competition: compOf(entry),
        index,
        createdAt: entry.createdAt || p.predictionTime || null
      };
    });

    return {
      journal,
      entries,
      memory,
      controller,
      challenger,
      approvals
    };
  }

  function populateCompetition(entries) {
    const select = $("ml-competition");

    if (!select) return;

    const old = select.value || "*";

    const comps = [
      ...new Set(entries.map(x => x.competition).filter(Boolean))
    ].sort();

    select.innerHTML =
      `<option value="*">Все турниры</option>` +
      comps.map(c =>
        `<option value="${esc(c)}">${esc(c)}</option>`
      ).join("");

    select.value = comps.includes(old) ? old : "*";
  }

  function render() {
    const root = $("ml-content");

    if (!root) return;

    const data = getData();

    populateCompetition(data.entries);

    const chosen = $("ml-competition")?.value || "*";

    const entries = chosen === "*"
      ? data.entries
      : data.entries.filter(e => e.competition === chosen);

    const finished = entries.filter(e => e.f);

    const withOutcome = finished.filter(
      e => e.predRes && e.actualRes
    );

    const outcomeHits = withOutcome.filter(
      e => e.predRes === e.actualRes
    ).length;

    const exactHits = finished.filter(
      e => e.score === actualScore(e.f)
    ).length;

    const lambdaHomeErrors = finished
      .filter(e => finite(e.lambdaHome))
      .map(e => e.f.homeGoals - e.lambdaHome);

    const lambdaAwayErrors = finished
      .filter(e => finite(e.lambdaAway))
      .map(e => e.f.awayGoals - e.lambdaAway);

    const absGoalErrors = [];

    for (const e of finished) {
      if (finite(e.lambdaHome)) {
        absGoalErrors.push(
          Math.abs(e.f.homeGoals - e.lambdaHome)
        );
      }

      if (finite(e.lambdaAway)) {
        absGoalErrors.push(
          Math.abs(e.f.awayGoals - e.lambdaAway)
        );
      }
    }

    const open = entries.filter(e => !e.f).length;

    const accuracy = withOutcome.length
      ? outcomeHits / withOutcome.length
      : null;

    const exactRate = finished.length
      ? exactHits / finished.length
      : null;

    const mae = avg(absGoalErrors);
    const avgHE = avg(lambdaHomeErrors);
    const avgAE = avg(lambdaAwayErrors);

    const status = window.FEGLearning?.getStatus
      ? safeStatus()
      : null;

    const adj =
      status?.adjustments ||
      data.controller?.adjustments ||
      {};

    const global = adj.global || {};

    const challenger = status?.challenger || data.challenger;

    const appliedCount = Object.values(data.approvals || {})
      .filter(a => a?.status === "APPROVED")
      .length;

    root.innerHTML = `
      <div class="ml-note ml-warn">
        <strong>Режим: SHADOW.</strong>
        Лаборатория анализирует реальные сохранённые прогнозы и предлагает
        направления поправок. Ничего не изменяет в действующем Brain
        автоматически. Исторические прогнозы не пересчитываются.
      </div>

      <div class="ml-grid">
        ${kpi("Записей журнала", entries.length)}
        ${kpi("Подтверждённых фактов", finished.length)}
        ${kpi("Ожидают факта", open)}
        ${kpi(
          "Точность 1–X–2",
          pct(accuracy),
          `${withOutcome.length} матчей с сохранённым исходом`
        )}
        ${kpi(
          "Точный счёт",
          pct(exactRate),
          `${exactHits} из ${finished.length}`
        )}
        ${kpi("MAE голов", num(mae), "по доступным λ и фактам")}
      </div>

      <div class="ml-section">
        <h3>📊 Ошибки модели</h3>

        ${errorBars(avgHE, avgAE, finished.length)}

        <div class="ml-small">
          Ошибка рассчитана как факт − λ. Положительное значение означает,
          что фактических голов было больше ожидания; отрицательное —
          меньше. Считаются только сохранённые λ и подтверждённые счета.
        </div>

        ${
          finished.length
            ? `
              <div class="ml-row" style="margin-top:10px">
                <span class="ml-tag">
                  Средняя ошибка хозяев: ${num(avgHE)}
                </span>

                <span class="ml-tag">
                  Средняя ошибка гостей: ${num(avgAE)}
                </span>
              </div>
            `
            : `
              <div class="ml-note">
                Пока нет подтверждённых фактов со счётом в статусе FINISHED
                для выбранного фильтра.
              </div>
            `
        }
      </div>

      <div class="ml-section">
        <h3>🧠 Как Brain рассчитывал прогноз</h3>
        ${renderRecent(entries)}
      </div>

      <div class="ml-section">
        <h3>🔬 Теневые поправки</h3>
        ${renderAdjustments(global, adj.teams || {})}
      </div>

      <div class="ml-section">
        <h3>🧪 Challenger / лаборатория</h3>
        ${renderChallenger(challenger, status, data.memory.length)}
      </div>

      <div class="ml-section">
        <h3>🛡️ Управление и контроль</h3>

        <div class="ml-grid">
          ${kpi(
            "Learning Controller",
            status?.version || "не подключён"
          )}

          ${kpi("Этап", status?.stage || "—")}

          ${kpi(
            "Фактов Learning",
            status?.processedFacts ?? data.memory.length
          )}

          ${kpi(
            "Ручных одобрений",
            appliedCount,
            "записи решения, не сигнал об активации формулы"
          )}
        </div>

        <div class="ml-note ml-warn">
          <strong>Важно:</strong>
          ручное одобрение поправки ещё не подключено к формуле Brain.
          В этой версии пульта нет кнопки «применить», чтобы не создать
          ложное впечатление, что будущие прогнозы уже используют поправку.
          Для реального применения нужен отдельный проверенный контракт
          в brain.js и тест, подтверждающий изменение λ/вероятностей.
        </div>

        <div class="ml-small" style="margin-top:8px">
          Пороги обучения: 88 / 264 / 999 — индикаторы объёма данных,
          а не доказательство улучшения. Brier Score и Log Loss не
          показываются без достоверно сохранённых исходных вероятностей
          для каждой исторической записи.
        </div>
      </div>

      <div class="ml-section">
        <h3>🗂️ Последние матчи</h3>
        ${renderTable(entries)}
      </div>

      <div class="ml-small" style="margin-top:12px">
        Обновлено: ${new Date().toLocaleString("ru-RU")} ·
        источник: localStorage текущего браузера.
      </div>
    `;
  }

  function safeStatus() {
    try {
      return window.FEGLearning.getStatus();
    } catch (_) {
      return null;
    }
  }

  function kpi(label, value, sub = "") {
    return `
      <div class="ml-kpi">
        <div class="ml-label">${esc(label)}</div>
        <div class="ml-value">${esc(value)}</div>
        ${sub ? `<div class="ml-small">${esc(sub)}</div>` : ""}
      </div>
    `;
  }

  function errorBars(home, away, n) {
    const scale = Math.max(
      Math.abs(home || 0),
      Math.abs(away || 0),
      0.01
    );

    const bar = (label, value) => {
      const width = value == null
        ? 0
        : Math.max(2, Math.abs(value) / scale * 100);

      return `
        <div class="ml-barrow">
          <span>${label}</span>
          <div class="ml-track">
            <div class="ml-fill" style="width:${width}%"></div>
          </div>
          <strong>${num(value)}</strong>
        </div>
      `;
    };

    return n
      ? bar("Хозяева", home) + bar("Гости", away)
      : `
        <div class="ml-note">
          Недостаточно подтверждённых данных для графика.
        </div>
      `;
  }

  function formatForm(form) {
    if (form == null) return "нет данных";

    if (typeof form === "string") return form;

    if (Array.isArray(form)) {
      return form.map(item => {
        if (typeof item === "string") return item;

        if (item && typeof item === "object") {
          const result =
            item.result ??
            item.outcome ??
            item.form ??
            item.status;

          if (typeof result === "string") return result;

          if (result && typeof result === "object") {
            return formatForm(result);
          }

          return "—";
        }

        return "—";
      }).join(" · ");
    }

    if (typeof form === "object") {
      const sequence =
        form.sequence ??
        form.form ??
        form.value ??
        form.results;

      if (sequence != null && sequence !== form) {
        return formatForm(sequence);
      }

      return "нет данных";
    }

    return String(form);
  }

  function renderRecent(entries) {
    const recent = [...entries]
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(
          String(a.createdAt || "")
        )
      )
      .slice(0, 8);

    if (!recent.length) {
      return `<div class="ml-note">Журнал прогнозов пока пуст.</div>`;
    }

    return recent.map(e => {
      const p = e.p;
      const state = p.state || {};
      const hs = state.home || {};
      const as = state.away || {};
      const comp = esc(e.competition);
      const probs = e.probs || {};

      const probText = [
        ["1", probs["1"] ?? probs.home],
        ["X", probs["X"] ?? probs.draw],
        ["2", probs["2"] ?? probs.away]
      ]
        .filter(x => finite(x[1]))
        .map(x => `${x[0]} ${pct(x[1])}`)
        .join(" · ") || "Вероятности не сохранены";

      const hform = formatForm(hs.form);
      const aform = formatForm(as.form);

      const fact = e.f
        ? `Факт ${actualScore(e.f)}`
        : "Факт ожидается";

      const lambda =
        `λ ${num(e.lambdaHome)} : ${num(e.lambdaAway)}`;

      return `
        <details>
          <summary>
            ${esc(e.teams.home)} — ${esc(e.teams.away)} ·
            ${esc(e.score)}
            <span class="ml-tag">${comp}</span>
          </summary>

          <div class="ml-small" style="margin-top:9px">
            <div>
              <strong>Версия:</strong>
              ${esc(p.brainVersion || p.modelVersion || "не записана")}
              ·
              <strong>Состояние:</strong>
              ${esc(p.status || "—")}
            </div>

            <div>
              <strong>Расчёт λ:</strong> ${esc(lambda)}
              ·
              <strong>Прогноз:</strong> ${esc(e.score)}
              ·
              <strong>${esc(fact)}</strong>
            </div>

            <div>
              <strong>Вероятности 1–X–2:</strong>
              ${esc(probText)}
            </div>

            <div>
              <strong>История:</strong>
              хозяева ${esc(hs.matches ?? "—")} матчей;
              гости ${esc(as.matches ?? "—")} матчей.
            </div>

            <div>
              <strong>Форма:</strong>
              хозяева ${esc(hform)};
              гости ${esc(aform)}.
            </div>

            <div>
              <strong>eXG:</strong>
              хозяева ${esc(
                hs.estimatedXG?.estimatedXG ?? "—"
              )};
              гости ${esc(
                as.estimatedXG?.estimatedXG ?? "—"
              )}.
            </div>

            <div>
              <strong>Что учитывает модель:</strong>
              результаты предыдущих матчей, атакующие и защитные показатели,
              преимущество своего поля и расчётный xG (eXG).
              Доступность отдельных показателей зависит от сохранённых данных.
            </div>
          </div>
        </details>
      `;
    }).join("");
  }

  function renderAdjustments(global, teams) {
    const status = global.status || "NOT_AVAILABLE";
    const home = global.lambdaHomeCorrection;
    const away = global.lambdaAwayCorrection;
    const teamEntries = Object.entries(teams).slice(0, 10);

    return `
      <div class="ml-note">
        <strong>Глобальный сигнал:</strong>
        ${esc(status)} · выборка ${esc(global.samples ?? 0)}
      </div>

      <div class="ml-grid">
        ${kpi(
          "Предложение λ хозяев",
          finite(home)
            ? (home > 0 ? "+" : "") + num(home, 3)
            : "—"
        )}

        ${kpi(
          "Предложение λ гостей",
          finite(away)
            ? (away > 0 ? "+" : "") + num(away, 3)
            : "—"
        )}
      </div>

      <div class="ml-small">
        Это диагностические предложения контроллера, не поправки
        действующего Brain. Положительная поправка увеличивает ожидаемые
        голы; отрицательная — уменьшает.
      </div>

      ${
        teamEntries.length
          ? `
            <h4 style="margin:12px 0 6px">
              Командные сигналы (первые 10)
            </h4>

            <div class="ml-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Команда</th>
                    <th>Поправка λ</th>
                    <th>Выборка</th>
                    <th>Статус</th>
                  </tr>
                </thead>

                <tbody>
                  ${teamEntries.map(([team, a]) => `
                    <tr>
                      <td>${esc(team)}</td>
                      <td>
                        ${
                          finite(a.lambdaCorrection)
                            ? num(a.lambdaCorrection, 3)
                            : "—"
                        }
                      </td>
                      <td>${esc(a.samples ?? "—")}</td>
                      <td>${esc(a.status || "—")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `
          : `
            <div class="ml-small" style="margin-top:8px">
              Командных поправок пока нет либо данных недостаточно.
            </div>
          `
      }
    `;
  }

  function renderChallenger(challenger, status, memoryCount) {
    if (!challenger) {
      return `
        <div class="ml-note">
          Challenger пока не создан. Доступно записей Learning:
          ${memoryCount}. До лабораторного сравнения требуется
          достаточная выборка и реализованный walk-forward.
        </div>
      `;
    }

    const v = challenger.validation || {};

    return `
      <div class="ml-grid">
        ${kpi(
          "Challenger",
          challenger.version || challenger.id || "создан"
        )}

        ${kpi(
          "Walk-forward",
          v.walkForward || "NOT_RUN"
        )}

        ${kpi(
          "Стат. проверка",
          v.statisticalCheck || "NOT_RUN"
        )}

        ${kpi(
          "Продвижение",
          v.promotion || "DISABLED"
        )}
      </div>

      <div class="ml-note ml-warn">
        Наличие Challenger не означает, что он испытан. Пока Walk-forward
        не выполнен на одинаковых хронологических матчах, улучшение
        не доказано.
      </div>

      <details>
        <summary>Технические данные Challenger</summary>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem">${esc(
          JSON.stringify(challenger, null, 2)
        )}</pre>
      </details>
    `;
  }

  function renderTable(entries) {
    const rows = [...entries]
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(
          String(a.createdAt || "")
        )
      )
      .slice(0, 25);

    if (!rows.length) {
      return `<div class="ml-note">Нет записей для отображения.</div>`;
    }

    return `
      <div class="ml-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Матч</th>
              <th>Турнир</th>
              <th>Прогноз</th>
              <th>Факт</th>
              <th>Исход</th>
              <th>Ошибка λ</th>
            </tr>
          </thead>

          <tbody>
            ${rows.map(e => {
              const fact = e.f
                ? actualScore(e.f)
                : "Ожидается";

              const out = e.f && e.predRes && e.actualRes
                ? (e.predRes === e.actualRes ? "✓" : "✕")
                : "—";

              const eh = e.f && finite(e.lambdaHome)
                ? e.f.homeGoals - e.lambdaHome
                : null;

              const ea = e.f && finite(e.lambdaAway)
                ? e.f.awayGoals - e.lambdaAway
                : null;

              return `
                <tr>
                  <td>
                    ${esc(e.teams.home)} — ${esc(e.teams.away)}
                  </td>
                  <td>${esc(e.competition)}</td>
                  <td>${esc(e.score)}</td>
                  <td>${esc(fact)}</td>
                  <td>${out}</td>
                  <td>
                    ${
                      eh == null && ea == null
                        ? "—"
                        : `${num(eh)} / ${num(ea)}`
                    }
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function start() {
    addStyles();
    mount();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
