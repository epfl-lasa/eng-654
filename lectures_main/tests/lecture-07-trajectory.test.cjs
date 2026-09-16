const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let trajectory;
before(async () => { trajectory = await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(__dirname+'/../js/viz/minimumJerk.js','utf8')).toString('base64')); });

test('minimum-jerk trajectory satisfies all six boundary conditions and forward progress', () => {
  for (const T of [.4,1,3,8]) {
    const a=trajectory.minimumJerkState(0,T),b=trajectory.minimumJerkState(T,T);
    assert.equal(a.s,0);assert.equal(b.s,1);
    assert.equal(a.velocity,0);assert.equal(b.velocity,0);
    assert.equal(a.acceleration,0);assert.ok(Math.abs(b.acceleration)<1e-13);
    for(let i=0;i<=100;i++){const t=T*i/100,s=trajectory.minimumJerkState(t,T);assert.ok(s.velocity>=0);assert.ok(Math.abs(trajectory.minimumJerkTime(s.s,T)-t)<1e-8);}
  }
});

test('analytic velocity, acceleration and jerk agree with finite differences', () => {
  const T=2.7,h=1e-5;
  for(let t=.2;t<T-.1;t+=.17){
    const a=trajectory.minimumJerkState(t-h,T),b=trajectory.minimumJerkState(t+h,T),v=trajectory.minimumJerkState(t,T);
    assert.ok(Math.abs((b.s-a.s)/(2*h)-v.velocity)<1e-8);
    assert.ok(Math.abs((b.velocity-a.velocity)/(2*h)-v.acceleration)<1e-8);
    assert.ok(Math.abs((b.acceleration-a.acceleration)/(2*h)-v.jerk)<1e-8);
  }
});

test('jerk cost is 720 L²/T⁵ and every tested admissible polynomial perturbation increases it', () => {
  // eta(u)=u^3(1-u)^3 leaves position, velocity and acceleration fixed at both ends.
  const etaThird=u=>6-72*u+180*u*u-120*u*u*u;
  const integrate=f=>{const n=2000;let sum=f(0)+f(1);for(let i=1;i<n;i++)sum+=(i%2?4:2)*f(i/n);return sum/(3*n);};
  const T=3,L=1.4,base=integrate(u=>(L*trajectory.minimumJerkState(u*T,T).jerk)**2)*T;
  assert.ok(Math.abs(base-trajectory.minimumJerkCost(L,T))<1e-9);
  for(const amount of [-2,-.3,.1,1]){const cost=integrate(u=>(L*trajectory.minimumJerkState(u*T,T).jerk+amount*etaThird(u)/T**3)**2)*T;assert.ok(cost>base);}
});
