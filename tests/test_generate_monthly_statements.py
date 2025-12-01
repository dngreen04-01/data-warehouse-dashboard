"""Tests for generate_monthly_statements script."""

from __future__ import annotations

from datetime import date
from unittest.mock import patch, MagicMock

import pytest
import pendulum

import sys
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from generate_monthly_statements import is_second_working_day


class TestIsSecondWorkingDay:
    """Tests for is_second_working_day function."""

    @patch("generate_monthly_statements.pendulum.now")
    def test_second_working_day_monday_start(self, mock_now):
        """Test when month starts on Monday, 2nd working day is Tuesday."""
        # December 2024 starts on Sunday, so 2nd is Monday (1st working),
        # 3rd is Tuesday (2nd working day)
        mock_now.return_value = pendulum.datetime(2024, 12, 3, tz="UTC")
        assert is_second_working_day() is True

    @patch("generate_monthly_statements.pendulum.now")
    def test_first_working_day(self, mock_now):
        """Test that first working day returns False."""
        # December 2024: Dec 2 (Monday) is the 1st working day
        mock_now.return_value = pendulum.datetime(2024, 12, 2, tz="UTC")
        assert is_second_working_day() is False

    @patch("generate_monthly_statements.pendulum.now")
    def test_third_working_day(self, mock_now):
        """Test that third working day returns False."""
        # December 2024: Dec 4 (Wednesday) is the 3rd working day
        mock_now.return_value = pendulum.datetime(2024, 12, 4, tz="UTC")
        assert is_second_working_day() is False

    @patch("generate_monthly_statements.pendulum.now")
    def test_weekend_day(self, mock_now):
        """Test that weekend days return False."""
        # December 2024: Dec 1 is Sunday
        mock_now.return_value = pendulum.datetime(2024, 12, 1, tz="UTC")
        assert is_second_working_day() is False

    @patch("generate_monthly_statements.pendulum.now")
    def test_month_starts_on_weekend(self, mock_now):
        """Test when month starts on Saturday."""
        # November 2024 starts on Friday, so:
        # Nov 1 (Fri) = 1st working day
        # Nov 4 (Mon) = 2nd working day
        mock_now.return_value = pendulum.datetime(2024, 11, 4, tz="UTC")
        assert is_second_working_day() is True

    @patch("generate_monthly_statements.pendulum.now")
    def test_month_starts_on_saturday(self, mock_now):
        """Test when month starts on Saturday."""
        # June 2024 starts on Saturday, so:
        # June 3 (Mon) = 1st working day
        # June 4 (Tue) = 2nd working day
        mock_now.return_value = pendulum.datetime(2024, 6, 4, tz="UTC")
        assert is_second_working_day() is True

    @patch("generate_monthly_statements.pendulum.now")
    def test_late_in_month(self, mock_now):
        """Test that late in month always returns False."""
        mock_now.return_value = pendulum.datetime(2024, 12, 15, tz="UTC")
        assert is_second_working_day() is False

    @patch("generate_monthly_statements.pendulum.now")
    def test_end_of_month(self, mock_now):
        """Test that end of month returns False."""
        mock_now.return_value = pendulum.datetime(2024, 12, 31, tz="UTC")
        assert is_second_working_day() is False
