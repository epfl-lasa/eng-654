# Authoring guide

## Layouts

Use these reusable classes:

- `layout-center`
- `layout-two-column`
- `layout-three-column`
- `layout-40-60`
- `layout-60-40`
- `layout-full`
- `layout-visual-full`

Modifiers:

- `tight-gap`, `medium-gap`, `loose-gap`
- `divided`
- `bleed-right`, `bleed-left`
- `shift-up`, `shift-left`, `shift-right`

## Figures

Use `technical-figure` for plots, diagrams, equations-as-images, and CAD screenshots where the entire image must remain visible.

Use `photo` for photographs where cropping is acceptable.

## Equations

MathJax is enabled. Use:

```html
<p>Inline math: \(q \in \mathbb{R}^n\).</p>

<div class="equation">
\[
T(q)=e^{[S_1]q_1}\cdots e^{[S_n]q_n}M
\]
</div>
```

### Notation-first rule

Declare every symbol and index convention on a slide before the first slide that uses it.
For frame notation, explicitly define:

- what each frame label means;
- whether a bold symbol represents a point coordinate, direction vector, or translation;
- what left superscripts and right subscripts identify;
- the source and destination frames of every rotation or transformation matrix.

## Step-by-step reveals

Add `reveal-children` to a grid/flex container:

```html
<div class="layout-three-column reveal-children">
  <div>Step 1</div>
  <div>Step 2</div>
  <div>Step 3</div>
</div>
```

In deck mode, arrow/space reveals each child before advancing the slide.

## 2D robot visualization

```html
<div data-robot2r data-q1="45" data-q2="60" data-trace="true"></div>
```

The 2D math convention is y-up. Internally, the visualizer flips y only at drawing time.
The default `data-trace-mode="fading"` keeps the latest 250 path points. Use
`data-trace-mode="persistent"` to retain the complete end-effector path, for example
when tracing a workspace boundary. The on-screen path button can switch modes live.
Set `data-fading-path-length` to customize the fading trail length.
Slider motion uses critically damped interpolation so abrupt input still produces a smooth
end-effector path. Set `data-smooth-time` in seconds to adjust its responsiveness (default `0.12`).
Each joint can be configured with either its slider or the synchronized numeric degree input.

## 3D revolute joint demo

```html
<div data-three-revolute></div>
```

The 3D robotics convention is z-up. The module creates a root group rotated by `-Math.PI/2` about x.
