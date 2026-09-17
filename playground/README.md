# Kinematic building blocks

Open **`building_blocks.html`** in a browser. Building compositions, saving
functions, and importing unmodified playground exports work offline. Importing
an external Python function downloads a Python/SymPy runtime on first use.
You can also preview the playground from the repository root:

```sh
python3 -m http.server 8000
```

Then visit `http://localhost:8000/playground/building_blocks.html`.

## Save and share operations

**Download operations** saves the canvas, connections, symbolic values, selected
output, and all reusable operations in **My blocks** as one JSON file.
**Upload operations** restores it. Older graph JSON files still open. Uploading
keeps existing saved blocks and adds imported definitions; undo restores the
previous graph and library if needed. Invalid files leave the current work intact.

Use **Download blocks** and **Upload blocks** to share My blocks on its own.
An individual saved block's menu also offers **Download block (.json)**.

## Vector addition, subtraction, scalar multiplication, and matrix operations

- **Row vector / Column vector:** add a 1 × n or m × 1 vector, then choose its
  length and enter its components in the inspector.
- **Matrix:** choose m rows and n columns (1–12 each), then enter values directly
  in the m × n grid. Resizing preserves entries in the overlapping cells.
  Entries can be numbers or symbolic expressions. A general matrix connection
  multiplies the actual matrix dimensions.
- **Cross product:** choose two 3 × 1 outputs as **A** and **B**, either in the
  inspector or using the labelled ports. The result is **A × B**.
- **Scalar multiplier:** connect a vector or matrix as A and enter a Scalar factor
  k (a number, symbol, or expression). The result is k · A, entry by entry, with
  the same dimensions. Symbols remain local to the multiplier block.
- **Add vectors:** choose matching row or column vectors as A and B to calculate
  A + B. Both vectors must have the same length, orientation, and reference frame.
- **Subtract vectors:** choose **A** and **B** to calculate **A − B** entry by
  entry. Both inputs must be row vectors or both column vectors, with the same
  length and reference frame. The result keeps their orientation.
- **Select columns:** choose a source output and column number for each output
  column. Set a common first row and number of rows. Columns may come from
  different blocks and can repeat. All row/column indices start at 1. The live
  output's **Select columns** button starts with that output already connected.
  For a transform's position, choose column 4, first row 1, and 3 rows.
- **Stack rows:** place A above B. For an angular-first twist, choose ω as A and
  v as B, producing the six-component column `(ω; v)`.
- **Determinant:** connect a square matrix. The result is a scalar; a rectangular
  matrix displays an error with its dimensions. Symbolic expressions and numeric evaluation are
  supported, including singular matrices and small nonzero determinants.

The live output starts minimized to give the canvas more space. Choose
**Expand output** to inspect the result and **Collapse output** to collapse it.
An invalid operation shows **Show error** while the panel is minimized.

Each input port accepts one source; one output may feed several input ports.
Select a block on the canvas to edit its inputs in the right panel. To save a calculation
with several inputs as a reusable function, select its final output block;
**Save as function** includes all upstream operands.

Completed Add, Subtract, Scalar multiplier, Cross product, Select columns, and
Stack rows calculations are immediately replaced by their editable vector or
matrix result. The operation's exclusive input blocks and connections disappear;
sources that also feed another calculation stay available. The result preserves
outgoing connections and numeric precision. Undo restores the operation and inputs.


## Math inputs and block values

Enter Greek names such as `theta_2` and `alpha_2`, Unicode Greek letters, or
LaTeX such as `\phi_{12}`. All Greek letters, uppercase forms, and common variants
are supported. Fields show mathematical notation when unfocused and a live
preview while editing. Expressions also accept `\pi`, `\sin`, `\sqrt{...}`,
`\frac{...}{...}`, and braced powers.

Every canvas block owns its symbols. A name already used by another block is
automatically renamed (for example, `theta` becomes `theta_2`). Repeated uses
within one block keep the same symbol. Numeric values appear only for the
selected block; select an upstream block to change its values. Saved functions
keep their internal parameter scope, while each instance has independent
arguments. Copying, combining, exporting, and saving retain these names.

The **Operation blocks** and **Live output** disclosures use large red **+ / −**
controls. Their open/closed preferences are saved on this device.

## custom_3R student templates

