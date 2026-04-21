#!/usr/bin/env python3
"""
Export the SIB query curation sheet from XLSX to normalized CSV.

Normalization rule:
- Every blank data entry is written as "-" in the output CSV.

This script intentionally uses only Python stdlib so it works without extra deps.
"""

from __future__ import annotations

import argparse
import csv
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS_MAIN = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NS_PKG_REL = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
REL_ID_KEY = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def column_index(cell_ref: str) -> int:
    """Convert Excel-style cell refs (e.g., 'C12') to one-based column index."""
    letters = re.match(r"[A-Za-z]+", cell_ref)
    if not letters:
        return 1
    value = 0
    for char in letters.group(0).upper():
        value = value * 26 + (ord(char) - 64)
    return value


def parse_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []

    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall("m:si", NS_MAIN):
        text_parts = [node.text or "" for node in item.findall(".//m:t", NS_MAIN)]
        values.append("".join(text_parts))
    return values


def parse_sheet_target(archive: zipfile.ZipFile, preferred_sheet: str) -> tuple[str, str]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("r:Relationship", NS_PKG_REL)
    }

    sheet_map = {}
    for sheet in workbook.findall("m:sheets/m:sheet", NS_MAIN):
        name = sheet.attrib.get("name", "")
        rid = sheet.attrib.get(REL_ID_KEY, "")
        target = rid_to_target.get(rid, "")
        if target:
            sheet_map[name] = f"xl/{target.lstrip('/')}"

    if preferred_sheet in sheet_map:
        return preferred_sheet, sheet_map[preferred_sheet]

    # The provided workbook currently uses this name for curated SIB content.
    if "curated" in sheet_map:
        return "curated", sheet_map["curated"]

    # Final fallback: first sheet in workbook order.
    for sheet in workbook.findall("m:sheets/m:sheet", NS_MAIN):
        name = sheet.attrib.get("name", "")
        if name in sheet_map:
            return name, sheet_map[name]

    raise RuntimeError("No readable worksheet found in workbook.")


def parse_sheet_rows(
    archive: zipfile.ZipFile,
    sheet_xml_path: str,
    shared_strings: list[str],
) -> list[list[str]]:
    root = ET.fromstring(archive.read(sheet_xml_path))
    parsed_rows: list[list[str]] = []

    for row in root.findall("m:sheetData/m:row", NS_MAIN):
        # Sparse cell encoding: map column index -> value, then densify.
        by_col: dict[int, str] = {}
        for cell in row.findall("m:c", NS_MAIN):
            ref = cell.attrib.get("r", "")
            col = column_index(ref)
            value = ""

            cell_type = cell.attrib.get("t")
            shared_node = cell.find("m:v", NS_MAIN)
            inline_node = cell.find("m:is/m:t", NS_MAIN)

            if cell_type == "s" and shared_node is not None and shared_node.text:
                idx = int(shared_node.text)
                if 0 <= idx < len(shared_strings):
                    value = shared_strings[idx]
            elif cell_type == "inlineStr" and inline_node is not None:
                value = inline_node.text or ""
            elif shared_node is not None and shared_node.text is not None:
                value = shared_node.text

            by_col[col] = value

        if not by_col:
            parsed_rows.append([])
            continue

        max_col = max(by_col)
        parsed_rows.append([by_col.get(index, "") for index in range(1, max_col + 1)])

    return parsed_rows


def normalize_rows(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    if not rows:
        return [], []

    header_row = rows[0]
    header_count = len(header_row)
    headers: list[str] = []
    for index, raw_header in enumerate(header_row, start=1):
        header = (raw_header or "").strip()
        headers.append(header if header else f"Column_{index}")

    normalized_data: list[list[str]] = []
    for raw_row in rows[1:]:
        # Expand row to the header width so missing trailing values are treated as blanks.
        dense = [(raw_row[index] if index < len(raw_row) else "") for index in range(header_count)]

        # Skip fully empty rows.
        if all((cell or "").strip() == "" for cell in dense):
            continue

        normalized_row: list[str] = []
        for cell in dense:
            text = (cell or "").strip()
            if text == "":
                normalized_row.append("-")
            else:
                # Keep CSV one-line-per-row for easier downstream parsing.
                normalized_row.append(re.sub(r"\s*\n\s*", " ", text))
        normalized_data.append(normalized_row)

    return headers, normalized_data


def main() -> None:
    parser = argparse.ArgumentParser(description="Export normalized SIB queries CSV from XLSX.")
    parser.add_argument("--input", required=True, help="Path to source .xlsx file")
    parser.add_argument("--output", required=True, help="Path to output .csv file")
    parser.add_argument(
        "--sheet",
        default="SIB_queries",
        help="Preferred worksheet name (default: SIB_queries)",
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    with zipfile.ZipFile(input_path) as archive:
        shared_strings = parse_shared_strings(archive)
        used_sheet, sheet_xml = parse_sheet_target(archive, args.sheet)
        raw_rows = parse_sheet_rows(archive, sheet_xml, shared_strings)

    headers, data_rows = normalize_rows(raw_rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(data_rows)

    print(f"[OK] Exported {len(data_rows)} rows from worksheet '{used_sheet}' to {output_path}")


if __name__ == "__main__":
    main()
