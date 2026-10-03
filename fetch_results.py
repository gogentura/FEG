import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests


API_URL = "https://api.football-data.org/v4"

TOKEN = os.getenv("FOOTBALL_DATA_TOKEN")

if not TOKEN:
    raise RuntimeError(
        "Не найден GitHub Secret FOOTBALL_DATA_TOKEN"
    )


# Лиги, которые FEG собирает на первом этапе.
COMPETITIONS = {
    "PL": "Premier League",
    "PD": "La Liga",
    "BL1": "Bundesliga",
    "SA": "Serie A",
    "FL1": "Ligue 1",
    "CL": "UEFA Champions League",
}


RESULTS_FILE = Path("results.json")
MEMORY_FILE = Path("memory.json")


HEADERS = {
    "X-Auth-Token": TOKEN,
    "Accept": "application/json",
}


def load_json(path, default):
    if not path.exists():
        return default

    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, data):
    with path.open("w", encoding="utf-8") as f:
        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
        )


def get_matches(competition):
    url = f"{API_URL}/competitions/{competition}/matches"

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=30,
    )

    response.raise_for_status()

    return response.json().get("matches", [])


def normalize_match(match, competition, competition_name):
    score = match.get("score") or {}
    full_time = score.get("fullTime") or {}
    half_time = score.get("halfTime") or {}

    home = match.get("homeTeam") or {}
    away = match.get("awayTeam") or {}

    match_id = match.get("id")

    return {
        "id": f"fd:{match_id}",
        "source": "football-data.org",
        "source_match_id": match_id,

        "date": match.get("utcDate"),

        "competition": competition,
        "competition_name": competition_name,

        "season": (
            (match.get("season") or {}).get("startDate")
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

        # Эти поля пока резервируем.
        # Если источник их отдаёт в будущем,
        # они смогут войти в Brain.
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


def merge_results(old_results, new_results):
    by_id = {}

    for match in old_results:
        match_id = match.get("id")

        if match_id:
            by_id[match_id] = match

    for match in new_results:
        match_id = match.get("id")

        if match_id:
            by_id[match_id] = match

    result = list(by_id.values())

    result.sort(
        key=lambda x: (
            x.get("date") or "",
            x.get("id") or "",
        )
    )

    return result


def build_memory(results):
    teams = {}

    finished = [
        match
        for match in results
        if match.get("status") == "FINISHED"
        and match.get("home_goals") is not None
        and match.get("away_goals") is not None
    ]

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

        hg = match["home_goals"]
        ag = match["away_goals"]

        teams[home]["matches"] += 1
        teams[home]["goals_for"] += hg
        teams[home]["goals_against"] += ag

        teams[away]["matches"] += 1
        teams[away]["goals_for"] += ag
        teams[away]["goals_against"] += hg

        if hg > ag:
            home_result = "W"
            away_result = "L"
        elif hg < ag:
            home_result = "L"
            away_result = "W"
        else:
            home_result = "D"
            away_result = "D"

        teams[home]["last5"].append(home_result)
        teams[away]["last5"].append(away_result)

        teams[home]["last_match"] = match.get("date")
        teams[away]["last_match"] = match.get("date")

    for team, data in teams.items():
        data["last5"] = data["last5"][-5:]

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
        "version": "FEG-MEMORY-0.1",
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),

        "match_count": len(finished),
        "teams": teams,
    }


def main():
    old_results = load_json(
        RESULTS_FILE,
        [],
    )

    new_results = []

    for competition, competition_name in COMPETITIONS.items():
        print(
            f"Получаем данные: "
            f"{competition_name} ({competition})"
        )

        try:
            matches = get_matches(competition)

            for match in matches:
                normalized = normalize_match(
                    match,
                    competition,
                    competition_name,
                )

                new_results.append(normalized)

            print(
                f"Получено матчей: {len(matches)}"
            )

        except requests.HTTPError as exc:
            print(
                f"Ошибка API для {competition}: "
                f"{exc}"
            )

        except Exception as exc:
            print(
                f"Ошибка для {competition}: "
                f"{exc}"
            )

        # Не создаём слишком быстрый поток запросов.
        time.sleep(7)

    results = merge_results(
        old_results,
        new_results,
    )

    save_json(
        RESULTS_FILE,
        results,
    )

    memory = build_memory(results)

    save_json(
        MEMORY_FILE,
        memory,
    )

    print()
    print("FEG обновлён.")
    print(f"Всего записей: {len(results)}")
    print(
        f"Завершённых матчей: "
        f"{memory['match_count']}"
    )
    print(
        f"Команд в памяти: "
        f"{len(memory['teams'])}"
    )


if __name__ == "__main__":
    main()
