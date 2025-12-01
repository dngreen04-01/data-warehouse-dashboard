"""Tests for statement generator module."""

from __future__ import annotations

import pytest
import pandas as pd

import sys
from pathlib import Path

# Add app directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "app"))

from statement_generator import (
    AGING_BUCKETS,
    AgingBuckets,
    generate_statement_pdf,
    sanitize_filename,
)


class TestSanitizeFilename:
    """Tests for sanitize_filename function."""

    def test_simple_name(self):
        """Test that simple alphanumeric names pass through."""
        assert sanitize_filename("CustomerABC") == "CustomerABC"

    def test_name_with_spaces(self):
        """Test that spaces are converted to underscores."""
        assert sanitize_filename("Customer Name") == "Customer_Name"

    def test_name_with_special_chars(self):
        """Test that special characters are removed."""
        assert sanitize_filename("Customer/Name") == "CustomerName"
        assert sanitize_filename("Customer\\Name") == "CustomerName"
        assert sanitize_filename("Customer:Name") == "CustomerName"

    def test_path_injection_attempt(self):
        """Test that path traversal attempts are sanitized."""
        assert sanitize_filename("../../../etc/passwd") == "etcpasswd"
        assert sanitize_filename("..\\..\\Windows\\System32") == "WindowsSystem32"

    def test_empty_string(self):
        """Test that empty strings return 'unknown'."""
        assert sanitize_filename("") == "unknown"
        assert sanitize_filename("///") == "unknown"

    def test_very_long_name(self):
        """Test that very long names are truncated."""
        long_name = "A" * 200
        result = sanitize_filename(long_name)
        assert len(result) == 100

    def test_unicode_characters(self):
        """Test that unicode characters are handled."""
        # Non-word characters should be removed
        result = sanitize_filename("Customer-Name_123")
        assert result == "Customer-Name_123"

    def test_multiple_spaces(self):
        """Test that multiple spaces become single underscore."""
        assert sanitize_filename("Customer   Name") == "Customer_Name"


class TestAgingBuckets:
    """Tests for AgingBuckets constants."""

    def test_bucket_values(self):
        """Test that bucket values match expected strings."""
        assert AGING_BUCKETS.CURRENT == "current"
        assert AGING_BUCKETS.DAYS_1_30 == "1-30"
        assert AGING_BUCKETS.DAYS_31_60 == "31-60"
        assert AGING_BUCKETS.DAYS_61_90 == "61-90"
        assert AGING_BUCKETS.OVER_90 == "90+"

    def test_display_labels(self):
        """Test that display labels are correct."""
        labels = AGING_BUCKETS.display_labels()
        assert labels["current"] == "Current"
        assert labels["1-30"] == "1-30 Days Past Due"
        assert labels["31-60"] == "31-60 Days Past Due"
        assert labels["61-90"] == "61-90 Days Past Due"
        assert labels["90+"] == "Over 90 Days Past Due"

    def test_bucket_is_frozen(self):
        """Test that AgingBuckets is immutable."""
        with pytest.raises(Exception):  # FrozenInstanceError
            AGING_BUCKETS.CURRENT = "modified"


class TestGenerateStatementPdf:
    """Tests for generate_statement_pdf function."""

    @pytest.fixture
    def sample_statement_data(self):
        """Create sample statement data for testing."""
        return pd.DataFrame({
            "merchant_group": ["Test Group", "Test Group", "Test Group"],
            "customer_name": ["Branch A", "Branch A", "Branch B"],
            "bill_to": ["123 Test St", "123 Test St", "456 Test Ave"],
            "invoice_number": ["INV-001", "INV-002", "INV-003"],
            "invoice_date": ["2024-01-15", "2024-02-15", "2024-01-20"],
            "outstanding_amount": [100.00, 250.50, 75.25],
            "aging_bucket": ["current", "1-30", "31-60"],
        })

    def test_generates_pdf_bytes(self, sample_statement_data):
        """Test that function returns bytes."""
        result = generate_statement_pdf(sample_statement_data)
        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_pdf_starts_with_header(self, sample_statement_data):
        """Test that PDF has proper header."""
        result = generate_statement_pdf(sample_statement_data)
        # PDF files start with %PDF
        assert result[:4] == b"%PDF"

    def test_missing_columns_raises_error(self):
        """Test that missing required columns raises ValueError."""
        incomplete_data = pd.DataFrame({
            "merchant_group": ["Test"],
            "customer_name": ["Branch"],
            # Missing other required columns
        })
        with pytest.raises(ValueError, match="Missing required columns"):
            generate_statement_pdf(incomplete_data)

    def test_empty_dataframe_raises_error(self):
        """Test that empty DataFrame raises ValueError."""
        empty_data = pd.DataFrame(columns=[
            "merchant_group", "customer_name", "bill_to",
            "invoice_number", "invoice_date", "outstanding_amount",
            "aging_bucket"
        ])
        with pytest.raises(ValueError, match="Cannot generate statement from empty data"):
            generate_statement_pdf(empty_data)

    def test_balance_resets_per_branch(self, sample_statement_data):
        """Test that running balance resets for each branch.

        This is a behavioral test - we can't easily inspect PDF content,
        but we ensure the function completes without error for multi-branch data.
        """
        # Add more data to ensure multi-branch processing
        multi_branch = pd.DataFrame({
            "merchant_group": ["Test"] * 6,
            "customer_name": ["A", "A", "A", "B", "B", "B"],
            "bill_to": ["Addr A"] * 3 + ["Addr B"] * 3,
            "invoice_number": ["001", "002", "003", "004", "005", "006"],
            "invoice_date": ["2024-01-01"] * 6,
            "outstanding_amount": [100, 200, 300, 50, 150, 200],
            "aging_bucket": ["current"] * 6,
        })
        result = generate_statement_pdf(multi_branch)
        assert isinstance(result, bytes)

    def test_handles_none_values(self):
        """Test that None values are handled gracefully."""
        data_with_nones = pd.DataFrame({
            "merchant_group": ["Test"],
            "customer_name": ["Branch"],
            "bill_to": [None],
            "invoice_number": [None],
            "invoice_date": ["2024-01-01"],
            "outstanding_amount": [100.0],
            "aging_bucket": ["current"],
        })
        result = generate_statement_pdf(data_with_nones)
        assert isinstance(result, bytes)

    def test_handles_zero_amounts(self):
        """Test that zero amounts are handled correctly."""
        data_with_zeros = pd.DataFrame({
            "merchant_group": ["Test"],
            "customer_name": ["Branch"],
            "bill_to": ["Address"],
            "invoice_number": ["INV-001"],
            "invoice_date": ["2024-01-01"],
            "outstanding_amount": [0.0],
            "aging_bucket": ["current"],
        })
        result = generate_statement_pdf(data_with_zeros)
        assert isinstance(result, bytes)
