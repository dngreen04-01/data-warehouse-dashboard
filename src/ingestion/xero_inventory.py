"""Xero inventory adjustment operations for manufacturing conversions.

This module handles creating invoices and credit notes in Xero to adjust
inventory quantities for manufacturing/production conversions.

Usage:
    from src.ingestion.xero_inventory import XeroInventoryAdjuster

    adjuster = XeroInventoryAdjuster(xero_client)
    credit_note_id = adjuster.decrease_stock(items, date, description)
    invoice_id = adjuster.increase_stock(items, date, description)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)

API_BASE = "https://api.xero.com/api.xro/2.0"

# Contact name used for inventory adjustments
INVENTORY_ADJUSTMENT_CONTACT = "Inventory Adjustments"

# Account code for inventory adjustment offset
ADJUSTMENT_ACCOUNT_CODE = "x100"


@dataclass
class InventoryItem:
    """Represents an item for inventory adjustment."""
    item_code: str
    description: str
    quantity: float
    unit_amount: float
    account_code: str  # Inventory asset account code (e.g., "575")


class XeroInventoryAdjuster:
    """Handles inventory adjustments in Xero via invoices and credit notes."""

    def __init__(self, xero_client):
        """Initialize with an authenticated XeroClient instance.

        Args:
            xero_client: An instance of XeroClient from sync_xero.py
        """
        self.client = xero_client

    def _build_line_items(self, items: List[InventoryItem]) -> List[dict]:
        """Build line items for invoice/credit note.

        Each inventory item needs two line items:
        1. The actual item with positive unit amount
        2. An adjustment line with negative unit amount to offset

        Args:
            items: List of InventoryItem objects

        Returns:
            List of line item dictionaries for Xero API
        """
        line_items = []

        for item in items:
            # Line 1: The inventory item
            line_items.append({
                "ItemCode": item.item_code,
                "Description": item.description,
                "Quantity": item.quantity,
                "UnitAmount": item.unit_amount,
                "AccountCode": item.account_code
            })

            # Line 2: Offset to adjustment account
            line_items.append({
                "Description": "Inventory Adjustment",
                "Quantity": item.quantity,
                "UnitAmount": -item.unit_amount,
                "AccountCode": ADJUSTMENT_ACCOUNT_CODE
            })

        return line_items

    def decrease_stock(
        self,
        items: List[InventoryItem],
        adjustment_date: date,
        reference: Optional[str] = None
    ) -> str:
        """Decrease inventory stock by creating a credit note (ACCPAYCREDIT).

        Args:
            items: List of items to decrease stock for
            adjustment_date: Date of the adjustment
            reference: Optional reference number for the credit note

        Returns:
            The CreditNoteID from Xero

        Raises:
            requests.HTTPError: If the API call fails
        """
        headers = self.client._auth_header()
        headers["Content-Type"] = "application/json"

        line_items = self._build_line_items(items)

        payload = {
            "Type": "ACCPAYCREDIT",
            "Contact": {"Name": INVENTORY_ADJUSTMENT_CONTACT},
            "Date": adjustment_date.isoformat(),
            "DueDate": adjustment_date.isoformat(),
            "LineAmountTypes": "NoTax",
            "Status": "AUTHORISED",
            "LineItems": line_items
        }

        if reference:
            payload["Reference"] = reference

        logger.info(f"Creating credit note to decrease stock for {len(items)} item(s)")
        logger.info(f"Tenant ID present: {bool(headers.get('xero-tenant-id'))}")
        logger.info(f"Auth header present: {bool(headers.get('Authorization'))}")
        if not headers.get('xero-tenant-id'):
            logger.error("MISSING xero-tenant-id header!")
        if not headers.get('Authorization'):
            logger.error("MISSING Authorization header!")

        response = requests.post(
            f"{API_BASE}/CreditNotes",
            headers=headers,
            json=payload,
            timeout=60
        )

        if not response.ok:
            logger.error(f"Xero API error: {response.status_code}")
            logger.error(f"Response: {response.text}")
            response.raise_for_status()

        result = response.json()
        credit_notes = result.get("CreditNotes", [])

        if not credit_notes:
            raise RuntimeError("No credit note returned from Xero API")

        credit_note = credit_notes[0]
        credit_note_id = credit_note.get("CreditNoteID")
        credit_note_number = credit_note.get("CreditNoteNumber")

        logger.info(f"Created credit note: {credit_note_number} ({credit_note_id})")
        return credit_note_id

    def increase_stock(
        self,
        items: List[InventoryItem],
        adjustment_date: date,
        reference: Optional[str] = None
    ) -> str:
        """Increase inventory stock by creating an invoice (ACCPAY).

        Args:
            items: List of items to increase stock for
            adjustment_date: Date of the adjustment
            reference: Optional reference number for the invoice

        Returns:
            The InvoiceID from Xero

        Raises:
            requests.HTTPError: If the API call fails
        """
        headers = self.client._auth_header()
        headers["Content-Type"] = "application/json"

        line_items = self._build_line_items(items)

        payload = {
            "Type": "ACCPAY",
            "Contact": {"Name": INVENTORY_ADJUSTMENT_CONTACT},
            "Date": adjustment_date.isoformat(),
            "DueDate": adjustment_date.isoformat(),
            "LineAmountTypes": "NoTax",
            "Status": "AUTHORISED",
            "LineItems": line_items
        }

        if reference:
            payload["Reference"] = reference

        logger.info(f"Creating invoice to increase stock for {len(items)} item(s)")

        response = requests.post(
            f"{API_BASE}/Invoices",
            headers=headers,
            json=payload,
            timeout=60
        )

        if not response.ok:
            logger.error(f"Xero API error: {response.status_code}")
            logger.error(f"Response: {response.text}")
            response.raise_for_status()

        result = response.json()
        invoices = result.get("Invoices", [])

        if not invoices:
            raise RuntimeError("No invoice returned from Xero API")

        invoice = invoices[0]
        invoice_id = invoice.get("InvoiceID")
        invoice_number = invoice.get("InvoiceNumber")

        logger.info(f"Created invoice: {invoice_number} ({invoice_id})")
        return invoice_id

    def process_conversion(
        self,
        bulk_item: InventoryItem,
        finished_items: List[InventoryItem],
        adjustment_date: date,
        reference_prefix: str = "PROD"
    ) -> tuple[str, str]:
        """Process a full manufacturing conversion.

        Creates both the credit note (to decrease bulk stock) and
        invoice (to increase finished goods stock).

        Args:
            bulk_item: The bulk material being consumed
            finished_items: The finished goods being created
            adjustment_date: Date of the conversion
            reference_prefix: Prefix for reference numbers

        Returns:
            Tuple of (credit_note_id, invoice_id)
        """
        import time
        timestamp = int(time.time())

        # Decrease bulk stock
        credit_note_id = self.decrease_stock(
            items=[bulk_item],
            adjustment_date=adjustment_date,
            reference=f"{reference_prefix}-DEC-{timestamp}"
        )

        # Increase finished goods stock
        invoice_id = self.increase_stock(
            items=finished_items,
            adjustment_date=adjustment_date,
            reference=f"{reference_prefix}-INC-{timestamp}"
        )

        return credit_note_id, invoice_id
