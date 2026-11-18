export type DateKind = 'expiry' | 'manufacturing' | 'best-before' | 'unknown';
export interface DateCandidate { raw: string; context: string; kind: DateKind; }
export interface PositionedOcrLine { text: string; left: number; top: number; right: number; bottom: number; }

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
  const s=context.toLowerCase()
    .replace(/[.:]/g,' ')
    .replace(/[|]/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  // Indian packaged food, cosmetics, household goods and OTC/pharma label wording.
  // Keep "best before" distinct from strict expiry/use-by language.
  const bestBefore = /\b(?:best\s*before(?:\s*end)?|best\s*before\s*(?:upto|up\s*to|within)|b\s*\.?\s*b\s*\.?\s*e\.?|bbe|bbd|bb\s*date|use\s*within|consume\s*within|consume\s*before|recommended\s*last\s*consumption(?:\s*date)?|last\s*date\s*of\s*consumption)\b/;
  const expiry = /\b(?:expiry|expires?|expiration|expir(?:y|ation)\s*(?:date|dt|on)?|exp\s*(?:date|dt|on)|exp\.?|e\.?\s*d\.?|use\s*by|use\s*before|use\s*upto|use\s*up\s*to|consume\s*by|consume\s*before\s*date|not\s*to\s*be\s*used\s*after|do\s*not\s*use\s*after|valid\s*(?:until|till|upto|up\s*to)|validity\s*(?:date|upto|up\s*to)|date\s*of\s*(?:expiry|expiration)|expiry\s*month|discard\s*after|do\s*not\s*consume\s*after|not\s*for\s*use\s*after)\b/;
  const manufacturing = /\b(?:mfg|mfd|manuf(?:acture|actured|acturing)?|manufactured\s*on|manufacturing\s*date|date\s*of\s*manufacture|mfg\s*(?:date|dt|on)|mfd\s*(?:date|dt|on)|dom|date\s*of\s*manufacture|production\s*date|prod\.?\s*(?:date|dt)|packed\s*on|packing\s*date|pkg\.?\s*(?:date|dt)|pkd|date\s*of\s*packing|date\s*packed)\b/;

  if (bestBefore.test(s)) return 'best-before';
  if (expiry.test(s)) return 'expiry';
  if (manufacturing.test(s)) return 'manufacturing';
  return 'unknown';
}


function classifyNearestLabel(text:string,dateIndex:number):DateKind {
  const labelPatterns: Array<{kind:DateKind; pattern:RegExp}> = [
    {kind:'manufacturing',pattern:/\b(?:mfg\.?\s*(?:date|dt|on)?|mfd\.?\s*(?:date|dt|on)?|manufactur(?:e|ed|ing)(?:\s*date)?|date\s*of\s*manufacture|dom|prod\.?\s*(?:date|dt)|production\s*date|pkd|pkg\.?\s*(?:date|dt)|packed\s*on|packing\s*date|date\s*packed)\b/gi},
    {kind:'best-before',pattern:/\b(?:best\s*before(?:\s*end)?|bbe|bbd|bb\s*date|use\s*within|consume\s*within|consume\s*before)\b/gi},
    {kind:'expiry',pattern:/\b(?:expiry|expires?|expiration|exp\.?\s*(?:date|dt|on)?|e\.?\s*d\.?|use\s*by|use\s*before|sell\s*by|sell\s*before|consume\s*by|valid\s*(?:until|till|upto|up\s*to)|discard\s*after|do\s*not\s*use\s*after)\b/gi}
  ];
  const labels:Array<{kind:DateKind;index:number;end:number}>=[];
  for(const item of labelPatterns){
    item.pattern.lastIndex=0;
    for(const m of text.matchAll(item.pattern)){
      const index=m.index??0;
      if(Math.abs(dateIndex-index)<=140) labels.push({kind:item.kind,index,end:index+m[0].length});
    }
  }
  if(!labels.length) return 'unknown';
  // Prefer the closest label before the date. A label after the date is a fallback.
  const preceding=labels.filter(x=>x.end<=dateIndex).sort((a,b)=>b.end-a.end)[0];
  if(preceding && dateIndex-preceding.end<=100) return preceding.kind;
  const following=labels.filter(x=>x.index>dateIndex).sort((a,b)=>a.index-b.index)[0];
  if(following && following.index-dateIndex<=45) return following.kind;
  return 'unknown';
}

export function extractDateCandidates(text:string, positionedLines:PositionedOcrLine[]=[]):DateCandidate[] {
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
      const localKind=classifyNearestLabel(text,index);
      let kind=localKind!=='unknown'?localKind:classify(context);
      if(kind==='unknown') kind=classify(nearby);
      // Associate a date with the nearest labelled OCR line using ML Kit geometry.
      if(kind==='unknown' && positionedLines.length){
        const dateLine=positionedLines.find(line=>line.text.toLowerCase().includes(raw.toLowerCase()));
        if(dateLine){
          const dateY=(dateLine.top+dateLine.bottom)/2;
          const candidates=positionedLines
            .filter(line=>line!==dateLine && classify(line.text)!=='unknown')
            .map(line=>({kind:classify(line.text),score:Math.abs((line.top+line.bottom)/2-dateY)/Math.max(1,dateLine.bottom-dateLine.top)+Math.abs((line.left+line.right)/2-(dateLine.left+dateLine.right)/2)/Math.max(1,dateLine.right-dateLine.left)}))
            .filter(item=>item.score<5)
            .sort((a,b)=>a.score-b.score);
          if(candidates.length) kind=candidates[0].kind;
        }
      }
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
