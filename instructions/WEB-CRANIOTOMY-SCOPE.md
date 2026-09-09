# Craniotomy exercise — web implementation scope

Hand this file to the web agent. It describes the **screen-based** craniotomy lesson to build in this folder. It is a port of the Unity training in `Unity/sandbox-meta` (`Assets/Scenes/VrTest.unity`), not a new procedure.

**Input:** mouse and touch. No VR, no hand tracking, no grab physics, no passthrough, no Quest placement.

**This repo today:** `model-viewer` orbit of `assets/models/AnatomyHuman.glb` (`index.html`, `js/viewer.js`). Extend that app. Do not start a second viewer.

**GLB owner:** the human exports tools (and any richer anatomy) into this project. Curve JSON already exists in Unity — copy it; do not reverse-engineer paths from screenshots.

---

## 1. Product goal

A trainee completes one ordered craniotomy on a 3D head:

1. Read a card.
2. Press **Continue**.
3. Do that step with click / click-drag.
4. Next card.

They must not peel, drill, or lift bone before earlier steps are done. **Skip** is allowed for testing: it applies the *finished* visual of the current step, then advances (a skipped incision still leaves a cut under the flap).

---

## 2. Out of scope (do not port)

| Unity / VR | Why drop it |
|---|---|
| Meta Interaction SDK grabs, hand poses, controllers | Screen uses click-select + drag |
| Quest Link, passthrough, room chooser, desk placement | Start already at the table |
| Tool rigidbodies, kinematic-while-grabbed, cranial-drill cable sim | Props, not physics toys |
| World-space poke UI, gaze-follow cards | HTML overlay |
| Editor test rigs, FPS / watermark HUDs | Not the lesson |

Keep the **lesson logic**: order, briefing vs working, progress 0→1, skip-completes-visuals, restart.

---

## 3. Session architecture

One procedure sequence. Exactly **one** step is armed at a time.

### Phases per step

| Phase | UI | Interaction |
|---|---|---|
| **Briefing** | Card shows instruction. Title prefix **Instruction**. Continue enabled. This step’s tool is not live (unless Auto continue). | Camera orbit OK. |
| **Working** | Title prefix **In progress**. Continue disabled. | Only this step’s tool / target is interactive. |
| **Complete** | Sequence advances to the next briefing, or the finish card. | |

**Intro exception:** Continue on the welcome card *is* completion. No tool.

**Auto continue (optional):** picking up the current step’s tool while still in briefing is the same as Continue. On web: first click on the highlighted tool while the card is up = Continue + select that tool. Off on the intro card.

**Skip:** wait **10 seconds** on an in-progress card, then show Skip. Skip = jump the current step to its finished visual, then next briefing. Do not leave half-done geometry.

**Restart (finish card only):** reset all progress, visuals, tools to tray, head unlocked, back to intro briefing.

**Sandbox button:** Unity has a no-op placeholder. Omit or disable.

**Progress:** each step reports 0–1. HUD may show `Step N of 7` (intro does not count; display is 1–7).

---

## 4. Ordered steps

Use these instruction strings.

| # | Id | Card copy | Unity type (reference) |
|---|---|---|---|
| 0 | `intro` | Welcome to craniotomy training. You will position and lock the head, then cut, peel, drill, open the bone, and lay the skull cap in the bowl.\n\nRead each card, press Continue, then do that step. Tools stay inactive until you continue. | `ProcedureIntroStep` |
| 1 | `headLock` | Turn the head so the surgical site faces you, then press Lock on the skull clamp. | `HeadLockController` |
| 2 | `incision` | Take the scalpel and draw the incision along the marked curve. | `IncisionController` |
| 3 | `skinFlap` | Grab the bead at the edge of the incision and peel the skin flap along the arc. | `SkinFlapController` |
| 4 | `drill` | Take the cranial drill and bore the four burr holes in order. | `DrillController` |
| 5 | `craniotome` | Take the craniotome and cut round the skull from the first burr hole back to it. | `CraniotomeController` |
| 6 | `boneFlap` | Seat the bone flap elevator at the edge of the cut and lever the skull cap loose. | `BoneFlapController` |
| 7 | `skullCap` | Lift the skull cap off the head and lay it in the sponge bowl. | `SkullCapRemovalController` |