Choose either custom_3R preset under **Templates & examples**. Both use the exact
[`custom_3R.urdf`](../lectures_main/assets/models/custom_3R/custom_3R.urdf), including
the fixed `tool0` offset. They return the pose of `tool0` in `base_link`, with
symbolic `q1`, `q2`, `q3` initially unset. Enter zero radians to evaluate the home pose. Distances are metres.

- **PoE forward kinematics:** three space screw exponentials followed by the
  home transform `M`. The home orientation is identity and the home position is
  `(4.5, 1.25, 1.25)`. The screws `(omega; v)` in `base_link` are
  `(0,0,1; 0,0,0)`, `(0,1,0; -1,0,1)`, and `(0,0,1; 1.25,-3,0)`.
- **D-H forward kinematics:** three 4×4 blocks named `^0T_1`, `^1T_2`, `^2T_3`.
  Select any matrix and press **Ctrl/Cmd+E** to see
  `Rz(q_i) → Tz(d_i) → Tx(a_i) → Rx(alpha_i)`. Expansion makes room for the
  added operations and can be undone.

| i | theta | d | a | alpha |
|---|---|---|---|---|
| 1 | q1 | 1 | 1 | −pi/2 |
| 2 | q2 | 1.25 | 2 | pi/2 |
| 3 | q3 | 0.25 | 1.5 | 0 |

Here `d1 = 1` includes both 0.5 m URDF origin heights. Intermediate D-H frames
differ from the URDF link frames, while the final frame is exactly `tool0`.
The table above lists the starting parameters. Change the joint values, expand
the operations, or save the final
output as a reusable FK function. **Download operations** keeps an editable copy;
reselecting a preset restores the starting template.

## Build a composition

- Drag a rotation, translation, homogeneous transform, or screw exponential from
  the toolbar. Clicking a toolbar item also adds a block.
- Edit numbers or symbols in the inspector. Expressions support `pi`, `+`, `-`,
  `*`, `/`, `^`, `sin`, `cos`, `tan`, `sqrt`, `acos`, and `atan2`.
- Drag an output port to an input port, or click the two ports in succession.
  One output may feed multiple blocks. Each input accepts one connection.
  Larger ports and nearby-target snapping help connect blocks: a valid nearby
  port highlights and the line snaps to its centre before you release it.
- Select any block to see the result accumulated up to that point. Enter a symbol
  or a number directly in each input; there are no separate substitution fields.
  Legacy saved substitutions are moved into the corresponding inputs when loaded.
- Right-click a block to edit it, save a reusable function, or expose its
  commented Python functions.
- Download operations saves editable JSON; Upload operations restores it. The latest graph is also
  saved in this browser’s local storage. Undo/redo includes edits and connections.

The palette includes inverse and matrix-to-screw operations. The exponential
block toggles between its exponential notation and its matrix form. Matrix to
screw produces coordinates `(omega, v, theta)`; enter those coordinates into an
exponential block to compose that motion.

## Select, combine, and reuse

- **Shift-, Ctrl-, or Cmd-click** a block to add or remove it from the selection.
  Drag empty canvas space to draw a selection box. Shift-drag adds to the current
  selection. Drag anywhere on a selected block's header, body, or footer to move
  the selection together. Buttons and connection ports retain their own actions.
- Hold **Space** and drag to pan, or choose the Pan tool. Scroll to zoom.
  **Ctrl/Cmd+A** selects all blocks; **Ctrl/Cmd+K** combines the selection.
- **Combine** replaces consecutive connected operations with one named function
  block and preserves the connections at its input and output. Choose a display
  name such as `^0T_1`, `^{0}T_{1}`, or `forward_kinematics`. Select one chain;
  branches within the selection and external connections from intermediate
  selected blocks cannot be combined.
- Function arguments remain editable numbers, symbols, or expressions such as
  `q1`, `pi/4`, and `2*q2`. A function retains the angle units in which it was
  created, independently of the canvas angle setting. Numeric example values do
  not turn its symbolic arguments into constants.
- **Ctrl/Cmd+E**, or **Expand individual blocks** in the block’s context menu, restores the operations inside a function
  made from canvas blocks. A function imported as a matrix has no internal block
  graph to expand. For a symbolic screw axis, expansion may require matching the
  canvas units to the saved function's units.
