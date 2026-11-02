import { readFile, writeFile } from "node:fs/promises";
import { calcAPCA } from "apca-w3";

const imagery = process.argv.includes("--imagery");
const stem = imagery ? "imagery-comparison" : "prompt-comparison";
const data = JSON.parse(
  await readFile(new URL(`../benchmarks/${stem}.json`, import.meta.url), "utf8"),
);
for (const result of data.results) {
  result.foreground =
    result.color &&
    Math.abs(calcAPCA("#000000", result.color)) < Math.abs(calcAPCA("#FFFFFF", result.color))
      ? "#FFFFFF"
      : "#000000";
}
const payload = JSON.stringify(data).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Color prompt comparison</title>
<style>
*{box-sizing:border-box}body{margin:48px auto;padding:0 24px;max-width:1080px;background:#faf9f6;color:#242424;font:15px/1.6 system-ui,sans-serif}h1{font-size:34px;font-weight:500;letter-spacing:-1px;margin-bottom:8px}p{color:#555}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #ddd}th{font-weight:500}select{font:inherit;padding:8px 12px;background:transparent;border:1px solid #bbb;border-radius:4px;margin-left:12px}.swatch{min-height:72px;padding:12px;border-radius:4px;display:flex;flex-direction:column;justify-content:center;font-variant-numeric:tabular-nums}.meta{font-size:12px}pre{white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace;padding:20px;background:#efeee9}details{margin:24px 0}.scroll{overflow:auto}footer{font-size:12px;color:#666;margin:40px 0}#results td{width:25%;vertical-align:middle}button{font:inherit}h2{font-size:20px;font-weight:500}
</style>
<h1>The same input, different colors</h1>
<p>Jev 1.14 · Luna Decisions · All prompts are in English</p>
<p>${imagery ? `12 atmospheric inputs × ${Object.keys(data.prompts).length} English templates × 2 models, ${data.results.length} requests in total. Six paired scenes vary light, time, material, or mood, without reference colors or a fixed palette. Each cell is one sample. Variants were collected in separate runs; color diversity describes distribution, not expressive quality.` : "Historical comparison: 12 explicit colors are scored by exact HEX match; six associative inputs have no single reference answer. Exact matching does not measure expressive quality or determine the production model or template. Each cell is one sample."}</p>
<div class="scroll"><table id="summary"></table></div>
<h2>Compare results <select id="variant"></select></h2>
<p id="note"></p><div class="scroll"><table id="results"></table></div>
<details><summary>Show the English prompt and options</summary><pre id="prompt"></pre></details>
<footer>Latency includes local network conditions at a concurrency of three and does not represent production end-to-end latency. ${imagery ? "Six-digit HEX permits 16,777,216 combinations. The three-channel RGB variant omits 127 from each channel to meet the option limit while retaining 0 and 255, yielding 16,581,375 combinations. Neither uses a fixed palette." : "The historical fixed-palette variant does not meet the free-form color goal and is no longer recommended."}</footer>
<script>
const data=${payload};
const imagery=${imagery};
const labels={baseline:"Baseline",rules:"Explicit rules",indexed:"Per-digit examples",short:"Short questions",ranges:"Channel ranges",palette:"Full palette (28 colors)",evocative:"Atmospheric · six-digit HEX",evocative_ranges:"Atmospheric + channel ranges",rgb:"Three-channel RGB · atmospheric",rgb_short:"Three-channel RGB · short"};
const variants=Object.keys(data.prompts);
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function stats(provider,variant){const rows=data.results.filter(r=>r.provider===provider&&r.variant===variant);const exact=rows.filter(r=>r.expected);const times=rows.filter(r=>r.status===200).map(r=>r.ms).sort((a,b)=>a-b);return (imagery?new Set(rows.map(r=>r.color).filter(Boolean)).size+' colors · '+rows.filter(r=>r.color).length+'/'+rows.length+' valid':exact.filter(r=>r.exact).length+'/'+exact.length)+' · '+times[Math.floor(times.length/2)]+' ms';}
document.querySelector('#summary').innerHTML='<tr><th>Variant</th><th>Jev'+(imagery?'':': exact matches / median latency')+'</th><th>Luna'+(imagery?'':': exact matches / median latency')+'</th></tr>'+variants.map(v=>'<tr><td>'+labels[v]+'</td><td>'+stats('jev',v)+'</td><td>'+stats('luna',v)+'</td></tr>').join('');
const select=document.querySelector('#variant');select.innerHTML=variants.map(v=>'<option value="'+v+'">'+labels[v]+'</option>').join('');select.value=imagery?'rgb':'baseline';
function cell(r){return r?.color?'<div class="swatch" style="background:'+r.color+';color:'+r.foreground+'"><span>'+r.color+'</span><span class="meta">'+r.ms+' ms'+(r.expected?(r.exact?' · exact match':' · mismatch'):'')+'</span></div>':'No valid color';}
function render(){const v=select.value;const items=[...new Set(data.results.map(r=>r.text))];document.querySelector('#note').textContent=imagery?'Compare hue, lightness, and saturation across similar scenes. Greater variation or more colors does not necessarily mean a better interpretation.':v==='palette'?'Historical structural comparison; not the current recommendation.':'One request, six questions, 16 options per digit.';document.querySelector('#results').innerHTML='<tr><th>Input</th>'+(imagery?'':'<th>Expected (explicit colors)</th>')+'<th>Jev</th><th>Luna</th></tr>'+items.map(text=>{const j=data.results.find(r=>r.text===text&&r.variant===v&&r.provider==='jev');const l=data.results.find(r=>r.text===text&&r.variant===v&&r.provider==='luna');return '<tr><td>'+escape(text)+'</td>'+(imagery?'':'<td>'+escape(j.expected||'No single reference')+'</td>')+'<td>'+cell(j)+'</td><td>'+cell(l)+'</td></tr>';}).join('');document.querySelector('#prompt').textContent=JSON.stringify(data.prompts[v],null,2);}
select.onchange=render;render();
</script></html>`;
await writeFile(new URL(`../benchmarks/${stem}.html`, import.meta.url), html);
console.log(`Created benchmarks/${stem}.html`);