Finish card title: **Procedure complete**. Body: *The procedure is complete. Press Restart to begin a new session from the start.*

---

## 5. Screen interaction model

**Idle camera** (already in the mockup): left-drag orbit, right-drag zoom, Shift-drag pan, Reset view.

**When a tool is selected or a step-drag is active:** do not orbit with the same pointer. Orbit only on empty background, or via a camera-mode toggle.

**Tool select:** click the tray mesh (or a tool-rail thumbnail). Selected tool follows the pointer or stays “in hand” until the step consumes the gesture. Click empty tray / Esc to deselect if the step allows.

**Inactive tools:** visible on the tray, not selectable.

**Pulse:** while briefing or working a tool step, gently pulse that tool. Unity pulses scalpel, drill, craniotome, elevator, and skull cap — not the flap bead or lock button (those stay hidden until armed).

---

## 6. Step specs

### 0 — Intro

Continue completes immediately. No 3D action.

### 1 — Head lock

**Goal:** surgical site faces the camera, then lock.

**Web**

- Drag on the **head** (not the whole scene) to yaw/pitch. Unity uses neck-safe rotation; if limits are unknown, clamp to about ±45° yaw and ±20° pitch.
- Show a **Lock** control (HTML button is fine; a 3D pad on the clamp is better if the mesh exists).
- First lock completes the step. Later unlock/lock is allowed and must **not** rewind the sequence.
- While locked: head cannot be dragged. Unlock re-enables drag.
- After this step, later steps that need the scalp must not steal “head grab” — only the lock control remains.

**Skip / complete:** snap locked.

### 2 — Incision (scalpel)

**Unity behaviour to preserve**

- Progress along **Incision Curve** (open spline), 0 at start → 1 at end.
- Only advances while the blade is near the curve and moving **forward** along it. No teleport to the end.
- Completes at **≥ 0.99**.
- Rate limit: about **8 cm/s** along the curve.
- Visual: cut line grows along the *same* spline.
- Marker at current progress.

**Web**

1. Click **scalpel**.
2. Pointer-down near the curve start (or current progress).
3. Drag along the marked curve. Progress = closest point on the spline within a generous radius, **forward only** (Unity incision does not rewind).
4. Release parks progress. Resume from there.
5. At 0.99, complete; freeze the cut line.

Do **not** require a 60° heading cone on mouse. Proximity + forward drag is enough.

**Guides (optional v1):** Unity plays a ghost scalpel on the curve until the user engages. Nice to have.

### 3 — Skin flap

**Unity**

- Bead at the flap tip (`bn_skinflapchain_tip` / Skin Flap Grab Point). Hidden and non-interactive until this step (a live volume would block the scalpel).
- Pull along **Hand Guide Skin Flap**. Looser than the incision. **Rewind allowed**.
- Completes at **≥ 0.95**, then latch: bead gone.
- Pose: `anim_LiftSkinFlap` scrubbed by progress. The flap must not play independently of progress.

**Web**

1. Pointer-down on the **bead** at the incision edge.
2. Drag along the arc spline. Flap mesh/bones follow progress.
3. Drag back closes the flap until latched.
4. At 0.95, latch open; bead disappears.

If the anatomy GLB has no flap animation, **block this step** until a GLB with the lift clip or morph is exported. Do not fake a disappearing patch.

### 4 — Burr holes (cranial drill)

**Unity**