- **Save function** adds the selected chain to **My blocks**. With one block
  selected, it includes that block's upstream operations. Click or drag a saved
  function onto the canvas to create another instance with its own arguments.
  My blocks is stored in this browser. Download it as JSON or export a function
  as Python to share it; workspace JSON also includes all saved definitions.

**Arrange & fit** in the canvas controls lays out connected blocks from left to
right, spaces branches apart, and groups disconnected calculations into rows. It
then fits all blocks in the visible canvas. Ctrl+Z restores the previous positions
and view. **Fit** adjusts only the view.

Canvas shortcuts (use Cmd on macOS):

| Shortcut | Action |
|---|---|
| Ctrl+C / Ctrl+V | Copy / paste selected blocks and their internal connections |
| Ctrl+X | Cut selected blocks |
| Ctrl+D | Duplicate the selection |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+K | Combine selected blocks (Ctrl+G also works) |
| Ctrl+E | Expand the selected function |
| Ctrl+Shift+M | Tuck selected input blocks inside their receiving operation / restore full size |
| Ctrl+Shift+F | Arrange all blocks by their connections and fit them on screen |
| Ctrl+A | Select all blocks |
| Ctrl+S | Download operations |
| Delete / Backspace | Delete selected blocks |

Minimized inputs tuck inside the first connected, expanded operation beside their
matching input port. They move with that operation; restoring or disconnecting
them returns them to their original position. Other outgoing connections remain
intact. Unconnected blocks stay as compact squares on the canvas.

The floating panel shows only the selected block’s direct inputs and relevant
angle units. It starts hidden; click a block or press Enter on a focused block to
open it. Drag its header to move it. Close it with ×, Escape, or a click on empty
canvas. Each component accepts either a symbol or a value, including zero.
Block actions are available
through canvas controls, context menus, and shortcuts.

Text fields retain their native editing shortcuts. Pasted blocks use independent
symbols and preserve their copied numeric values. When pasting across canvases,
match their angle-unit setting first.

Delete removes the selection; Ctrl/Cmd+Z undoes a change. Right-click a connection
to disconnect it. Matrix-to-screw results remain terminal coordinates and cannot
be saved as reusable matrix functions.

## Mathematical conventions

Vectors are columns. A connection **A → B computes A B**, so the rightmost
matrix acts first when the product is applied to a point. Connecting a rotation
to a translation yields `[R, R p; 0, 1]`; reversing their order yields
`[R, p; 0, 1]`. Mixed compositions automatically become 4×4 homogeneous matrices.
Two translations add their vectors; two rotations retain a 3×3 output.

The D–H example is the standard sequence
`Rz(theta) Tz(d) Tx(a) Rx(alpha)`. The PoE example uses fixed home-frame screws
and a home transform `M`. The same reference frame must be used for an
operation’s axis and vector coordinates; compatible coordinate transforms obey
`T_AB T_BC = T_AC`.

Screws use angular components first: `xi = (omega, v)`. For a unit rotational
axis, theta is an angle; for `omega = 0`, theta is a translation parameter and
is unaffected by the angle-unit setting. The matrix logarithm requires a numeric
rigid transform and returns a principal rotational angle in radians between
zero and pi. At identity it returns zero motion. A screw axis at pi has an
equivalent opposite-sign representation.

Numeric evaluation substitutes values before evaluating each operation, including
the pure-translation case of a symbolic angular screw becoming zero. Symbolic
output uses elementary simplification rather than a full computer algebra system;
large expressions report a size limit. Numeric evaluation remains available.

Trigonometric expressions such as `sin(pi/2)` always take radian arguments. The
canvas angle setting applies to rotation angles and rotational screw parameters,
not to arbitrary expressions inside matrix entries.

