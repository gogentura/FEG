import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests


# ============================================================
# FEG — Football Evolution God
# DATA COLLECTOR
#
# Назначение:
#   Получение матчей football-data.org
#   и безопасное обновление results.json.
#
# Принципы:
#   1. История не удаляется.
#   2. Подтверждённый факт не заменяется неполными данными.
#   3. Missing != 0.
#   4. Будущие матчи можно обновлять.
#   5. FINISHED/AWARDED факт с голами защищён.
#   6. results.json — источник исторических фактов для Brain.
# ============================================================


API_URL = "https://api.football-data.org/v4"

TOKEN = os.getenv("FOOTBALL_DATA_TOKEN")

if not TOKEN:
    raise RuntimeError(
        "Не найден GitHub Secret FOOTBALL_DATA_TOKEN"
    )


# ============================================================
# COMPETITIONS
# ============================================================

COMPETITIONS = {
    # --------------------------------------------------------
    # TOP 5 EUROPE
    # --------------------------------------------------------

    "PL": "Premier League",
    "PD": "La Liga",
    "BL1": "Bundesliga",
    "SA": "Serie A",
    "FL1": "Ligue 1",

    # --------------------------------------------------------
    # ADDITIONAL EUROPEAN LEAGUES
    #
    # Нужны прежде всего для истории клубов,
    # участвующих в Champions League.
    # --------------------------------------------------------

    "PPL": "Primeira Liga",
    "DED": "Eredivisie",

    # --------------------------------------------------------
    # EUROPEAN CUP
    # --------------------------------------------------------

    "CL": "UEFA Champions League",
}


RESULTS_FILE = Path("results.json")
MEMORY_FILE = Path("memory.json")


HEADERS = {
    "X-Auth-Token": TOKEN,
    "Accept": "application/json",
}


# ============================================================
# HELPERS
# ============================================================

def load_json(path, default):
    if not path.exists():
        return default

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        return data

    except Exception as exc:
        print(
            f"Предупреждение: не удалось прочитать "
            f"{path}: {exc}"
        )

        return default


def save_json(path, data):
    temp_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    with temp_path.open(
        "w",
        encoding="utf-8"
    ) as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
        )

    # Атомарная замена файла.
    temp_path.replace(path)


def is_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
    )


def has_full_time_score(match):
    return (
        is_number(match.get("home_goals"))
        and is_number(match.get("away_goals"))
    )


def is_finished_status(status):
    return str(status or "").upper() in {
        "FINISHED",
        "AWARDED",
    }


def is_finished_fact(match):
    """
    FINISHED/AWARDED с полным счётом
    считаем подтверждённым фактом.
    """

    return (
        is_finished_status(match.get("status"))
        and has_full_time_score(match)
    )


# ============================================================
# API
# ============================================================

def get_matches(competition):
    url = (
        f"{API_URL}/competitions/"
        f"{competition}/matches"
    )

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    matches = data.get("matches", [])

    if not isinstance(matches, list):
        raise RuntimeError(
            f"Некорректный ответ API для {competition}"
        )

    return matches


# ============================================================
# NORMALIZE
# ============================================================

def normalize_match(
    match,
    competition,
    competition_name,
):
    score = match.get("score") or {}

    full_time = (
        score.get("fullTime") or {}
    )

    half_time = (
        score.get("halfTime") or {}
    )

    home = (
        match.get("homeTeam") or {}
    )

    away = (
        match.get("awayTeam") or {}
    )

    match_id = match.get("id")

    return {
        "id": f"fd:{match_id}",
        "source": "football-data.org",
        "source_match_id": match_id,

        "date": match.get("utcDate"),

        "competition": competition,
        "competition_name": competition_name,

        "season": (
            (match.get("season") or {}).get(
                "startDate"
            )
        ),

        "matchday": match.get("matchday"),
        "stage": match.get("stage"),

        "status": match.get("status"),

        "home": home.get("name"),
        "away": away.get("name"),

        "home_goals": full_time.get("home"),
        "away_goals": full_time.get("away"),

        "home_goals_ht": half_time.get("home"),
        "away_goals_ht": half_time.get("away"),

        # ----------------------------------------------------
        # RESERVED STATISTICS
        # ----------------------------------------------------

        "xg_home": None,
        "xg_away": None,

        "shots_home": None,
        "shots_away": None,

        "shots_on_target_home": None,
        "shots_on_target_away": None,

        "possession_home": None,
        "possession_away": None,

        "big_chances_home": None,
        "big_chances_away": None,

        "corners_home": None,
        "corners_away": None,

        "cards_home": None,
        "cards_away": None,
    }


# ============================================================
# SAFE MERGE
# ============================================================

