/** Determinant of the URDF geometric Jacobian [v;ω] at tool0.
 * Derived by expressing all columns in the link_3 orientation and using
 * sin²(q3)+cos²(q3)=1. Translation of the evaluation point and frame rotation
 * leave this 6×6 determinant unchanged. q1 and q6 therefore disappear.
 * Each term is coefficient * s2^p0 c2^p1 s3^p2 c3^p3 c4^p4 s5^p5.
 */
const terms=[{"coefficient":0.0459096,"powers":[1,0,2,0,0,1]},{"coefficient":0.0039072,"powers":[1,0,2,0,0,0]},{"coefficient":0.0927072,"powers":[1,0,1,1,0,1]},{"coefficient":0.0166944,"powers":[1,0,1,1,0,0]},{"coefficient":-0.02168496,"powers":[1,0,1,0,0,1]},{"coefficient":0.01577088,"powers":[1,0,0,1,2,0]},{"coefficient":-0.09265392,"powers":[1,0,0,1,0,1]},{"coefficient":-0.01577088,"powers":[1,0,0,1,0,0]},{"coefficient":0.0039072,"powers":[1,0,0,0,2,0]},{"coefficient":-0.0229548,"powers":[1,0,0,0,0,1]},{"coefficient":-0.0039072,"powers":[1,0,0,0,0,0]},{"coefficient":0.0927072,"powers":[0,1,2,0,0,1]},{"coefficient":0.0166944,"powers":[0,1,2,0,0,0]},{"coefficient":-0.0459096,"powers":[0,1,1,1,0,1]},{"coefficient":-0.0039072,"powers":[0,1,1,1,0,0]},{"coefficient":-0.0980796,"powers":[0,1,0,0,0,1]},{"coefficient":-0.0166944,"powers":[0,1,0,0,0,0]}];
export function trigonometricDeterminant(q){const values=[Math.sin(q[1]),Math.cos(q[1]),Math.sin(q[2]),Math.cos(q[2]),Math.cos(q[3]),Math.sin(q[4])];return terms.reduce((s,t)=>s+t.powers.reduce((p,n,i)=>p*values[i]**n,t.coefficient),0);}
/** For q(t)=a+t(b-a), |d(detJ)/dt| ≤ this global bound:
 * apply the product rule to each sine/cosine monomial, using |sin|,|cos|≤1.
 * A positive sampled min|detJ|−L·Δt/2 (with a roundoff allowance) then bounds
 * |detJ| away from zero over the entire straight segment, including its interior.
 */
export function determinantRateBound(a,b){const d=a.map((v,i)=>Math.abs(b[i]-v)),speed=[d[1],d[1],d[2],d[2],d[3],d[4]];return terms.reduce((s,t)=>s+Math.abs(t.coefficient)*t.powers.reduce((v,n,i)=>v+n*speed[i],0),0)*(1+1e-12)+1e-12;}