Reference: [Modern Robotics, §3.3.3 — Exponential coordinates of rigid-body motion](https://modernrobotics.northwestern.edu/nu-gm-book-resource/3-3-3-exponential-coordinates-of-rigid-body-motion/).

## Export Python functions

Exported scripts use **SymPy** for readable symbolic matrix operations. Extracting
a numeric screw also uses **NumPy**. The Python dialog offers:

- **This block's function:** a callable for the selected operation. An inverse
  or matrix logarithm includes its input chain so it can be called independently.
- **Composed function:** a named callable that invokes the individual block
  functions in order. Nested reusable functions remain callable functions.

Parameters are ordinary function arguments, so the same `FK(q1, q2)` can be
called at different joint configurations. Enabling numeric values changes only
the example under `if __name__ == "__main__":`; importing the file does not run
that example. Display names are converted to valid Python identifiers—for
example, `^0T_1` becomes `fn_0T_1`.

Exported matrix functions include a footer containing their reusable definition
and a fingerprint of the Python source. **Import Python** restores an unmodified
playground export offline, including its parameters, defaults, and internal
blocks. An edited source file with its old footer is rejected because the code
and saved definition no longer match. Re-export the function, or remove the
footer and explicitly import the edited file as external Python. A terminal
matrix-to-screw export has no reusable-matrix footer.

## Import external Python

Open **Import Python**, load a `.py` file or paste its source, choose the function,
and import it as a block. External extraction runs in a browser worker and needs
an internet connection to load Python and SymPy on first use. It evaluates the
function with symbolic arguments, then saves the resulting matrix as a reusable
function; later use of that block is local.

The importer supports a subset of NumPy, SymPy, and `math` suitable for symbolic
kinematics. Use a plain top-level function with independent scalar parameters and
return a 3×3 rotation, 3×1 translation, or 4×4 homogeneous matrix. Keep helper
functions and constants in the same file. Supported expressions include ordinary
arithmetic, `pi`, `sin`, `cos`, `tan`, `sqrt`, `acos`, and `atan2`, together with
supported matrix constructors and matrix multiplication. For example:

```python
import sympy as sp

def turn_and_translate(q, a):
    c, s = sp.cos(q), sp.sin(q)
    return sp.Matrix([
        [c, -s, 0, a*c],
        [s,  c, 0, a*s],
        [0,  0, 1,   0],
        [0,  0, 0,   1],
    ])
```

This is a symbolic matrix extractor, with these boundaries:

- Vector-valued parameter inputs, `*args`/`**kwargs`, numeric-only casts, and
  branches that depend on joint values cannot be extracted.
- Imports are limited to the supported NumPy/SymPy/`math` operations. Other
  packages, classes, decorators, file access, and network operations are outside
  this importer. It does not provide full NumPy or arbitrary Python compatibility.
- Every free symbol in the result must be a declared scalar parameter. Matrix
  entries must be real, finite expressions of at most 500 characters.
- Files are limited to 1 MB. Extraction has a time limit and can be cancelled;
  simplify a function that takes too long. Runtime loading also has a timeout.

## Checks

Run the math, graph, and reusable-function checks with Node.js:

```sh
node --test playground/tests/math.test.cjs playground/tests/graph.test.cjs playground/tests/functions.test.cjs playground/tests/presets.test.cjs playground/tests/files.test.cjs playground/tests/iiwa-twists.test.cjs
```

The Python export and import checks execute Python and require `python3`, SymPy,
and NumPy:

```sh
node --test playground/tests/python.test.cjs playground/tests/python-import.test.cjs
```

The operations browser check uses a disposable browser context and verifies the
KUKA example, input connections, column selection, determinants, and JSON
download/upload through the interface:

```sh
OPERATIONS_BASE_URL=http://localhost:8000 OPERATIONS_CDP_PORT=9222 node playground/tests/operations.browser.cjs
```

Files are separated into the expression/matrix engine (`math.js`), graph and
function model (`graph.js`), JSON persistence (`files.js`), custom_3R templates (`presets.js`), Python generator (`python.js`), Python importer
(`python-import.js`), and canvas/inspector UI (`app.js`).

The symbol/shortcut browser check covers Greek rendering, block-specific values,
collapsible panels, copy/paste/cut, duplicate, undo/redo, combine and expand:

```sh
OPERATIONS_BASE_URL=http://localhost:8000 OPERATIONS_CDP_PORT=9222 node playground/tests/symbols-shortcuts.browser.cjs
```

The layout checks cover branches, measured block sizes, disconnected calculations,
undo/redo, viewport bounds, and the Arrange & fit shortcut:

```sh
node --test playground/tests/layout.test.cjs
OPERATIONS_BASE_URL=http://localhost:8000 OPERATIONS_CDP_PORT=9222 node playground/tests/layout.browser.cjs
```

The floating-input checks cover opening/closing, header dragging, empty numeric
defaults, explicit zeros, and viewport bounds:

```sh
OPERATIONS_BASE_URL=http://localhost:8000 OPERATIONS_CDP_PORT=9222 node playground/tests/floating-inputs.browser.cjs
```
