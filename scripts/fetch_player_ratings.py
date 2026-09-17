#!/usr/bin/env python3
"""Build a bounded, membership-verified cache of current daily ratings.

The cache is intentionally a lookup table, not a rating history.  Historical
league data discovers candidates, while the Club Members API decides whether a
candidate still belongs to the club.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sys
import tempfile
import time
from typing import Any, Dict, Iterable, Optional, Set, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
DEFAULT_USER_AGENT = "ChessLeagueTracker/1.0"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: Optional[datetime] = None) -> str:
    return (value or utc_now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalise_username(value: Any) -> str:
    return str(value or "").strip().casefold()


def fetch_json(url: str, user_agent: str) -> Optional[Dict[str, Any]]:
    """Fetch public Chess.com JSON.  None means the response was unusable."""
    try:
        request = Request(url, headers={"User-Agent": user_agent})
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload if isinstance(payload, dict) else None
    except HTTPError as exc:
        print(f"  [WARN] HTTP {exc.code} fetching {url}", file=sys.stderr)
    except URLError as exc:
        print(f"  [WARN] Network error fetching {url}: {exc}", file=sys.stderr)
    except json.JSONDecodeError as exc:
        print(f"  [WARN] Invalid JSON from {url}: {exc}", file=sys.stderr)
    return None


def extract_ratings(stats: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
    """Return the latest Daily and Daily Chess960 ratings from /stats."""
    ratings = []
    for variant_key in ("chess_daily", "chess960_daily"):
        variant = stats.get(variant_key) or {}
        last = variant.get("last") if isinstance(variant, dict) else None
        rating = last.get("rating") if isinstance(last, dict) else None
        try:
            ratings.append(int(rating) if rating is not None else None)
        except (TypeError, ValueError):
            ratings.append(None)
    return ratings[0], ratings[1]


def iter_rounds(leagues: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    for league in leagues.values():
        if not isinstance(league, dict):
            continue
        for subleague in (league.get("subLeagues") or {}).values():
            if not isinstance(subleague, dict):
                continue
            for round_data in subleague.get("rounds") or []:
                if isinstance(round_data, dict):
                    yield round_data


def _record_player(players: Dict[str, Tuple[str, float]], username: Any, seen_ts: float) -> None:
    display_name = str(username or "").strip()
    key = normalise_username(display_name)
    if not key:
        return
    prior = players.get(key)
    if prior is None or seen_ts > prior[1]:
        players[key] = (display_name, seen_ts)


def discover_players(
    leagues: Dict[str, Any], now_ts: float, refresh_window_days: int
) -> Tuple[Dict[str, Tuple[str, float]], Set[str]]:
    """Return own-club historical players and the active/recent refresh cohort."""
    seen: Dict[str, Tuple[str, float]] = {}
    refresh: Set[str] = set()
    cutoff = now_ts - refresh_window_days * 86400

    for round_data in iter_rounds(leagues):
        status = str(round_data.get("status") or "").casefold()
        raw_start = round_data.get("startTime")
        try:
            start_ts = float(raw_start)
        except (TypeError, ValueError):
            start_ts = 0.0
        is_live = status in {"open", "in_progress"}
        is_recent = start_ts >= cutoff if start_ts else False
        seen_ts = max(start_ts, now_ts) if is_live else start_ts

        usernames = []
        player_stats = round_data.get("playerStats") or {}
        if isinstance(player_stats, dict):
            usernames.extend(player_stats.keys())
        registration = round_data.get("registrationData") or {}
        if isinstance(registration, dict):
            usernames.extend(
                player.get("username")
                for player in registration.get("ourRoster") or []
                if isinstance(player, dict)
            )
        usernames.extend(
            board.get("ourPlayer")
            for board in round_data.get("boardsData") or []
            if isinstance(board, dict)
        )

        for username in usernames:
            _record_player(seen, username, seen_ts)
            key = normalise_username(username)
            if key and (is_live or is_recent):
                refresh.add(key)
    return seen, refresh


def current_members(data: Dict[str, Any]) -> Optional[Set[str]]:
    """Validate and normalize the complete current-membership response."""
    if not all(isinstance(data.get(group), list) for group in ("weekly", "monthly", "all_time")):
        return None
    members: Set[str] = set()
    for group in ("weekly", "monthly", "all_time"):
        for member in data[group]:
            if isinstance(member, dict):
                key = normalise_username(member.get("username"))
                if key:
                    members.add(key)
    return members


def load_json(path: str, default: Dict[str, Any]) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else default
    except (OSError, json.JSONDecodeError):
        return default


def write_json_atomically(path: str, value: Dict[str, Any]) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temporary_path = tempfile.mkstemp(prefix=".playerRatings-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise


def parse_iso_timestamp(value: Any) -> float:
    if not isinstance(value, str):
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def refresh_site(site_key: str, force: bool = False, usernames: Optional[Set[str]] = None) -> Dict[str, Any]:
    config_dir = os.path.join(PROJECT_ROOT, "config", site_key)
    params = load_json(os.path.join(config_dir, "script_params.json"), {})
    league_config = load_json(os.path.join(config_dir, "league_config.json"), {})
    club_id = league_config.get("clubId")
    if not isinstance(club_id, str) or not club_id:
        raise ValueError(f"Missing clubId for site '{site_key}'")

    data_dir = os.path.join(PROJECT_ROOT, "public", "data", site_key)
    league_data = load_json(os.path.join(data_dir, "leagueData.json"), {})
    if not league_data:
        raise FileNotFoundError(f"Unable to read {os.path.join(data_dir, 'leagueData.json')}")

    output_path = os.path.join(data_dir, "playerRatings.json")
    existing = load_json(output_path, {})
    existing_players = existing.get("players") if isinstance(existing.get("players"), dict) else {}
    now = utc_now()
    now_ts = now.timestamp()
    refresh_days = int(params.get("ratingsRefreshWindowDays", 180))
    retention_days = int(params.get("ratingsRetentionDays", 365))
    request_delay = float(params.get("ratingsRequestDelaySeconds", 0.3))
    user_agent = os.environ.get("USER_AGENT", params.get("userAgent", DEFAULT_USER_AGENT))

    membership_data = fetch_json(f"https://api.chess.com/pub/club/{club_id}/members", user_agent)
    members = current_members(membership_data) if membership_data else None
    output: Dict[str, Any] = {
        "schemaVersion": 1,
        "generatedAt": iso_timestamp(now),
        "refreshWindowDays": refresh_days,
        "retentionDays": retention_days,
        "membershipStatus": "verified" if members is not None else "unverified",
        "membershipVerifiedAt": iso_timestamp(now) if members is not None else existing.get("membershipVerifiedAt"),
        "players": dict(existing_players),
    }

    if members is None:
        write_json_atomically(output_path, output)
        print(f"Membership validation failed for {site_key}; retained {len(existing_players)} entries and marked cache unverified.")
        return output

    seen, refresh_cohort = discover_players(league_data.get("leagues") or {}, now_ts, refresh_days)
    seen = {key: value for key, value in seen.items() if key in members}
    refresh_cohort.intersection_update(members)
    selected = {normalise_username(name) for name in (usernames or set()) if normalise_username(name)}
    if selected:
        refresh_cohort.intersection_update(selected)

    retention_cutoff = now_ts - retention_days * 86400
    players: Dict[str, Dict[str, Any]] = {}
    removed_departed = 0
    pruned = 0
    for username, entry in existing_players.items():
        key = normalise_username(username)
        if not key or not isinstance(entry, dict):
            continue
        if key not in members:
            removed_departed += 1
            continue
        last_seen_ts = parse_iso_timestamp(entry.get("lastSeenAt"))
        if key in seen:
            last_seen_ts = seen[key][1]
        if last_seen_ts and last_seen_ts < retention_cutoff and key not in refresh_cohort:
            pruned += 1
            continue
        players[key] = dict(entry)

    newly_retained: Set[str] = set()
    for key, (display_name, seen_ts) in seen.items():
        # Do not resurrect a long-inactive historical player after retention
        # pruned it. They become eligible again only through recent/live play.
        if key not in players and seen_ts < retention_cutoff and key not in refresh_cohort:
            continue
        if key not in players:
            newly_retained.add(key)
        entry = players.setdefault(key, {})
        entry["username"] = display_name
        entry["lastSeenAt"] = iso_timestamp(datetime.fromtimestamp(seen_ts, timezone.utc))

    targets = set(refresh_cohort)
    targets.update(newly_retained)
    targets.update(
        key for key, entry in players.items()
        if entry.get("fetchStatus") == "failed"
    )
    if selected:
        targets = selected & members
    elif force:
        targets = set(players)

    fetched = 0
    failed = 0
    for username in sorted(targets):
        stats = fetch_json(f"https://api.chess.com/pub/player/{username}/stats", user_agent)
        entry = players.setdefault(username, {"username": seen.get(username, (username, now_ts))[0]})
        entry["lastAttemptedAt"] = iso_timestamp(now)
        if stats is None:
            entry["fetchStatus"] = "failed"
            failed += 1
        else:
            daily_rating, rating_960 = extract_ratings(stats)
            entry.update({
                "dailyRating": daily_rating,
                "rating960": rating_960,
                "fetchedAt": iso_timestamp(now),
                "fetchStatus": "ok",
            })
            fetched += 1
        if request_delay:
            time.sleep(request_delay)

    output["players"] = players
    write_json_atomically(output_path, output)
    print(
        f"{site_key}: members={len(members)}, seen={len(seen)}, refresh={len(refresh_cohort)}, "
        f"fetched={fetched}, failed={failed}, removed_departed={removed_departed}, pruned={pruned}."
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh membership-verified daily ratings.")
    parser.add_argument("--site-key", required=True, help="Site key under config/ and public/data/.")
    parser.add_argument("--force", action="store_true", help="Refresh every retained current member.")
    parser.add_argument("--username", action="append", default=[], help="Refresh one current member (repeatable).")
    args = parser.parse_args()
    refresh_site(args.site_key, force=args.force, usernames=set(args.username))


if __name__ == "__main__":
    main()