def merge_match(old_match, new_match):
    """
    Безопасное объединение одного матча.

    Основной принцип:

        старый подтверждённый факт
        НЕ МОЖЕТ
        быть заменён неполным новым ответом API.
    """

    if not old_match:
        return new_match

    if not new_match:
        return old_match

    old_is_fact = is_finished_fact(
        old_match
    )

    new_is_fact = is_finished_fact(
        new_match
    )

    # --------------------------------------------------------
    # Старый факт уже подтверждён.
    #
    # Новый ответ не должен его уничтожить.
    # --------------------------------------------------------

    if old_is_fact and not new_is_fact:
        merged = dict(old_match)

        # Безопасно обновляем только поля,
        # которые не могут уничтожить факт.

        for key in [
            "competition_name",
            "season",
            "matchday",
            "stage",
            "home",
            "away",
        ]:
            value = new_match.get(key)

            if value is not None:
                merged[key] = value

        return merged

    # --------------------------------------------------------
    # Оба являются полноценными фактами.
    #
    # Новый факт может содержать более свежую информацию.
    # Но существующие значения не заменяем на None.
    # --------------------------------------------------------

    if old_is_fact and new_is_fact:
        merged = dict(old_match)

        for key, value in new_match.items():

            if value is None:
                continue

            merged[key] = value

        # На всякий случай сохраняем старый счёт,
        # если новый вдруг оказался некорректным.
        if not has_full_time_score(merged):
            merged["home_goals"] = (
                old_match.get("home_goals")
            )

            merged["away_goals"] = (
                old_match.get("away_goals")
            )

        return merged

    # --------------------------------------------------------
    # Старой подтверждённой фактической записи нет.
    #
    # Можно принять новые данные.
    # --------------------------------------------------------

    merged = dict(old_match)

    for key, value in new_match.items():

        if value is None:
            continue

        merged[key] = value

    return merged


def merge_results(
    old_results,
    new_results,
):
    """
    Объединяет всю историю.

    Старые записи никогда не удаляются.
    """

    by_id = {}

    # --------------------------------------------------------
    # Сначала сохраняем существующую историю.
    # --------------------------------------------------------

    for match in old_results:

        if not isinstance(match, dict):
            continue

        match_id = match.get("id")

        if not match_id:
            continue

        by_id[match_id] = match

    # --------------------------------------------------------
    # Затем аккуратно применяем свежие данные.
    # --------------------------------------------------------

    for match in new_results:

        if not isinstance(match, dict):
            continue

        match_id = match.get("id")

        if not match_id:
            continue

        if match_id in by_id:
            by_id[match_id] = merge_match(
                by_id[match_id],
                match,
            )
        else:
            by_id[match_id] = match

    result = list(
        by_id.values()
    )

    result.sort(
        key=lambda x: (
            x.get("date") or "",
            x.get("id") or "",
        )
    )

    return result


# ============================================================
# MEMORY
# ============================================================

def build_memory(results):
    teams = {}

    finished = [
        match
        for match in results
        if is_finished_fact(match)
    ]

    # --------------------------------------------------------
    # Обрабатываем матчи по дате.
    # --------------------------------------------------------

    finished.sort(
        key=lambda x: (
            x.get("date") or "",
            x.get("id") or "",
        )
    )

    for match in finished:

        home = match.get("home")
        away = match.get("away")

        if not home or not away:
            continue

        if home not in teams:
            teams[home] = {
                "matches": 0,
                "goals_for": 0,
                "goals_against": 0,
                "last5": [],
                "last_match": None,
            }

        if away not in teams:
            teams[away] = {
                "matches": 0,
                "goals_for": 0,
                "goals_against": 0,
                "last5": [],
                "last_match": None,
            }

        hg = match.get("home_goals")
        ag = match.get("away_goals")

        if not is_number(hg) or not is_number(ag):
            continue

        # ----------------------------------------------------
        # HOME
        # ----------------------------------------------------

        teams[home]["matches"] += 1

        teams[home]["goals_for"] += hg

        teams[home]["goals_against"] += ag

        # ----------------------------------------------------
        # AWAY
        # ----------------------------------------------------

        teams[away]["matches"] += 1

        teams[away]["goals_for"] += ag

        teams[away]["goals_against"] += hg

        # ----------------------------------------------------
        # RESULT
        # ----------------------------------------------------

        if hg > ag:
            home_result = "W"
            away_result = "L"

        elif hg < ag:
            home_result = "L"
            away_result = "W"

        else:
            home_result = "D"
            away_result = "D"

        teams[home]["last5"].append(
            home_result
        )

        teams[away]["last5"].append(
            away_result
        )

        teams[home]["last_match"] = (
            match.get("date")
        )

        teams[away]["last_match"] = (
            match.get("date")
        )

    # --------------------------------------------------------
    # FINAL TEAM METRICS
    # --------------------------------------------------------

    for team, data in teams.items():

        data["last5"] = (
            data["last5"][-5:]
        )

        matches = data["matches"]

        if matches:

            data["avg_goals_for"] = round(
                data["goals_for"] / matches,
                4,
            )

            data["avg_goals_against"] = round(
                data["goals_against"] / matches,
                4,
            )

        else:

            data["avg_goals_for"] = None

            data["avg_goals_against"] = None

    return {
        "version": "FEG-MEMORY-0.2",

        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),

        "match_count": len(finished),

        "teams": teams,
    }


