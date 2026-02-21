#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chess League Data Fetcher
Fetches, parses, and aggregates chess league data from chess.com club matches.
Outputs a JSON file for consumption by the static React website.
"""

import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from typing import Dict, List, Any, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# Ensure stdout uses UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# ── Paths (always relative to this file, regardless of cwd) ───────────────────

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))


# ── Module-level configuration ─────────────────────────────────────────────────
# These globals are populated by load_config() in main() before any
# processing functions are called.  They must not be used at import time.

CLUB_ID: str           = ""
CLUB_MATCHES_URL: str  = ""
OUTPUT_FILE: str       = ""
LEAGUE_CONFIG: list    = []
VARIANT_PATTERNS: list = []
USER_AGENT: str        = "ChessLeagueTracker/1.0"


def load_config(site_key: str) -> None:
    """Load per-site and shared config files from `config/` and set globals."""
    global CLUB_ID, CLUB_MATCHES_URL, OUTPUT_FILE, LEAGUE_CONFIG, VARIANT_PATTERNS, USER_AGENT

    config_dir = os.path.join(PROJECT_ROOT, "config", site_key)

    # ── league_config.json (per-site, required)
    league_config_path = os.path.join(config_dir, "league_config.json")
    if not os.path.exists(league_config_path):
        print(f"ERROR: Config file not found: {league_config_path}", file=sys.stderr)
        sys.exit(1)
    with open(league_config_path, "r", encoding="utf-8") as f:
        league_cfg = json.load(f)

    CLUB_ID          = league_cfg["clubId"]
    LEAGUE_CONFIG    = league_cfg.get("leagues", [])
    CLUB_MATCHES_URL = f"https://api.chess.com/pub/club/{CLUB_ID}/matches"

    # ── variant_patterns.json (shared, optional)
    # Prefer config/shared to keep all inputs together; fall back to
    # scripts/shared for backward compatibility.
    variant_path = os.path.join(PROJECT_ROOT, "config", "shared", "variant_patterns.json")
    if not os.path.exists(variant_path):
        variant_path = os.path.join(SCRIPT_DIR, "shared", "variant_patterns.json")

    if os.path.exists(variant_path):
        with open(variant_path, "r", encoding="utf-8") as f:
            VARIANT_PATTERNS = json.load(f)
    else:
        VARIANT_PATTERNS = []

    # ── Output file
    OUTPUT_FILE = os.path.join(PROJECT_ROOT, "public", "data", site_key, "leagueData.json")

    # ── User agent (env override > script_params.json > default)
    params_path = os.path.join(config_dir, "script_params.json")
    if os.path.exists(params_path):
        with open(params_path, "r", encoding="utf-8") as f:
            params = json.load(f)
        USER_AGENT = params.get("userAgent", USER_AGENT)
    USER_AGENT = os.environ.get("USER_AGENT", USER_AGENT)

def fetch_json(url: str) -> Optional[Dict]:
    """Fetch JSON data from a URL with error handling."""
    try:
        req = Request(url, headers={'User-Agent': USER_AGENT})
        with urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except (URLError, HTTPError) as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON from {url}: {e}", file=sys.stderr)
        return None


def parse_match_title(title: str) -> Optional[Dict[str, str]]:
    """
    Parse a match title to extract league, sub-league, and round.

    Sub-leagues are discovered automatically so you never need to enumerate
    them. Joining a new sub-league (e.g. "WL2026 U1500 R3") will automatically be picked up.

    Team-name boundary detection (in priority order):
      1. Colon:   "WL2026 SubLeague R1: TeamA vs TeamB"
                   Everything before ':' is structural; team names ignored.
      2. Round token: "WL2026 SubLeague R1 TeamA vs TeamB"
                   Text LEFT  of the round token → sub-league qualifier.
                   Text RIGHT of the round token (before ' vs ') → teamName,
                   discarded automatically.
      3. ' vs ' only (no colon, no round): "WL2026 SubLeague TeamA vs TeamB"
                   Everything before ' vs ' is taken; team1 name unavoidably
                   bleeds into the sub-league string.  Add a colon or round
                   number to the match title to avoid this.
                   (See `resolve_unresolved_matches` function which attempts to 
                   resolve these cases automatically)

    Round tokens recognized (case-insensitive, anywhere in title):
        R1, R2 …       ("R" + digits)
        Round 1 …      ("Round" + digits)
        Rd 1 …         ("Rd" + digits)
        G1, Game 1 …   ("G" / "Game" + digits)

    Examples (all produce identical output for the same sub-league):
      "WL2026 Open R1"                      -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open R1: TeamA vs TeamB"      -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open R1 TeamA vs TeamB"       -> league=WL, subLeague=2026 Open,         round=R1
      "WL2026 Open TeamA vs TeamB"          -> league=WL, subLeague=2026 Open TeamA,   round=None  (ambiguous - add colon or round)
      "WL2026 R1"                           -> league=WL, subLeague=2026,              round=R1
      "Chess960 WL2026 R1"                  -> league=WL, subLeague=Chess960 2026,     round=R1
      "WL2026 Chess960 Round 3"             -> league=WL, subLeague=Chess960 2026,     round=R3
      "WL2026 U1500 Rd 4: TeamA vs TeamB"   -> league=WL, subLeague=2026 U1500,        round=R4
    """
    working = title.strip()

    # ── 1. Find which league config matches ────────────────────────────────────
    league_name: Optional[str] = None
    year: Optional[str] = None
    league_m = None

    for cfg in LEAGUE_CONFIG:
        m = re.search(cfg["root_pattern"], working, re.IGNORECASE)
        if m:
            league_name = cfg["name"]
            year = m.groupdict().get("year")  # None if no year capture group
            league_m = m
            break

    if not league_name:
        return None

    # Remove the matched league identifier from the working string.
    working = (working[:league_m.start()] + working[league_m.end():]).strip()

    # ── 2. Isolate the structural portion (strip team names) ───────────────────
    # Priority: colon > round token (acts as boundary in step 3) > bare " vs ".
    # Track if we fell back to a bare " vs " split. That is the only case where
    # team1's name may bleed into the sub-league text (ambiguous).
    split_on_vs_only = False
    if ":" in working:
        working = working.split(":", 1)[0].strip()
    elif re.search(r"\bvs\b", working, re.IGNORECASE):
        vs_m = re.search(r"\bvs\b", working, re.IGNORECASE)
        working = working[:vs_m.start()].strip()
        split_on_vs_only = True

    # ── 3. Extract round token ─────────────────────────────────────────────────
    # Patterns tried in priority order; first match wins.
    # Canonical form: R<n> for round-style, G<n> for game-style.
    ROUND_PATTERNS = [
        (r"\b(?:Round|Rd)\.?\s*(\d+)\b", "R"),   # Round 1 / Rd 1 / Rd.1
        (r"\bR(\d+)\b",                   "R"),   # R1
        (r"\b(?:Game|G)\.?\s*(\d+)\b",   "G"),   # Game 1 / G1
    ]
    round_str: Optional[str] = None
    for rp, prefix in ROUND_PATTERNS:
        round_m = re.search(rp, working, re.IGNORECASE)
        if round_m:
            round_str = f"{prefix}{round_m.group(1)}"
            # Keep only the text LEFT of the round token as the sub-league
            # qualifier; text to the right was team1's name (no colon present).
            working = working[:round_m.start()].strip()
            split_on_vs_only = False  # round token fully disambiguates
            break

    # ── 4. Extract variant keywords (in any order) ─────────────────────────────
    variants: list = []
    for pattern, canonical in VARIANT_PATTERNS:
        vm = re.search(pattern, working, re.IGNORECASE)
        if vm:
            if canonical not in variants:
                variants.append(canonical)
            working = (working[:vm.start()] + working[vm.end():]).strip()

    # ── 5. Assemble canonical sub-league name ──────────────────────────────────
    # Format: "<variant(s)> <year> <any-remaining-qualifier>"
    remaining = re.sub(r"\s+", " ", working).strip(" -:")
    parts = variants + ([year] if year else []) + ([remaining] if remaining else [])
    sub_league = " ".join(parts) if parts else "main"

    # ── Ambiguous case ─────────────────────────────────────────────────────────
    # No colon and no round token → team1's name has bled into sub_league.
    # Return a sentinel so resolve_unresolved_matches() can fix it later using
    # confirmed sub-league names from other matches.
    if split_on_vs_only:
        return {
            "league":       league_name,
            "subLeague":    "__unresolved__",
            "round":        None,
            "rawRemainder": sub_league,  # contaminated text, used for fuzzy match
        }

    return {
        "league":    league_name,
        "subLeague": sub_league,
        "round":     round_str,
    }


def resolve_unresolved_matches(league_matches: List[Dict]) -> int:
    """
    Two-pass resolution for matches flagged as '__unresolved__' by parse_match_title.

    These are titles that had no colon separator and no round token, meaning
    team1's name bled into the sub-league qualifier text. This function tries
    to fix them using confirmed sub-league names from other parsed matches.

    Algorithm:
      Pass 1 - collect every confirmed sub-league name (subLeague != '__unresolved__').
      Pass 2 - for each unresolved match, score each confirmed sub-league by how
               many of its non-year qualifier words appear in the rawRemainder.
               The highest-scoring (most specific) match wins.
               Ties broken by longer name (more words = more specific).
               If no confirmed sub-league matches → assign 'Undefined Subleague'.

    Returns the number of matches that could not be resolved.
    """
    confirmed: Dict[str, set] = defaultdict(set)
    for m in league_matches:
        sl = m["parsed"]["subLeague"]
        if sl != "__unresolved__":
            confirmed[m["parsed"]["league"]].add(sl)

    unresolved_count = 0
    for m in league_matches:
        if m["parsed"]["subLeague"] != "__unresolved__":
            continue

        league  = m["parsed"]["league"]
        raw     = m["parsed"].get("rawRemainder", "").lower().split()

        best_sl:    Optional[str] = None
        best_score: int           = 0
        best_len:   int           = 0

        for sl in confirmed[league]:
            # Qualifier words are everything except a bare 4-digit year
            qualifier_words = [w for w in sl.split() if not re.match(r"^\d{4}$", w)]

            if not qualifier_words:
                # Sub-league is just a year (e.g. "2026").
                # Accept it only as a last-resort fallback (score 0, length 0).
                if best_sl is None:
                    best_sl = sl
                continue

            hits = sum(1 for w in qualifier_words if w.lower() in raw)
            sl_len = len(qualifier_words)

            # Must match ALL qualifier words; prefer longer (more specific) sub-leagues
            if hits == sl_len and (hits > best_score or (hits == best_score and sl_len > best_len)):
                best_sl    = sl
                best_score = hits
                best_len   = sl_len

        if best_sl and best_score > 0:
            m["parsed"]["subLeague"] = best_sl
            print(f"  Resolved unresolved match → sub-league '{best_sl}': {m['title']}")
        else:
            m["parsed"]["subLeague"] = "Undefined Subleague"
            unresolved_count += 1
            print(f"  Could not resolve → 'Undefined Subleague': {m['title']}")

    return unresolved_count


def get_player_result_from_game(username: str, game: Dict) -> Optional[Dict[str, Any]]:
    """
    Determine the result for a specific player in a game.
    Returns dict with result type and colors played, or None.
    """
    username = username.lower()
    
    white = game.get("white", {})
    black = game.get("black", {})
    
    white_username = white.get("username", "").lower()
    black_username = black.get("username", "").lower()
    
    white_result = white.get("result", "")
    black_result = black.get("result", "")
    
    result_type = None
    color = None
    
    # Check if player was white
    if username == white_username:
        color = "white"
        if white_result == "win":
            result_type = "win"
        elif white_result in ["checkmated", "resigned", "timeout", "abandoned"]:
            result_type = "loss"
        elif white_result in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
            result_type = "draw"
    
    # Check if player was black
    elif username == black_username:
        color = "black"
        if black_result == "win":
            result_type = "win"
        elif black_result in ["checkmated", "resigned", "timeout", "abandoned"]:
            result_type = "loss"
        elif black_result in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
            result_type = "draw"
    
    if result_type and color:
        return {"result": result_type, "color": color}
    
    return None


def get_match_web_url(match_url: str) -> str:
    """Convert API URL to web URL."""
    # API URL: https://api.chess.com/pub/match/<ID>
    # Web URL: https://www.chess.com/club/matches/<ID>
    match_id = match_url.split("/")[-1]
    return f"https://www.chess.com/club/matches/{match_id}"


def process_result(result_str: str) -> str:
    """
    Convert a chess.com result string to win/draw/loss.
    """
    result_str = str(result_str).lower()
    if result_str == "win":
        return "win"
    elif result_str in ["checkmated", "resigned", "timeout", "abandoned"]:
        return "loss"
    elif result_str in ["stalemate", "repetition", "insufficient", "50move", "agreed", "timevsinsufficient"]:
        return "draw"
    return "unknown"


def process_match(match_url: str, parsed_title: Dict, status: str) -> Optional[Dict]:
    """
    Fetch and process a single match.
    Returns match data with player statistics (only from our club).
    Each player plays 2 games: one as white, one as black.
    """
    print(f"Processing match: {match_url}")
    
    match_data = fetch_json(match_url)
    if not match_data:
        return None
    
    # Use the status from Chess.com API (passed as parameter)
    boards_count = match_data.get("boards", 0)
    
    # Identify which team is our club by matching @id field
    our_team_key = None
    our_team_data = None
    opponent_team_data = None
    teams = match_data.get("teams", {})
    
    for team_key, team_data in teams.items():
        if isinstance(team_data, dict):
            # Match by @id field containing CLUB_ID
            team_id = team_data.get("@id", "")
            if CLUB_ID in team_id:
                our_team_key = team_key
                our_team_data = team_data
                print(f"  Found our team: {team_data.get('name')} (key: {team_key})")
            else:
                opponent_team_data = team_data
    
    if not our_team_key or not our_team_data:
        print(f"  Warning: Could not identify our club's team in this match")
        return None

    # Extract player statistics from our team
    # Each player plays 2 games: played_as_white and played_as_black
    player_stats = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "timeouts": 0})
    
    players = our_team_data.get("players", [])
    print(f"  Processing {len(players)} players...")
    
    for player in players:
        if not isinstance(player, dict):
            continue
            
        username = player.get("username", "").lower()
        if not username:
            continue
        
        # For in_progress and finished matches, count timeouts and process results
        if status in ["in_progress", "finished"]:
            # Process white game
            white_result = player.get("played_as_white")
            if white_result:
                player_stats[username]["games"] += 1
                if white_result == "timeout":
                    player_stats[username]["timeouts"] += 1
                    player_stats[username]["losses"] += 1
                else:
                    result_type = process_result(white_result)
                    if result_type == "win":
                        player_stats[username]["wins"] += 1
                    elif result_type == "draw":
                        player_stats[username]["draws"] += 1
                    elif result_type == "loss":
                        player_stats[username]["losses"] += 1
            
            # Process black game
            black_result = player.get("played_as_black")
            if black_result:
                player_stats[username]["games"] += 1
                if black_result == "timeout":
                    player_stats[username]["timeouts"] += 1
                    player_stats[username]["losses"] += 1
                else:
                    result_type = process_result(black_result)
                    if result_type == "win":
                        player_stats[username]["wins"] += 1
                    elif result_type == "draw":
                        player_stats[username]["draws"] += 1
                    elif result_type == "loss":
                        player_stats[username]["losses"] += 1
    
    # Determine match result
    our_score = our_team_data.get("score", 0)
    opponent_score = opponent_team_data.get("score", 0) if opponent_team_data else 0
    our_result = our_team_data.get("result", "unknown")
    
    # Get minimum required players from match settings (for all matches)
    settings = match_data.get("settings", {})
    min_team_players = settings.get("min_team_players") if isinstance(settings, dict) else None
    
    # Get player lists for both teams (for all matches)
    opponent_players = opponent_team_data.get("players", []) if opponent_team_data else []
    our_player_count = len(players)
    opponent_player_count = len(opponent_players)
    
    # Detect forfeit scenarios for finished matches with 0-0 score
    # Chess.com counts matches that never started as a draw. This is how they show up on a team's "official" list, 
    # but leagues track these as forfeits in their standings.
    if status == "finished" and our_score == 0 and opponent_score == 0 and min_team_players is not None:
        our_below_min = our_player_count < min_team_players
        opp_below_min = opponent_player_count < min_team_players
        
        if our_below_min and opp_below_min:
            # Double forfeit - we lose
            our_result = "double forfeit"
            print(f"  Detected double forfeit: our={our_player_count}, opp={opponent_player_count}, min={min_team_players}")
        elif our_below_min:
            # We forfeited
            our_result = "forfeit"
            print(f"  Detected our forfeit: our={our_player_count}, min={min_team_players}")
        elif opp_below_min:
            # Opponent forfeited - we win
            our_result = "win by forfeit"
            print(f"  Detected opponent forfeit: opp={opponent_player_count}, min={min_team_players}")
    
    match_result = {
        "ourScore": our_score,
        "opponentScore": opponent_score,
        "result": our_result  # "win", "lose", "draw", "forfeit", "double forfeit", "win by forfeit"
    }
    
    # Extract board-level rating data for registration matches only
    boards_data = []
    our_boards = {}
    opponent_boards = {}
    
    if status == "open":  # Only for registration status
        print(f"  Extracting board ratings for registration match...")
        
        # Check if players have board assignments (for matches in registration,
        # boards may not be assigned yet)
        has_board_assignments = any(p.get("board") for p in players if isinstance(p, dict))
        
        if has_board_assignments:
            # Create dictionaries mapping board number to player data
            for player in players:
                if isinstance(player, dict):
                    board = player.get("board")
                    if board:
                        our_boards[board] = {
                            "username": player.get("username"),
                            "rating": player.get("rating")
                        }
            
            for player in opponent_players:
                if isinstance(player, dict):
                    board = player.get("board")
                    if board:
                        opponent_boards[board] = {
                            "username": player.get("username"),
                            "rating": player.get("rating")
                        }
            
            # Calculate rating differential for each board
            for board_num in range(1, boards_count + 1):
                our_player = our_boards.get(board_num)
                opp_player = opponent_boards.get(board_num)
                
                if our_player and opp_player:
                    our_rating = our_player.get("rating")
                    opp_rating = opp_player.get("rating")
                    
                    board_data = {
                        "boardNumber": board_num,
                        "ourPlayer": our_player.get("username"),
                        "ourRating": our_rating,
                        "oppPlayer": opp_player.get("username"),
                        "oppRating": opp_rating,
                        "ratingDiff": None
                    }
                    
                    # Calculate rating differential (positive = our player is higher rated)
                    if our_rating and opp_rating:
                        board_data["ratingDiff"] = our_rating - opp_rating
                    
                    boards_data.append(board_data)
        else:
            # No board assignments yet, so collect all registered players
            # Sort by rating descending.
            our_roster = sorted(
                [{"username": p.get("username"), "rating": p.get("rating")} 
                 for p in players if isinstance(p, dict) and p.get("username")],
                key=lambda x: x.get("rating", 0),
                reverse=True
            )
            
            opp_roster = sorted(
                [{"username": p.get("username"), "rating": p.get("rating")} 
                 for p in opponent_players if isinstance(p, dict) and p.get("username")],
                key=lambda x: x.get("rating", 0),
                reverse=True
            )
            
            # Store roster data
            boards_data = {
                "type": "roster",
                "ourRoster": our_roster,
                "oppRoster": opp_roster
            }
    
    # Use parsed round if available, otherwise let it be auto-assigned later
    round_str = parsed_title["round"] if parsed_title["round"] else None
    
    # Build cleaned player stats (timeouts only included when > 0)
    cleaned_player_stats = {}
    for username, stats in player_stats.items():
        cleaned_stats = {
            "games":  stats["games"],
            "wins":   stats["wins"],
            "draws":  stats["draws"],
            "losses": stats["losses"],
        }
        if stats.get("timeouts", 0) > 0:
            cleaned_stats["timeouts"] = stats["timeouts"]
        cleaned_player_stats[username] = cleaned_stats
    
    result = {
        "round": round_str,
        "status": status,
        "matchId": match_data.get("@id", match_url),
        "matchUrl": match_url,
        "matchWebUrl": get_match_web_url(match_url),
        "name": match_data.get("name", ""),
        "startTime": match_data.get("start_time"),
        "endTime": match_data.get("end_time"),
        "boards": boards_count,
        "matchResult": match_result,
        "playerStats": cleaned_player_stats
    }
    
    # Add minTeamPlayers for all matches
    # This can be used to detect possible forfeits in open matches 
    # and track projected winners in in-progress matches based on current player counts.
    if min_team_players is not None:
        result["minTeamPlayers"] = min_team_players
    
    # Add registration data if available for open matches
    if boards_data:
        if isinstance(boards_data, dict) and boards_data.get("type") == "roster":
            # Roster format
            result["registrationData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(boards_data.get("ourRoster", [])),
                "opponent": len(boards_data.get("oppRoster", []))
            }
        elif isinstance(boards_data, list) and len(boards_data) > 0:
            # Board-specific format
            result["boardsData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(our_boards),
                "opponent": len(opponent_boards)
            }
    
    return result


def is_our_club_from_url(team_url: str) -> bool:
    """Check if a team URL belongs to our club."""
    if not team_url:
        return False
    # URL format: https://api.chess.com/pub/club/<CLUB_ID>
    return CLUB_ID in team_url.lower()


def aggregate_player_stats(rounds: List[Dict]) -> List[Dict]:
    """
    Aggregate player statistics across all rounds in a sub-league.
    Returns a sorted leaderboard.
    """
    player_totals = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "points": 0.0})
    
    for round_data in rounds:
        for username, stats in round_data.get("playerStats", {}).items():
            player_totals[username]["games"] += stats["games"]
            player_totals[username]["wins"] += stats["wins"]
            player_totals[username]["draws"] += stats["draws"]
            player_totals[username]["losses"] += stats["losses"]
            player_totals[username]["points"] += stats["wins"] + (stats["draws"] * 0.5)
    
    # Convert to list and sort by points descending, then by games ascending
    leaderboard = []
    for username, stats in player_totals.items():
        leaderboard.append({
            "username": username,
            "games": stats["games"],
            "wins": stats["wins"],
            "draws": stats["draws"],
            "losses": stats["losses"],
            "points": stats["points"]
        })
    
    leaderboard.sort(key=lambda x: (-x["points"], x["games"]))
    
    return leaderboard


def calculate_subleague_record(rounds: List[Dict]) -> Dict:
    """
    Calculate the Win-Loss-Draw record for a sub-league based on match results.
    Returns dict with wins, losses, draws counts.
    """
    record = {"wins": 0, "losses": 0, "draws": 0}
    
    for round_data in rounds:
        match_result = round_data.get("matchResult", {})
        result = match_result.get("result", "unknown")
        
        if result == "win":
            record["wins"] += 1
        elif result == "lose":
            record["losses"] += 1
        elif result in ["draw", "agreed"]:
            record["draws"] += 1
    
    return record


def create_global_leaderboard(leagues_data: Dict) -> List[Dict]:
    """
    Create a global leaderboard across all leagues and sub-leagues.
    """
    global_stats = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0, "points": 0.0})
    
    for league_name, league_data in leagues_data.items():
        for sub_league_name, sub_league_data in league_data.get("subLeagues", {}).items():
            for player in sub_league_data.get("leaderboard", []):
                username = player["username"]
                global_stats[username]["games"] += player["games"]
                global_stats[username]["wins"] += player["wins"]
                global_stats[username]["draws"] += player["draws"]
                global_stats[username]["losses"] += player["losses"]
                global_stats[username]["points"] += player["points"]
    
    # Convert to list and sort
    global_leaderboard = []
    for username, stats in global_stats.items():
        global_leaderboard.append({
            "username": username,
            "games": stats["games"],
            "wins": stats["wins"],
            "draws": stats["draws"],
            "losses": stats["losses"],
            "points": stats["points"]
        })
    
    global_leaderboard.sort(key=lambda x: (-x["points"], x["games"]))
    
    return global_leaderboard


def load_existing_match_ids() -> set:
    """Load finished match IDs from existing data file to avoid re-processing.
    In-progress and open matches are always re-fetched for updated data."""
    if not os.path.exists(OUTPUT_FILE):
        return set()
    
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        match_ids = set()
        for league_data in data.get("leagues", {}).values():
            for sub_league_data in league_data.get("subLeagues", {}).values():
                for round_data in sub_league_data.get("rounds", []):
                    # Only skip finished matches
                    if round_data.get("status") == "finished":
                        match_id = round_data.get("matchId")
                        if match_id:
                            match_ids.add(match_id)
        
        return match_ids
    except Exception as e:
        print(f"Warning: Could not load existing data: {e}")
        return set()


def main():
    """Main execution function."""
    parser = argparse.ArgumentParser(
        description="Fetch chess league data from Chess.com"
    )
    parser.add_argument(
        "--site-key", required=True,
        help="Site key matching a directory under config/ (e.g. '1dpmc', 'teamusa')",
    )
    args = parser.parse_args()

    load_config(args.site_key)

    print(f"Fetching matches for club: {CLUB_ID} (site: {args.site_key})")
    
    # Load existing match IDs to skip
    existing_match_ids = load_existing_match_ids()
    print(f"Loaded {len(existing_match_ids)} existing match IDs to skip")
    
    # Fetch all club matches
    club_data = fetch_json(CLUB_MATCHES_URL)
    if not club_data:
        print("Failed to fetch club matches", file=sys.stderr)
        sys.exit(1)
    
    # Collect match objects from all categories, tracking their status
    all_match_objects = []
    
    if "finished" in club_data:
        for match in club_data["finished"]:
            match["_api_status"] = "finished"
            all_match_objects.append(match)
    
    if "in_progress" in club_data:
        for match in club_data["in_progress"]:
            match["_api_status"] = "in_progress"
            all_match_objects.append(match)
    
    if "registered" in club_data:
        for match in club_data["registered"]:
            match["_api_status"] = "open"  # Map 'registered' to 'open' for our system
            all_match_objects.append(match)
    
    print(f"Found {len(all_match_objects)} total matches")
    
    # Filter and parse league matches
    league_matches = []
    skipped_existing = 0
    for match_obj in all_match_objects:
        # Extract match ID/URL from the object
        # The "@id" field contains the API URL
        match_url = match_obj.get("@id")
        if not match_url:
            continue
        
        # Skip finished matches that we already have
        if match_url in existing_match_ids:
            skipped_existing += 1
            continue
        
        # The "name" field contains the match title
        title = match_obj.get("name", "")
        parsed = parse_match_title(title)
        
        if parsed:
            league_matches.append({
                "url": match_url,
                "parsed": parsed,
                "title": title,
                "status": match_obj.get("_api_status", "open")
            })
            try:
                print(f"  Found league match: {title}")
            except UnicodeEncodeError:
                print(f"  Found league match: [encoding issue in title]")
    
    print(f"\nSkipped {skipped_existing} already-processed finished matches")
    print(f"Note: In-progress and open matches are always re-fetched for updates")
    league_names = [cfg["name"] for cfg in LEAGUE_CONFIG]
    print(f"Found {len(league_matches)} new league matches for leagues {league_names}")

    # Resolve ambiguous matches (no colon + no round token + has 'vs' in title)
    unresolved_before = sum(1 for m in league_matches if m["parsed"]["subLeague"] == "__unresolved__")
    if unresolved_before:
        print(f"\nResolving {unresolved_before} ambiguous match title(s)...")
        still_unresolved = resolve_unresolved_matches(league_matches)
        if still_unresolved:
            print(f"  {still_unresolved} match(es) could not be resolved → grouped as 'Undefined Subleague'")
    
    if len(league_matches) == 0:
        print("\nWARNING: No league matches found!")
        print("This could mean:")
        print("  1. The club has no matches with the specified prefixes")
        print("  2. Match titles don't contain known league identifiers: " + ", ".join(cfg["name"] for cfg in LEAGUE_CONFIG))
        print("\nPlease check the club's match titles on chess.com")
    
    # Organize matches by league and sub-league
    organized_data = defaultdict(lambda: defaultdict(list))
    
    print(f"\nProcessing {len(league_matches)} matches...")
    for i, match_info in enumerate(league_matches, 1):
        try:
            print(f"\n[{i}/{len(league_matches)}] Processing: {match_info['title']}")
        except UnicodeEncodeError:
            print(f"\n[{i}/{len(league_matches)}] Processing: [encoding issue in title]")
        league = match_info["parsed"]["league"]
        sub_league = match_info["parsed"]["subLeague"]
        
        # Process the match
        try:
            match_data = process_match(match_info["url"], match_info["parsed"], match_info["status"])
            if match_data:
                organized_data[league][sub_league].append(match_data)
                print(f"  ✓ Collected stats for {len(match_data['playerStats'])} players")
            else:
                print(f"  ✗ Failed to process match")
        except Exception as e:
            print(f"  ✗ Error processing match: {e}")
        
        # Be nice to the API
        time.sleep(0.5)
    
    # Build final data structure
    print("\nBuilding final data structure...")
    
    # Load existing data to merge with new data
    existing_data = {}
    if os.path.exists(OUTPUT_FILE):
        try:
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                existing_data = json.load(f).get("leagues", {})
        except Exception as e:
            print(f"Warning: Could not load existing data for merging: {e}")
    
    leagues_output = existing_data.copy()
    
    for league_name, sub_leagues in organized_data.items():
        if league_name not in leagues_output:
            leagues_output[league_name] = {"subLeagues": {}}
        
        for sub_league_name, rounds in sub_leagues.items():
            # Get existing rounds for this sub-league, keeping only finished ones.
            # Open and in_progress rounds are always discarded so fresh re-fetched data
            # fills them in cleanly. This handles status transitions (open→in_progress,
            # in_progress→finished, open→finished) with zero duplicates by construction.
            existing_rounds = []
            if sub_league_name in leagues_output[league_name].get("subLeagues", {}):
                all_existing = leagues_output[league_name]["subLeagues"][sub_league_name].get("rounds", [])
                existing_rounds = [r for r in all_existing if r.get("status") == "finished"]
            
            all_rounds = existing_rounds + rounds
            
            # Sort rounds: R<n> first (numerically), then G<n>, then NA/NA-2/… by timestamp
            def get_round_sort_key(round_data):
                rs = (round_data.get("round") or "").strip()
                if not rs:
                    return (3, 0, round_data.get("startTime") or 0)
                m_r = re.match(r'^R(\d+)$', rs, re.IGNORECASE)
                if m_r:
                    return (1, int(m_r.group(1)), 0)
                m_g = re.match(r'^G(\d+)$', rs, re.IGNORECASE)
                if m_g:
                    return (2, int(m_g.group(1)), 0)
                # NA / NA-2 / NA-3 … → after numbered rounds, ordered by timestamp
                return (3, 0, round_data.get("startTime") or 0)

            all_rounds.sort(key=get_round_sort_key)

            # Assign "NA", "NA-2", "NA-3", … to rounds with no explicit round number.
            # Rounds that already carry an R\d+, G\d+, or existing NA-style id are kept.
            _EXPLICIT_ROUND_RE = re.compile(r'^(?:[RG]\d+|NA(?:-\d+)?)$', re.IGNORECASE)
            _NA_RE             = re.compile(r'^NA(?:-(\d+))?$', re.IGNORECASE)
            rounds_needing_na: list = []
            existing_na_ids:   set  = set()

            for round_data in all_rounds:
                rs = (round_data.get("round") or "").strip()
                if _EXPLICIT_ROUND_RE.match(rs):
                    if _NA_RE.match(rs):
                        existing_na_ids.add(rs.upper())
                elif not rs or " vs " in rs or rs.startswith("Match "):
                    rounds_needing_na.append(round_data)

            def _next_na(used: set) -> str:
                if "NA" not in used:
                    return "NA"
                i = 2
                while f"NA-{i}" in used:
                    i += 1
                return f"NA-{i}"

            for round_data in rounds_needing_na:
                na_id = _next_na(existing_na_ids)
                existing_na_ids.add(na_id)
                round_data["round"] = na_id
            
            # Aggregate player stats for this sub-league
            leaderboard = aggregate_player_stats(all_rounds)
            
            # Calculate sub-league match record (W-L-D)
            subleague_record = calculate_subleague_record(all_rounds)
            
            leagues_output[league_name]["subLeagues"][sub_league_name] = {
                "rounds": all_rounds,
                "leaderboard": leaderboard,
                "record": subleague_record
            }
    
    # Create global leaderboard
    global_leaderboard = create_global_leaderboard(leagues_output)
    
    # Final output structure
    output = {
        "lastUpdated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "leagues": leagues_output,
        "globalLeaderboard": global_leaderboard
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    
    # Write JSON file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n{'='*60}")
    print(f"✓ Data successfully written to {OUTPUT_FILE}")
    print(f"{'='*60}")
    print(f"Summary:")
    print(f"  • Total leagues: {len(leagues_output)}")
    print(f"  • Total sub-leagues: {sum(len(l['subLeagues']) for l in leagues_output.values())}")
    print(f"  • Total rounds: {sum(len(sl['rounds']) for l in leagues_output.values() for sl in l['subLeagues'].values())}")
    print(f"  • Global leaderboard players: {len(global_leaderboard)}")
    
    if len(leagues_output) > 0:
        print(f"\nLeagues found:")
        for league_name, league_data in leagues_output.items():
            print(f"  • {league_name}: {len(league_data['subLeagues'])} sub-league(s)")
            for sub_name, sub_data in league_data['subLeagues'].items():
                print(f"    - {sub_name}: {len(sub_data['rounds'])} round(s), {len(sub_data['leaderboard'])} player(s)")
    
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
