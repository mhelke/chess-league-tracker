#!/usr/bin/env python3
"""Import current member ratings from the optional member-data service.

The member service performs the expensive Chess.com member/statistics work and
returns one cached roster response per club. This script keeps the local
ratings lookup compact: only players present in local league history and in the
latest valid member response are retained. The service is optional so forks
can disable rating-based recruitment while retaining league and risk data.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sys
import tempfile
from typing import Any, Dict, Iterable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
DEFAULT_USER_AGENT = "ChessLeagueTracker/1.0"
MEMBER_SERVICE_URL = "https://chessteamdata.com/api/members"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_timestamp(value: Optional[datetime] = None) -> str:
    return (value or utc_now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalise_username(value: Any) -> str:
    return str(value or "").strip().casefold()


def fetch_member_service_members(url: str, club_id: str, user_agent: str) -> Optional[Dict[str, Any]]:
    """Fetch one cached member-service roster response for a club."""
    try:
        request = Request(
            url,
            headers={"User-Agent": user_agent, "clubid": club_id},
        )
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload if isinstance(payload, dict) else None
    except HTTPError as exc:
        print(f"  [WARN] HTTP {exc.code} fetching member-service data for {club_id}", file=sys.stderr)
    except (URLError, TimeoutError) as exc:
        print(f"  [WARN] Network error fetching member-service data for {club_id}: {exc}", file=sys.stderr)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(f"  [WARN] Invalid member-service data for {club_id}: {exc}", file=sys.stderr)
    return None


def parse_rating(value: Any) -> Optional[int]:
    """Normalize member-service ratings; the service uses 0 for unavailable."""
    try:
        rating = int(value)
    except (TypeError, ValueError):
        return None
    return rating if rating > 0 else None


def parse_timeout_percent(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_source_timestamp(value: Any, fallback: datetime) -> str:
    """Convert member-service updateDate (epoch milliseconds) to ISO time."""
    try:
        timestamp = float(value) / 1000.0
        return iso_timestamp(datetime.fromtimestamp(timestamp, timezone.utc))
    except (TypeError, ValueError, OverflowError, OSError):
        return iso_timestamp(fallback)


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


def discover_historical_players(leagues: Dict[str, Any]) -> Dict[str, str]:
    """Return every player represented in local league history."""
    seen: Dict[str, str] = {}
    for round_data in iter_rounds(leagues):
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

        for board in round_data.get("boardsData") or []:
            if isinstance(board, dict):
                usernames.append(board.get("ourPlayer"))

        for username in usernames:
            display_name = str(username or "").strip()
            key = normalise_username(display_name)
            if key:
                seen.setdefault(key, display_name)
    return seen


def member_service_members(payload: Dict[str, Any]) -> Optional[Dict[str, Dict[str, Any]]]:
    """Validate and normalize the complete member-service response."""
    raw_members = payload.get("members")
    update_date = payload.get("updateDate")
    try:
        # The service contract uses a positive Unix epoch in milliseconds.
        if float(update_date) <= 0:
            return None
    except (TypeError, ValueError):
        return None
    if not isinstance(raw_members, list):
        return None

    members: Dict[str, Dict[str, Any]] = {}
    for member in raw_members:
        if not isinstance(member, dict):
            continue
        key = normalise_username(member.get("username"))
        if key:
            members[key] = member
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


def refresh_site(site_key: str) -> Dict[str, Any]:
    config_dir = os.path.join(PROJECT_ROOT, "config", site_key)
    league_config = load_json(os.path.join(config_dir, "league_config.json"), {})
    params = load_json(os.path.join(config_dir, "script_params.json"), {})
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
    user_agent = os.environ.get("USER_AGENT", DEFAULT_USER_AGENT)
    member_service_enabled = bool(params.get("memberServiceEnabled", False))
    recruitment_enabled = bool(params.get("recruitmentEnabled", False))
    member_service_url = str(params.get("memberServiceUrl") or MEMBER_SERVICE_URL)
    historical = discover_historical_players(league_data.get("leagues") or {})

    if not member_service_enabled:
        output = {
            "schemaVersion": 1,
            "generatedAt": iso_timestamp(now),
            "source": "member-service",
            "sourceStatus": "disabled",
            "sourceUpdatedAt": None,
            "lastAttemptedAt": None,
            "membershipStatus": "unverified",
            "membershipVerifiedAt": None,
            "recruitmentEnabled": False,
            "players": {},
        }
        write_json_atomically(output_path, output)
        print(f"{site_key}: member service disabled; ratings/recruitment cache unavailable.")
        return output

    payload = fetch_member_service_members(member_service_url, club_id, user_agent)
    members = member_service_members(payload) if payload else None

    if members is None:
        output = {
            "schemaVersion": 1,
            "generatedAt": iso_timestamp(now),
            "source": "member-service",
            "sourceStatus": "stale" if existing_players else "unavailable",
            "sourceUpdatedAt": existing.get("sourceUpdatedAt"),
            "lastAttemptedAt": iso_timestamp(now),
            "membershipStatus": existing.get("membershipStatus", "unverified"),
            "membershipVerifiedAt": existing.get("membershipVerifiedAt"),
            "recruitmentEnabled": recruitment_enabled,
            "players": dict(existing_players),
        }
        write_json_atomically(output_path, output)
        print(
            f"{site_key}: member-service data unavailable; retained {len(existing_players)} cached players.",
            file=sys.stderr,
        )
        return output

    source_updated_at = parse_source_timestamp(payload.get("updateDate"), now)
    players: Dict[str, Dict[str, Any]] = {}
    for key, display_name in historical.items():
        member = members.get(key)
        if member is None:
            continue
        previous = existing_players.get(key) if isinstance(existing_players.get(key), dict) else {}
        players[key] = {
            "username": str(member.get("username") or display_name),
            "dailyRating": parse_rating(member.get("daily_rating")),
            "rating960": parse_rating(member.get("daily_960_rating")),
            "memberServiceTimeoutPercent": parse_timeout_percent(member.get("timeout_percent")),
            "fetchedAt": source_updated_at,
            "lastSeenAt": previous.get("lastSeenAt") or source_updated_at,
        }

    output = {
        "schemaVersion": 1,
        "generatedAt": iso_timestamp(now),
        "source": "member-service",
        "sourceStatus": "ok",
        "sourceUpdatedAt": source_updated_at,
        "lastAttemptedAt": iso_timestamp(now),
        "membershipStatus": "verified",
        "membershipVerifiedAt": source_updated_at,
        "recruitmentEnabled": recruitment_enabled,
        "players": players,
    }
    write_json_atomically(output_path, output)
    removed = len(set(existing_players) - set(players))
    print(
        f"{site_key}: memberServiceUpdate={source_updated_at}, members={len(members)}, "
        f"retained={len(players)}, removed={removed}.",
    )
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Import current ratings from ChessClubData.")
    parser.add_argument("--site-key", required=True, help="Site key under config/ and public/data/.")
    args = parser.parse_args()
    refresh_site(args.site_key)


if __name__ == "__main__":
    main()
