export type DateKind = 'expiry' | 'manufacturing' | 'best-before' | 'unknown';
export interface DateCandidate { raw: string; context: string; kind: DateKind; }

const DATE_PATTERNS = [
  /\b(?:0?[1-9]|[12]\d|3[01])[/.\-](?:0?[1-9]|1[0-2])[/.\-](?:20)?\d{2}\b/g,
  /\b(?:20\d{2})[/.\-](?:0?[1-9]|1[0-2])[/.\-](?:0?[1-9]|[12]\d|3[01])\b/g,
  /\b(?:0?[1-9]|[12]\d|3[01])\s*[- ]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[- ,]?\s*(?:20)?\d{2}\b/gi,
  /\b(?:0[1-9]|1[0-2])[/.\-](?:20)?\d{2}\b/g,
  /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(?:20)?\d{2}\b/gi,
];

function classify(context:string):DateKind {
  const s=context.toLowerCase().replace(/[.:]/g,' ');
  if (/best\s*before|use\s*within/.test(s)) return 'best-before';
  if (/exp(?:iry|iration)?\s*(?:date|dt)?|use\s*by|expires|expiry|valid\s*until/.test(s)) return 'expiry';
  if (/mfg|manufactur(?:ed|ing)?|packed\s*on|pkd|date\s*of\s*manufacture/.test(s)) return 'manufacturing';
  return 'unknown';
}

export function extractDateCandidates(text:string):DateCandidate[] {
  const found:DateCandidate[]=[];const seen=new Set<string>();
  for(const pattern of DATE_PATTERNS){
    pattern.lastIndex=0;
    for(const match of text.matchAll(pattern)){
      const raw=match[0],index=match.index??0;
      const context=text.slice(Math.max(0,index-64),Math.min(text.length,index+raw.length+64)).replace(/\s+/g,' ').trim();
      const key=raw.toLowerCase();
      if(!seen.has(key)){seen.add(key);found.push({raw,context,kind:classify(context)});}
    }
  }
  const rank=(kind:DateKind)=>kind==='expiry'?0:kind==='best-before'?1:kind==='manufacturing'?2:3;
  return found.sort((a,b)=>rank(a.kind)-rank(b.kind));
}
export function firstTextValue(text:string,pattern:RegExp):string {
  return text.match(pattern)?.[1]?.trim()??'';
}
