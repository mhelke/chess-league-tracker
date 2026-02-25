#!/usr/bin/env python3
"""Detect early resignations (<= N half-moves) from match board endpoints.

Usage:
  python scripts/detect_early_resignations.py --site-key 1dpmc [--threshold 2]

This script scans `public/data/<siteKey>/leagueData.json` for match entries
that include per-player `played_as_white` / `played_as_black` fields
(or nested player objects that contain those keys). When a played_* field
indicates a resignation and provides a `board` API URL, the script will
fetch the board endpoint and inspect each game to find resignation games
with a move count (in half-moves / ply) less than or equal to `threshold`.

Results are written to `public/data/<siteKey>/earlyResignations.json` and a
cache at `public/data/<siteKey>/early_resignations_cache.json` is maintained
so players already checked won't be re-checked on subsequent runs.

The script is defensive about input shapes: it recursively searches match
objects for player entries that contain `played_as_white` / `played_as_black`.
"""

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Tuple
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_USER_AGENT = os.environ.get("USER_AGENT", "ChessLeagueTracker/1.0")
DEFAULT_HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "15"))
DEFAULT_HTTP_RETRIES = int(os.environ.get("HTTP_RETRIES", "2"))


def fetch_json(url: str, user_agent: str = DEFAULT_USER_AGENT, timeout: int = DEFAULT_HTTP_TIMEOUT, retries: int = DEFAULT_HTTP_RETRIES) -> Any:
    """Fetch JSON with retries, timeout and logging."""
    req = Request(url, headers={"User-Agent": user_agent})
    attempt = 0
    while attempt <= retries:
        try:
            logging.debug("Fetching URL (attempt %d): %s", attempt + 1, url)
            with urlopen(req, timeout=timeout) as resp:
                payload = resp.read().decode("utf-8")
                return json.loads(payload)
        except (URLError, HTTPError) as e:
            logging.warning("Fetch failed for %s (attempt %d/%d): %s", url, attempt + 1, retries + 1, e)
            attempt += 1
            if attempt > retries:
                logging.error("Giving up fetching %s after %d attempts", url, attempt)
                return None
            sleep_for = 0.5 * (2 ** (attempt - 1)) + random.random() * 0.5
            time.sleep(sleep_for)
        except Exception as e:
            logging.exception("Unexpected error fetching %s: %s", url, e)
            return None


def parse_pgn_move_count(pgn: str) -> int:
    """Return number of half-moves (ply) in a PGN string.

    This is a lightweight parser: it strips PGN header lines, removes move
    numbers and result tokens, and counts remaining move tokens.
    """
    if not pgn:
        return 0
    # Remove header lines (lines that start with '[')
    lines = [l for l in pgn.splitlines() if not l.strip().startswith("[")]
    moves_text = " ".join(lines).strip()
    # Remove comments and parentheses
    moves_text = re.sub(r"\{[^}]*\}", "", moves_text)
    moves_text = re.sub(r"\([^)]*\)", "", moves_text)
    tokens = [t for t in moves_text.split() if t]
    # Filter out move numbers (e.g. '1.' '12.'), and result tokens
    filtered = [t for t in tokens if not re.match(r"^\d+\.$", t) and t not in ("1-0","0-1","1/2-1/2","*")]
    return len(filtered)


