#!/usr/bin/env python3
"""
PRiMAX Floor Plan Geometric Validator
Runs self-consistency checks on parsed floor plan JSON and produces a confidence score.

Usage:
    python validate.py <plan.json>
"""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


def validate_plan(plan: dict) -> dict:
    """Run all validation checks on a parsed floor plan.

    Returns a report dict with per-check scores and issues.
    """
    report = {}

    report["wallClosure"] = check_wall_closure(plan.get("walls", []))
    report["openingValidity"] = check_openings(
        plan.get("openings", []), plan.get("walls", [])
    )
    report["roomPlausibility"] = check_rooms(plan.get("rooms", []))
    report["furnitureValidity"] = check_furniture(plan.get("furniture", []), plan)

    # Composite score
    weights = {
        "wallClosure": 0.30,
        "openingValidity": 0.25,
        "roomPlausibility": 0.25,
        "furnitureValidity": 0.20,
    }
    total = sum(
        report[k]["score"] * weights[k]
        for k in weights
        if report[k]["score"] is not None
    )
    weight_sum = sum(
        weights[k] for k in weights if report[k]["score"] is not None
    )
    report["overallScore"] = round(total / weight_sum) if weight_sum > 0 else 0

    return report


def check_wall_closure(walls: list) -> dict:
    """Check if walls form closed polygons using union-find on snapped endpoints."""
    if not walls:
        return {"score": 0, "issues": ["No walls found"]}

    SNAP_TOLERANCE = 50  # mm

    # Collect all endpoints
    points = []
    for wall in walls:
        points.append(tuple(wall["start"]))
        points.append(tuple(wall["end"]))

    # Snap points: group points within tolerance
    snapped = {}  # original point -> canonical point
    canonical_points = []

    for pt in points:
        found = False
        for canon in canonical_points:
            dist = math.sqrt((pt[0] - canon[0]) ** 2 + (pt[1] - canon[1]) ** 2)
            if dist <= SNAP_TOLERANCE:
                snapped[pt] = canon
                found = True
                break
        if not found:
            canonical_points.append(pt)
            snapped[pt] = pt

    # Build adjacency: count degree of each canonical point
    degree = defaultdict(int)
    for wall in walls:
        sp = snapped[tuple(wall["start"])]
        ep = snapped[tuple(wall["end"])]
        degree[sp] += 1
        degree[ep] += 1

    # Check: for closed polygons, every node should have even degree
    issues = []
    odd_degree_points = [pt for pt, deg in degree.items() if deg % 2 != 0]

    if odd_degree_points:
        for pt in odd_degree_points[:5]:  # Report up to 5
            issues.append(
                f"Wall endpoint at [{pt[0]:.0f}, {pt[1]:.0f}] has odd degree "
                f"({degree[pt]}), suggesting an open wall segment"
            )

    # Also check for isolated segments (degree-1 endpoints = dead ends)
    dead_ends = [pt for pt, deg in degree.items() if deg == 1]
    if dead_ends:
        for pt in dead_ends[:5]:
            issues.append(
                f"Dead-end wall at [{pt[0]:.0f}, {pt[1]:.0f}] — wall doesn't connect to anything"
            )

    total_points = len(degree)
    problem_points = len(odd_degree_points) + len(dead_ends)
    score = max(0, round(100 * (1 - problem_points / max(total_points, 1))))

    return {"score": score, "issues": issues}


def check_openings(openings: list, walls: list) -> dict:
    """Validate opening placement and dimensions."""
    if not openings:
        return {"score": 100, "issues": []}

    wall_map = {w["id"]: w for w in walls}
    issues = []
    penalty = 0

    for opening in openings:
        oid = opening.get("id", "?")

        # Check wallId exists
        if opening["wallId"] not in wall_map:
            issues.append(f"Opening {oid}: wallId '{opening['wallId']}' not found")
            penalty += 25
            continue

        wall = wall_map[opening["wallId"]]

        # Check position range
        pos = opening.get("position", 0.5)
        if pos < 0 or pos > 1:
            issues.append(
                f"Opening {oid}: position {pos} is outside [0, 1]"
            )
            penalty += 10

        # Check opening width vs wall length
        wall_length = math.sqrt(
            (wall["end"][0] - wall["start"][0]) ** 2
            + (wall["end"][1] - wall["start"][1]) ** 2
        )
        if opening["width"] > wall_length:
            issues.append(
                f"Opening {oid}: width {opening['width']}mm exceeds "
                f"wall {opening['wallId']} length {wall_length:.0f}mm"
            )
            penalty += 25

        # Check plausible dimensions
        if opening["type"] == "door":
            if not (600 <= opening.get("width", 0) <= 3000):
                issues.append(
                    f"Opening {oid}: door width {opening.get('width')}mm "
                    f"seems implausible (expected 600-3000mm)"
                )
                penalty += 5
            if opening.get("sillHeight", 0) != 0:
                issues.append(
                    f"Opening {oid}: door has sillHeight {opening['sillHeight']}mm "
                    f"(expected 0)"
                )
                penalty += 5
        elif opening["type"] == "window":
            if not (400 <= opening.get("width", 0) <= 4000):
                issues.append(
                    f"Opening {oid}: window width {opening.get('width')}mm "
                    f"seems implausible"
                )
                penalty += 5
            if not (300 <= opening.get("sillHeight", 0) <= 1500):
                issues.append(
                    f"Opening {oid}: window sillHeight {opening.get('sillHeight', 0)}mm "
                    f"seems implausible (expected 300-1500mm)"
                )
                penalty += 5

    # Check for overlapping openings on the same wall
    by_wall = defaultdict(list)
    for opening in openings:
        if opening["wallId"] in wall_map:
            by_wall[opening["wallId"]].append(opening)

    for wall_id, wall_openings in by_wall.items():
        if len(wall_openings) < 2:
            continue
        wall = wall_map[wall_id]
        wall_length = math.sqrt(
            (wall["end"][0] - wall["start"][0]) ** 2
            + (wall["end"][1] - wall["start"][1]) ** 2
        )
        # Sort by position
        sorted_openings = sorted(wall_openings, key=lambda o: o["position"])
        for i in range(len(sorted_openings) - 1):
            a = sorted_openings[i]
            b = sorted_openings[i + 1]
            a_end = a["position"] * wall_length + a["width"] / 2
            b_start = b["position"] * wall_length - b["width"] / 2
            if a_end > b_start + 10:  # 10mm tolerance
                issues.append(
                    f"Openings {a['id']} and {b['id']} overlap on wall {wall_id}"
                )
                penalty += 20

    score = max(0, 100 - penalty)
    return {"score": score, "issues": issues}


