#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chess League Data Fetcher
Fetches, parses, and aggregates chess league data from chess.com club matches.
Outputs a JSON file for consumption by the static React website.
"""

import json
import re
import sys
from collections import defaultdict
from typing import Dict, List, Any, Optional
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import time

# Ensure stdout uses UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# Configuration
CLUB_ID = "1-day-per-move-club"
CLUB_NAME_VARIATIONS = ["1 day per move club", "1-day-per-move-club", "1dayperMoveClub"]
CLUB_MATCHES_URL = f"https://api.chess.com/pub/club/{CLUB_ID}/matches"
OUTPUT_FILE = "public/data/leagueData.json"
LEAGUE_PREFIXES = ["1WL", "TCMAC", "TMCL", "TMCL960"]

# User agent for API requests
USER_AGENT = "ChessLeagueTracker/1.0"


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
    
    Format: "{PREFIX} {sub-league text}: {teamA} vs {teamB}"
    
    Examples:
      - "1WL 2026 960 U1400 Winter Experts G2: 1 day per move club vs I like beer"
        -> league: "1WL", subLeague: "2026 960 U1400 Winter Experts G2", round: "1 day per move club vs I like beer"
      - "1WL summer league R1"
        -> league: "1WL", subLeague: "summer league", round: "R1"
    """
    title = title.strip()
    
    # Check if title starts with any league prefix
    league_prefix = None
    for prefix in LEAGUE_PREFIXES:
        if title.startswith(prefix):
            league_prefix = prefix
            break
    
    if not league_prefix:
        return None
    
    # Remove the league prefix
    remaining = title[len(league_prefix):].strip()
    
    # First, look for round pattern (R followed by digits) in the entire remaining string
    round_match = re.search(r'\bR(\d+)\b', remaining, re.IGNORECASE)
    
    # Split by colon to separate sub-league from teams
    if ":" in remaining:
        sub_league = remaining.split(":", 1)[0].strip()
        after_colon = remaining.split(":", 1)[1].strip()
        
        # If we found a round pattern in the sub-league part, extract it
        if round_match and round_match.start() < remaining.index(":"):
            # Round is before the colon, extract it from sub-league
            round_str = round_match.group(0).upper()
            sub_league = remaining[:round_match.start()].strip()
        else:
            # The part after the colon is the round identifier
            round_str = after_colon
    else:
        # No colon - check for round pattern
        if round_match:
            round_str = round_match.group(0).upper()
            # Everything before the round is the sub-league
            # Everything after the round is ignored
            sub_league = remaining[:round_match.start()].strip()
        else:
            # No round found, treat everything as sub-league
            sub_league = remaining
            round_str = None
    
    # Clean up sub-league name
    if not sub_league:
        sub_league = "main"
    
    return {
        "league": league_prefix,
        "subLeague": sub_league,
        "round": round_str
    }


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


def is_our_club(club_name: str) -> bool:
    """Check if a club name matches our club (case-insensitive)."""
    club_name_lower = club_name.lower()
    for variation in CLUB_NAME_VARIATIONS:
        if variation.lower() in club_name_lower:
            return True
    return False