def find_player_played_entries(obj: Any) -> Iterable[Tuple[str, Dict]]:
    """Recursively search `obj` for player objects that include
    `played_as_white` or `played_as_black` fields.

    Yields (username_lower, player_obj)
    """
    if isinstance(obj, dict):
        # Case: explicit player dict with username
        if "username" in obj and ("played_as_white" in obj or "played_as_black" in obj):
            yield obj.get("username", "").lower(), obj
        # Case: mapping username -> player dict
        for k, v in list(obj.items()):
            if isinstance(v, dict) and ("played_as_white" in v or "played_as_black" in v):
                yield str(k).lower(), v
        # Recurse
        for v in obj.values():
            yield from find_player_played_entries(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from find_player_played_entries(item)


def insert_result(results: Dict, league: str, subleague: str, match_key: str, match_info: Dict, entry: Dict) -> None:
    leagues = results.setdefault("leagues", {})
    league_map = leagues.setdefault(league, {})
    sub_map = league_map.setdefault("subLeagues", {})
    sub_entry = sub_map.setdefault(subleague, {})
    matches = sub_entry.setdefault("matches", [])
    # Find existing match item by matchUrl if present
    match_url = match_info.get("matchUrl") or match_info.get("matchId")
    for m in matches:
        if m.get("matchUrl") == match_url:
            m.setdefault("players", []).append(entry)
            return
    # New match item
    match_item = {
        "matchUrl": match_url,
        "matchWebUrl": match_info.get("matchWebUrl"),
        "players": [entry],
    }
    matches.append(match_item)


def main() -> None:
    ap = argparse.ArgumentParser(description="Detect early resignations in match games")
    ap.add_argument("--site-key", required=True)
    ap.add_argument("--threshold", type=int, default=2, help="Max half-moves (ply) to consider 'early' (default: 2)")
    ap.add_argument("--timeout", type=int, default=DEFAULT_HTTP_TIMEOUT, help="HTTP timeout seconds per request")
    ap.add_argument("--retries", type=int, default=DEFAULT_HTTP_RETRIES, help="HTTP retries per request")
    ap.add_argument("--log-level", default="INFO", choices=["DEBUG","INFO","WARNING","ERROR","CRITICAL"], help="Logging level")
    args = ap.parse_args()

    site = args.site_key
    threshold = int(args.threshold)
    http_timeout = int(args.timeout)
    http_retries = int(args.retries)
    log_level = getattr(logging, args.log_level.upper(), logging.INFO)
    logging.basicConfig(level=log_level, format="%(asctime)s %(levelname)-8s %(message)s")
    logging.info("detect_early_resignations starting: site=%s threshold=%d timeout=%d retries=%d", site, threshold, http_timeout, http_retries)
    data_dir = os.path.join(PROJECT_ROOT, "public", "data", site)
    league_path = os.path.join(data_dir, "leagueData.json")
    cache_path = os.path.join(data_dir, "early_resignations_cache.json")
    out_path = os.path.join(data_dir, "earlyResignations.json")

    # Load club ID so we can restrict to our team's players only
    config_path = os.path.join(PROJECT_ROOT, "config", site, "league_config.json")
    if not os.path.exists(config_path):
        print(f"league_config.json not found for site {site}: {config_path}", file=sys.stderr)
        sys.exit(1)
    with open(config_path, "r", encoding="utf-8") as f:
        league_cfg = json.load(f)
    club_id = league_cfg.get("clubId", "")
    if not club_id:
        print(f"clubId missing from league_config.json for site {site}", file=sys.stderr)
        sys.exit(1)
    logging.info("Filtering to club: %s", club_id)

    if not os.path.exists(league_path):
        print(f"leagueData.json not found for site {site}: {league_path}", file=sys.stderr)
        sys.exit(1)

    with open(league_path, "r", encoding="utf-8") as f:
        league_data = json.load(f)
    total_matches_found = 0

    cache = {"checked_players": [], "checked_boards": [], "checked_matches": [], "checked_players_by_match": {}}
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {"checked_players": [], "checked_boards": [], "checked_matches": []}

    # checked_players_by_match: { matchUrl: [username, ...] }
    raw_checked_players_by_match = cache.get("checked_players_by_match", {}) or {}
    checked_players_by_match: Dict[str, set] = {m: set([u.lower() for u in users]) for m, users in raw_checked_players_by_match.items()}
    checked_boards = set(cache.get("checked_boards", []))
    checked_matches = set(cache.get("checked_matches", []))

    # If an existing results file exists, prefill checked_players_by_match
    # so we won't re-record the same player for the same match when merging.
    if os.path.exists(out_path):
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                existing_results = json.load(f)
            for league_val in (existing_results.get("leagues", {}) or {}).values():
                for sub_val in (league_val.get("subLeagues", {}) or {}).values():
                    for match in (sub_val.get("matches", []) or []):
                        murl = match.get("matchUrl")
                        if not murl:
                            continue
                        for p in (match.get("players", []) or []):
                            uname = p.get("username")
                            color = p.get("color", "")
                            if uname:
                                checked_players_by_match.setdefault(murl, set()).add(f"{uname.lower()}:{color}")
        except Exception:
            logging.debug("Unable to prefill checked players from existing results file; continuing")

    # Find candidate (username, color, board_url, match_info)
    candidates_by_board: Dict[str, List[Tuple[str, str, Dict]]] = {}
    # Walk leagues -> subLeagues -> rounds/matches (shaped like fetch_league_data)
    leagues = league_data.get("leagues", {})
    for league_key, league_val in leagues.items():
        sub_leagues = league_val.get("subLeagues", {}) if isinstance(league_val, dict) else {}
        for sub_name, sub_val in sub_leagues.items():
            rounds = sub_val.get("rounds") or sub_val.get("matches") or []
            for match in rounds:
                status = (match.get("status") or "").lower()
                if status not in ("in_progress", "finished"):
                    continue
                match_url = match.get("matchUrl") or match.get("matchId")
                if not match_url:
                    continue
                # Skip matches we've already inspected
                if match_url in checked_matches:
                    continue
                # Fetch the full match JSON from the Chess.com API
                match_json = fetch_json(match_url)
                if not match_json:
                    # mark match as checked to avoid repeated failures
                    checked_matches.add(match_url)
                    continue
                # Identify our team's players only (by matching clubId against teams.*.@id)
                our_team_players = []
                teams = match_json.get("teams", {})
                for team_data in teams.values():
                    if isinstance(team_data, dict) and club_id in team_data.get("@id", ""):
                        our_team_players = team_data.get("players", [])
                        logging.debug("Found our team '%s' in match %s (%d players)", team_data.get("name"), match_url, len(our_team_players))
                        break
                if not our_team_players:
                    logging.warning("Could not identify our team in match %s — skipping", match_url)
                    checked_matches.add(match_url)
                    continue
                # find player entries with played_as_* fields, restricted to our team
                for username, player_obj in find_player_played_entries(our_team_players):
                    if not username:
                        continue
                    for color_field, color_name in (("played_as_white", "white"), ("played_as_black", "black")):
                        # Skip if this player+color was already checked for this match
                        if f"{username}:{color_name}" in checked_players_by_match.get(match_url, set()):
                            logging.debug("Skipping %s (%s) for already-checked match %s", username, color_name, match_url)
                            continue
                        field_val = player_obj.get(color_field)
                        if not field_val:
                            continue
                        # Determine if this was a resignation indicator
                        is_resigned = False
                        board_url = None
                        if isinstance(field_val, str):
                            if field_val.lower() == "resigned" or "resign" in field_val.lower():
                                is_resigned = True
                            # board might be sibling property
                            board_url = player_obj.get("board")
                        elif isinstance(field_val, dict):
                            # often shaped like {"result": "resigned", "board": "https://..."}
                            res = str(field_val.get("result", "")).lower()
                            if res == "resigned" or "resign" in res:
                                is_resigned = True
                            board_url = field_val.get("board") or field_val.get("board_url") or player_obj.get("board")

                        if is_resigned and board_url:
                            lst = candidates_by_board.setdefault(board_url, [])
                            # include league/subleague and match reference from the original leagueData.json
                            match_ref = {
                                "matchUrl": match_url,
                                "matchWebUrl": match.get("matchWebUrl"),
                                "league": league_key,
                                "subLeague": sub_name,
                            }
                            lst.append((username, color_name, match_ref))
                # Mark match as checked to avoid re-fetching next run
                checked_matches.add(match_url)

    if not candidates_by_board:
        logging.info("No candidate resigned players with board URLs found.")

    results: Dict = {"lastUpdated": datetime.now(timezone.utc).isoformat(), "leagues": {}}

    # For efficiency, fetch each board once
    for board_url, candidates in candidates_by_board.items():
        if not candidates:
            continue
        # Skip candidates already checked for their specific match+color
        remaining = [c for c in candidates if f"{c[0]}:{c[1]}" not in checked_players_by_match.get(c[2].get("matchUrl"), set())]
        if not remaining:
            continue
        logging.info("Fetching board: %s for %d candidate(s)", board_url, len(remaining))
        board_json = fetch_json(board_url, timeout=http_timeout, retries=http_retries)
        if not board_json:
            logging.warning("Failed to fetch board: %s", board_url)
            # mark players as checked for their matches to avoid repeated failures
            for username, color_name, match_ref in remaining:
                murl = match_ref.get("matchUrl") if isinstance(match_ref, dict) else None
                if murl:
                    checked_players_by_match.setdefault(murl, set()).add(f"{username}:{color_name}")
            checked_boards.add(board_url)
            continue

        games = board_json.get("games") or board_json.get("game") or []
        if isinstance(games, dict):
            games = [games]

        # Iterate games and match to candidates
        for idx, game in enumerate(games):
            # Normalize usernames
            white_user = (game.get("white", {}) or {}).get("username") if isinstance(game.get("white"), dict) else None
            black_user = (game.get("black", {}) or {}).get("username") if isinstance(game.get("black"), dict) else None
            if white_user:
                white_user = white_user.lower()
            if black_user:
                black_user = black_user.lower()

            # Candidate match
            for username, color_name, match_info in list(remaining):
                if username not in (white_user, black_user):
                    continue
                # Determine if this game records resignation for this player
                person_side = "white" if username == white_user else "black"
                # Check result fields in game
                side_obj = game.get(person_side) if isinstance(game.get(person_side), dict) else {}
                result_field = str(side_obj.get("result", "")).lower() if side_obj else ""
                termination = str(game.get("termination", "")).lower() if game.get("termination") else ""
                top_result = str(game.get("result", "")).lower() if game.get("result") else ""
                resigned = False
                for chk in (result_field, termination, top_result):
                    if chk and "resign" in chk:
                        resigned = True
                        break

                # As a fallback, check pgn for the word 'resign'
                if not resigned:
                    pgn_txt = game.get("pgn") or ""
                    if pgn_txt and "resign" in pgn_txt.lower():
                        resigned = True

                if not resigned:
                    logging.debug("Player %s (%s) in match %s: not resigned in fetched game", username, color_name, match_info.get("matchUrl"))
                    # mark as checked for this match+color and skip
                    checked_players_by_match.setdefault(match_info.get("matchUrl"), set()).add(f"{username}:{color_name}")
                    remaining = [c for c in remaining if not (c[0] == username and c[1] == color_name and c[2].get("matchUrl") == match_info.get("matchUrl"))]
                    continue

                # Compute move count
                pgn_txt = game.get("pgn") or ""
                moves = parse_pgn_move_count(pgn_txt)
                if moves <= threshold:
                    # Build entry
                    game_api_link = game.get("url") or game.get("game_url") or f"{board_url}#index={idx}"
                    entry = {
                        "username": username,
                        "color": person_side,
                        "moves_ply": moves,
                        "game_api": game_api_link,
                        "board_api": board_url,
                    }
                    # Insert into results under league/subleague/match
                    # We need league and subleague names: try to find via match_info fields
                    league_name = match_info.get("league") or match_info.get("leagueName") or "unknown"
                    subleague_name = match_info.get("subLeague") or match_info.get("subLeagueName") or "unknown"
                    insert_result(results, league_name, subleague_name, match_info.get("matchId") or match_info.get("matchUrl"), match_info, entry)

                # Whether or not we recorded, mark player+color as checked for this match
                checked_players_by_match.setdefault(match_info.get("matchUrl"), set()).add(f"{username}:{color_name}")
                remaining = [c for c in remaining if not (c[0] == username and c[1] == color_name and c[2].get("matchUrl") == match_info.get("matchUrl"))]

        # After processing this board, mark it checked
        checked_boards.add(board_url)

    # Write results and cache
    try:
        if os.path.exists(out_path):
            # Merge with existing results to preserve history
            with open(out_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
        else:
            existing = {"leagues": {}, "lastUpdated": None}
    except Exception:
        existing = {"leagues": {}, "lastUpdated": None}

    # Merge leagues by appending matches/players when new
    for league_key, league_val in results.get("leagues", {}).items():
        dest_league = existing.setdefault("leagues", {}).setdefault(league_key, {})
        for sub_key, sub_val in league_val.get("subLeagues", {}).items():
            dest_sub = dest_league.setdefault("subLeagues", {}).setdefault(sub_key, {})
            dest_matches = dest_sub.setdefault("matches", [])
            # Append matches from new results
            for match_item in sub_val.get("matches", []):
                # Try to find existing match by matchUrl
                murl = match_item.get("matchUrl")
                found = False
                for dm in dest_matches:
                    if dm.get("matchUrl") == murl:
                        # Append players not already present (by username + game_api)
                        existing_players = {(p.get("username"), p.get("game_api")) for p in dm.get("players", [])}
                        for p in match_item.get("players", []):
                            key = (p.get("username"), p.get("game_api"))
                            if key not in existing_players:
                                dm.setdefault("players", []).append(p)
                        found = True
                        break
                if not found:
                    dest_matches.append(match_item)

    # (No post-write deduplication - merging logic above avoids adding exact duplicates.)

    existing["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)

    # Update cache
    cache_obj = {
        "checked_players_by_match": {m: sorted(list(users)) for m, users in checked_players_by_match.items()},
        "checked_boards": sorted(list(checked_boards)),
        "checked_matches": sorted(list(checked_matches)),
        "lastRun": datetime.now(timezone.utc).isoformat(),
    }
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache_obj, f, indent=2, ensure_ascii=False)

    logging.info("Wrote results to %s", out_path)
    logging.info("Updated cache at %s", cache_path)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logging.warning("Interrupted by user; exiting")
        sys.exit(2)


if __name__ == "__main__":
    main()
