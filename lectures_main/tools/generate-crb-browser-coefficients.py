#!/usr/bin/env python3
"""Rebuild the browser coefficient evaluator from the supplied Rust expressions.

No symbolic solver runs in the browser: this translates the generated fixed-
geometry recipe to BigInt fixed-point operations, keeping rational constants.
"""
import ast,re,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'assets/abb_irb_ik/src/coefficients.rs').read_text()
s=s.split('let [c2, cx, cy, cz, xz, yz] = values;')[1].split('    vec![')[0]
def js(n):
 if isinstance(n,ast.Name): return n.id
 if isinstance(n,ast.Constant): return f'({n.value}n*SCALE)'
 if isinstance(n,ast.UnaryOp): return f'(-{js(n.operand)})'
 if isinstance(n,ast.BinOp):
  a,b=js(n.left),js(n.right)
  if isinstance(n.op,ast.Add):return f'({a}+{b})'
  if isinstance(n.op,ast.Sub):return f'({a}-{b})'
  if isinstance(n.op,ast.Mult):return f'mul({a},{b})'
  if isinstance(n.op,ast.Div):return f'div({a},{b})'
  if isinstance(n.op,ast.Pow):return f'mul({a},{a})'
 raise ValueError(ast.dump(n))
out=['// Generated from the supplied Rust CRB15000 coefficient recipe.','// 160 fractional bits preserve cancellations in the degree-16 elimination.','export const SCALE=1n<<160n;','export const mul=(a,b)=>(a*b)/SCALE;','export const div=(a,b)=>(a*SCALE)/b;','export function fixed(x){const [m,e="0"]=String(x).toLowerCase().split("e");const sign=m.startsWith("-")?-1n:1n;const parts=m.replace(/^[+-]/,"").split(".");const digits=BigInt(parts.join(""));const exp=Number(e)-(parts[1]?.length||0);return sign*(exp>=0?digits*10n**BigInt(exp)*SCALE:digits*SCALE/10n**BigInt(-exp));}','export function coefficients([c2,cx,cy,cz,xz,yz]){']
for name,exp in re.findall(r'let (\w+)\s*=\s*(.*?);',s,re.S):
 exp=exp.replace('Float::with_val(precision,','(').replace('_i64','').replace('&','')
 exp=re.sub(r'(\w+)\.square_ref\(\)',r'(\1**2)',exp)
 exp=' '.join(exp.split())
 out.append(f' const {name}={js(ast.parse(exp,mode="eval").body)};')
out.append(' return ['+','.join(f'mul(constant_8,u_{i})' for i in range(17))+'];\n}')
(root/'js/viz/abbCrbCoefficients.js').write_text('\n'.join(out)+'\n')
