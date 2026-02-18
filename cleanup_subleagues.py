#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cleanup script to merge incorrectly split sub-leagues.

Identifies sub-leagues that should be merged based on:
1. Single-round sub-leagues with team names in the title
2. Sub-league names that end with "vs 1 day per move club" or similar patterns

Merges them back to their parent sub-league while preserving all match data.
"""

import json
import re
from collections import defaultdict

INPUT_FILE = 'public/data/leagueData.json'
OUTPUT_FILE = 'public/data/leagueData.json'
BACKUP_FILE = 'public/data/leagueData.backup.json'

def should_merge_subleague(sub_league_name, sub_league_data):
    """
    Determine if a sub-league should be merged into another.
    
    Returns (True, parent_name) if it should be merged, (False, None) otherwise.
    """
    # Only consider single-round sub-leagues
    if len(sub_league_data.get('rounds', [])) != 1:
        return False, None
    
    # Check if sub-league name contains team matchup patterns
    # Pattern: ends with "Team vs 1 day per move club" or "1 day per move club vs Team"
    vs_pattern = r'(.+?)\s+(vs\s+1\s+day\s+per\s+move\s+club|1\s+day\s+per\s+move\s+club\s+vs\s+.+)$'
    match = re.search(vs_pattern, sub_league_name, re.IGNORECASE)
    
    if match:
        parent_name = match.group(1).strip()
        return True, parent_name
    
    return False, None


def merge_subleagues(leagues_data):
    """
    Merge incorrectly split sub-leagues back to their parents.
    """
    changes_made = []
    
    for league_name, league_data in leagues_data.items():
        sub_leagues = league_data.get('subLeagues', {})
        
        # Find sub-leagues that need merging
        to_merge = []
        for sl_name, sl_data in sub_leagues.items():
            should_merge, parent_name = should_merge_subleague(sl_name, sl_data)
            if should_merge and parent_name:
                to_merge.append((sl_name, parent_name, sl_data))
        
        # Perform merges
        for child_name, parent_name, child_data in to_merge:
            # Check if parent exists
            if parent_name in sub_leagues:
                # Merge the round into parent
                parent_rounds = sub_leagues[parent_name].get('rounds', [])
                child_rounds = child_data.get('rounds', [])
                
                # Add child rounds to parent
                parent_rounds.extend(child_rounds)
                
                # Recalculate leaderboard and record
                from fetch_league_data import aggregate_player_stats, calculate_subleague_record
                sub_leagues[parent_name]['leaderboard'] = aggregate_player_stats(parent_rounds)
                sub_leagues[parent_name]['record'] = calculate_subleague_record(parent_rounds)
                
                # Remove the child sub-league
                del sub_leagues[child_name]
                
                changes_made.append(f"{league_name}: Merged '{child_name}' into '{parent_name}'")
            else:
                # Parent doesn't exist, rename child to parent
                sub_leagues[parent_name] = child_data
                del sub_leagues[child_name]
                changes_made.append(f"{league_name}: Renamed '{child_name}' to '{parent_name}'")
    
    return changes_made


def fill_missing_round_identifiers(leagues_data):
    """
    Fill in missing round identifiers for rounds that have None or team matchups as round names.
    """
    for league_name, league_data in leagues_data.items():
        sub_leagues = league_data.get('subLeagues', {})
        
        for sl_name, sl_data in sub_leagues.items():
            rounds = sl_data.get('rounds', [])
            
            # Find rounds needing identifiers
            existing_round_numbers = set()
            rounds_needing_numbers = []
            
            for round_data in rounds:
                round_str = round_data.get('round', '') or ''
                # Check if this round has an explicit RX number
                match = re.search(r'R(\d+)', round_str, re.IGNORECASE)
                if match:
                    existing_round_numbers.add(int(match.group(1)))
                # Check if round needs auto-numbering
                elif not round_str or ' vs ' in round_str or round_str.startswith('Match '):
                    rounds_needing_numbers.append(round_data)
            
            # Assign sequential round numbers
            if rounds_needing_numbers:
                next_number = max(existing_round_numbers) + 1 if existing_round_numbers else 1
                for round_data in rounds_needing_numbers:
                    round_data['round'] = f"R{next_number}"
                    next_number += 1


def main():
    print("="*80)
    print("SUB-LEAGUE CLEANUP SCRIPT")
    print("="*80)
    print()
    
    # Load data
    print(f"Loading data from {INPUT_FILE}...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Create backup
    print(f"Creating backup at {BACKUP_FILE}...")
    with open(BACKUP_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    leagues_data = data.get('leagues', {})
    
    # Count before
    total_before = sum(len(l.get('subLeagues', {})) for l in leagues_data.values())
    print(f"\nSub-leagues before cleanup: {total_before}")
    
    # Merge incorrectly split sub-leagues
    print("\nMerging incorrectly split sub-leagues...")
    changes = merge_subleagues(leagues_data)
    
    if changes:
        print(f"\nChanges made ({len(changes)}):")
        for change in changes:
            print(f"  • {change}")
    else:
        print("  No merges needed.")
    
    # Fill missing round identifiers
    print("\nFilling missing round identifiers...")
    fill_missing_round_identifiers(leagues_data)
    
    # Count after
    total_after = sum(len(l.get('subLeagues', {})) for l in leagues_data.values())
    print(f"\nSub-leagues after cleanup: {total_after}")
    print(f"Merged: {total_before - total_after} sub-league(s)")
    
    # Save cleaned data
    print(f"\nSaving cleaned data to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*80)
    print("✓ Cleanup complete!")
    print("="*80)
    print(f"\nBackup saved at: {BACKUP_FILE}")
    print(f"Cleaned data at: {OUTPUT_FILE}")


if __name__ == '__main__':
    main()