# ============================================================
# DIAGNOSTICS
# ============================================================

def print_diagnostics(results):
    finished = [
        match
        for match in results
        if is_finished_fact(match)
    ]

    print()
    print("=" * 60)
    print("FEG DATA DIAGNOSTICS")
    print("=" * 60)

    print(
        f"Всего записей: {len(results)}"
    )

    print(
        f"Завершённых фактов: "
        f"{len(finished)}"
    )

    teams = {}

    for match in finished:

        home = match.get("home")
        away = match.get("away")

        if home:
            teams[home] = (
                teams.get(home, 0) + 1
            )

        if away:
            teams[away] = (
                teams.get(away, 0) + 1
            )

    print(
        f"Команд с фактами: "
        f"{len(teams)}"
    )

    print()

    print(
        "Топ команд по количеству "
        "завершённых матчей:"
    )

    top_teams = sorted(
        teams.items(),
        key=lambda item: item[1],
        reverse=True,
    )

    for team, count in top_teams[:20]:

        print(
            f"  {team}: {count}"
        )

    print("=" * 60)
    print()


# ============================================================
# MAIN
# ============================================================

def main():

    old_results = load_json(
        RESULTS_FILE,
        [],
    )

    if not isinstance(old_results, list):
        print(
            "Предупреждение: "
            "results.json имеет некорректный формат."
        )

        old_results = []

    print(
        f"Старая история: "
        f"{len(old_results)} записей"
    )

    new_results = []

    successful_competitions = 0

    failed_competitions = 0

    # ========================================================
    # DOWNLOAD
    # ========================================================

    for competition, competition_name in (
        COMPETITIONS.items()
    ):

        print(
            f"Получаем данные: "
            f"{competition_name} "
            f"({competition})"
        )

        try:

            matches = get_matches(
                competition
            )

            print(
                f"Получено матчей: "
                f"{len(matches)}"
            )

            # ------------------------------------------------
            # Не принимаем совершенно пустой ответ
            # как нормальное обновление.
            # ------------------------------------------------

            if not matches:

                print(
                    f"Предупреждение: "
                    f"{competition} вернул 0 матчей."
                )

                failed_competitions += 1

                time.sleep(7)

                continue

            successful_competitions += 1

            for match in matches:

                normalized = normalize_match(
                    match,
                    competition,
                    competition_name,
                )

                if not normalized.get("id"):
                    continue

                new_results.append(
                    normalized
                )

        except requests.HTTPError as exc:

            failed_competitions += 1

            print(
                f"Ошибка API для "
                f"{competition}: {exc}"
            )

        except Exception as exc:

            failed_competitions += 1

            print(
                f"Ошибка для "
                f"{competition}: {exc}"
            )

        # ----------------------------------------------------
        # Не создаём слишком быстрый поток запросов.
        # ----------------------------------------------------

        time.sleep(7)

    # ========================================================
    # SAFETY CHECK
    # ========================================================

    print()
    print(
        f"Успешных турниров: "
        f"{successful_competitions}"
    )

    print(
        f"Ошибок турниров: "
        f"{failed_competitions}"
    )

    print(
        f"Новых записей получено: "
        f"{len(new_results)}"
    )

    # --------------------------------------------------------
    # Если вообще не получили данные,
    # НЕ ТРОГАЕМ results.json.
    # --------------------------------------------------------

    if not new_results:

        print()
        print(
            "КРИТИЧЕСКАЯ ЗАЩИТА:"
        )

        print(
            "API не вернул ни одной записи."
        )

        print(
            "Существующий results.json "
            "НЕ ИЗМЕНЯЕМ."
        )

        return

    # ========================================================
    # MERGE
    # ========================================================

    results = merge_results(
        old_results,
        new_results,
    )

    # --------------------------------------------------------
    # История не должна уменьшаться.
    # --------------------------------------------------------

    if len(results) < len(old_results):

        raise RuntimeError(
            "ОШИБКА БЕЗОПАСНОСТИ: "
            "после merge история стала меньше."
        )

    # ========================================================
    # SAVE RESULTS
    # ========================================================

    save_json(
        RESULTS_FILE,
        results,
    )

    # ========================================================
    # MEMORY
    # ========================================================

    memory = build_memory(
        results
    )

    save_json(
        MEMORY_FILE,
        memory,
    )

    # ========================================================
    # DIAGNOSTICS
    # ========================================================

    print()

    print(
        "FEG обновлён."
    )

    print(
        f"Всего записей: "
        f"{len(results)}"
    )

    print(
        f"Завершённых матчей: "
        f"{memory['match_count']}"
    )

    print(
        f"Команд в памяти: "
        f"{len(memory['teams'])}"
    )

    print_diagnostics(
        results
    )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()
