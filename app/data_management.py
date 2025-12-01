"""Data management utilities for customer matching and archiving."""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import List, Tuple, Optional

import pandas as pd


@dataclass
class CustomerMatch:
    """Represents a potential customer match."""
    xero_customer_id: str
    xero_customer_name: str
    historical_customer_id: str
    historical_customer_name: str
    similarity_score: float
    match_type: str  # 'exact', 'high', 'medium', 'low'


def normalize_customer_name(name: str) -> str:
    """Normalize customer name for comparison.

    Handles patterns like:
    - "Local - 1:Farmlands:Kamo" -> "farmlands kamo"
    - "Farmlands - Kamo" -> "farmlands kamo"
    - "The Brand Outlet - Cashier1" -> "brand outlet cashier1"
    """
    if not name:
        return ""

    # Convert to lowercase
    name = name.lower()

    # Remove common prefixes
    prefixes_to_remove = [
        r'^local\s*-\s*\d+:',  # "Local - 1:"
        r'^export\s*-\s*\d+:',  # "Export - 1:"
        r'^the\s+',  # "The "
    ]
    for pattern in prefixes_to_remove:
        name = re.sub(pattern, '', name, flags=re.IGNORECASE)

    # Replace separators with spaces
    name = re.sub(r'[:\-_/\\]+', ' ', name)

    # Remove special characters but keep alphanumeric and spaces
    name = re.sub(r'[^a-z0-9\s]', '', name)

    # Normalize whitespace
    name = ' '.join(name.split())

    return name.strip()


def extract_name_parts(name: str) -> List[str]:
    """Extract significant parts of a customer name."""
    normalized = normalize_customer_name(name)
    parts = normalized.split()
    # Filter out very short parts and common words
    stopwords = {'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at'}
    return [p for p in parts if len(p) > 1 and p not in stopwords]


def calculate_similarity(name1: str, name2: str) -> float:
    """Calculate similarity score between two customer names.

    Uses multiple strategies:
    1. Direct string similarity on normalized names
    2. Word overlap score
    3. Substring matching for partial matches
    """
    norm1 = normalize_customer_name(name1)
    norm2 = normalize_customer_name(name2)

    if not norm1 or not norm2:
        return 0.0

    # Exact match after normalization
    if norm1 == norm2:
        return 1.0

    # Calculate sequence matcher similarity
    seq_score = SequenceMatcher(None, norm1, norm2).ratio()

    # Calculate word overlap
    parts1 = set(extract_name_parts(name1))
    parts2 = set(extract_name_parts(name2))

    if parts1 and parts2:
        intersection = parts1 & parts2
        union = parts1 | parts2
        jaccard = len(intersection) / len(union) if union else 0

        # Bonus for matching significant words
        word_match_score = len(intersection) / min(len(parts1), len(parts2)) if min(len(parts1), len(parts2)) > 0 else 0
    else:
        jaccard = 0
        word_match_score = 0

    # Check if one contains the other (substring)
    substring_score = 0
    if norm1 in norm2 or norm2 in norm1:
        substring_score = 0.3

    # Weighted combination
    final_score = (seq_score * 0.4) + (jaccard * 0.3) + (word_match_score * 0.2) + (substring_score * 0.1)

    return min(final_score, 1.0)


def classify_match(score: float) -> str:
    """Classify match quality based on similarity score."""
    if score >= 0.95:
        return 'exact'
    elif score >= 0.7:
        return 'high'
    elif score >= 0.5:
        return 'medium'
    else:
        return 'low'


def find_customer_matches(
    xero_customers: pd.DataFrame,
    historical_customers: pd.DataFrame,
    min_score: float = 0.5
) -> List[CustomerMatch]:
    """Find potential matches between Xero and historical customers.

    Args:
        xero_customers: DataFrame with customer_id, customer_name (from Xero)
        historical_customers: DataFrame with customer_id, customer_name (historical)
        min_score: Minimum similarity score to include in results

    Returns:
        List of CustomerMatch objects sorted by similarity score descending
    """
    matches = []

    for _, xero_row in xero_customers.iterrows():
        xero_id = xero_row['customer_id']
        xero_name = xero_row['customer_name'] or ''

        if not xero_name:
            continue

        best_match = None
        best_score = 0

        for _, hist_row in historical_customers.iterrows():
            hist_id = hist_row['customer_id']
            hist_name = hist_row['customer_name'] or ''

            if not hist_name or hist_id == xero_id:
                continue

            score = calculate_similarity(xero_name, hist_name)

            if score >= min_score and score > best_score:
                best_score = score
                best_match = CustomerMatch(
                    xero_customer_id=xero_id,
                    xero_customer_name=xero_name,
                    historical_customer_id=hist_id,
                    historical_customer_name=hist_name,
                    similarity_score=score,
                    match_type=classify_match(score)
                )

        if best_match:
            matches.append(best_match)

    # Sort by score descending
    matches.sort(key=lambda m: m.similarity_score, reverse=True)

    return matches


