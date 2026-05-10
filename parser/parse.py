#!/usr/bin/env python3
"""
PRiMAX Floor Plan Parser
Extracts structured geometry from a 2D floor plan image using a VLM (Claude).

Usage:
    python parse.py <image_path> [-o output.json] [--model claude-sonnet-4-20250514] [--validate] [--retries 2]
"""

import argparse
import base64
import json
import sys
from pathlib import Path

import anthropic


def load_prompt():
    """Load the VLM prompt template."""
    prompt_path = Path(__file__).parent / "prompt.txt"
    return prompt_path.read_text(encoding="utf-8")


def encode_image(image_path: str) -> tuple[str, str]:
    """Read and base64-encode an image file. Returns (base64_data, media_type)."""
    path = Path(image_path)
    suffix = path.suffix.lower()
    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    media_type = media_types.get(suffix, "image/png")
    data = base64.standard_b64encode(path.read_bytes()).decode("utf-8")
    return data, media_type


def parse_floor_plan(
    image_path: str,
    model: str = "claude-sonnet-4-6",
    max_retries: int = 2,
    validate: bool = True,
) -> dict:
    """Parse a floor plan image into structured JSON.

    Args:
        image_path: Path to the floor plan image.
        model: Claude model to use.
        max_retries: Max retry attempts if validation fails.
        validate: Whether to run validation between retries.

    Returns:
        Parsed floor plan dict.
    """
    client = anthropic.Anthropic()
    prompt = load_prompt()
    image_data, media_type = encode_image(image_path)
    source_filename = Path(image_path).name

    errors_so_far = []

    for attempt in range(1 + max_retries):
        # Build the user message
        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": image_data,
                },
            },
            {"type": "text", "text": prompt},
        ]

        # On retries, append previous errors
        if errors_so_far:
            error_text = (
                "\n\nYour previous output had these validation errors:\n"
                + "\n".join(f"- {e}" for e in errors_so_far)
                + "\n\nPlease fix these issues and output corrected JSON."
            )
            content.append({"type": "text", "text": error_text})

        print(f"Attempt {attempt + 1}/{1 + max_retries}...", file=sys.stderr)

        response = client.messages.create(
            model=model,
            max_tokens=8192,
            temperature=0,
            messages=[{"role": "user", "content": content}],
        )

        # Extract text response
        raw_text = response.content[0].text.strip()

        # Strip markdown fences if present
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            # Remove first and last lines (fences)
            lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            raw_text = "\n".join(lines)

        # Parse JSON
        try:
            plan = json.loads(raw_text)
        except json.JSONDecodeError as e:
            print(f"JSON parse error: {e}", file=sys.stderr)
            errors_so_far.append(f"Invalid JSON: {e}")
            continue

        # Ensure sourceImage is set
        if "metadata" in plan:
            plan["metadata"]["sourceImage"] = source_filename

        # Validate if requested
        if validate:
            from validate import validate_plan

            report = validate_plan(plan)
            issues = []
            for check_name, check_result in report.items():
                if check_name == "overallScore":
                    continue
                if isinstance(check_result, dict) and check_result.get("issues"):
                    issues.extend(check_result["issues"])

            if issues:
                print(
                    f"Validation issues (score={report['overallScore']}):",
                    file=sys.stderr,
                )
                for issue in issues:
                    print(f"  - {issue}", file=sys.stderr)

                if attempt < max_retries:
                    errors_so_far = issues
                    continue
                else:
                    print(
                        "Max retries reached. Returning best result.", file=sys.stderr
                    )

        print(
            f"Successfully parsed: {len(plan.get('walls', []))} walls, "
            f"{len(plan.get('openings', []))} openings, "
            f"{len(plan.get('rooms', []))} rooms, "
            f"{len(plan.get('furniture', []))} furniture items",
            file=sys.stderr,
        )
        return plan

    print("All attempts failed.", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Parse a floor plan image into JSON")
    parser.add_argument("image", help="Path to floor plan image (PNG, JPG)")
    parser.add_argument(
        "-o", "--output", default=None, help="Output JSON file (default: stdout)"
    )
    parser.add_argument(
        "--model",
        default="claude-sonnet-4-6",
        help="Claude model to use",
    )
    parser.add_argument(
        "--retries", type=int, default=2, help="Max validation retries (default: 2)"
    )
    parser.add_argument(
        "--no-validate",
        action="store_true",
        help="Skip validation between retries",
    )
    args = parser.parse_args()

    plan = parse_floor_plan(
        args.image,
        model=args.model,
        max_retries=args.retries,
        validate=not args.no_validate,
    )

    output_json = json.dumps(plan, indent=2)

    if args.output:
        Path(args.output).write_text(output_json, encoding="utf-8")
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == "__main__":
    main()