def get_match_web_url(match_url: str) -> str:
    """Convert API URL to web URL."""
    # API URL: https://api.chess.com/pub/match/1895389
    # Web URL: https://www.chess.com/club/matches/1895389
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
    player_stats = defaultdict(lambda: {"games": 0, "wins": 0, "draws": 0, "losses": 0})
    
    players = our_team_data.get("players", [])
    print(f"  Processing {len(players)} players...")
    
    for player in players:
        if not isinstance(player, dict):
            continue
            
        username = player.get("username", "").lower()
        if not username:
            continue
        
        # Process white game
        white_result = player.get("played_as_white")
        if white_result:
            player_stats[username]["games"] += 1
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
    
    match_result = {
        "ourScore": our_score,
        "opponentScore": opponent_score,
        "result": our_result  # "win", "lose", "draw"
    }
    
    # Extract board-level rating data for registration matches only
    boards_data = []
    our_boards = {}
    opponent_boards = {}
    min_team_players = None
    
    if status == "open":  # Only for registration status
        print(f"  Extracting board ratings for registration match...")
        
        # Get minimum required players from match settings
        min_team_players = match_data.get("min_team_players")
        
        # Get opponent players
        opponent_players = opponent_team_data.get("players", []) if opponent_team_data else []
        
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
            # No board assignments yet - collect all registered players
            # Sort by rating (highest first) for strategic planning
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
            
            # Store roster data for display
            boards_data = {
                "type": "roster",
                "ourRoster": our_roster,
                "oppRoster": opp_roster
            }
    
    # Use parsed round if available, otherwise let it be auto-assigned later
    round_str = parsed_title["round"] if parsed_title["round"] else None
    
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
        "playerStats": dict(player_stats)
    }
    
    # Add registration data if available (only for registration matches)
    if boards_data:
        if isinstance(boards_data, dict) and boards_data.get("type") == "roster":
            # Roster format (no board assignments yet)
            result["registrationData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(boards_data.get("ourRoster", [])),
                "opponent": len(boards_data.get("oppRoster", []))
            }
            # Add minimum required players for registration matches
            if min_team_players is not None:
                result["minTeamPlayers"] = min_team_players
        elif isinstance(boards_data, list) and len(boards_data) > 0:
            # Board-specific format (boards assigned)
            result["boardsData"] = boards_data
            result["registeredPlayers"] = {
                "our": len(our_boards),
                "opponent": len(opponent_boards)
            }
            # Add minimum required players for registration matches
            if min_team_players is not None:
                result["minTeamPlayers"] = min_team_players
    
    return result


def is_our_club_from_url(team_url: str) -> bool:
    """Check if a team URL belongs to our club."""
    if not team_url:
        return False
    # URL format: https://api.chess.com/pub/club/1-day-per-move-club
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
    
    # Convert to list and sort by points (descending), then by games (ascending)
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
    """Load FINISHED match IDs from existing data file to avoid re-processing.
    In-progress and open matches are always re-fetched for updated data."""
    import os
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
    print(f"Fetching matches for club: {CLUB_ID}")
    
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
    print(f"Found {len(league_matches)} new league matches matching prefixes {LEAGUE_PREFIXES}")
    
    if len(league_matches) == 0:
        print("\nWARNING: No league matches found!")
        print("This could mean:")
        print("  1. The club has no matches with the specified prefixes")
        print("  2. Match titles don't start with: " + ", ".join(LEAGUE_PREFIXES))
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
    import os
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
            # Get existing rounds for this sub-league
            existing_rounds = []
            if sub_league_name in leagues_output[league_name].get("subLeagues", {}):
                existing_rounds = leagues_output[league_name]["subLeagues"][sub_league_name].get("rounds", [])
            
            # Merge new rounds with existing rounds
            all_rounds = existing_rounds + rounds
            
            # Sort rounds - try to extract round numbers, otherwise use timestamp
            def get_round_sort_key(round_data):
                round_str = round_data.get("round", "")
                if not round_str:
                    return (0, round_data.get("startTime", 0))
                # Try to extract number from R\d+ format
                match = re.search(r'R(\d+)', round_str, re.IGNORECASE)
                if match:
                    return (1, int(match.group(1)))
                # No explicit round number - sort by timestamp
                return (2, round_data.get("startTime", 0))
            
            all_rounds.sort(key=get_round_sort_key)
            
            # Find existing round numbers to determine next available number
            existing_round_numbers = set()
            rounds_needing_numbers = []
            
            for round_data in all_rounds:
                round_str = round_data.get("round", "") or ""  # Handle None
                # Check if this round has an explicit RX number
                match = re.search(r'R(\d+)', round_str, re.IGNORECASE)
                if match:
                    existing_round_numbers.add(int(match.group(1)))
                # Check if round needs auto-numbering (missing or looks like team matchup or starts with "Match ")
                elif not round_str or " vs " in round_str or round_str.startswith("Match "):
                    rounds_needing_numbers.append(round_data)
            
            # Assign sequential round numbers starting from max + 1
            if rounds_needing_numbers:
                next_number = max(existing_round_numbers) + 1 if existing_round_numbers else 1
                for round_data in rounds_needing_numbers:
                    round_data["round"] = f"R{next_number}"
                    next_number += 1
            
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
    import os
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
