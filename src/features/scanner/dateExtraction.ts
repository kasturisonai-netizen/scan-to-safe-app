export type DateKind = 'expiry' | 'manufacturing' | 'best-before' | 'unknown';
export interface DateCandidate { raw: string; context: string; kind: DateKind; }

const DATE_PATTERNS = [
  /\b(?:0?[1-9]|[12]\d|3[01])[/.\-](?:0?[1-9]|1[0-2])[/.\-](?:20)?\d{2}\b/g,
  /\b(?:20\d{2})[/.\-](?:0?[1-9]|1[0-2])[/.\-](?:0?[1-9]|[12]\d|3[01])\b/g,
  /\b(?:0?[1-9]|[12]\d|3[01])\s*[- ]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[- ,]?\s*(?:20)?\d{2}\b/gi,
  /\b(?:0[1-9]|1[0-2])[/.\-](?:20)?\d{2}\b/g,
  /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(?:20)?\d{2}\b/gi,
];

function isPlausibleDate(raw:string):boolean {
  const numeric = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|20\d{2})$/);
  if (numeric) {
    const day=Number(numeric[1]), month=Number(numeric[2]), year=Number(numeric[3].length===2?'20'+numeric[3]:numeric[3]);
    const maxDay=new Date(year,month,0).getDate();
    return month>=1 && month<=12 && day>=1 && day<=maxDay;
  }
  const yearFirst=raw.match(/^(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (yearFirst) {
    const year=Number(yearFirst[1]), month=Number(yearFirst[2]), day=Number(yearFirst[3]);
    return month>=1 && month<=12 && day>=1 && day<=new Date(year,month,0).getDate();
  }
  // Month/year forms must contain a two-digit month; fragments such as 5-23 are not dates.
  return /^(?:0[1-9]|1[0-2])[/.\-](?:20)?\d{2}$/.test(raw) || /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(?:20)?\d{2}$/i.test(raw);
}

function classify(context:string):DateKind {
  const s=context.toLowerCase().replace(/[.:]/g,' ');
  if (/best\s*before|use\s*within/.test(s)) return 'best-before';
  if (/exp(?:iry|iration)?\s*(?:date|dt)?|use\s*by|use\s*before|expires|expiry|valid\s*until/.test(s)) return 'expiry';
  if (/mfg|manufactur(?:ed|ing)?|packed\s*on|pkd|date\s*of\s*manufacture/.test(s)) return 'manufacturing';
  return 'unknown';
}

export function extractDateCandidates(text:string):DateCandidate[] {
  const found:DateCandidate[]=[];const seen=new Set<string>();
  for(const pattern of DATE_PATTERNS){
    pattern.lastIndex=0;
    for(const match of text.matchAll(pattern)){
      const raw=match[0],index=match.index??0;
      if (!isPlausibleDate(raw)) continue;
      const lines=text.split(/\r?\n/);
      let offset=0, lineIndex=0;
      for(let i=0;i<lines.length;i++){if(index<=offset+lines[i].length){lineIndex=i;break;}offset+=lines[i].length+1;}
      const context=[lines[lineIndex-1]??'',lines[lineIndex]??'',lines[lineIndex+1]??''].join(' ').replace(/\s+/g,' ').trim().slice(0,220);
      // OCR may place a small date label on a neighbouring line or text block.
      // Fall back to a bounded window around the date when its own line has no label.
      const nearby=text.slice(Math.max(0,index-100),Math.min(text.length,index+raw.length+100)).replace(/\s+/g,' ');
      const localKind=classify(context);
      const kind=localKind==='unknown'?classify(nearby):localKind;
      const key=raw.toLowerCase();
      if(!seen.has(key)){seen.add(key);found.push({raw,context,kind});}
    }
  }
  const rank=(kind:DateKind)=>kind==='expiry'?0:kind==='best-before'?1:kind==='manufacturing'?2:3;
  return found.sort((a,b)=>rank(a.kind)-rank(b.kind));
}
export function firstTextValue(text:string,pattern:RegExp):string {
  return text.match(pattern)?.[1]?.trim()??'';
}
