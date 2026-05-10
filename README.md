# PRiMAX

**Turn 2D floor plans into walkable 3D environments.**

PRiMAX converts architectural floor plan images into interactive, first-person walkable 3D scenes. It's built for off-the-plan property buyers who need to experience the actual unit -- not a hallucinated approximation.

## The Problem

Naive approaches (drop a floor plan into a generative model) produce output that looks plausible but fails on five axes:

1. **Geometry is wrong** -- walls aren't where the plan says they are
2. **Brand/finishes are ignored** -- every output looks the same
3. **Details get hallucinated** -- furniture, windows, rooms that don't exist
4. **Output drifts run-to-run** -- no consistency between generations
5. **None of it scales** -- manual tweaking per lot

## The Architectural Insight

These five problems aren't peers. **Geometry is load-bearing.** Once you solve it, hallucination and consistency fall out for free, and brand fidelity becomes addressable.

The key move: **use AI for perception and code for generation.**

```
plan.png  -->  [VLM PARSER]  -->  structured JSON  -->  [PROCEDURAL GEN]  -->  3D scene
```

- **VLM Parser** (Claude) extracts structured geometry from the plan image -- walls, openings, rooms, furniture -- into a flat JSON file
- **Procedural Generator** (Three.js) deterministically builds the 3D scene from that JSON

This single architectural choice solves four problems at once:
- **Hallucination is impossible** -- the generator can only emit what's in the JSON
- **Consistency is free** -- generation is deterministic code, not stochastic
- **Brand fidelity is a config lookup** -- swap a style JSON, get a different project
- **Scalability is tractable** -- every stage is inspectable and automatable

Geometry -- getting the JSON right -- is the remaining problem, and that's what we solve with the parser + validator.

## Alternatives Considered

### End-to-End Generative (the "nano banana" approach)
Feed the floor plan image to a generative model, get 3D output directly. Maximum visual polish, but hallucinated geometry, non-deterministic, no configurability. You get *a* unit, not *the* unit.

### Hybrid: Structured Extraction then Generative Refinement
Extract structure first, then use a generative model to add visual richness on top. Correct foundation + high polish, but massively more complex and re-introduces stochastic failure modes in the visual layer.

### CV-Based Parser
Classical computer vision (Hough transforms, contour detection) instead of VLM. More reliable on clean architectural drawings but brittle across varied plan styles. VLM generalises better across plan formats for the time budget.

**We chose structured extraction + procedural generation** because it provides correctness guarantees that generative approaches fundamentally cannot.

## Tradeoffs Made

- **VLM over CV for parsing** -- generalises across plan styles, fast to build vs a month of CV work. Trades coordinate precision for flexibility.
- **Procedural primitives over glTF assets for furniture** -- beds, sofas, tables are boxes/cylinders with brand-config materials. Looks schematic but guarantees style consistency and eliminates asset sourcing.
- **Self-consistency eval over ground truth** -- wall closure checks, dimensional validation, room plausibility scoring. Ground truth doesn't scale; self-consistency runs unsupervised on every output.
- **Segment decomposition over CSG for wall openings** -- walls split into sub-boxes around doors/windows. Simpler, clean UVs, no mesh repair bugs. Can't do arched openings but covers 95%+ of residential plans.
- **Fixed eye height over physics simulation** -- no jumping, no gravity. Floor plan walkthroughs don't need it.

## What's Built

### VLM Parser (`parser/`)
- Python script that sends a floor plan image to Claude with a structured extraction prompt
- Outputs JSON conforming to the floor plan schema (walls, openings, rooms, furniture)
- Validation loop: if the output fails geometric checks, re-prompts with error feedback (up to 2 retries)

### Geometric Validator (`parser/validate.py`)
- **Wall closure**: checks that wall endpoints connect (accounts for T-junctions)
- **Opening validity**: verifies openings reference real walls, fit within wall length, don't overlap
- **Room plausibility**: shoelace area check, no degenerate or impossibly large rooms
- **Furniture validity**: type checking, bounds checking, dimension plausibility
- Produces a per-plan confidence score (0-100)

### 3D Viewer (`viewer/`)
- **Procedural geometry**: walls built from BoxGeometry with segment decomposition for door/window openings
- **Furniture**: procedural primitives (boxes, cylinders) styled from brand config
- **First-person walkthrough**: PointerLockControls + WASD with AABB wall collision and sliding response
- **Orbit view**: dollhouse view with ceiling auto-hidden
- **Plan overlay**: toggle parsed walls as wireframe on the floor (press `P`)
- **Brand config**: two style presets (Warm Timber, Cool Concrete) -- same geometry, different materials

### JSON Contract (`schema/`)
All spatial values in millimeters. Walls defined as start/end segments with thickness. Openings positioned as fractions along their parent wall. Rooms as independent polygons. Furniture with type, position, rotation, and dimensions.

## Quick Start

### Viewer
```bash
cd primax/viewer
npm install
npm run dev
# Opens at http://localhost:3000
```

Controls:
- **Click** to enter FPS mode, **ESC** to exit
- **WASD** to move, **mouse** to look
- **P** to toggle plan overlay
- **V** to toggle orbit/FPS view
- Bottom bar: plan selector, view toggle, plan overlay, style preset

### Parser
```bash
pip install anthropic
cd primax/parser

# Parse a floor plan image
python parse.py plan.png -o output.json

# Validate a parsed plan
python validate.py output.json
```

Requires `ANTHROPIC_API_KEY` environment variable.

## Demo Plans

- **Sanctuary Quarter 1.01** -- 3-bedroom apartment from Bathla's Rouse Hill development. 97m2 internal, two terraces. Hand-traced from the actual marketing floor plan.
- **Sample 2-Bed** -- hand-written 2-bedroom apartment for development testing.

Both render in the viewer with furniture, openings, and brand config support.

## What We'd Build Next

1. **Production CV parser** -- hybrid VLM + classical CV pipeline for higher coordinate accuracy
2. **Auto-extracted style configs** -- parse project renders to derive material palettes automatically
3. **Orchestration layer** -- batch processing across hundreds of lots with eval gating
4. **glTF furniture library** -- replace procedural primitives with curated, brand-matched 3D models
5. **PBR texture pipeline** -- Polyhaven textures with proper UV tiling for photorealistic materials
6. **Multi-storey support** -- stacked floor plans with stairwell/elevator connections

## Architecture

```
primax/
  parser/
    parse.py              # VLM parser (Claude API)
    validate.py           # Geometric validator + scoring
    prompt.txt            # Extraction prompt template
    requirements.txt
  viewer/
    src/
      main.js             # Scene setup, animation loop, UI wiring
      geometry.js          # Procedural walls, floors, ceilings, openings
      materials.js         # PBR materials + brand config
      controls.js          # FPS + orbit controls with AABB collision
      overlay.js           # 2D plan overlay on floor
      furniture.js         # Procedural furniture primitives
    public/
      data/               # Parsed floor plan JSONs
      styles/             # Brand config presets
  schema/
    floorplan.schema.json  # JSON contract specification
```

## The Pitch

Generative tools give you a pretty picture of *a* unit. PRiMAX gives you the *actual* unit -- walkable, measurable, configurable. The floor plan is overlaid on the 3D floor so you can see geometric accuracy directly. The same lot renders in different project styles with a config swap. The eval runs unsupervised on every output. For a platform tracking buyer behaviour in the actual unit, correctness beats polish.