- Four targets, **in order**: `skull_drill_hole_01` … `_04`.
- Capture: tip near the hole and bit roughly along the hole’s +Z. Then constrain to that axis.
- Plunge along the axis to about **12 mm**. High-water mark (pulling out does not undo depth).
- Rate-limit the plunge.
- Withdraw past the mouth: if through → hide that hole visual, arm the next; if not through → keep depth, hunt again.
- Ghost drill in the current hole while hunting. Highlight the current hole.
- Step progress = holes finished / 4. Completes when hole 4 is withdrawn through.

**Web**

1. Click **drill**.
2. Click (or drag onto) **hole 1** to seat.
3. Drag **into** the skull (or a depth control) until through.
4. Drag **out** to finish the hole.
5. Repeat 2–4 for holes 2–4. Clicking hole 3 first does nothing.

**Skip:** all four holes through / hidden, next card.

### 5 — Craniotome

Same interaction pattern as the incision, different spline.

- Spline: **SkullCap Spline** — closed loop **re-cut open at hole 1**. Start and end are the same world point (`skull_drill_hole_01`). Progress 0→1 is one full circuit.
- Search window is **arc length from current progress** so the tool cannot jump the seam by touching the far end.
- Completes at **0.99**. Rate limit similar to the scalpel.
- Visual: kerf grows on that spline.

**Web:** click craniotome, drag around the skull from hole 1 back to hole 1. Forward only.

### 6 — Bone flap elevator

**Unity**

- Tool seats at `pos_bone_flap_elevator_StartPose` (ghost until seated).
- Seat: tip near the start pose and orientation close enough.
- Then **one parameter** `t` 0→1 interpolates elevator Start→End **and** SkullCap `pos_bone_flap_StartPose` → `pos_bone_flap_EndPose`. Input is **sweep around the hinge**, not push along it.
- Pulling back can close until complete. At `t = 1` the cap is released for the next step.

**Web**

1. Click **elevator**.
2. Click the ghost / cut edge to seat (or drag near it until it snaps).
3. Drag in the lever direction (map the screen gesture to hinge angle) to open.
4. At 1.0, latch open.

**Skip:** snap elevator + cap to end poses.

### 7 — Skull cap into bowl

**Unity**

- Cap not selectable until this step.
- First pickup un-parents from the head.
- Seat if released (or on contact) near `SkullCap_Placement` inside `spongeBowl` (about 5 cm in VR).
- Drop elsewhere: cap stays there; pick up again.
- Marker on the placement while the step is live; hide when seated.

**Web**

1. Click the **hinged cap**.
2. Drag to the **bowl**.
3. Release (or overlap) on the target to snap in. Miss = leave it in the scene, try again.

**Skip:** cap snapped in the bowl.

---

## 7. Assets

### GLBs (human exports)

| Asset | Role |
|---|---|
| `AnatomyHuman.glb` | Head, scalp, holes `skull_drill_hole_01..04`, skin flap chain, `SkullCap`, pose empties, optional clamp |
| `Scalpel.glb` | Incision |
| `cranial drill.glb` | Burr holes (prefer pivot = bit tip, +Z into bone) |
| `Craniotome.glb` | Skull cut (name the footplate / tip) |
| `boneFlapElevator.glb` | Lever (prefer pivot = working tip) |
| `spongeBowl.glb` | Cap target |

Keep **node names** from Unity / Blender. The web agent will pick by name.

Anatomy GLB should include, if possible:

- Head bone / mesh for rotate-lock
- Skin flap bones or `anim_LiftSkinFlap`
- `SkullCap` as a separate movable node
- Empties: `pos_bone_flap_*`, `SkullCap_Placement`
- Optional guides: `guide_skin_incision`, `guide_skin_flap`

### Curve JSON (copy from Unity)

```
Unity/sandbox-meta/Assets/Resources/Curves/incision-curve.json
Unity/sandbox-meta/Assets/Resources/Curves/hand-guide-skin-flap.json
Unity/sandbox-meta/Assets/Resources/Curves/skullcap-spline.json
```

Format: `{ "name", "closed", "points": [{ "x", "y", "z" }] }`.

