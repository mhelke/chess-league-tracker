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
import enrich_timeouts as timeout_enrichment


class PlayerRatingsTests(unittest.TestCase):
    def test_disabled_member_service_does_not_call_network(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = os.path.join(root, "config", "test")
            data_dir = os.path.join(root, "public", "data", "test")
            os.makedirs(config_dir)
            os.makedirs(data_dir)
            with open(os.path.join(config_dir, "league_config.json"), "w", encoding="utf-8") as handle:
                json.dump({"clubId": "test-club"}, handle)
            with open(os.path.join(config_dir, "script_params.json"), "w", encoding="utf-8") as handle:
                json.dump({"memberServiceEnabled": False, "recruitmentEnabled": False}, handle)
            with open(os.path.join(data_dir, "leagueData.json"), "w", encoding="utf-8") as handle:
                json.dump({"leagues": {}}, handle)

            original_root = ratings.PROJECT_ROOT
            ratings.PROJECT_ROOT = root
            try:
                with patch.object(ratings, "fetch_member_service_members", side_effect=AssertionError("network call")):
                    output = ratings.refresh_site("test")
            finally:
                ratings.PROJECT_ROOT = original_root

        self.assertEqual(output["sourceStatus"], "disabled")
        self.assertFalse(output["recruitmentEnabled"])
        self.assertEqual(output["players"], {})

    def test_variant_timeout_selection_and_member_service_fallback(self):
        previous_fallback = timeout_enrichment.USE_MEMBER_SERVICE_TIMEOUT_FALLBACK
        previous_compare = timeout_enrichment.COMPARE_CHESS960_TIMEOUT_FOR_STANDARD
        try:
            timeout_enrichment.USE_MEMBER_SERVICE_TIMEOUT_FALLBACK = True
            timeout_enrichment.COMPARE_CHESS960_TIMEOUT_FOR_STANDARD = False
            standard, chess960, risk, source = timeout_enrichment.select_timeout_percent(
                [{"variant": "chess960", "timeoutPercent": 80}], 30
            )
            self.assertEqual(standard, 30)
            self.assertEqual(chess960, 80)
            self.assertEqual(risk, 80)
            self.assertEqual(source, "match-chess960+member-service-fallback")

            standard, chess960, risk, source = timeout_enrichment.select_timeout_percent(
                [{"variant": "chess960", "timeoutPercent": None}], 30
            )
            self.assertEqual(standard, 30)
            self.assertIsNone(chess960)
            self.assertEqual(risk, 30)
            self.assertEqual(source, "member-service-fallback")
        finally:
            timeout_enrichment.USE_MEMBER_SERVICE_TIMEOUT_FALLBACK = previous_fallback
            timeout_enrichment.COMPARE_CHESS960_TIMEOUT_FOR_STANDARD = previous_compare

    def test_discovery_uses_our_historical_players_only(self):
        leagues = {
            "League": {"subLeagues": {"Division": {"rounds": [{
                "status": "finished",
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

        seen = ratings.discover_historical_players(leagues)

        self.assertEqual(set(seen), {"statsplayer", "rosterplayer", "boardplayer"})

    def test_member_service_members_normalizes_and_validates_payload(self):
        members = ratings.member_service_members({
            "updateDate": 1789682178103,
            "members": [
                {"username": "PlayerOne", "daily_rating": 1500},
                {"username": "PlayerTwo", "daily_rating": 0},
            ],
        })

        self.assertEqual(set(members), {"playerone", "playertwo"})
        self.assertEqual(ratings.parse_rating(members["playerone"]["daily_rating"]), 1500)
        self.assertIsNone(ratings.parse_rating(members["playertwo"]["daily_rating"]))
        self.assertIsNone(ratings.member_service_members({"members": []}))
        self.assertIsNone(ratings.member_service_members({"updateDate": "not-a-timestamp", "members": []}))

    def test_activity_field_parsers_preserve_unknown_values(self):
        self.assertEqual(ratings.parse_nonnegative_count("12"), 12)
        self.assertEqual(ratings.parse_nonnegative_count(0), 0)
        self.assertIsNone(ratings.parse_nonnegative_count(-1))
        self.assertIsNone(ratings.parse_nonnegative_count("unknown"))
        self.assertEqual(ratings.parse_last_online("2026-09-17"), "2026-09-17")
        self.assertEqual(ratings.parse_last_online("2026-09-17T12:30:00Z"), "2026-09-17")
        self.assertIsNone(ratings.parse_last_online("not-a-date"))

    def test_successful_import_filters_history_and_removes_departed(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = os.path.join(root, "config", "test")
            data_dir = os.path.join(root, "public", "data", "test")
            os.makedirs(config_dir)
            os.makedirs(data_dir)
            with open(os.path.join(config_dir, "league_config.json"), "w", encoding="utf-8") as handle:
                json.dump({"clubId": "test-club"}, handle)
            with open(os.path.join(config_dir, "script_params.json"), "w", encoding="utf-8") as handle:
                json.dump({"memberServiceEnabled": True, "recruitmentEnabled": True}, handle)
            with open(os.path.join(data_dir, "leagueData.json"), "w", encoding="utf-8") as handle:
                json.dump({"leagues": {"L": {"subLeagues": {"S": {"rounds": [
                    {"playerStats": {"Active": {}, "Departed": {}}}
                ]}}}}}, handle)
            with open(os.path.join(data_dir, "playerRatings.json"), "w", encoding="utf-8") as handle:
                json.dump({"players": {
                    "active": {"dailyRating": 1200, "lastSeenAt": "2026-09-01T00:00:00Z"},
                    "departed": {"dailyRating": 1800, "lastSeenAt": "2026-09-01T00:00:00Z"},
                    "not-in-history": {"dailyRating": 1900},
                }}, handle)

            original_root = ratings.PROJECT_ROOT
            ratings.PROJECT_ROOT = root
            try:
                with patch.object(ratings, "fetch_member_service_members", return_value={
                    "updateDate": 1789682178103,
                    "members": [
                        {
                            "username": "ACTIVE",
                            "daily_rating": 1500,
                            "daily_960_rating": 1300,
                            "timeout_percent": 4,
                            "total_matches_entered": 12,
                            "total_timeouts": 2,
                            "last_online": "2026-09-17",
                        },
                        {"username": "NewMember", "daily_rating": 1700, "daily_960_rating": 1500},
                    ],
                }):
                    output = ratings.refresh_site("test")
            finally:
                ratings.PROJECT_ROOT = original_root

        self.assertEqual(output["membershipStatus"], "verified")
        self.assertEqual(output["sourceStatus"], "ok")
        self.assertTrue(output["recruitmentEnabled"])
        self.assertEqual(output["players"]["active"]["dailyRating"], 1500)
        self.assertEqual(output["players"]["active"]["rating960"], 1300)
        self.assertEqual(output["players"]["active"]["memberServiceTimeoutPercent"], 4.0)
        self.assertEqual(output["players"]["active"]["memberServiceTotalTimeouts"], 2)
        self.assertEqual(output["players"]["active"]["totalMatches90Days"], 12)
        self.assertEqual(output["players"]["active"]["lastOnlineAt"], "2026-09-17")
        self.assertNotIn("departed", output["players"])
        self.assertNotIn("not-in-history", output["players"])

    def test_failed_import_retains_previous_snapshot_without_deletion(self):
        with tempfile.TemporaryDirectory() as root:
            config_dir = os.path.join(root, "config", "test")
            data_dir = os.path.join(root, "public", "data", "test")
            os.makedirs(config_dir)
            os.makedirs(data_dir)
            with open(os.path.join(config_dir, "league_config.json"), "w", encoding="utf-8") as handle:
                json.dump({"clubId": "test-club"}, handle)
            with open(os.path.join(config_dir, "script_params.json"), "w", encoding="utf-8") as handle:
                json.dump({"memberServiceEnabled": True, "recruitmentEnabled": True}, handle)
            with open(os.path.join(data_dir, "leagueData.json"), "w", encoding="utf-8") as handle:
                json.dump({"leagues": {}}, handle)
            previous = {
                "schemaVersion": 1,
                "membershipStatus": "verified",
                "players": {"active": {
                    "dailyRating": 1500,
                    "totalMatches90Days": 8,
                    "lastOnlineAt": "2026-09-16",
                    "memberServiceTotalTimeouts": 1,
                }},
            }
            with open(os.path.join(data_dir, "playerRatings.json"), "w", encoding="utf-8") as handle:
                json.dump(previous, handle)

            original_root = ratings.PROJECT_ROOT
            ratings.PROJECT_ROOT = root
            try:
                with patch.object(ratings, "fetch_member_service_members", return_value=None):
                    output = ratings.refresh_site("test")
            finally:
                ratings.PROJECT_ROOT = original_root

        self.assertEqual(output["sourceStatus"], "stale")
        self.assertEqual(output["membershipStatus"], "verified")
        self.assertIn("active", output["players"])
        self.assertEqual(output["players"]["active"]["totalMatches90Days"], 8)
        self.assertEqual(output["players"]["active"]["lastOnlineAt"], "2026-09-16")
        self.assertEqual(output["players"]["active"]["memberServiceTotalTimeouts"], 1)


if __name__ == "__main__":
    unittest.main()
