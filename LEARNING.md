```markdown
# FEG Learning System

**Версия:** LEARNING-0.1
**Проект:** FEG — Football Evolution God

---

## 1. Назначение

Learning System — это механизм накопления опыта FEG.

Он получает:
- прогноз FEG;
- фактический результат;
- сравнение прогноза с фактом;
- ошибки;
- повторяющиеся тенденции;
- изменения Club Rating;
- турнирные и домашние/гостевые закономерности.

Learning System НЕ является самим Brain.

Его задача:

```text
ПРОГНОЗ
   ↓
ФАКТ
   ↓
СРАВНЕНИЕ
   ↓
ОШИБКА
   ↓
НАКОПЛЕНИЕ
   ↓
ПОИСК ТЕНДЕНЦИЙ
   ↓
КОРРЕКТИРОВКА / CHALLENGER
```

2. Главный принцип

```text
Prediction ≠ Fact
```

Прогноз никогда не заменяется фактическим результатом.

Prediction Snapshot является неизменяемым.

Например:

```text
Prediction
Chelsea FC vs Crystal Palace FC
Brain: 0.1.0
eXG: 0.1.0
λ: 3.2348 — 1.6181
1X2: HOME 69.2% DRAW 14.6% AWAY 16.2%
```

После завершения матча этот snapshot не изменяется.

Добавляется отдельный FACT:

```text
FACT
Chelsea FC 2:1 Crystal Palace FC
```

Затем создаётся Error Record.

3. Источник фактов

Единственный источник фактического результата:

```text
results.json
```

Результат не может быть получен из:

· прогноза;
· памяти Brain;
· ручного ввода;
· вероятности;
· стороннего предположения;
· результата, рассчитанного самой моделью.

Цепочка:

```text
football-data.org
   ↓
fetch_results.py
   ↓
results.json
   ↓
FEG Evaluator
   ↓
FACT
```

4. Prediction Journal

Каждый прогноз получает уникальный:

```text
predictionId
```

Прогноз содержит как минимум:

```text
predictionId
createdAt
competition
home
away
brainVersion
exgVersion
lambdaHome
lambdaAway
probabilities1X2
BTTS
totals
topScores
```

Prediction Journal хранит оригинальный snapshot.

Удалённый прогноз не участвует в дальнейшем обучении.

5. Prediction Evaluator

Когда соответствующий завершённый матч появляется в results.json, FEG автоматически сравнивает Prediction Snapshot с FACT.

Проверяются:

1X2

```text
Prediction → Home / Draw / Away
FACT       → Home / Draw / Away
```

Результат:

```text
HIT или MISS
```

BTTS

```text
Prediction → YES / NO
FACT       → YES / NO
```

Over / Under 2.5

```text
Prediction → OVER / UNDER
FACT       → OVER / UNDER
```

Exact Score

```text
Prediction → 2:1
FACT       → 2:1
```

λ

Сравниваются:

```text
Predicted λ Home vs Actual Home Goals
Predicted λ Away vs Actual Away Goals
```

Например:

```text
λ: 3.2348 — 1.6181
FACT: 2 — 1
```

Ошибки:

```text
Home Error = 2 - 3.2348
Away Error = 1 - 1.6181
```

6. Error Record

После появления FACT создаётся запись Learning Memory.

Пример:

```json
{
  "learningVersion": "FEG-LEARNING-0.1",
  "predictionId": "example-id",
  "brainVersion": "0.1.0",
  "exgVersion": "0.1.0",
  "competition": "PL",
  "home": "Chelsea FC",
  "away": "Crystal Palace FC",
  "predictionCreatedAt": "2026-10-03T14:48:19",
  "actualHomeGoals": 2,
  "actualAwayGoals": 1,
  "predictedLambdaHome": 3.2348,
  "predictedLambdaAway": 1.6181,
  "errors": {
    "lambdaHome": -1.2348,
    "lambdaAway": -0.6181
  },
  "markets": {
    "1X2": { "predicted": "HOME", "actual": "HOME", "hit": true },
    "BTTS": { "predicted": "YES", "actual": "YES", "hit": true },
    "O2.5": { "predicted": "OVER", "actual": "OVER", "hit": true },
    "TopScore": { "predicted": "3:1", "actual": "2:1", "hit": false }
  }
}
```

7. Learning Memory

Learning Memory хранит не сами прогнозы, а опыт после появления факта.

Принцип:

```text
Prediction Journal + FACT
   ↓
Learning Memory
```

Learning Memory не должна изменять старый Prediction Snapshot.

Каждый Prediction ID может создать только одну финальную Learning Record.

Повторная загрузка страницы не должна создавать дубликаты.

8. Удаление прогноза

Если пользователь удаляет Prediction:

```text
Prediction Journal
   ↓