**Skull cap spline:** Unity re-cuts the closed loop so knot 0 is nearest `skull_drill_hole_01`, duplicates that knot at the end, and leaves the spline **open**. Web must do the same or progress will jump the seam.

Curves were authored in an export space; in Unity they inherit the **Incision Curve** parent transform. If they look offset on the web head, apply the same parent TRS as the incision host, or bake points into anatomy space in a one-off convert.

### Audio (optional v1)

VO per briefing under `Unity/sandbox-meta/Assets/Audio/VO/`:

`intro`, `head_lock`, `incision`, `skin_flap`, `drill`, `craniotome`, `bone_flap`, `skull_cap`, `complete` (`.wav`).

SFX: tool pickup/drop, cut/peel/drill/lever loops, hole-complete, seat, flap-loose, cap-seated, lock/unlock click.

The exercise must work muted.

---

## 8. UI chrome (HTML overlay)

- Step title + body (strings in section 4).
- **Continue** — briefing only (intro: completes).
- **Skip** — working, after 10 s.
- **Restart** — complete card only.
- Optional: progress bar 0–1, hole 1/4, Auto-continue toggle.
- Do not cover more of the 3D view than a card on one side.

---

## 9. Suggested build order

1. Sequence + briefing / working / complete / skip / restart with stub steps (Continue / Skip only).
2. Head drag + Lock.
3. Load three splines, draw them, incision drag + growing cut.
4. Flap bead + progress-driven flap pose.
5. Four holes + drill plunge / withdraw.
6. Craniotome loop.
7. Elevator seat + hinge `t`.
8. Cap drag to bowl.
9. Tool GLBs on a tray + pulse + select.
10. Polish: VO, SFX, ghosts, skip end-states.

---

## 10. Acceptance checklist

- Cannot flap before incision, cannot drill before flap, and so on, without Skip.
- Skip on incision shows a full cut, then the flap is possible.
- Restart returns intro, closed flap, four hole markers, cap on head, tools on tray.
- Incision and craniotome cannot complete in one un-rate-limited frame.
- Drill holes only in 1 → 2 → 3 → 4.
- Craniotome starts at hole 1 and cannot complete by touching the end seam early.
- Cap only selectable after the elevator latches.
- Camera orbit does not steal an active cut / peel / plunge drag.
- Works without a headset. Primary input is mouse; touch should support click-drag.

---

## 11. Unity source of truth (for the web agent)

| File | What it defines |
|---|---|
| `Unity/sandbox-meta/Assets/Editor/ProcedureSequenceSetup.cs` | Step order + instruction copy |
| `Unity/sandbox-meta/Assets/ProcedureSequence.cs` | Briefing, continue, skip, reset |
| `Unity/sandbox-meta/Assets/ProcedureBriefingPanel.cs` | Card UX, skip delay |
| `Unity/sandbox-meta/Assets/IncisionController.cs` | Scalpel cut |
| `Unity/sandbox-meta/Assets/SkinFlapController.cs` | Flap pull |
| `Unity/sandbox-meta/Assets/DrillController.cs` | Four burr holes |
| `Unity/sandbox-meta/Assets/CraniotomeController.cs` | Skull loop cut |
| `Unity/sandbox-meta/Assets/BoneFlapController.cs` | Elevator hinge |
| `Unity/sandbox-meta/Assets/SkullCapRemovalController.cs` | Cap to bowl |
| `Unity/sandbox-meta/Assets/HeadLockController.cs` | Head rotate + lock |
| `Unity/sandbox-meta/Assets/IncisionVisual.cs` | Growing scalp cut |
| `Unity/sandbox-meta/Assets/CraniotomeVisual.cs` | Growing bone kerf |
| `Unity/sandbox-meta/Assets/SkinFlapAnimation.cs` | Flap pose from progress |
| `Unity/sandbox-meta/Assets/Editor/ImportSkullCapSpline.cs` | How the skull loop is re-cut at hole 1 |
