import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import fetch_player_ratings as ratings


class PlayerRatingsTests(unittest.TestCase):
    def test_discovery_uses_our_players_only(self):
        leagues = {
            "League": {"subLeagues": {"Division": {"rounds": [{
                "status": "finished",
                "startTime": 2_000_000_000,
                "playerStats": {"StatsPlayer": {}},
                "registrationData": {
                    "ourRoster": [{"username": "RosterPlayer"}],
                    "oppRoster": [{"username": "OpponentRoster"}],
                },
                "boardsData": [
                    {"ourPlayer": "BoardPlayer", "oppPlayer": "OpponentBoard"},
                ],
            }]}}}
        }

        seen, refresh = ratings.discover_players(leagues, 2_000_000_100, 180)

        self.assertEqual(set(seen), {"statsplayer", "rosterplayer", "boardplayer"})
        self.assertEqual(refresh, {"statsplayer", "rosterplayer", "boardplayer"})

    def test_successful_membership_validation_removes_departed_player(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = os.path.join(root, "config", "test")
            data_dir = os.path.join(root, "public", "data", "test")
            os.makedirs(config_dir)
            os.makedirs(data_dir)
            with open(os.path.join(config_dir, "league_config.json"), "w", encoding="utf-8") as handle:
                json.dump({"clubId": "test-club"}, handle)
            with open(os.path.join(config_dir, "script_params.json"), "w", encoding="utf-8") as handle:
                json.dump({"ratingsRequestDelaySeconds": 0}, handle)
            with open(os.path.join(data_dir, "leagueData.json"), "w", encoding="utf-8") as handle:
                json.dump({"leagues": {}}, handle)
            with open(os.path.join(data_dir, "playerRatings.json"), "w", encoding="utf-8") as handle:
                json.dump({
                    "players": {
                        "active": {"dailyRating": 1500, "lastSeenAt": "2026-09-01T00:00:00Z"},
                        "departed": {"dailyRating": 1800, "lastSeenAt": "2026-09-01T00:00:00Z"},
                    }
                }, handle)

            original_root = ratings.PROJECT_ROOT
            ratings.PROJECT_ROOT = root
            try:
                with patch.object(ratings, "fetch_json", return_value={
                    "weekly": [{"username": "active"}], "monthly": [], "all_time": [],
                }):
                    output = ratings.refresh_site("test")
            finally:
                ratings.PROJECT_ROOT = original_root

        self.assertEqual(output["membershipStatus"], "verified")
        self.assertIn("active", output["players"])
        self.assertNotIn("departed", output["players"])


if __name__ == "__main__":
    unittest.main()