def check_rooms(rooms: list) -> dict:
    """Check room polygon plausibility."""
    if not rooms:
        return {"score": 0, "issues": ["No rooms found"]}

    issues = []
    plausible = 0

    for room in rooms:
        rid = room.get("id", "?")
        label = room.get("label", "?")
        polygon = room.get("polygon", [])

        if len(polygon) < 3:
            issues.append(f"Room {rid} ({label}): polygon has fewer than 3 vertices")
            continue

        # Compute area using shoelace formula (in mm^2)
        area_mm2 = 0
        n = len(polygon)
        for i in range(n):
            j = (i + 1) % n
            area_mm2 += polygon[i][0] * polygon[j][1]
            area_mm2 -= polygon[j][0] * polygon[i][1]
        area_mm2 = abs(area_mm2) / 2
        area_m2 = area_mm2 / 1_000_000

        # Check plausibility
        if area_m2 < 1.0:
            issues.append(
                f"Room {rid} ({label}): area {area_m2:.1f}m² is very small (< 1m²)"
            )
        elif area_m2 > 200:
            issues.append(
                f"Room {rid} ({label}): area {area_m2:.1f}m² is very large (> 200m²)"
            )
        else:
            plausible += 1

    score = round(100 * plausible / max(len(rooms), 1))
    return {"score": score, "issues": issues}


def check_furniture(furniture: list, plan: dict) -> dict:
    """Check furniture placement plausibility."""
    if not furniture:
        return {"score": 100, "issues": []}

    VALID_TYPES = {
        "bed_single", "bed_double", "sofa", "dining_table", "chair",
        "toilet", "sink", "bathtub", "kitchen_counter", "wardrobe",
        "desk", "washing_machine", "fridge", "shower",
    }

    issues = []
    valid = 0
    plan_w = plan.get("metadata", {}).get("planWidth", float("inf"))
    plan_h = plan.get("metadata", {}).get("planHeight", float("inf"))

    for item in furniture:
        fid = item.get("id", "?")
        ftype = item.get("type", "unknown")

        if ftype not in VALID_TYPES:
            issues.append(f"Furniture {fid}: unknown type '{ftype}'")
            continue

        # Check position is within plan bounds
        pos = item.get("position", [0, 0])
        if pos[0] < -100 or pos[0] > plan_w + 100 or pos[1] < -100 or pos[1] > plan_h + 100:
            issues.append(
                f"Furniture {fid} ({ftype}): position [{pos[0]:.0f}, {pos[1]:.0f}] "
                f"is outside plan bounds"
            )
            continue

        # Check dimensions are plausible
        w = item.get("width", 0)
        d = item.get("depth", 0)
        if w <= 0 or d <= 0:
            issues.append(f"Furniture {fid} ({ftype}): invalid dimensions {w}x{d}mm")
            continue

        if w > 5000 or d > 5000:
            issues.append(
                f"Furniture {fid} ({ftype}): dimensions {w}x{d}mm seem too large"
            )
            continue

        valid += 1

    score = round(100 * valid / max(len(furniture), 1))
    return {"score": score, "issues": issues}


def main():
    parser = argparse.ArgumentParser(
        description="Validate a parsed floor plan JSON"
    )
    parser.add_argument("plan", help="Path to floor plan JSON file")
    parser.add_argument(
        "-o", "--output", default=None, help="Output report JSON (default: stdout)"
    )
    args = parser.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    report = validate_plan(plan)

    output = json.dumps(report, indent=2)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(output)

    # Print summary
    print(f"\nOverall Score: {report['overallScore']}/100", file=sys.stderr)
    for key, val in report.items():
        if key == "overallScore":
            continue
        if isinstance(val, dict):
            print(f"  {key}: {val['score']}/100", file=sys.stderr)
            for issue in val.get("issues", []):
                print(f"    - {issue}", file=sys.stderr)


if __name__ == "__main__":
    main()