def merge_customers(conn, source_id: str, target_id: str) -> int:
    """Merge source customer into target customer.

    Updates all references from source to target and marks source as merged.

    Returns:
        Number of records updated
    """
    updated = 0

    with conn.cursor() as cur:
        # Update fct_invoice
        cur.execute(
            "UPDATE dw.fct_invoice SET customer_id = %s WHERE customer_id = %s",
            (target_id, source_id)
        )
        updated += cur.rowcount

        # Update fct_sales_line
        cur.execute(
            "UPDATE dw.fct_sales_line SET customer_id = %s WHERE customer_id = %s",
            (target_id, source_id)
        )
        updated += cur.rowcount

        # Mark source customer as merged
        cur.execute(
            "UPDATE dw.dim_customer SET merged_into = %s, archived = true WHERE customer_id = %s",
            (target_id, source_id)
        )

    conn.commit()
    return updated


def archive_customers_by_date(conn, before_date: str) -> int:
    """Archive customers who have no transactions after the given date.

    Returns:
        Number of customers archived
    """
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE dw.dim_customer c
            SET archived = true
            WHERE (archived = false OR archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_invoice i
                WHERE i.customer_id = c.customer_id
                AND i.invoice_date >= %s
            )
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.customer_id = c.customer_id
                AND s.invoice_date >= %s
            )
        """, (before_date, before_date))
        archived = cur.rowcount

    conn.commit()
    return archived


def archive_products_by_date(conn, before_date: str) -> int:
    """Archive products with no transactions after the given date.

    Returns:
        Number of products archived
    """
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE dw.dim_product p
            SET archived = true
            WHERE (archived = false OR archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.product_id = p.product_id
                AND s.invoice_date >= %s
            )
        """, (before_date,))
        archived = cur.rowcount

    conn.commit()
    return archived


def get_archive_preview(conn, before_date: str) -> Tuple[int, int]:
    """Preview how many customers and products would be archived.

    Returns:
        Tuple of (customers_count, products_count)
    """
    with conn.cursor() as cur:
        # Count customers to archive
        cur.execute("""
            SELECT COUNT(*) as cnt FROM dw.dim_customer c
            WHERE (archived = false OR archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_invoice i
                WHERE i.customer_id = c.customer_id
                AND i.invoice_date >= %s
            )
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.customer_id = c.customer_id
                AND s.invoice_date >= %s
            )
        """, (before_date, before_date))
        row = cur.fetchone()
        customers = row['cnt'] if row else 0

        # Count products to archive
        cur.execute("""
            SELECT COUNT(*) as cnt FROM dw.dim_product p
            WHERE (archived = false OR archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.product_id = p.product_id
                AND s.invoice_date >= %s
            )
        """, (before_date,))
        row = cur.fetchone()
        products = row['cnt'] if row else 0

    return customers, products


def get_customers_to_archive(conn, before_date: str) -> List[dict]:
    """Get list of customers that would be archived."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT c.customer_id, c.customer_name, c.market, c.merchant_group
            FROM dw.dim_customer c
            WHERE (c.archived = false OR c.archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_invoice i
                WHERE i.customer_id = c.customer_id
                AND i.invoice_date >= %s
            )
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.customer_id = c.customer_id
                AND s.invoice_date >= %s
            )
            ORDER BY c.customer_name
        """, (before_date, before_date))
        return cur.fetchall()


def get_products_to_archive(conn, before_date: str) -> List[dict]:
    """Get list of products that would be archived."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.product_id, p.product_code, p.item_name, p.product_group
            FROM dw.dim_product p
            WHERE (p.archived = false OR p.archived IS NULL)
            AND NOT EXISTS (
                SELECT 1 FROM dw.fct_sales_line s
                WHERE s.product_id = p.product_id
                AND s.invoice_date >= %s
            )
            ORDER BY p.item_name
        """, (before_date,))
        return cur.fetchall()


def archive_customers_by_ids(conn, customer_ids: List[str]) -> int:
    """Archive specific customers by their IDs."""
    if not customer_ids:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE dw.dim_customer SET archived = true WHERE customer_id = ANY(%s)",
            (customer_ids,)
        )
        archived = cur.rowcount
    conn.commit()
    return archived


def archive_products_by_ids(conn, product_ids: List[int]) -> int:
    """Archive specific products by their IDs."""
    if not product_ids:
        return 0
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE dw.dim_product SET archived = true WHERE product_id = ANY(%s)",
            (product_ids,)
        )
        archived = cur.rowcount
    conn.commit()
    return archived


def unarchive_customer(conn, customer_id: str) -> bool:
    """Unarchive a single customer."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE dw.dim_customer SET archived = false WHERE customer_id = %s",
            (customer_id,)
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated


def unarchive_product(conn, product_id: int) -> bool:
    """Unarchive a single product."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE dw.dim_product SET archived = false WHERE product_id = %s",
            (product_id,)
        )
        updated = cur.rowcount > 0
    conn.commit()
    return updated
