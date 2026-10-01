import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const compareSource = source.slice(source.indexOf('function compareChannelRows('), source.indexOf('function sortChannelRows('));
const context = { Date, Number, String };
vm.createContext(context);
vm.runInContext(compareSource + ';globalThis.compare = compareChannelRows;', context);
const row = (name, order, started_at, status='online') => ({channel:{name,started_at,status,onLive:true},order});
describe('Popup display sort', () => {
  it('orders names without mutating saved order', () => {
    const rows=[row('zebra',0),row('Alpha',1),row('alpha',2)];
    expect([...rows].sort((a,b)=>context.compare(a,b,'name')).map(x=>x.order)).toEqual([1,2,0]);
    expect(rows.map(x=>x.order)).toEqual([0,1,2]);
  });
  it('sorts starts in both directions and puts stale/invalid times last', () => {
    const rows=[row('old',0,'2026-10-01T01:00:00Z'),row('new',1,'2026-10-01T02:00:00Z'),row('error',2,'2026-10-01T03:00:00Z','error'),row('bad',3,'invalid')];
    expect([...rows].sort((a,b)=>context.compare(a,b,'started_newest')).map(x=>x.order)).toEqual([1,0,2,3]);
    expect([...rows].sort((a,b)=>context.compare(a,b,'started_oldest')).map(x=>x.order)).toEqual([0,1,2,3]);
  });
  it('registered order is stable after a different display order',()=> {
    expect(context.compare(row('z',0),row('a',1),'registered')).toBe(-1);
  });
});
describe('Stream details',()=>{
  function run(channel){
    const elements={};
    const get=id=>elements[id]??=(id==='streamDetailsDialog'?{open:false,showModal(){this.open=true;}}:{textContent:''});
    const sandbox={document:{getElementById:get},chrome:{i18n:{getMessage:key=>key}},Date,Number,String};
    vm.createContext(sandbox);
    const fn=source.slice(source.indexOf('function showStreamDetails('),source.indexOf('// Sort only rendered row pairs;'));
    vm.runInContext(fn+';globalThis.show=showStreamDetails;',sandbox);
    sandbox.show(channel);
    sandbox.show(channel);
    return elements;
  }
  it('uses textContent for untrusted titles and shows current category',()=>{
    const e=run({name:'name',status:'online',onLive:true,title:'<img src=x onerror=alert(1)>',game_name:'Chess',started_at:'2026-10-01T01:00:00Z'});
    expect(e.streamDetailsTitle.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(e.streamDetailsTitle.innerHTML).toBeUndefined();
    expect(e.streamDetailsCategory.textContent).toBe('Chess');
    expect(e.streamDetailsDialog.open).toBe(true);
  });
  it('does not present cached metadata as current after a failed fetch',()=>{
    const e=run({name:'name',status:'error',onLive:true,title:'old',game_name:'Old',started_at:'2026-10-01T01:00:00Z'});
    expect(e.streamDetailsTitle.textContent).toBe('streamDetailsUnavailable');
    expect(e.streamDetailsCategory.textContent).toBe('—');
    expect(e.streamDetailsStarted.textContent).toBe('—');
  });
});

describe('Row pair sorting',()=>{
  it('keeps settings with its channel and preserves expanded state through repeated sorts',()=>{
    const nodes=[];
    const make=(kind,id)=>({id,classList:{contains:x=>x===kind},get nextElementSibling(){return nodes[nodes.indexOf(this)+1]||null;}});
    const a=make('channel-tr','z'),as=make('settings-tr','z-settings'),b=make('channel-tr','a'),bs=make('settings-tr','a-settings');
    as.hidden=false; bs.hidden=true; nodes.push(a,as,b,bs);
    const metadata=new WeakMap([[a,row('z',0)],[b,row('a',1)]]);
    const select={value:'name'};
    const sandbox={Array,Date,Number,String,channelRows:metadata,channelSort:select,channelTable:{querySelectorAll:()=>nodes.filter(x=>x.classList.contains('channel-tr')),appendChild(n){nodes.splice(nodes.indexOf(n),1);nodes.push(n);}}};
    vm.createContext(sandbox);
    vm.runInContext(source.slice(source.indexOf('function compareChannelRows('),source.indexOf('async function updateList('))+';globalThis.sort=sortChannelRows;',sandbox);
    sandbox.sort();
    expect(nodes.map(n=>n.id)).toEqual(['a','a-settings','z','z-settings']);
    select.value='registered';sandbox.sort();sandbox.sort();
    expect(nodes.map(n=>n.id)).toEqual(['z','z-settings','a','a-settings']);
    expect(as.hidden).toBe(false);expect(bs.hidden).toBe(true);
  });
});
