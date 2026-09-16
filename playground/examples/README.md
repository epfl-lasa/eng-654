# Exercise 01: KUKA iiwa 7 twists

[Download the worked graph](exercise-01-iiwa7-twists.json), open [Building Blocks](../building_blocks.html), and choose **Upload operations** to upload the JSON. You can also click **Load example** in the playground. It contains every operation and needs no additional model upload. Use **Go to a block** to inspect individual inputs and results; use **Numeric** for decimal values.

The graph solves the seven space screws and the home tool transform in Exercise 01, Part 2. It uses the exact joint origins and positive axes from [the supplied KUKA iiwa 7 URDF](../../lectures_main/assets/models/iiwa7/kuka_iiwa7_misaligned.urdf). All joints remain at their declared zero values. Visual and collision origins are not kinematic transforms.

## Follow the operations

Each of the seven columns on the canvas derives one screw:

1. Multiply the joint-origin transforms from `world` to joint frame `J_i`. Each Transform block contains its **local** URDF origin matrix; its accumulated output is `^worldT_Ji(0)`. The fixed base edge is included. URDF uses `T(x,y,z) Rz(yaw) Ry(pitch) Rx(roll)`.
2. Select rows 1–3 of column 3 to obtain `^worldω_i`. Every declared URDF axis is `[0, 0, 1]`, so this column is the axis rotated into `world`.
3. Select rows 1–3 of column 4 to obtain a point `^worldp_Ji` on that axis.
4. Take the cross product `^worldv_i = ^worldp_Ji × ^worldω_i = −^worldω_i × ^worldp_Ji`.
5. Stack angular first: `^worldξ_i = [^worldω_i; ^worldv_i]`. Select these seven columns to assemble `^worldJ_s(0)`.

The final fixed tool transform produces `M = ^worldT_ee(0)`. Select the block labelled **M** to read all 16 entries. The file opens with the six-by-seven screw matrix selected.

The angular rows of a normalised revolute screw are dimensionless; its linear rows are in metres. Multiplying a screw by its joint rate in radians/second gives angular and linear twist rates. These are space-twist coordinates: the linear part is not the velocity of the tool origin. The tool-origin velocity is `ω × p_ee + v`.

## Check the result

The matrix rows are `ωx, ωy, ωz, vx, vy, vz`; the columns are joints 1 through 7:

```text
^worldJ_s(0) =
[ 0     0     0     0     0     0     0 ]
[ 0     1     0    -1     0     1     0 ]
[ 1     0     1     0     1     0     1 ]
[ 0    -0.34  0     0.74  0    -1.14  0 ]
[ 0     0     0     0     0     0     0 ]
[ 0     0     0     0     0     0     0 ]

M =
[ 1  0  0  0     ]
[ 0  1  0  0     ]
[ 0  0  1  1.266 ]
[ 0  0  0  1     ]
```

The six-by-seven matrix has no determinant. The example selects its first six columns to demonstrate a **square** determinant, which is zero at home. Here all six-by-six minors vanish: only three independent row directions remain, and the home space Jacobian has rank three. A single zero minor alone would not prove that a general six-by-seven matrix is rank deficient.

This is a **playground graph**, not the exercise response JSON. To verify the exercise answers, enter each screw column and the entries of `M` into the corresponding Part 2 response fields, then use the exercise's checks.

## Regenerate and test

From the repository root:

```sh
node playground/examples/generate-iiwa-twists.cjs
node --test playground/tests/iiwa-twists.test.cjs
```

The generator reads the URDF joint graph and writes derivation operations; it does not read the answer key. RPY values within `1e-12` radians of a multiple of `pi/2` are represented by that exact expression, removing floating-point noise in the supplied quarter turns. Other angles and all translations retain their URDF values. The tests compare the graph against the exercise answer key, an independent numeric URDF chain, and forward kinematics away from home.