DELETE
   ↓
Prediction удалён
   ↓
соответствующая Learning Record удаляется
```

Удалённый прогноз:

· не считается в статистике;
· не участвует в обучении;
· не участвует в анализе ошибок;
· не участвует в рейтингах.

Это необходимо для защиты от случайных или тестовых прогнозов.

9. Один матч НЕ меняет Brain

Это фундаментальное правило FEG.

После одного результата:

```text
FACT
   ↓
ERROR
   ↓
LEARNING MEMORY
```

Но:

```text
Brain
```

не меняется автоматически.

Даже если прогноз оказался полностью неправильным.

Один матч является наблюдением, а не доказательством нового правила.

10. Живой Club Rating

Club Rating развивается постепенно вместе с накоплением FACTS.

После каждого завершённого матча может происходить небольшое обновление рейтинга.

Условная структура:

```text
Club Rating
   │
   ├── Base Rating
   ├── Current Rating
   ├── Home Component
   ├── Away Component
   ├── Opponent Strength
   ├── Match Count
   ├── Stability
   └── Confidence
```

Рейтинг должен учитывать:

· силу соперника;
· результат;
· ожидание FEG;
· домашний/гостевой статус;
· накопленную историю;
· количество матчей.

Один матч не должен полностью менять рейтинг.

11. Новая команда

Для команды с маленькой историей рейтинг считается менее устойчивым.

Пример:

```text
5 матчей
   ↓
низкая статистическая уверенность
```

После накопления большего количества матчей:

```text
30 матчей
   ↓
больше информации
   ↓
более устойчивый рейтинг
```

После большого количества матчей:

```text
100+ матчей
   ↓
значительно более стабильная история
```

FEG не должен считать маленькую выборку равной большой.

12. Контрольная точка 88 матчей

После накопления 88 обработанных матчей FEG выполняет первый контрольный анализ.

Цель:

```text
найти устойчивые общие тенденции.
```

Проверяются:

· домашние/гостевые различия;
· турнирные особенности;
· средняя результативность;
· систематическое завышение λ;
· систематическое занижение λ;
· ошибки 1X2;
· ошибки BTTS;
· ошибки тоталов;
· стабильность eXG;
· общие отклонения Club Rating.

13. Корректировка после 88 матчей

После 88 матчей допускаются только:

Точечные слабые корректировки

Например:

```text
Tournament Home Factor + небольшая корректировка
Tournament Away Factor + небольшая корректировка
```

или:

```text
Home/Away tendency + небольшая корректировка
```

Корректировка должна быть ограниченной.

FEG НЕ должен:

· полностью переписывать Brain;
· менять все коэффициенты;
· подгонять модель под 88 результатов;
· использовать будущие матчи;
· использовать один конкретный матч как доказательство.

14. Почему 88

88 — первая контрольная точка.

Это не означает:

```text
88 матчей = модель полностью обучена
```

Это означает:

```text
88 матчей = уже можно искать первые устойчивые тенденции
```

Если тенденция недостаточно стабильна:

```text
NO CHANGE
```

Она просто остаётся в Learning Memory.

15. Контрольная точка ~264 матчей

После трёх циклов по 88:

```text
88 + 88 + 88 ≈ 264
```

FEG получает значительно больше материала.

На этой стадии основной акцент переносится на конкретные команды.

Анализируются:

```text
TEAM PROFILE
Club
   │
   ├── Rating
   ├── Home Rating
   ├── Away Rating
   ├── Attack tendency
   ├── Defence tendency
   ├── Expected vs Actual
   ├── Opponent Strength
   ├── Stability
   ├── FEG Error Pattern
   └── Historical Confidence
```

16. Командная адаптация

После ~264 матчей FEG может начать осторожно корректировать прогнозы с учётом устойчивых особенностей конкретной команды.

Например:

```text
Команда A
FEG регулярно завышает её атакующую способность
```

или:

```text
Команда B
FEG регулярно недооценивает её домашнюю результативность
```

Такие особенности должны подтверждаться множеством наблюдений.

Одна ошибка не создаёт правило.

17. Дом / гости

Домашняя и гостевая история являются отдельными компонентами.

Например:

```text
Team Rating
   ↓
Home Rating
Away Rating
```

FEG должен учитывать количество соответствующих матчей.

Нельзя считать:

```text
2 домашних матча = 20 домашних матчей
```

История должна постепенно накапливаться.

18. Сила соперника

При анализе команды FEG должен учитывать не только собственные результаты.

Например:

```text
Team A
результат: 3 победы
но соперники: слабые
```

и:

```text
Team B
результат: 2 победы
но соперники: сильные
```

Поэтому:

```text
Result + Opponent Strength
```

важнее простого количества побед.

19. Контрольная точка 999 матчей

999 матчей считаются завершением первого полного Learning Cycle.

На этом этапе FEG получает:

```text
999 FACTS
+ 999 PREDICTIONS
+ ERROR MEMORY
+ CLUB RATINGS
+ HOME/AWAY HISTORY
+ TOURNAMENT TRENDS
+ eXG HISTORY
```

Это уже материал для полноценного Laboratory Cycle.

20. Full Learning Cycle

После 999 матчей:

```text
999 FACTS
   ↓
ERROR MEMORY
   ↓
PATTERN ANALYSIS
   ↓
LABORATORY
   ↓
CHALLENGER
   ↓
WALK-FORWARD
   ↓
STATISTICAL CHECK
   ↓
ACCEPT / REJECT
```

Новая модель не принимается только потому, что она лучше подошла к накопленным историческим матчам.

Она должна проверяться на последующих данных, которые не использовались для её построения.

21. Новая модельная линия

Если Challenger проходит проверки, появляется новая версия:

```text
Brain 0.1.0
   ↓
Learning Cycle 1
   ↓
Brain 0.2.0
```

Старая версия не удаляется.

История остаётся:

```text
Brain 0.1.0
Brain 0.2.0
Brain 0.3.0
...
```

Это позволяет понять, какая версия создала каждый прогноз.

22. Запрет на утечку будущего

Learning System никогда не должна использовать результат матча для изменения прогноза, который был сделан до этого матча.

Правильно:

```text
Prediction 2026-10-03
   ↓
Match 2026-10-10
   ↓
FACT
   ↓
Learning
```

Неправильно:

```text
Match 2026-10-10
   ↓
изменение Prediction 2026-10-03
```

Исторический Prediction Snapshot является неизменяемым.

23. Champion и Challenger

Текущая модель:

```text
CHAMPION
```

Новая экспериментальная модель:

```text
CHALLENGER
```

Challenger не заменяет Champion автоматически.

Сначала:

```text
CHAMPION vs CHALLENGER
```

на новых матчах.

Затем:

```text
WALK-FORWARD
```

И только после прохождения проверки возможна новая версия Champion.

24. FEG развивается на нескольких уровнях

FEG имеет три разных скорости развития.

Уровень 1 — каждый матч

```text
FACT
   ↓
MEMORY
   ↓
ERROR
   ↓
CLUB RATING UPDATE
```

Уровень 2 — контрольные точки

```text
88
   ↓
слабые точечные корректировки

264
   ↓
более глубокая командная адаптация
```

Уровень 3 — полный цикл

```text
999
   ↓
Laboratory
   ↓
Challenger
   ↓
Walk-Forward
   ↓
новая модельная линия
```

25. Главная идея FEG

FEG не должен ждать 999 матчей, чтобы становиться умнее.

Он развивается постоянно:

```text
Каждый матч
   ↓
Живая память
   ↓
Живой рейтинг
   ↓
Накопление ошибок
```

Но чем больше данных, тем глубже разрешённый уровень изменения:

```text
1 матч        → память
88 матчей     → слабая общая корректировка
264 матча     → командная адаптация
999 матчей    → полный цикл обучения
```

26. Архитектурный принцип

```text
FEG BRAIN
   │
   ▼
PREDICTION
   │
   ▼
PREDICTION JOURNAL
   │
   ▼
WAIT FOR FACT
   │
   ▼
results.json
   │
   ▼
EVALUATOR
   │
   ┌─────────┴─────────┐
   ▼                   ▼
ERROR             CLUB RATING
   │                   │
   └─────────┬─────────┘
             ▼
      LEARNING MEMORY
             │
   ┌─────────┼─────────┐
   ▼         ▼         ▼
  88        264       999
   │         │         │
   ▼         ▼         ▼
TRENDS    TEAMS    LABORATORY
             │
             ▼
         CHALLENGER
             │
             ▼
        WALK-FORWARD
             │
             ▼
        NEW CHAMPION
```

27. Статус версии

Текущий статус:

```text
Learning System:              0.1
Prediction Journal:           ACTIVE
Prediction Evaluator:         ACTIVE
Learning Memory:              ACTIVE
Club Rating:                  FOUNDATION
88-match correction:          PLANNED
264-match adaptation:         PLANNED
999-match full cycle:         PLANNED
Laboratory:                   NOT ACTIVE
Challenger:                   NOT ACTIVE
Automatic Brain replacement:  DISABLED
```

28. Золотое правило

```text
FEG может учиться постоянно,
но не имеет права делать вывод быстрее,
чем позволяют накопленные факты.
```

И второе:

```text
Память может расти после каждого матча.
Brain меняется только через контролируемый цикл обучения.
```

---

```

